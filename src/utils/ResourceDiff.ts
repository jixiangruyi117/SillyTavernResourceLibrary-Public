import type { Resource } from '../types/Resource'
import { RESOURCE_TYPE } from '../types/Resource'
import { computeCardFingerprints } from './CharacterCardFingerprint'
import { humanizeRegexMatch, summarizeRegexEffect } from './RegexEffectPreview'
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
  details?: FieldDiff[]
}

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
  value: Record<string, unknown>
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (!isRecord(value)) return JSON.stringify(value) ?? 'null'
  const fields = Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
  return `{${fields.join(',')}}`
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
      content: stableJson(rest),
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

  const unknownChanged = (
    oldValue: Record<string, unknown> | undefined,
    newValue: Record<string, unknown> | undefined,
  ) => {
    const oldUnknownFields = Object.fromEntries(
      Object.entries(oldValue ?? {}).filter(([key]) => !knownKeys.has(key)),
    )
    const newUnknownFields = Object.fromEntries(
      Object.entries(newValue ?? {}).filter(([key]) => !knownKeys.has(key)),
    )
    const oldExtensions = isRecord(oldValue?.extensions) ? oldValue.extensions : {}
    const newExtensions = isRecord(newValue?.extensions) ? newValue.extensions : {}
    const oldUnknownExtensions = Object.fromEntries(
      Object.entries(oldExtensions).filter(([key]) => !knownKeys.has(key)),
    )
    const newUnknownExtensions = Object.fromEntries(
      Object.entries(newExtensions).filter(([key]) => !knownKeys.has(key)),
    )
    return (
      stableJson(oldUnknownFields) !== stableJson(newUnknownFields) ||
      stableJson(oldUnknownExtensions) !== stableJson(newUnknownExtensions)
    )
  }
  if (unknownChanged(oldEntry, newEntry)) {
    fields.push({
      label: '其他高级设置',
      status: oldEntry ? (newEntry ? 'changed' : 'removed') : 'added',
      oldText: oldEntry ? '有配置' : '',
      newText: newEntry ? '有配置' : '',
    })
  }
  return fields
}

interface NormalizedRegexRule {
  key: string
  name: string
  scope: string
  enabled: boolean
  placements: string[]
  find: string
  replace: string
  flags: string
  trimStrings: string[]
  substituteRegex?: number
  otherOptions: string
  minDepth?: number
  maxDepth?: number
}

const REGEX_PLACEMENTS: Record<number, string> = {
  0: 'Markdown 显示（旧版）',
  1: '用户输入',
  2: 'AI 输出',
  3: '斜杠命令',
  5: '世界书',
  6: '推理内容',
}

const REGEX_SCOPE_LABELS: Record<string, string> = {
  global: '全局',
  scoped: '角色范围',
  character: '角色范围',
  preset: '预设范围',
  当前资源: '当前资源',
}

