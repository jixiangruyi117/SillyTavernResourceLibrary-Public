import type { CharacterCardContentSection } from '../types/CharacterCardContentEdit'

import { isRecord } from '../utils/UnknownValue'

import { stableCharacterContentJson } from '../utils/CharacterCardContentEdits'

export type Row = { key: string; label: string; value: unknown; note?: string }

export type ImportCandidate = {
  id: string
  label: string
  value: unknown
  selected: boolean
  warning?: string
}

export function collectScriptRows(values: unknown[], folder = ''): Row[] {
  return values.flatMap((item, index) => {
    if (!isRecord(item)) return []
    if (item.type === 'folder') {
      const children = Array.isArray(item.scripts) ? item.scripts : item.value
      return Array.isArray(children) ? collectScriptRows(children, String(item.name ?? folder)) : []
    }
    const raw = item.type === 'script' && isRecord(item.value) ? item.value : item
    if (typeof raw.content !== 'string' && typeof raw.script !== 'string') return []
    const key = String(raw.id ?? `fingerprint:${stableCharacterContentJson(raw)}`)
    return [
      {
        key,
        label: String(raw.name ?? '') || `脚本 ${index + 1}`,
        value: raw,
        note: folder || (raw.enabled === true ? '已启用' : '已停用'),
      },
    ]
  })
}

export function helperScriptSources(cardData: Record<string, unknown>): unknown[][] {
  const extensions = isRecord(cardData.extensions) ? cardData.extensions : undefined
  const helper = normalizeSettingsRecord(extensions?.tavern_helper)
  const legacyScript = normalizeSettingsRecord(cardData.script)
  return [
    helper?.scripts,
    extensions?.TavernHelper_scripts,
    cardData.scripts,
    legacyScript?.scripts,
  ].filter((value): value is unknown[] => Array.isArray(value))
}

export function normalizeSettingsRecord(value: unknown): Record<string, unknown> | undefined {
  if (isRecord(value)) return value
  if (!Array.isArray(value)) return undefined
  return Object.fromEntries(
    value.filter(
      (item): item is [string, unknown] =>
        Array.isArray(item) && item.length >= 2 && typeof item[0] === 'string',
    ),
  )
}

export function importedHelperScripts(
  root: unknown,
): Array<{ name: string; value: Record<string, unknown> }> {
  if (Array.isArray(root))
    return collectScriptRows(root).map((row) => ({
      name: row.label,
      value: row.value as Record<string, unknown>,
    }))
  if (!isRecord(root)) return []
  const data = isRecord(root.data) ? root.data : root
  const extensions = isRecord(data.extensions) ? data.extensions : undefined
  if (data.type === 'script' || typeof data.content === 'string') {
    const raw = data.type === 'script' && isRecord(data.value) ? data.value : data
    return typeof raw.content === 'string' || typeof raw.script === 'string'
      ? [{ name: String(raw.name ?? '导入脚本'), value: raw }]
      : []
  }
  const helper = normalizeSettingsRecord(extensions?.tavern_helper)
  const legacyScript = normalizeSettingsRecord(data.script)
  const sources = [
    helper?.scripts,
    extensions?.TavernHelper_scripts,
    data.scripts,
    legacyScript?.scripts,
  ].filter((value): value is unknown[] => Array.isArray(value))
  return sources.flatMap((values) =>
    collectScriptRows(values).map((row) => ({
      name: row.label,
      value: row.value as Record<string, unknown>,
    })),
  )
}

export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

export function textList(value: unknown): string {
  if (Array.isArray(value))
    return value.filter((item): item is string => typeof item === 'string').join('\n')
  return typeof value === 'string' ? value : ''
}

export function parseTextList(value: string): string[] {
  return [
    ...new Set(
      value
        .split(/\r?\n/u)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ]
}

export function worldBookCollision(
  entry: Record<string, unknown>,
  entries: Row[],
): string | undefined {
  const sourceId = String(entry.uid ?? entry.id ?? '')
  const title = String(entry.comment ?? entry.name ?? '')
    .trim()
    .toLocaleLowerCase()
  const keys = parseTextList(textList(entry.keys ?? entry.key))
    .map((item) => item.toLocaleLowerCase())
    .sort()
    .join('\u0000')
  const matching = entries.find((row) => {
    if (!isRecord(row.value)) return false
    const candidate = row.value
    if (sourceId && row.key === sourceId) return true
    const candidateTitle = String(candidate.comment ?? candidate.name ?? '')
      .trim()
      .toLocaleLowerCase()
    const candidateKeys = parseTextList(textList(candidate.keys ?? candidate.key))
      .map((item) => item.toLocaleLowerCase())
      .sort()
      .join('\u0000')
    return Boolean((title && title === candidateTitle) || (keys && keys === candidateKeys))
  })
  if (!matching) return undefined
  return `可能与卡内“${matching.label}”重复（编号、名称或触发词相同）。继续导入只会新增条目，不会覆盖该条目。`
}

export function readData(card: Record<string, unknown>): Record<string, unknown> {
  return isRecord(card.data) ? card.data : card
}

export function defaultValue(
  tab: CharacterCardContentSection,
  nextWorldBookUid: () => number,
): unknown {
  const id = crypto.randomUUID()
  if (tab === 'worldBook')
    return {
      uid: nextWorldBookUid(),
      id: nextWorldBookUid(),
      comment: '新世界书条目',
      keys: [],
      secondary_keys: [],
      content: '',
      extensions: {},
      enabled: true,
      insertion_order: 0,
      constant: false,
      selective: false,
      position: 'before_char',
    }
  if (tab === 'regex')
    return {
      id,
      scriptName: '新正则',
      findRegex: '',
      replaceString: '',
      disabled: false,
      placement: [2],
      markdownOnly: true,
      promptOnly: false,
      runOnEdit: true,
      trimStrings: [],
      substituteRegex: 0,
    }
  return { id, name: '新酒馆助手脚本', info: '', content: '', enabled: false, data: {} }
}

export function nextWorldBookUid(data: Record<string, unknown>): number {
  const book = isRecord(data.character_book) ? data.character_book : undefined
  const entries = Array.isArray(book?.entries)
    ? book.entries
    : isRecord(book?.entries)
      ? Object.values(book.entries)
      : []
  const maximum = entries.reduce((current, item) => {
    if (!isRecord(item)) return current
    return [item.uid, item.id].reduce<number>((max, value) => {
      const uid = Number(value)
      return Number.isSafeInteger(uid) && uid > max ? uid : max
    }, current)
  }, 0)
  return maximum + 1
}

export function unwrapCard(root: unknown): Record<string, unknown> | undefined {
  if (!isRecord(root)) return undefined
  return isRecord(root.data) ? root : root
}

export function candidateDetail(item: ImportCandidate, tab: CharacterCardContentSection): string {
  if (tab === 'greeting') return String(item.value).slice(0, 150)
  if (!isRecord(item.value)) return ''
  if (tab === 'worldBook') {
    const keys = textList(item.value.keys ?? item.value.key) || '没有触发词'
    return `触发词：${keys} · ${String(item.value.content ?? '').slice(0, 100)}`
  }
  if (tab === 'regex')
    return `匹配：${String(item.value.findRegex ?? item.value.find_regex ?? '').slice(0, 100)}`
  return item.value.enabled === true ? '导入后启用' : '导入后停用'
}
