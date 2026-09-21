import { RESOURCE_TYPE, type Resource, type ResourceType } from '../types/Resource'
import { extractTavernHelperScripts } from '../utils/TavernHelperScriptParser'
import { isRecord } from '../utils/UnknownValue'

export interface EmbeddedAssetCandidate {
  file: File
  type: ResourceType
  kind: 'worldBook' | 'regex' | 'script' | 'quickReply'
}

export function safeJsonFileName(value: string): string {
  const normalized = value
    .replace(/[\\/:*?"<>|]/g, '_')
    .trim()
    .slice(0, 120)
  return `${normalized || '角色卡配套资源'}.json`
}

export function isEmbeddedRegex(value: unknown): boolean {
  if (!isRecord(value)) return false
  return (
    (typeof value.findRegex === 'string' && typeof value.replaceString === 'string') ||
    (typeof value.find_regex === 'string' && typeof value.replace_string === 'string')
  )
}

export async function collectEmbeddedAssets(resource: Resource): Promise<EmbeddedAssetCandidate[]> {
  if (resource.type !== RESOURCE_TYPE.CHARACTER_CARD && resource.type !== RESOURCE_TYPE.PRESET)
    return []
  let root: Record<string, unknown> | undefined
  if (resource.type === RESOURCE_TYPE.CHARACTER_CARD) {
    root = isRecord(resource.metadata.card) ? resource.metadata.card : undefined
  } else {
    try {
      const parsed: unknown = JSON.parse(await resource.originalBlob.text())
      root = isRecord(parsed) ? parsed : undefined
    } catch {
      return []
    }
  }
  const data = root && isRecord(root.data) ? root.data : root
  if (!data) return []

  const candidates: EmbeddedAssetCandidate[] = []
  const worldBook = resource.type === RESOURCE_TYPE.CHARACTER_CARD ? data.character_book : undefined
  if (isRecord(worldBook)) {
    const entries = worldBook.entries
    const entryCount = Array.isArray(entries)
      ? entries.length
      : isRecord(entries)
        ? Object.keys(entries).length
        : 0
    if (entryCount > 0) {
      const name = `${resource.name} · 配套世界书`
      candidates.push({
        file: new File([JSON.stringify(worldBook, null, 2)], safeJsonFileName(name), {
          type: 'application/json',
        }),
        type: RESOURCE_TYPE.WORLD_BOOK,
        kind: 'worldBook',
      })
    }
  }

  const extensions = isRecord(data.extensions) ? data.extensions : undefined
  const regexScripts = Array.isArray(extensions?.regex_scripts)
    ? extensions.regex_scripts.filter(isEmbeddedRegex)
    : []
  if (regexScripts.length > 0) {
    const name = `${resource.name} · ${resource.type === RESOURCE_TYPE.PRESET ? '预设正则' : '配套正则'}`
    candidates.push({
      file: new File([JSON.stringify(regexScripts, null, 2)], safeJsonFileName(name), {
        type: 'application/json',
      }),
      type: RESOURCE_TYPE.REGEX,
      kind: 'regex',
    })
  }

  const tavernHelper = isRecord(extensions?.tavern_helper) ? extensions.tavern_helper : undefined
  const helperScripts = extractTavernHelperScripts(tavernHelper?.scripts ?? [], {
    source: 'character',
    fallbackName: resource.name,
  })
  if (tavernHelper && helperScripts.length > 0) {
    const name = `${resource.name} · 酒馆助手脚本`
    candidates.push({
      file: new File(
        [JSON.stringify({ name, scripts: tavernHelper.scripts }, null, 2)],
        safeJsonFileName(name),
        { type: 'application/json' },
      ),
      type: RESOURCE_TYPE.SCRIPT,
      kind: 'script',
    })
  }

  // SillyTavern 的角色专属“快速回复绑定”通常保存在扩展设置里，并不属于角色卡文件。
  // 少数打包工具会把完整 qrList 一并放在卡根对象上；仅在确实带有列表时拆出，避免虚构资源。
  const quickReplies = root && Array.isArray(root.qrList) ? root.qrList.filter(isRecord) : []
  if (resource.type === RESOURCE_TYPE.CHARACTER_CARD && quickReplies.length > 0) {
    const name = `${resource.name} · 配套快速回复`
    candidates.push({
      file: new File(
        [JSON.stringify({ name, qrList: quickReplies }, null, 2)],
        safeJsonFileName(name),
        { type: 'application/json' },
      ),
      type: RESOURCE_TYPE.QUICK_REPLY,
      kind: 'quickReply',
    })
  }

  return candidates
}
