import type { Resource } from '../types/Resource'
import { RESOURCE_TYPE } from '../types/Resource'
import { computeCardFingerprints } from './CharacterCardFingerprint'
import { isRecord } from './UnknownValue'
import type { EntryDiff, FieldDiff, LineDiffOp } from './ResourceDiffShared'
import { asText, diffLines, pushFieldDiff, stableJson } from './ResourceDiffShared'
export { diffLines } from './ResourceDiffShared'
export type { EntryDiff, FieldDiff, LineDiffOp } from './ResourceDiffShared'
import { diffHelperScripts, readHelperScripts } from './ResourceHelperScriptDiff'
import { diffRegexRules, readRegexRules } from './ResourceRegexDiff'

/**
 * 版本对比。
 *
 * 全部在本地内存中完成：角色卡按卡内字段对比，世界书按条目对比，
 * 其他文本资源按行对比。只读取两份资源的元数据与原始文件文本，
 * 不修改任何资源、版本记录或导出内容。
 */

export interface ResourceDiffResult {
  kind: 'identical' | 'character' | 'worldBook' | 'text' | 'binary'
  fields: FieldDiff[]
  entries: EntryDiff[]
  regexRules?: EntryDiff[]
  scriptItems?: EntryDiff[]
  lines: LineDiffOp[]
  summary: { added: number; removed: number; changed: number }
  /** 附加说明，例如「卡内数据完全一致，差异仅在封装/立绘」。 */
  note?: string
}

function readCardData(resource: Resource): Record<string, unknown> | undefined {
  const card = isRecord(resource.metadata.card) ? resource.metadata.card : undefined
  const data = card?.data ?? card
  return isRecord(data) ? data : undefined
}

/** SillyTavern 角色卡的对比字段清单（v2/v3 通用）。 */
const CHARACTER_FIELDS: Array<{ key: string; label: string }> = [
  { key: 'name', label: '名称' },
  { key: 'description', label: '描述' },
  { key: 'personality', label: '性格' },
  { key: 'scenario', label: '场景' },
  { key: 'first_mes', label: '主开场白' },
  { key: 'mes_example', label: '对话示例' },
  { key: 'system_prompt', label: '系统提示' },
  { key: 'post_history_instructions', label: '历史后指令' },
  { key: 'creator_notes', label: '创作者注释' },
  { key: 'creator', label: '创作者' },
  { key: 'character_version', label: '角色版本号' },
  { key: 'tags', label: '标签' },
]

interface NormalizedEntry {
  key: string
  label: string
  content: string
  value: Record<string, unknown>
}

function otherCharacterSettings(data: Record<string, unknown>): Record<string, unknown> {
  const remaining = { ...data }
  for (const { key } of CHARACTER_FIELDS) delete remaining[key]
  delete remaining.alternate_greetings

  if (isRecord(remaining.character_book)) {
    const settings = { ...remaining.character_book }
    delete settings.entries
    if (Object.keys(settings).length) remaining.character_book = settings
    else delete remaining.character_book
  }
  return remaining
}

function formatOtherCharacterSettings(value: Record<string, unknown>): string {
  const text = JSON.stringify(value, null, 2) ?? '{}'
  const maxLength = 12_000
  if (text.length <= maxLength) return text
  const edgeLength = maxLength / 2
  return `${text.slice(0, edgeLength)}\n…（中间省略 ${text.length - maxLength} 个字符）…\n${text.slice(-edgeLength)}`
}

function normalizeWorldBookEntries(value: unknown): NormalizedEntry[] {
  const rawEntries: unknown[] = Array.isArray(value)
    ? value
    : isRecord(value)
      ? Object.entries(value).map(([key, entry]) =>
          isRecord(entry) ? { __recordKey: key, ...entry } : entry,
        )
      : []
  return rawEntries.filter(isRecord).map((entry, index) => {
    const uid = entry.uid ?? entry.id ?? entry.__recordKey
    const keys = Array.isArray(entry.key) ? entry.key : Array.isArray(entry.keys) ? entry.keys : []
    const comment = asText(entry.comment) || asText(entry.name)
    const label =
      comment || (keys.length ? keys.map(asText).filter(Boolean).join('、') : `条目 ${index + 1}`)
    const { __recordKey: _recordKey, ...rest } = entry
    return {
      key: uid !== undefined && uid !== null && uid !== '' ? `uid:${String(uid)}` : `idx:${index}`,
      label,
      content: normalizedWorldBookEntryContent(rest),
      value: rest,
    }
  })
}