function readRegexRule(
  value: unknown,
  scope: string,
  index: number,
): NormalizedRegexRule | undefined {
  if (!isRecord(value)) return undefined
  const find = asText(value.findRegex ?? value.find_regex)
  const replace = asText(value.replaceString ?? value.replace_string)
  if (value.findRegex === undefined && value.find_regex === undefined) return undefined

  const source = isRecord(value.source) ? value.source : undefined
  const destination = isRecord(value.destination) ? value.destination : undefined
  const helperPlacements = source
    ? [
        source.user_input === true ? '用户输入' : '',
        source.ai_output === true ? 'AI 输出' : '',
        source.slash_command === true ? '斜杠命令' : '',
        source.world_info === true ? '世界书' : '',
        source.reasoning === true ? '推理内容' : '',
        destination?.display === true ? '显示文本' : '',
        destination?.prompt === true ? '发送提示词' : '',
      ].filter(Boolean)
    : []
  const placements = Array.isArray(value.placement)
    ? value.placement.map((item) => REGEX_PLACEMENTS[Number(item)] ?? '其他位置')
    : helperPlacements
  const name = asText(value.scriptName ?? value.script_name ?? value.name) || `正则 ${index + 1}`
  const ruleScope = asText(value.scope) || scope
  const rawMinDepth = value.minDepth ?? value.min_depth
  const rawMaxDepth = value.maxDepth ?? value.max_depth
  const minDepth = rawMinDepth == null ? Number.NaN : Number(rawMinDepth)
  const maxDepth = rawMaxDepth == null ? Number.NaN : Number(rawMaxDepth)
  const rawTrimStrings = value.trimStrings ?? value.trimOut ?? value.trim_out
  const trimStrings = Array.isArray(rawTrimStrings)
    ? rawTrimStrings.filter((item): item is string => typeof item === 'string')
    : typeof rawTrimStrings === 'string'
      ? rawTrimStrings.split(/\r?\n/u).filter(Boolean)
      : []
  const patternFlags = find.match(/^\/[\s\S]*\/([dgimsuvy]*)$/u)?.[1] ?? ''
  const knownOptions = new Set([
    'id',
    'scope',
    'scriptName',
    'script_name',
    'name',
    'findRegex',
    'find_regex',
    'replaceString',
    'replace_string',
    'flags',
    'regexFlags',
    'disabled',
    'enabled',
    'placement',
    'source',
    'destination',
    'minDepth',
    'min_depth',
    'maxDepth',
    'max_depth',
    'trimStrings',
    'trimOut',
    'trim_out',
    'substituteRegex',
    'substitute_regex',
  ])
  const otherOptions = Object.fromEntries(
    Object.entries(value).filter(([key]) => !knownOptions.has(key)),
  )

  return {
    key: `${ruleScope.toLocaleLowerCase()}::${name.toLocaleLowerCase()}`,
    name,
    scope: REGEX_SCOPE_LABELS[ruleScope] ?? ruleScope,
    enabled: value.disabled !== true && value.enabled !== false,
    placements: [...new Set(placements)],
    find,
    replace,
    flags: asText(value.flags ?? value.regexFlags) || patternFlags,
    trimStrings,
    substituteRegex:
      value.substituteRegex == null && value.substitute_regex == null
        ? undefined
        : Number.isFinite(Number(value.substituteRegex ?? value.substitute_regex))
          ? Number(value.substituteRegex ?? value.substitute_regex)
          : undefined,
    otherOptions: stableJson(otherOptions),
    minDepth: Number.isFinite(minDepth) ? minDepth : undefined,
    maxDepth: Number.isFinite(maxDepth) ? maxDepth : undefined,
  }
}

function readRegexRules(value: unknown, resourceType: Resource['type']): NormalizedRegexRule[] {
  if (resourceType !== RESOURCE_TYPE.REGEX && resourceType !== RESOURCE_TYPE.PRESET) return []
  const rules: NormalizedRegexRule[] = []
  const addRule = (item: unknown, scope: string, index: number): void => {
    const rule = readRegexRule(item, scope, index)
    if (rule) rules.push(rule)
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => addRule(item, '正则集合', index))
  } else if (isRecord(value)) {
    if (value.findRegex !== undefined || value.find_regex !== undefined) {
      addRule(value, '单条规则', 0)
    }
    for (const [scopeKey, scopeLabel] of [
      ['global', '全局'],
      ['scoped', '角色范围'],
      ['preset', '预设范围'],
    ]) {
      const scopedRules = value[scopeKey]
      if (Array.isArray(scopedRules)) {
        scopedRules.forEach((item, index) => addRule(item, scopeLabel, index))
      }
    }
    const extensions = isRecord(value.extensions) ? value.extensions : undefined
    if (Array.isArray(extensions?.regex_scripts)) {
      extensions.regex_scripts.forEach((item, index) => addRule(item, '随预设执行', index))
    }
  }

  const occurrences = new Map<string, number>()
  return rules.map((rule) => {
    const occurrence = occurrences.get(rule.key) ?? 0
    occurrences.set(rule.key, occurrence + 1)
    return occurrence ? { ...rule, key: `${rule.key}#${occurrence + 1}` } : rule
  })
}

function formatRegexDepth(rule: NormalizedRegexRule): string {
  if (rule.minDepth === undefined && rule.maxDepth === undefined) return '默认范围'
  const minimum = rule.minDepth === undefined ? '不限' : String(rule.minDepth)
  const maximum = rule.maxDepth === undefined ? '不限' : String(rule.maxDepth)
  return `${minimum} 至 ${maximum} 层消息`
}

