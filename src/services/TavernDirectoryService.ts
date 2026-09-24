import type { TavernDirectoryStorage } from '../storage/TavernDirectoryStorage'
import { hashBlob } from './HashService'
import { PngResourceParser } from '../parser/PngResourceParser'
import { parseSillyTavernPersonaBackup } from '../parser/SillyTavernPersonaBackup'
import { isRecord } from '../utils/UnknownValue'
import { replacePngCharacterChunk } from '../utils/CharacterCardCustomization'
import type {
  TavernResourceItem,
  TavernResourceKind,
  TavernConflictPolicy,
} from './TavernBridgeProtocol'

const FOLDERS: Partial<Record<TavernResourceKind, string[]>> = {
  character: ['characters'],
  worldBook: ['worlds'],
  preset: ['OpenAI Settings', 'TextGen Settings', 'NovelAI Settings', 'KoboldAI Settings'],
  theme: ['themes'],
  quickReply: ['QuickReplies'],
  userAvatar: ['User Avatars'],
}
const MAX_BYTES = 256 * 1024 * 1024
const MAX_JSON_BYTES = 16 * 1024 * 1024
type Json = Record<string, unknown>
interface LocatedItem {
  item: TavernResourceItem
  path: string
  value?: unknown
  parentKind?: 'character' | 'preset'
}