const WORLD_BOOK_FIELD_SPECS: Array<{
  label: string
  keys: string[]
  format?: (value: unknown) => string
}> = [
  { label: '条目名称', keys: ['comment', 'name'], format: asText },
  { label: '条目内容', keys: ['content'], format: asText },
  { label: '触发关键词', keys: ['keys', 'key'], format: asText },
  { label: '辅助关键词', keys: ['secondary_keys', 'keysecondary'], format: asText },
  { label: '是否启用', keys: ['enabled'], format: formatWorldBookEnabled },
  { label: '是否启用', keys: ['disable'], format: formatWorldBookDisabled },
  { label: '触发模式', keys: ['constant'], format: (value) => (value ? '常驻' : '关键词触发') },
  { label: '插入位置', keys: ['position'], format: formatWorldBookPosition },
  { label: '插入深度', keys: ['depth'], format: formatWorldBookDepth },
  { label: '插入角色', keys: ['role'], format: formatWorldBookRole },
  { label: '触发概率', keys: ['probability'], format: formatWorldBookProbability },
  { label: '扫描聊天范围', keys: ['scan_depth'], format: formatWorldBookScanDepth },
  { label: '关键词匹配方式', keys: ['selectiveLogic'], format: formatWorldBookLogic },
  { label: '区分大小写', keys: ['case_sensitive'], format: formatBoolean },
  { label: '整词匹配', keys: ['matchWholeWords'], format: formatBoolean },
  { label: '按正则匹配', keys: ['use_regex'], format: formatBoolean },
  { label: '向量化检索', keys: ['vectorized'], format: formatBoolean },
  { label: '插入顺序', keys: ['order'], format: asText },
]

function normalizedWorldBookEntryContent(entry: Record<string, unknown>): string {
  const knownKeys = new Set(WORLD_BOOK_FIELD_SPECS.flatMap((field) => field.keys))
  for (const key of ['extensions', 'uid', 'id', 'comment', 'name', '__recordKey'])
    knownKeys.add(key)
  const fields = WORLD_BOOK_FIELD_SPECS.flatMap((field) => {
    const value = readWorldBookField(entry, field.keys)
    return value === undefined ? [] : [[field.label, (field.format ?? asText)(value)] as const]
  })
  const unknown = Object.fromEntries(Object.entries(entry).filter(([key]) => !knownKeys.has(key)))
  const extensions = isRecord(entry.extensions) ? entry.extensions : {}
  const unknownExtensions = Object.fromEntries(
    Object.entries(extensions).filter(([key]) => !knownKeys.has(key)),
  )
  return stableJson({ fields, unknown, unknownExtensions })
}

const WORLD_BOOK_POSITION_LABELS: Record<string, string> = {
  '0': '主提示词之前',
  '1': '主提示词之后',
  '2': '作者注顶部',
  '3': '作者注底部',
  '4': '聊天消息深度位置',
  '5': '示例消息顶部',
  '6': '示例消息底部',
  before_char: '角色设定之前',
  after_char: '角色设定之后',
  before_example: '示例消息之前',
  after_example: '示例消息之后',
  at_depth: '聊天消息深度位置',
  '@depth': '聊天消息深度位置',
}

function formatBoolean(value: unknown): string {
  return value === true ? '是' : value === false ? '否' : asText(value)
}

function formatWorldBookEnabled(value: unknown): string {
  return typeof value === 'boolean'
    ? value
      ? '启用'
      : '停用'
    : value === 1 || value === 'true'
      ? '启用'
      : value === 0 || value === 'false'
        ? '停用'
        : '启用'
}

function formatWorldBookDisabled(value: unknown): string {
  return value === true || value === 1 || value === 'true' ? '停用' : '启用'
}

function formatWorldBookPosition(value: unknown): string {
  const raw = asText(value)
  return WORLD_BOOK_POSITION_LABELS[raw] ?? (raw ? '插入位置已调整' : '未设置')
}

function formatWorldBookDepth(value: unknown): string {
  if (value == null) return '未设置'
  const depth = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(depth)) return asText(value) || '未设置'
  return depth === 0 ? '最近一条消息之后' : `聊天记录中距最近消息 ${depth} 层的位置`
}