function describeRegexMatch(pattern: string): string {
  if (!pattern) return '未填写匹配规则'
  if (/(?:\\[dDwWsSbBAZztnrfupPx]|\\[1-9]|\\k[<{]|\(\?[=!<]|\(\?\(|\|)/.test(pattern)) {
    return '复杂正则表达式（展开技术细节可查看原规则）'
  }
  return humanizeRegexMatch(pattern)
}

function describeRegexFlags(flags: string): string {
  if (!flags) return '默认匹配选项'
  const descriptions: string[] = []
  if (flags.includes('i')) descriptions.push('不区分大小写')
  if (flags.includes('g')) descriptions.push('替换所有匹配项')
  if (flags.includes('m')) descriptions.push('逐行匹配起止位置')
  if (flags.includes('s')) descriptions.push('允许匹配跨行内容')
  if (flags.includes('u')) descriptions.push('按 Unicode 字符匹配')
  return descriptions.length ? descriptions.join('、') : '其他匹配选项已设置'
}

function describeMacroSubstitution(mode: number | undefined): string {
  if (mode === 0) return '按原文匹配，不展开宏'
  if (mode === 1) return '匹配前展开宏'
  if (mode === 2) return '转义宏内容后再匹配'
  return '默认处理方式'
}

function regexRuleDetails(
  oldRule: NormalizedRegexRule | undefined,
  newRule: NormalizedRegexRule | undefined,
): FieldDiff[] {
  const fields: FieldDiff[] = []
  const oldEffect = oldRule ? summarizeRegexEffect(oldRule.find, oldRule.replace) : undefined
  const newEffect = newRule ? summarizeRegexEffect(newRule.find, newRule.replace) : undefined
  const oldMatch = oldRule ? describeRegexMatch(oldRule.find) : ''
  const newMatch = newRule ? describeRegexMatch(newRule.find) : ''
  const add = (label: string, oldText: string, newText: string): void => {
    pushFieldDiff(fields, label, oldText, newText)
  }

  if (oldRule || newRule) {
    add(
      '启用状态',
      oldRule ? (oldRule.enabled ? '启用' : '停用') : '',
      newRule ? (newRule.enabled ? '启用' : '停用') : '',
    )
    add('作用范围', oldRule?.scope ?? '', newRule?.scope ?? '')
    add(
      '作用位置',
      oldRule?.placements.join('、') || '未指定',
      newRule?.placements.join('、') || '未指定',
    )
    add(
      '生效消息范围',
      oldRule ? formatRegexDepth(oldRule) : '',
      newRule ? formatRegexDepth(newRule) : '',
    )
    add('匹配内容（易读）', oldMatch, newMatch)
    add(
      '规则效果概述',
      oldRule && oldEffect ? `匹配 ${oldMatch}，替换为 ${oldEffect.after}` : '',
      newRule && newEffect ? `匹配 ${newMatch}，替换为 ${newEffect.after}` : '',
    )
    add('效果说明', oldEffect?.explanation ?? '', newEffect?.explanation ?? '')
    add(
      '匹配选项',
      oldRule ? describeRegexFlags(oldRule.flags) : '',
      newRule ? describeRegexFlags(newRule.flags) : '',
    )
    add(
      '匹配后移除文本',
      oldRule?.trimStrings.join('、') ?? '',
      newRule?.trimStrings.join('、') ?? '',
    )
    add(
      '宏处理方式',
      oldRule ? describeMacroSubstitution(oldRule.substituteRegex) : '',
      newRule ? describeMacroSubstitution(newRule.substituteRegex) : '',
    )
    if (oldRule && newRule && oldRule.otherOptions !== newRule.otherOptions) {
      fields.push({
        label: '其他规则选项',
        status: 'changed',
        oldText: '旧版高级选项',
        newText: '新版高级选项已调整',
      })
    }

    if (oldRule && newRule && oldRule.find !== newRule.find && oldMatch === newMatch) {
      fields.push({
        label: '匹配条件',
        status: 'changed',
        oldText: '原正则表达式已调整',
        newText: '新正则表达式已调整',
      })
    }
    if (
      oldRule &&
      newRule &&
      oldRule.replace !== newRule.replace &&
      oldEffect?.after === newEffect?.after
    ) {
      fields.push({
        label: '替换内容',
        status: 'changed',
        oldText: '原替换代码已调整',
        newText: '新替换代码已调整',
      })
    }
  }
  return fields
}

function diffRegexRules(
  oldRules: NormalizedRegexRule[],
  newRules: NormalizedRegexRule[],
): EntryDiff[] {
  const oldByKey = new Map(oldRules.map((rule) => [rule.key, rule]))
  const newByKey = new Map(newRules.map((rule) => [rule.key, rule]))
  const diffs: EntryDiff[] = []
  for (const rule of newRules) {
    const previous = oldByKey.get(rule.key)
    if (!previous) {
      diffs.push({
        key: `regex:${rule.key}`,
        label: `${rule.scope} · ${rule.name}`,
        status: 'added',
        details: regexRuleDetails(undefined, rule),
      })
    } else if (stableJson(previous) !== stableJson(rule)) {
      diffs.push({
        key: `regex:${rule.key}`,
        label: `${rule.scope} · ${rule.name}`,
        status: 'changed',
        details: regexRuleDetails(previous, rule),
      })
    }
  }
  for (const rule of oldRules) {
    if (!newByKey.has(rule.key)) {
      diffs.push({
        key: `regex:${rule.key}`,
        label: `${rule.scope} · ${rule.name}`,
        status: 'removed',
        details: regexRuleDetails(rule, undefined),
      })
    }
  }
  return diffs
}

interface NormalizedHelperScript {
  key: string
  name: string
  folder: string
  info: string
  enabled: boolean
  buttons: string[]
  dataCount: number
  exportData: boolean
  exportButtons: boolean
  content: string
}

function readHelperScript(
  value: unknown,
  index: number,
  folder = '',
): NormalizedHelperScript | undefined {
  if (!isRecord(value) || typeof value.content !== 'string') return undefined
  const hasTypedShape = value.type === 'script'
  const hasLegacyShape =
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    (typeof value.info === 'string' || Array.isArray(value.buttons))
  if (!hasTypedShape && !hasLegacyShape) return undefined

  const button = isRecord(value.button) ? value.button : undefined
  const buttons = Array.isArray(button?.buttons)
    ? button.buttons
    : Array.isArray(value.buttons)
      ? value.buttons
      : []
  const exportWith = isRecord(value.export_with) ? value.export_with : undefined
  const name = asText(value.name) || `脚本 ${index + 1}`
  return {
    key: `${folder.toLocaleLowerCase()}::${name.toLocaleLowerCase()}`,
    name,
    folder,
    info: asText(value.info),
    enabled: value.enabled !== false,
    buttons: buttons
      .filter(isRecord)
      .map((item) => asText(item.name))
      .filter(Boolean),
    dataCount: isRecord(value.data) ? Object.keys(value.data).length : 0,
    exportData: exportWith?.data !== false,
    exportButtons: exportWith?.button !== false,
    content: value.content,
  }
}

function readHelperScripts(
  value: unknown,
  resourceType: Resource['type'],
): NormalizedHelperScript[] {
  if (resourceType !== RESOURCE_TYPE.SCRIPT && resourceType !== RESOURCE_TYPE.PRESET) return []
  const scripts: NormalizedHelperScript[] = []
  const visit = (item: unknown, index: number, folder = ''): void => {
    if (!isRecord(item)) return
    if (item.type === 'folder' && Array.isArray(item.scripts)) {
      const folderName = asText(item.name) || `文件夹 ${index + 1}`
      item.scripts.forEach((script, scriptIndex) => visit(script, scriptIndex, folderName))
      return
    }
    const script = readHelperScript(item, index, folder)
    if (script) scripts.push(script)
  }
  const visitList = (items: unknown[]): void => items.forEach((item, index) => visit(item, index))

  if (Array.isArray(value)) {
    visitList(value)
  } else if (isRecord(value)) {
    visit(value, 0)
    if (value.type !== 'folder' && Array.isArray(value.scripts)) visitList(value.scripts)
    const scriptSettings = isRecord(value.script) ? value.script : undefined
    if (Array.isArray(scriptSettings?.scripts)) visitList(scriptSettings.scripts)
    const extensions = isRecord(value.extensions) ? value.extensions : undefined
    const helper = isRecord(extensions?.tavern_helper) ? extensions.tavern_helper : undefined
    if (Array.isArray(helper?.scripts)) visitList(helper.scripts)
  }

  const occurrences = new Map<string, number>()
  return scripts.map((script) => {
    const occurrence = occurrences.get(script.key) ?? 0
    occurrences.set(script.key, occurrence + 1)
    return occurrence ? { ...script, key: `${script.key}#${occurrence + 1}` } : script
  })
}

function helperScriptDetails(
  oldScript: NormalizedHelperScript | undefined,
  newScript: NormalizedHelperScript | undefined,
): FieldDiff[] {
  const fields: FieldDiff[] = []
  const add = (label: string, oldText: string, newText: string): void => {
    pushFieldDiff(fields, label, oldText, newText)
  }
  add('所在文件夹', oldScript?.folder ?? '', newScript?.folder ?? '')
  add('脚本说明', oldScript?.info ?? '', newScript?.info ?? '')
  add(
    '启用状态',
    oldScript ? (oldScript.enabled ? '启用' : '停用') : '',
    newScript ? (newScript.enabled ? '启用' : '停用') : '',
  )
  add('按钮', oldScript?.buttons.join('、') ?? '', newScript?.buttons.join('、') ?? '')
  add(
    '脚本数据',
    oldScript ? `${oldScript.dataCount} 项` : '',
    newScript ? `${newScript.dataCount} 项` : '',
  )
  add(
    '导出设置',
    oldScript
      ? `${oldScript.exportData ? '包含' : '不含'}脚本数据 · ${oldScript.exportButtons ? '包含' : '不含'}按钮`
      : '',
    newScript
      ? `${newScript.exportData ? '包含' : '不含'}脚本数据 · ${newScript.exportButtons ? '包含' : '不含'}按钮`
      : '',
  )

  if (oldScript && newScript && oldScript.content !== newScript.content) {
    fields.push({
      label: '脚本代码',
      status: 'changed',
      oldText: '旧版代码',
      newText: '新版代码有修改（原文可展开查看）',
    })
  } else if (!oldScript && newScript) {
    fields.push({
      label: '脚本代码',
      status: 'added',
      oldText: '',
      newText: '已添加（原文默认收起）',
    })
  } else if (oldScript && !newScript) {
    fields.push({
      label: '脚本代码',
      status: 'removed',
      oldText: '已移除',
      newText: '',
    })
  }
  return fields
}

function diffHelperScripts(
  oldScripts: NormalizedHelperScript[],
  newScripts: NormalizedHelperScript[],
): EntryDiff[] {
  const oldByKey = new Map(oldScripts.map((script) => [script.key, script]))
  const newByKey = new Map(newScripts.map((script) => [script.key, script]))
  const diffs: EntryDiff[] = []
  for (const script of newScripts) {
    const previous = oldByKey.get(script.key)
    if (!previous) {
      diffs.push({
        key: `script:${script.key}`,
        label: `${script.folder ? `${script.folder} · ` : ''}${script.name}`,
        status: 'added',
        details: helperScriptDetails(undefined, script),
      })
    } else if (stableJson(previous) !== stableJson(script)) {
      diffs.push({
        key: `script:${script.key}`,
        label: `${script.folder ? `${script.folder} · ` : ''}${script.name}`,
        status: 'changed',
        details: helperScriptDetails(previous, script),
      })
    }
  }
  for (const script of oldScripts) {
    if (!newByKey.has(script.key)) {
      diffs.push({
        key: `script:${script.key}`,
        label: `${script.folder ? `${script.folder} · ` : ''}${script.name}`,
        status: 'removed',
        details: helperScriptDetails(script, undefined),
      })
    }
  }
  return diffs
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
    if (!newByKey.has(entry.key)) {
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