function object(value: unknown): Json {
  return isRecord(value) ? value : {}
}
function nameOf(file: string): string {
  return file.replace(/\.[^.]+$/u, '')
}
function safeName(value: string): string {
  const name = value
    .split('')
    .map((char) => (char.charCodeAt(0) < 32 ? '_' : char))
    .join('')
    .replace(/[<>:"/\\|?*]/gu, '_')
    .replace(/[. ]+$/u, '')
    .trim()
    .slice(0, 110)
  if (
    !name ||
    name === '.' ||
    name === '..' ||
    /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(name)
  )
    throw new Error('资源名称不能作为文件名')
  return name
}
function jsonFile(value: unknown, name: string): File {
  return new File([JSON.stringify(value, null, 2)], `${safeName(name)}.json`, {
    type: 'application/json',
  })
}
async function parse(file: File): Promise<Json> {
  const value = await parseJson(file)
  if (!isRecord(value)) throw new Error(`${file.name} 不是有效 JSON 对象`)
  return value
}
async function parseJson(file: File): Promise<unknown> {
  if (file.size > MAX_JSON_BYTES) throw new Error('设置或 JSON 资源超过 16 MiB，停止读取')
  return JSON.parse(await file.text())
}
function entries(value: unknown): unknown[] {
  const wrapped = object(value)
  const result = Array.isArray(value) ? value : (wrapped.global ?? wrapped.scripts ?? [value])
  if (!Array.isArray(result) || !result.length) throw new Error('资源列表格式无效或为空')
  return result
}
function disableScripts(value: unknown): unknown {
  if (!Array.isArray(value)) throw new Error('脚本格式无效')
  return value.map((entry) => {
    const item = object(entry)
    if (item.type !== 'folder' && typeof item.content !== 'string')
      throw new Error('脚本缺少代码内容')
    return {
      ...item,
      type: item.type === 'folder' ? 'folder' : 'script',
      id: crypto.randomUUID(),
      enabled: false,
      ...(Array.isArray(item.scripts) ? { scripts: disableScripts(item.scripts) } : {}),
    }
  })
}

/** Offline adapter behind the existing TavernBridge service. Never reads secrets or chats. */
export class TavernDirectoryService {
  private readonly items = new Map<string, LocatedItem>()
  private writeChain: Promise<unknown> = Promise.resolve()
  readonly capabilities = [
    ...Object.keys(FOLDERS),
    'userPersona',
    'regexGlobal',
    'scriptGlobal',
    'regexCharacter',
    'regexPreset',
    'scriptCharacter',
    'scriptPreset',
    'persona-avatar-check-v1',
  ]
  readonly storage: TavernDirectoryStorage
  constructor(storage: TavernDirectoryStorage) {
    this.storage = storage
  }

  async validate(): Promise<void> {
    const entries = await this.storage.list('')
    if (
      !entries.some((entry) => entry.name === 'settings.json' && !entry.directory) ||
      !entries.some((entry) => entry.name === 'characters' && entry.directory)
    ) {
      throw new Error(
        '请选择包含 settings.json 和 characters 的酒馆用户目录，例如 data/default-user',
      )
    }
    await this.settings()
  }

  private async settings(): Promise<{ file: File; data: Json }> {
    const file = await this.storage.read('settings.json')
    if (!file) throw new Error('酒馆设置文件不存在，请重新绑定目录')
    return { file, data: await parse(file) }
  }

  async listResources(): Promise<TavernResourceItem[]> {
    this.items.clear()
    const add = (
      kind: TavernResourceKind,
      name: string,
      path: string,
      value?: unknown,
      parentKind?: 'character' | 'preset',
      key = name,
    ) => {
      const id = `${kind}:${path}:${value === undefined ? '' : encodeURIComponent(key)}`
      const item: TavernResourceItem = {
        id,
        kind,
        name,
        fileName: value === undefined ? path.split('/').at(-1)! : `${safeName(name)}.json`,
        detail: path,
      }
      this.items.set(id, { item, path, value, parentKind })
    }
    for (const [rawKind, folders] of Object.entries(FOLDERS)) {
      const kind = rawKind as TavernResourceKind
      for (const folder of folders) {
        for (const entry of await this.storage.list(folder)) {
          if (entry.directory || entry.name.startsWith('.')) continue
          const valid =
            kind === 'character'
              ? /\.png$/iu
              : kind === 'userAvatar'
                ? /\.(png|jpe?g|webp|gif)$/iu
                : /\.json$/iu
          if (!valid.test(entry.name)) continue
          const path = `${folder}/${entry.name}`
          add(kind, nameOf(entry.name), path)
          // Scoped scripts/regex are read only for their owning resource, not entire settings.
          if (kind === 'character' || kind === 'preset') {
            const file = await this.storage.read(path)
            if (!file || file.size > MAX_BYTES) continue
            const native = [...this.items.values()].find(
              (located) => located.path === path && located.item.kind === kind,
            )!
            native.item.contentHash = await hashBlob(file)
            native.item.size = file.size
            native.item.updatedAt = file.lastModified
            let data: Json
            try {
              data =
                kind === 'character'
                  ? object((await new PngResourceParser().parse(file)).metadata.card)
                  : await parse(file)
            } catch {
              continue
            }
            const extensions = object(
              (kind === 'character' ? object(data.data ?? data) : data).extensions,
            )
            const regex = extensions.regex_scripts
            const scripts =
              object(extensions.tavern_helper).scripts ?? extensions.TavernHelper_scripts
            if (Array.isArray(regex) && regex.length)
              add(
                kind === 'character' ? 'regexCharacter' : 'regexPreset',
                nameOf(entry.name),
                path,
                regex,
                kind,
              )
            if (Array.isArray(scripts) && scripts.length)
              add(
                kind === 'character' ? 'scriptCharacter' : 'scriptPreset',
                nameOf(entry.name),
                path,
                scripts,
                kind,
              )
          }
        }
      }
    }
    const { data } = await this.settings()
    const extension = object(data.extension_settings)
    const regex = Array.isArray(extension.regex) ? extension.regex : []
    for (const entry of regex)
      add(
        'regexGlobal',
        String(object(entry).scriptName || object(entry).id || '正则'),
        'settings.json',
        entry,
        undefined,
        await hashBlob(jsonFile(entry, 'regex')),
      )
    const scripts =
      object(object(extension.tavern_helper).script).scripts ??
      object(object(extension.TavernHelper).script).scripts
    if (Array.isArray(scripts))
      for (const entry of scripts)
        add(
          'scriptGlobal',
          String(object(entry).name || object(entry).id || '脚本'),
          'settings.json',
          entry,
          undefined,
          await hashBlob(jsonFile(entry, 'script')),
        )
    for (const [avatarId, name] of Object.entries(object(data.personas))) {
      add('userPersona', String(name), `persona/${avatarId}`, {
        personas: { [avatarId]: name },
        persona_descriptions: { [avatarId]: object(data.persona_descriptions)[avatarId] ?? {} },
        default_persona: data.default_persona === avatarId ? avatarId : undefined,
      })
    }
    return [...this.items.values()].map(({ item }) => ({ ...item }))
  }

  async pullResources(items: TavernResourceItem[]): Promise<File[]> {
    const result: File[] = []
    if (!this.items.size) await this.listResources()
    for (const item of items) {
      const entry = this.items.get(item.id)
      if (!entry) throw new Error(`${item.name} 已不存在，请刷新目录`)
      if (entry.value !== undefined) {
        const current = await this.readEmbedded(entry)
        const value =
          item.kind === 'regexGlobal'
            ? { global: [current], sourceName: item.name }
            : item.kind.startsWith('regex')
              ? { scripts: current, sourceName: item.name, scope: entry.parentKind }
              : item.kind.startsWith('script')
                ? {
                    scripts: Array.isArray(current) ? current : [current],
                    sourceName: item.name,
                    scope: entry.parentKind || 'global',
                  }
                : current
        result.push(jsonFile(value, item.name))
      } else {
        const file = await this.storage.read(entry.path)
        if (!file || file.size > MAX_BYTES) throw new Error(`${item.name} 不可读取或超过 256 MiB`)
        result.push(file)
      }
    }
    return result
  }

  private async readEmbedded(entry: LocatedItem): Promise<unknown> {
    if (entry.parentKind) {
      const file = await this.storage.read(entry.path)
      if (!file || file.size > MAX_BYTES) throw new Error('绑定资源已不存在或过大，请刷新目录')
      const card =
        entry.parentKind === 'character'
          ? object((await new PngResourceParser().parse(file)).metadata.card)
          : await parse(file)
      const data = entry.parentKind === 'character' ? object(card.data ?? card) : card
      const ext = object(data.extensions)
      const result = entry.item.kind.startsWith('regex')
        ? ext.regex_scripts
        : (object(ext.tavern_helper).scripts ?? ext.TavernHelper_scripts)
      if (!Array.isArray(result) || !result.length)
        throw new Error('绑定的正则或脚本已变化，请刷新目录')
      return result
    }
    const { data } = await this.settings()
    if (entry.item.kind === 'userPersona') {
      const id = entry.path.slice('persona/'.length)
      if (!Object.hasOwn(object(data.personas), id)) throw new Error('人设已不存在，请刷新目录')
      return {
        personas: { [id]: object(data.personas)[id] },
        persona_descriptions: { [id]: object(data.persona_descriptions)[id] ?? {} },
        ...(data.default_persona === id ? { default_persona: id } : {}),
      }
    }
    const ext = object(data.extension_settings)
    const candidates =
      entry.item.kind === 'regexGlobal'
        ? ext.regex
        : (object(object(ext.tavern_helper).script).scripts ??
          object(object(ext.TavernHelper).script).scripts)
    if (Array.isArray(candidates)) {
      for (const value of candidates) {
        if (object(entry.value).id && object(value).id === object(entry.value).id) return value
        if (JSON.stringify(value) === JSON.stringify(entry.value)) return value
      }
    }
    throw new Error('正则或脚本已变化，请刷新目录')
  }

  async checkUserAvatarIds(ids: string[]): Promise<Set<string>> {
    const names = new Set(
      (await this.storage.list('User Avatars'))
        .filter((entry) => !entry.directory)
        .map((entry) => entry.name),
    )
    return new Set(ids.filter((id) => names.has(id)))
  }

  private async writeProtected(path: string, blob: Blob, previous: File | null): Promise<void> {
    const beforeHash = previous ? await hashBlob(previous) : null
    if (previous) {
      const backup = `.srl-backups/${crypto.randomUUID()}/${path}`
      await this.storage.write(backup, previous, null)
    }
    await this.storage.write(path, blob, beforeHash)
  }

  sendFiles(
    files: Array<{
      file: File
      kind: TavernResourceKind
      displayName: string
      targetName?: string
    }>,
    policy: TavernConflictPolicy,
    progress?: (completed: number, total: number, detail?: string) => void,
  ): Promise<Array<{ name: string; status: string }>> {
    const run = this.writeChain.then(async () => {
      const results = []
      for (const [index, item] of files.entries()) {
        if (item.file.size > MAX_BYTES) throw new Error('文件超过 256 MiB')
        progress?.(index, files.length, `正在校验并写入 ${item.displayName}`)
        results.push(await this.writeResource(item, policy))
        progress?.(index + 1, files.length, '已写入目录，下次启动酒馆后可用')
      }
      return results
    })
    this.writeChain = run.catch(() => undefined)
    return run
  }

  private async writeResource(
    item: { file: File; kind: TavernResourceKind; displayName: string; targetName?: string },
    policy: TavernConflictPolicy,
  ): Promise<{ name: string; status: string }> {
    if (item.kind === 'userPersona' || item.kind === 'regexGlobal' || item.kind === 'scriptGlobal')
      return this.mergeSettings(item, policy)
    if (['regexCharacter', 'regexPreset', 'scriptCharacter', 'scriptPreset'].includes(item.kind))
      return this.mergeScoped(item, policy)
    let folders = FOLDERS[item.kind]
    if (!folders) throw new Error('此资源不支持目录写入')
    let blob: Blob = item.file
    let stem = safeName(item.displayName || nameOf(item.file.name))
    let extension = '.json'
    if (item.kind === 'character') {
      const parsed = await new PngResourceParser().parse(item.file)
      stem = safeName(parsed.name)
      extension = '.png'
    } else if (item.kind === 'userAvatar') {
      const requested = safeName(item.targetName || item.file.name)
      if (!/\.(png|jpe?g|webp|gif)$/iu.test(requested) || !item.file.type.startsWith('image/'))
        throw new Error('头像必须是图片文件')
      stem = nameOf(requested)
      extension = requested.slice(stem.length)
    } else {
      const data = await parse(item.file)
      if (item.kind === 'worldBook' && !isRecord(data.entries))
        throw new Error('世界书缺少 entries')
      if (item.kind === 'preset') {
        // Existing names identify the API family; new presets use distinctive native fields.
        const matches = []
        for (const folder of folders)
          if (await this.storage.read(`${folder}/${stem}.json`)) matches.push(folder)
        if (matches.length > 1) throw new Error('多个 API 类型有同名预设，请先使用在线互传指定类型')
        const inferred =
          'openai_max_tokens' in data || 'chat_completion_source' in data
            ? 'OpenAI Settings'
            : 'textgenerationwebui_max_context' in data || 'sampler_order' in data
              ? 'TextGen Settings'
              : 'nai_preamble' in data
                ? 'NovelAI Settings'
                : undefined
        if (!matches.length && !inferred) throw new Error('无法确定预设的 API 类型，请使用在线互传')
        folders = [matches[0] || inferred!]
      }
      if (item.kind === 'theme' || item.kind === 'quickReply')
        blob = jsonFile({ ...data, name: stem }, stem)
    }
    let path = `${folders[0]}/${stem}${extension}`
    let previous = await this.storage.read(path)
    if (previous && (await hashBlob(previous)) === (await hashBlob(blob)))
      return { name: stem, status: 'skipped' }
    if (previous && policy === 'skip') return { name: stem, status: 'skipped' }
    if (previous && policy === 'copy') {
      let index = 2
      const base = stem
      while (true) {
        stem = `${base} (SRL ${index})`
        const candidate = await this.copyBlob(item.file, item.kind, stem)
        const existing = await this.storage.read(`${folders[0]}/${stem}${extension}`)
        if (!existing) {
          blob = candidate
          break
        }
        if ((await hashBlob(existing)) === (await hashBlob(candidate)))
          return { name: stem, status: 'skipped' }
        if (++index > 10000) throw new Error('同名副本过多，请整理目录后重试')
      }
      path = `${folders[0]}/${stem}${extension}`
      previous = null
    }
    await this.writeProtected(path, blob, previous)
    return { name: stem, status: previous ? 'overwritten' : 'created' }
  }

  private async copyBlob(file: File, kind: TavernResourceKind, stem: string): Promise<Blob> {
    if (kind === 'theme' || kind === 'quickReply')
      return jsonFile({ ...(await parse(file)), name: stem }, stem)
    if (kind !== 'character') return file
    const parsed = await new PngResourceParser().parse(file)
    const card = object(parsed.metadata.card)
    object(card.data ?? card).name = stem
    if (Object.hasOwn(card, 'name')) card.name = stem
    return replacePngCharacterChunk(file, String(parsed.metadata.characterCardChunk), card)
  }

  private async mergeSettings(
    item: { file: File; kind: TavernResourceKind; displayName: string },
    policy: TavernConflictPolicy,
  ) {
    const { file, data } = await this.settings()
    const parsedInput = await parseJson(item.file)
    const input = object(parsedInput)
    if (item.kind === 'userPersona') {
      parseSillyTavernPersonaBackup(input)
      const personas = { ...object(data.personas) }
      const descriptions = { ...object(data.persona_descriptions) }
      for (const [id, name] of Object.entries(object(input.personas))) {
        if (safeName(id) !== id || !/\.(png|jpe?g|webp|gif)$/iu.test(id))
          throw new Error('人设头像文件名无效')
        if (Object.hasOwn(personas, id) && policy === 'copy')
          throw new Error('人设不能创建同头像键副本，请选择跳过或覆盖')
        if (Object.hasOwn(personas, id) && policy === 'skip') continue
        if (!(await this.storage.read(`User Avatars/${id}`)))
          throw new Error(`人设缺少头像 ${id}，请先传送头像后重试`)
        personas[id] = name
        descriptions[id] = object(input.persona_descriptions)[id] ?? {}
      }
      data.personas = personas
      data.persona_descriptions = descriptions
    } else {
      const ext = { ...object(data.extension_settings) }
      const scripts = item.kind === 'scriptGlobal'
      const helper = { ...object(ext.TavernHelper), ...object(ext.tavern_helper) }
      const branch = {
        ...object(object(ext.TavernHelper).script),
        ...object(object(ext.tavern_helper).script),
      }
      const current = scripts ? branch.scripts : ext.regex
      const incoming = entries(parsedInput)
      const merged = this.mergeEntries(
        Array.isArray(current) ? current : [],
        incoming,
        policy,
        scripts,
      )
      if (scripts) {
        branch.scripts = merged
        helper.script = branch
        ext.tavern_helper = helper
        delete ext.TavernHelper
      } else ext.regex = merged
      data.extension_settings = ext
    }
    const next = jsonFile(data, 'settings')
    if (JSON.stringify(await parse(file)) === JSON.stringify(data))
      return { name: item.displayName, status: 'skipped' }
    await this.writeProtected('settings.json', next, file)
    return { name: item.displayName, status: 'updated' }
  }

  private mergeEntries(
    current: unknown[],
    incoming: unknown[],
    policy: TavernConflictPolicy,
    scripts: boolean,
  ): unknown[] {
    const result = [...current]
    for (const value of incoming) {
      const entry = object(value)
      if (!Object.keys(entry).length) throw new Error('正则或脚本条目无效')
      const key = scripts ? 'name' : 'scriptName'
      const index = result.findIndex(
        (candidate) =>
          (entry.id && object(candidate).id === entry.id) ||
          (entry[key] && object(candidate)[key] === entry[key]),
      )
      if (index >= 0 && policy === 'skip') continue
      let next = scripts
        ? object((disableScripts([entry]) as unknown[])[0])
        : { ...entry, id: crypto.randomUUID() }
      if (index >= 0 && policy === 'copy')
        next = {
          ...next,
          [key]: `${String(entry[key] || '资源')} (SRL ${crypto.randomUUID().slice(0, 6)})`,
        }
      if (index >= 0 && policy === 'overwrite') result[index] = next
      else result.push(next)
    }
    return result
  }

  private async mergeScoped(
    item: { file: File; kind: TavernResourceKind; displayName: string; targetName?: string },
    policy: TavernConflictPolicy,
  ) {
    if (!item.targetName) throw new Error('请指定绑定的角色卡或预设名称')
    await this.listResources()
    const character = item.kind.endsWith('Character')
    const matches = [...this.items.values()].filter(
      ({ item: candidate }) =>
        candidate.kind === (character ? 'character' : 'preset') &&
        candidate.name === item.targetName,
    )
    if (matches.length !== 1) throw new Error('绑定目标不存在或不唯一，请核对角色卡／预设名称')
    const target = matches[0]!
    const file = await this.storage.read(target.path)
    if (!file) throw new Error('绑定目标已不存在')
    const parsed = character ? await new PngResourceParser().parse(file) : undefined
    const card = character ? object(parsed!.metadata.card) : await parse(file)
    const data = character ? object(card.data ?? card) : card
    const ext = { ...object(data.extensions) }
    const input = await parseJson(item.file)
    const scripts = item.kind.startsWith('script')
    const helper = { ...object(ext.tavern_helper) }
    const current = scripts ? (helper.scripts ?? ext.TavernHelper_scripts) : ext.regex_scripts
    const incoming = entries(input)
    const merged = this.mergeEntries(
      Array.isArray(current) ? current : [],
      incoming,
      policy,
      scripts,
    )
    if (JSON.stringify(merged) === JSON.stringify(current))
      return { name: item.displayName, status: 'skipped' }
    if (scripts) {
      helper.scripts = merged
      ext.tavern_helper = helper
      delete ext.TavernHelper_scripts
    } else ext.regex_scripts = merged
    data.extensions = ext
    const blob = character
      ? await replacePngCharacterChunk(file, String(parsed!.metadata.characterCardChunk), card)
      : jsonFile(card, target.item.name)
    await this.writeProtected(target.path, blob, file)
    return { name: item.displayName, status: 'updated' }
  }
}