function formatWorldBookScanDepth(value: unknown): string {
  if (value == null) return '使用默认范围'
  const depth = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(depth)) return asText(value) || '使用默认范围'
  return depth === 0 ? '仅检查递归条目和作者注' : `检查最近 ${depth} 条聊天消息`
}

function formatWorldBookRole(value: unknown): string {
  const roles: Record<string, string> = {
    '0': '系统',
    '1': '用户',
    '2': '助手',
    system: '系统',
    user: '用户',
    assistant: '助手',
  }
  const raw = asText(value)
  return roles[raw] ?? (raw || '未设置')
}

function formatWorldBookProbability(value: unknown): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return asText(value) || '默认'
  return `${value <= 1 ? Math.round(value * 100) : value}%`
}

function formatWorldBookLogic(value: unknown): string {
  const modes: Record<string, string> = {
    '0': '任意关键词满足即可',
    '1': '不满足全部关键词时触发',
    '2': '不满足任意关键词时触发',
    '3': '全部关键词都满足才触发',
  }
  return modes[asText(value)] ?? (asText(value) || '默认')
}

function readWorldBookField(entry: Record<string, unknown> | undefined, keys: string[]): unknown {
  if (!entry) return undefined
  const extensions = isRecord(entry.extensions) ? entry.extensions : undefined
  for (const key of keys) {
    if (entry[key] !== undefined) return entry[key]
    if (extensions?.[key] !== undefined) return extensions[key]
  }
  return undefined
}

function worldBookEntryDetails(
  oldEntry: Record<string, unknown> | undefined,
  newEntry: Record<string, unknown> | undefined,
): FieldDiff[] {
  const fields: FieldDiff[] = []
  const knownKeys = new Set(WORLD_BOOK_FIELD_SPECS.flatMap((field) => field.keys))
  knownKeys.add('extensions')
  knownKeys.add('uid')
  knownKeys.add('id')
  knownKeys.add('comment')
  knownKeys.add('name')
  knownKeys.add('__recordKey')

  for (const spec of WORLD_BOOK_FIELD_SPECS) {
    const oldValue = readWorldBookField(oldEntry, spec.keys)
    const newValue = readWorldBookField(newEntry, spec.keys)
    if (oldValue === undefined && newValue === undefined) continue
    const format = spec.format ?? asText
    pushFieldDiff(
      fields,
      spec.label,
      oldValue === undefined ? '' : format(oldValue),
      newValue === undefined ? '' : format(newValue),
    )
  }

  const readUnknownSettings = (value: Record<string, unknown> | undefined) => {
    const unknownFields = Object.fromEntries(
      Object.entries(value ?? {}).filter(([key]) => !knownKeys.has(key)),
    )
    const extensions = isRecord(value?.extensions) ? value.extensions : {}
    const unknownExtensions = Object.fromEntries(
      Object.entries(extensions).filter(([key]) => !knownKeys.has(key)),
    )
    return { unknownFields, unknownExtensions }
  }
  const oldUnknown = readUnknownSettings(oldEntry)
  const newUnknown = readUnknownSettings(newEntry)
  if (
    stableJson(oldUnknown.unknownFields) !== stableJson(newUnknown.unknownFields) ||
    stableJson(oldUnknown.unknownExtensions) !== stableJson(newUnknown.unknownExtensions)
  ) {
    fields.push({
      label: '其他高级设置',
      status: oldEntry ? (newEntry ? 'changed' : 'removed') : 'added',
      oldText: oldEntry
        ? stableJson({
            fields: oldUnknown.unknownFields,
            extensions: oldUnknown.unknownExtensions,
          })
        : '',
      newText: newEntry
        ? stableJson({
            fields: newUnknown.unknownFields,
            extensions: newUnknown.unknownExtensions,
          })
        : '',
    })
  }
  return fields
}

