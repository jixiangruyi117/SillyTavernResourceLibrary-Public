import type { Resource } from '../types/Resource'
import { RESOURCE_TYPE } from '../types/Resource'
import { computeCardFingerprints } from './CharacterCardFingerprint'
import { isRecord } from './UnknownValue'

/**
 * 版本对比。
 *
 * 全部在本地内存中完成：角色卡按卡内字段对比，世界书按条目对比，
 * 其他文本资源按行对比。只读取两份资源的元数据与原始文件文本，
 * 不修改任何资源、版本记录或导出内容。
 */

export interface LineDiffOp {
  type: 'same' | 'added' | 'removed'
  text: string
}

export interface FieldDiff {
  label: string
  status: 'added' | 'removed' | 'changed'
  oldText: string
  newText: string
  /** 多行文本字段附带行级 diff，短字段留空。 */
  lines?: LineDiffOp[]
}

export interface EntryDiff {
  key: string
  label: string
  status: 'added' | 'removed' | 'changed'
  lines?: LineDiffOp[]
}

export interface ResourceDiffResult {
  kind: 'identical' | 'character' | 'worldBook' | 'text' | 'binary'
  fields: FieldDiff[]
  entries: EntryDiff[]
  lines: LineDiffOp[]
  summary: { added: number; removed: number; changed: number }
  /** 附加说明，例如「卡内数据完全一致，差异仅在封装/立绘」。 */
  note?: string
}

const MAX_DIFF_LINES = 3000
const INLINE_FIELD_LIMIT = 120

/**
 * 基于 LCS 的行级 diff。超过行数上限时退化为“整段替换”视图，
 * 避免在移动端对超长世界书做 O(n²) 计算。
 */
export function diffLines(oldText: string, newText: string): LineDiffOp[] {
  if (oldText === newText) {
    return oldText ? oldText.split('\n').map((text) => ({ type: 'same' as const, text })) : []
  }
  // 空字符串视为零行，避免出现一行“空删除”噪音。
  const oldLines = oldText ? oldText.split('\n') : []
  const newLines = newText ? newText.split('\n') : []
  if (oldLines.length > MAX_DIFF_LINES || newLines.length > MAX_DIFF_LINES) {
    return [
      ...oldLines.map((text) => ({ type: 'removed' as const, text })),
      ...newLines.map((text) => ({ type: 'added' as const, text })),
    ]
  }

  const rows = oldLines.length
  const columns = newLines.length
  // lengths[i][j] = oldLines[i:] 与 newLines[j:] 的最长公共子序列长度
  const lengths: Uint32Array[] = Array.from(
    { length: rows + 1 },
    () => new Uint32Array(columns + 1),
  )
  for (let i = rows - 1; i >= 0; i -= 1) {
    for (let j = columns - 1; j >= 0; j -= 1) {
      lengths[i][j] =
        oldLines[i] === newLines[j]
          ? lengths[i + 1][j + 1] + 1
          : Math.max(lengths[i + 1][j], lengths[i][j + 1])
    }
  }

  const ops: LineDiffOp[] = []
  let i = 0
  let j = 0
  while (i < rows && j < columns) {
    if (oldLines[i] === newLines[j]) {
      ops.push({ type: 'same', text: oldLines[i] })
      i += 1
      j += 1
    } else if (lengths[i + 1][j] >= lengths[i][j + 1]) {
      ops.push({ type: 'removed', text: oldLines[i] })
      i += 1
    } else {
      ops.push({ type: 'added', text: newLines[j] })
      j += 1
    }
  }
  while (i < rows) ops.push({ type: 'removed', text: oldLines[i++] })
  while (j < columns) ops.push({ type: 'added', text: newLines[j++] })
  return ops
}

function readCardData(resource: Resource): Record<string, unknown> | undefined {
  const card = isRecord(resource.metadata.card) ? resource.metadata.card : undefined
  const data = card?.data ?? card
  return isRecord(data) ? data : undefined
}

function asText(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value) && value.every((item) => typeof item === 'string')) {
    return value.join('、')
  }
  return ''
}

function pushFieldDiff(fields: FieldDiff[], label: string, oldText: string, newText: string): void {
  if (oldText === newText) return
  const status: FieldDiff['status'] = !oldText ? 'added' : !newText ? 'removed' : 'changed'
  const multiline =
    oldText.length > INLINE_FIELD_LIMIT ||
    newText.length > INLINE_FIELD_LIMIT ||
    oldText.includes('\n') ||
    newText.includes('\n')
  fields.push({
    label,
    status,
    oldText,
    newText,
    lines: multiline ? diffLines(oldText, newText) : undefined,
  })
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
      content: JSON.stringify(rest, Object.keys(rest).sort(), 2),
    }
  })
}

function diffEntries(oldEntries: NormalizedEntry[], newEntries: NormalizedEntry[]): EntryDiff[] {
  const oldByKey = new Map(oldEntries.map((entry) => [entry.key, entry]))
  const newByKey = new Map(newEntries.map((entry) => [entry.key, entry]))
  const diffs: EntryDiff[] = []
  for (const entry of newEntries) {
    const previous = oldByKey.get(entry.key)
    if (!previous) {
      diffs.push({
        key: entry.key,
        label: entry.label,
        status: 'added',
        lines: diffLines('', entry.content),
      })
    } else if (previous.content !== entry.content) {
      diffs.push({
        key: entry.key,
        label: entry.label,
        status: 'changed',
        lines: diffLines(previous.content, entry.content),
      })
    }
  }
  for (const entry of oldEntries) {
    if (!newByKey.has(entry.key)) {
      diffs.push({
        key: entry.key,
        label: entry.label,
        status: 'removed',
        lines: diffLines(entry.content, ''),
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