function diffEntries(oldEntries: NormalizedEntry[], newEntries: NormalizedEntry[]): EntryDiff[] {
  const oldByKey = new Map(oldEntries.map((entry) => [entry.key, entry]))
  const matchedOldKeys = new Set<string>()
  const diffs: EntryDiff[] = []
  for (const entry of newEntries) {
    let previous = oldByKey.get(entry.key)
    if (previous) matchedOldKeys.add(previous.key)
    else {
      previous = oldEntries.find(
        (candidate) => !matchedOldKeys.has(candidate.key) && candidate.content === entry.content,
      )
      if (previous) matchedOldKeys.add(previous.key)
    }
    if (!previous) {
      diffs.push({
        key: entry.key,
        label: entry.label,
        status: 'added',
        lines: diffLines('', entry.content),
        details: worldBookEntryDetails(undefined, entry.value),
      })
    } else if (previous.content !== entry.content) {
      diffs.push({
        key: entry.key,
        label: entry.label,
        status: 'changed',
        lines: diffLines(previous.content, entry.content),
        details: worldBookEntryDetails(previous.value, entry.value),
      })
    }
  }
  for (const entry of oldEntries) {
    if (!matchedOldKeys.has(entry.key)) {
      diffs.push({
        key: entry.key,
        label: entry.label,
        status: 'removed',
        lines: diffLines(entry.content, ''),
        details: worldBookEntryDetails(entry.value, undefined),
      })
    }
  }
  return diffs
}

function summarize(result: Omit<ResourceDiffResult, 'summary'>): ResourceDiffResult {
  const counters = { added: 0, removed: 0, changed: 0 }
  for (const field of result.fields) counters[field.status] += 1
  for (const entry of result.entries) counters[entry.status] += 1
  if (result.kind === 'text') {
    counters.added += result.lines.filter((op) => op.type === 'added').length
    counters.removed += result.lines.filter((op) => op.type === 'removed').length
  }
  return { ...result, summary: counters }
}

function diffCharacterCards(oldResource: Resource, newResource: Resource): ResourceDiffResult {
  const oldData = readCardData(oldResource) ?? {}
  const newData = readCardData(newResource) ?? {}
  const fields: FieldDiff[] = []
  for (const { key, label } of CHARACTER_FIELDS) {
    pushFieldDiff(fields, label, asText(oldData[key]), asText(newData[key]))
  }

  // 备用开场白按位置逐条对比：作者通常在末尾追加或就地修改。
  const oldGreetings = Array.isArray(oldData.alternate_greetings)
    ? oldData.alternate_greetings.map(asText)
    : []
  const newGreetings = Array.isArray(newData.alternate_greetings)
    ? newData.alternate_greetings.map(asText)
    : []
  const greetingCount = Math.max(oldGreetings.length, newGreetings.length)
  for (let index = 0; index < greetingCount; index += 1) {
    pushFieldDiff(
      fields,
      `备用开场白 ${index + 1}`,
      oldGreetings[index] ?? '',
      newGreetings[index] ?? '',
    )
  }

  // 卡内世界书按条目对比；卡内正则按名称集合提示增删。
  const oldBook = isRecord(oldData.character_book) ? oldData.character_book.entries : undefined
  const newBook = isRecord(newData.character_book) ? newData.character_book.entries : undefined
  const entries = diffEntries(
    normalizeWorldBookEntries(oldBook),
    normalizeWorldBookEntries(newBook),
  )

  const readRegexNames = (data: Record<string, unknown>): string[] => {
    const extensions = isRecord(data.extensions) ? data.extensions : undefined
    const scripts = Array.isArray(extensions?.regex_scripts) ? extensions.regex_scripts : []
    return scripts
      .filter(isRecord)
      .map(
        (script, index) => asText(script.scriptName) || asText(script.name) || `正则 ${index + 1}`,
      )
  }
  pushFieldDiff(
    fields,
    '卡内正则清单',
    readRegexNames(oldData).join('\n'),
    readRegexNames(newData).join('\n'),
  )

  const oldOtherSettings = otherCharacterSettings(oldData)
  const newOtherSettings = otherCharacterSettings(newData)
  const oldOtherJson = stableJson(oldOtherSettings)
  const newOtherJson = stableJson(newOtherSettings)
  if (oldOtherJson !== newOtherJson) {
    const label =
      oldOtherJson.length > 12_000 || newOtherJson.length > 12_000
        ? '其他卡内设置（超长 JSON 显示首尾节选）'
        : '其他卡内设置'
    pushFieldDiff(
      fields,
      label,
      oldOtherJson === '{}' ? '' : formatOtherCharacterSettings(oldOtherSettings),
      newOtherJson === '{}' ? '' : formatOtherCharacterSettings(newOtherSettings),
    )
  }

  return summarize({ kind: 'character', fields, entries, lines: [] })
}

async function readBlobText(resource: Resource): Promise<string | undefined> {
  const looksTextual =
    /^(?:application\/json|text\/)/i.test(resource.mimeType) ||
    /\.(?:json|txt|md|css|js|mjs|yaml|yml|html)$/i.test(resource.fileName)
  if (!looksTextual) return undefined
  try {
    return await resource.originalBlob.text()
  } catch {
    return undefined
  }
}

function prettyIfJson(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2)
  } catch {
    return text
  }
}

function readWorldBookEntries(text: string): NormalizedEntry[] | undefined {
  try {
    const parsed = JSON.parse(text) as unknown
    if (isRecord(parsed) && ('entries' in parsed || Array.isArray(parsed))) {
      return normalizeWorldBookEntries(isRecord(parsed) ? parsed.entries : parsed)
    }
  } catch {
    // 非 JSON 时走文本 diff
  }
  return undefined
}

function parseJsonValue(text: string): unknown {
  try {
    return JSON.parse(text) as unknown
  } catch {
    return undefined
  }
}

export async function diffResources(
  oldResource: Resource,
  newResource: Resource,
): Promise<ResourceDiffResult> {
  if (oldResource.contentHash === newResource.contentHash) {
    return summarize({ kind: 'identical', fields: [], entries: [], lines: [] })
  }

  if (
    oldResource.type === RESOURCE_TYPE.CHARACTER_CARD &&
    newResource.type === RESOURCE_TYPE.CHARACTER_CARD &&
    readCardData(oldResource) &&
    readCardData(newResource)
  ) {
    // 卡内容指纹一致 → 两个文件只是封装不同（如 PNG 与 JSON），无需逐字段对比。
    const [oldPrints, newPrints] = await Promise.all([
      computeCardFingerprints(oldResource.metadata),
      computeCardFingerprints(newResource.metadata),
    ])
    if (oldPrints && newPrints && oldPrints.full === newPrints.full) {
      return {
        ...summarize({ kind: 'character', fields: [], entries: [], lines: [] }),
        note: '卡内数据完全一致，差异仅在文件封装或立绘（例如 PNG 与 JSON 导出）。',
      }
    }
    return diffCharacterCards(oldResource, newResource)
  }

  const [oldText, newText] = await Promise.all([
    readBlobText(oldResource),
    readBlobText(newResource),
  ])
  if (oldText === undefined || newText === undefined) {
    return summarize({ kind: 'binary', fields: [], entries: [], lines: [] })
  }

  if (
    oldResource.type === newResource.type &&
    (oldResource.type === RESOURCE_TYPE.REGEX ||
      oldResource.type === RESOURCE_TYPE.SCRIPT ||
      oldResource.type === RESOURCE_TYPE.PRESET)
  ) {
    const oldRules = readRegexRules(parseJsonValue(oldText), oldResource.type)
    const newRules = readRegexRules(parseJsonValue(newText), newResource.type)
    const regexRules = diffRegexRules(oldRules, newRules)
    const oldScripts = readHelperScripts(parseJsonValue(oldText), oldResource.type)
    const newScripts = readHelperScripts(parseJsonValue(newText), newResource.type)
    const scriptItems = diffHelperScripts(oldScripts, newScripts)
    if (regexRules.length || scriptItems.length) {
      return summarize({
        kind: 'text',
        fields: [],
        entries: [],
        regexRules: regexRules.length ? regexRules : undefined,
        scriptItems: scriptItems.length ? scriptItems : undefined,
        lines: diffLines(prettyIfJson(oldText), prettyIfJson(newText)),
      })
    }
  }

  if (
    oldResource.type === RESOURCE_TYPE.WORLD_BOOK &&
    newResource.type === RESOURCE_TYPE.WORLD_BOOK
  ) {
    const oldEntries = readWorldBookEntries(oldText)
    const newEntries = readWorldBookEntries(newText)
    if (oldEntries && newEntries) {
      return summarize({
        kind: 'worldBook',
        fields: [],
        entries: diffEntries(oldEntries, newEntries),
        lines: [],
      })
    }
  }

  return summarize({
    kind: 'text',
    fields: [],
    entries: [],
    lines: diffLines(prettyIfJson(oldText), prettyIfJson(newText)),
  })
}
