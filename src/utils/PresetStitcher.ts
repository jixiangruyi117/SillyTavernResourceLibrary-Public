import { isRecord } from './UnknownValue'

/**
 * 「缝了么」预设缝合核心：从多个 SillyTavern 预设中挑选提示词段，
 * 以某个预设为底板缝合出可直接导入酒馆的新预设。
 *
 * 往返保真红线：缝合永远在底板完整深拷贝的基础上进行，只新增 prompts
 * 条目、重建 prompt_order 顺序与追加 extensions.regex_scripts；
 * 所有未识别字段原样透传，绝不重建整个 JSON。
 */

export interface PresetSegmentView {
  identifier: string
  name: string
  role: string
  content: string
  charCount: number
  enabled: boolean
  marker: boolean
  /** 是否出现在 prompt_order 中；孤儿条目保留在文件里但不参与装配。 */
  inOrder: boolean
  stitchable: boolean
}

export interface AssemblyEntry {
  /** 界面行唯一键：底板行为 base:<identifier>，挑选行为 pick:<资源id>:<identifier>。 */
  key: string
  origin: 'base' | 'pick'
  identifier: string
  name: string
  role: string
  content: string
  charCount: number
  marker: boolean
  enabled: boolean
  sourceResourceId?: string
  sourceName?: string
  favoriteId?: string
  /** 每一行都携带工作副本；编辑只改副本，不改来源资源。 */
  prompt: Record<string, unknown>
  original: {
    name: string
    role: string
    content: string
    enabled: boolean
  }
}

export interface PresetFavoriteSnapshot {
  id: string
  sourceResourceId?: string
  sourceName: string
  identifier: string
  name: string
  role: string
  content: string
  prompt: Record<string, unknown>
  createdAt: number
  updatedAt: number
}

/** 只用于本机候选检查；不改变任何 prompt 正文或导出内容。 */
export function estimatePromptSimilarity(left: string, right: string): number {
  const normalize = (value: string) => value.toLocaleLowerCase().replace(/\s+/g, '')
  const first = normalize(left)
  const second = normalize(right)
  if (!first || !second) return 0
  if (first === second) return 1
  if (first.includes(second) || second.includes(first))
    return Math.min(first.length, second.length) / Math.max(first.length, second.length)
  const grams = (value: string) => {
    const result = new Set<string>()
    for (let index = 0; index < value.length - 1; index += 1)
      result.add(value.slice(index, index + 2))
    return result
  }
  const firstGrams = grams(first)
  const secondGrams = grams(second)
  let shared = 0
  for (const gram of firstGrams) if (secondGrams.has(gram)) shared += 1
  return shared / Math.max(firstGrams.size + secondGrams.size - shared, 1)
}

export function listPromptSetVariables(content: string): string[] {
  const variables = new Set<string>()
  const pattern = /\{\{\s*set(?:global)?var::\s*([^:}]+?)\s*::/gi
  for (const match of content.matchAll(pattern)) {
    const name = match[1]?.trim()
    if (name) variables.add(name)
  }
  return [...variables]
}

export interface RegexGroupPick {
  sourceResourceId: string
  sourceName: string
  scripts: Record<string, unknown>[]
}

export interface StitchProvenance {
  kind: 'segment' | 'regex'
  resourceId: string
  resourceName: string
  identifier: string
  finalIdentifier: string
  name: string
}

export interface StitchOutput {
  preset: Record<string, unknown>
  provenance: StitchProvenance[]
}

export interface StitchReviewItem {
  kind: 'add' | 'edit' | 'move' | 'toggle' | 'regex'
  key: string
  title: string
  detail: string
  sourceName?: string
  addedLines?: string[]
  removedLines?: string[]
  addedMacros?: string[]
  removedMacros?: string[]
  addedVariableReads?: string[]
  addedVariableWrites?: string[]
}

export interface PromptVariableReference {
  scope: 'chat' | 'global'
  operation: 'read' | 'write'
  name: string
}

export interface PromptAuditIssue {
  kind: 'braces' | 'condition' | 'unwritten-read' | 'repeated-write'
  severity: 'error' | 'warning'
  title: string
  detail: string
  entryKeys: string[]
}

export interface PromptAuditReport {
  issues: PromptAuditIssue[]
  reads: string[]
  writes: string[]
}

function unique(values: string[]): string[] {
  return [...new Set(values)]
}

function variableLabel(reference: PromptVariableReference): string {
  return `${reference.scope === 'global' ? '全局' : '聊天'}：${reference.name}`
}

function subtractOccurrences(values: string[], baseline: string[]): string[] {
  const counts = new Map<string, number>()
  for (const value of baseline) counts.set(value, (counts.get(value) ?? 0) + 1)
  return values.filter((value) => {
    const count = counts.get(value) ?? 0
    if (!count) return true
    counts.set(value, count - 1)
    return false
  })
}

function contentLines(value: string): string[] {
  return value.split(/\r?\n/).filter((line) => line.length > 0)
}

export function listPromptMacros(content: string): string[] {
  return [...content.matchAll(/\{\{[^{}]*\}\}/g)].map((match) => match[0])
}

function listMacroRanges(content: string): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = []
  let start = -1
  let depth = 0
  for (let index = 0; index < content.length - 1; index += 1) {
    const pair = content.slice(index, index + 2)
    if (pair === '{{') {
      if (depth === 0) start = index
      depth += 1
      index += 1
    } else if (pair === '}}' && depth > 0) {
      depth -= 1
      index += 1
      if (depth === 0 && start >= 0) {
        ranges.push({ start, end: index + 1 })
        start = -1
      }
    }
  }
  return ranges
}

function macroHighlightKind(macro: string): 'read' | 'write' | 'plain' {
  const value = macro.slice(2, -2).trim().replace(/^#\s*/, '')
  if (/^(?:get|has)(?:global)?var\b/i.test(value)) return 'read'
  if (/^(?:set|add|inc|dec|delete)(?:global)?var\b/i.test(value)) return 'write'
  const shorthand =
    /^([.$])\s*[A-Za-z](?:[A-Za-z0-9_-]*[A-Za-z0-9])?\s*(\|\|=|\?\?=|\+\+|--|\+=|-=|=)?/.exec(value)
  if (!shorthand) return 'plain'
  return shorthand[2] ? 'write' : 'read'
}

/** 原样转义正文后为酒馆宏加上只读高亮标记；不解析或执行宏。 */
export interface PromptDisplayToken {
  text: string
  kind: 'plain' | 'read' | 'write'
}

/** 仅按原文切分展示片段，不解析或执行酒馆宏。 */
export function getPromptDisplayTokens(content: string): PromptDisplayToken[] {
  let cursor = 0
  const tokens: PromptDisplayToken[] = []
  for (const range of listMacroRanges(content)) {
    const plainText = content.slice(cursor, range.start)
    if (plainText) tokens.push({ text: plainText, kind: 'plain' })
    const macro = content.slice(range.start, range.end)
    tokens.push({ text: macro, kind: macroHighlightKind(macro) })
    cursor = range.end
  }
  const trailingText = content.slice(cursor)
  if (trailingText) tokens.push({ text: trailingText, kind: 'plain' })
  return tokens
}

export function listPromptVariables(content: string): PromptVariableReference[] {
  const references: Array<PromptVariableReference & { index: number }> = []
  const pattern =
    /\{\{\s*#?\s*((?:get|has|set|add|inc|dec|delete)(?:global)?var)(?:(?:::)|\s+)\s*(?!\{\{)([^:}\s]+)/gi
  for (const match of content.matchAll(pattern)) {
    const macro = match[1]?.toLocaleLowerCase()
    const name = match[2]?.trim()
    if (!macro || !name) continue
    references.push({
      scope: macro.includes('global') ? 'global' : 'chat',
      operation: /^(get|has)/.test(macro) ? 'read' : 'write',
      name,
      index: match.index,
    })
  }

  const shorthandPattern =
    /\{\{\s*#?\s*([.$])\s*([A-Za-z](?:[A-Za-z0-9_-]*[A-Za-z0-9])?)\s*(\|\|=|\?\?=|\+\+|--|\+=|-=|==|!=|>=|<=|=|>|<|\|\||\?\?)?/g
  const shorthandWrites = new Set(['||=', '??=', '++', '--', '+=', '-=', '='])
  for (const match of content.matchAll(shorthandPattern)) {
    const scope = match[1] === '$' ? 'global' : 'chat'
    const name = match[2]?.trim()
    if (!name) continue
    references.push({
      scope,
      operation: match[3] && shorthandWrites.has(match[3]) ? 'write' : 'read',
      name,
      index: match.index,
    })
  }

  return references
    .sort((left, right) => left.index - right.index)
    .map(({ scope, operation, name }) => ({ scope, operation, name }))
}

function buildContentDiff(before: string, after: string) {
  const beforeMacros = listPromptMacros(before)
  const afterMacros = listPromptMacros(after)
  const beforeVariables = listPromptVariables(before)
  const afterVariables = listPromptVariables(after)
  const beforeVariableKeys = beforeVariables.map(
    (item) => `${item.operation}:${item.scope}:${item.name}`,
  )
  const addedVariables = subtractOccurrences(
    afterVariables.map((item) => `${item.operation}:${item.scope}:${item.name}`),
    beforeVariableKeys,
  )
  return {
    addedLines: subtractOccurrences(contentLines(after), contentLines(before)),
    removedLines: subtractOccurrences(contentLines(before), contentLines(after)),
    addedMacros: subtractOccurrences(afterMacros, beforeMacros),
    removedMacros: subtractOccurrences(beforeMacros, afterMacros),
    addedVariableReads: unique(
      addedVariables
        .filter((item) => item.startsWith('read:'))
        .map((item) => {
          const [, scope, ...name] = item.split(':')
          return variableLabel({
            scope: scope as 'chat' | 'global',
            operation: 'read',
            name: name.join(':'),
          })
        }),
    ),
    addedVariableWrites: unique(
      addedVariables
        .filter((item) => item.startsWith('write:'))
        .map((item) => {
          const [, scope, ...name] = item.split(':')
          return variableLabel({
            scope: scope as 'chat' | 'global',
            operation: 'write',
            name: name.join(':'),
          })
        }),
    ),
  }
}

function auditPromptSyntax(entry: AssemblyEntry): PromptAuditIssue[] {
  const issues: PromptAuditIssue[] = []
  let braceDepth = 0
  let unmatchedClosing = false
  for (let index = 0; index < entry.content.length - 1; index += 1) {
    const pair = entry.content.slice(index, index + 2)
    if (pair === '{{') {
      braceDepth += 1
      index += 1
    } else if (pair === '}}') {
      if (braceDepth === 0) unmatchedClosing = true
      else braceDepth -= 1
      index += 1
    }
  }
  if (braceDepth || unmatchedClosing) {
    issues.push({
      kind: 'braces',
      severity: 'error',
      title: `「${entry.name}」的大括号没有配对`,
      detail: '请检查 {{ 和 }} 是否成对出现。',
      entryKeys: [entry.key],
    })
  }

  let conditionDepth = 0
  let invalidCondition = false
  for (const match of entry.content.matchAll(/\{\{\s*#?\s*(\/if|if|else)\b/gi)) {
    const token = match[1]?.toLocaleLowerCase()
    if (token === 'if') conditionDepth += 1
    else if (token === '/if') {
      if (conditionDepth === 0) invalidCondition = true
      else conditionDepth -= 1
    } else if (conditionDepth === 0) invalidCondition = true
  }
  if (conditionDepth || invalidCondition) {
    issues.push({
      kind: 'condition',
      severity: 'error',
      title: `「${entry.name}」的条件块没有关闭`,
      detail: '请检查 {{if ...}}、{{else}} 和 {{/if}}。',
      entryKeys: [entry.key],
    })
  }
  return issues
}

export function auditPresetAssembly(assembly: AssemblyEntry[]): PromptAuditReport {
  const enabled = assembly.filter((entry) => entry.enabled && !entry.marker)
  const issues = enabled.flatMap(auditPromptSyntax)
  const references = enabled.flatMap((entry) =>
    listPromptVariables(entry.content).map((reference) => ({ entry, reference })),
  )
  const writes = references.filter((item) => item.reference.operation === 'write')
  const writeKeys = new Set(writes.map((item) => `${item.reference.scope}:${item.reference.name}`))
  const missingReads = new Map<string, { label: string; entryKeys: Set<string> }>()
  for (const item of references.filter((value) => value.reference.operation === 'read')) {
    const key = `${item.reference.scope}:${item.reference.name}`
    if (writeKeys.has(key)) continue
    const current = missingReads.get(key) ?? {
      label: variableLabel(item.reference),
      entryKeys: new Set<string>(),
    }
    current.entryKeys.add(item.entry.key)
    missingReads.set(key, current)
  }
  for (const value of missingReads.values()) {
    issues.push({
      kind: 'unwritten-read',
      severity: 'warning',
      title: `读取了未在当前预设写入的变量「${value.label}」`,
      detail: '这个变量可能来自聊天、快速回复或其他扩展，请确认来源。',
      entryKeys: [...value.entryKeys],
    })
  }

  const writers = new Map<string, { label: string; entryKeys: Set<string> }>()
  for (const item of writes) {
    const key = `${item.reference.scope}:${item.reference.name}`
    const current = writers.get(key) ?? {
      label: variableLabel(item.reference),
      entryKeys: new Set<string>(),
    }
    current.entryKeys.add(item.entry.key)
    writers.set(key, current)
  }
  for (const value of writers.values()) {
    if (value.entryKeys.size < 2) continue
    issues.push({
      kind: 'repeated-write',
      severity: 'warning',
      title: `多段提示词写入同一变量「${value.label}」`,
      detail: `共有 ${value.entryKeys.size} 个启用条目写入这个变量。`,
      entryKeys: [...value.entryKeys],
    })
  }

  return {
    issues,
    reads: unique(
      references
        .filter((item) => item.reference.operation === 'read')
        .map((item) => variableLabel(item.reference)),
    ),
    writes: unique(writes.map((item) => variableLabel(item.reference))),
  }
}

/** 预设是纯 JSON 数据；JSON 深拷贝可同时剥离 Vue 响应式代理，structuredClone 反而会抛错。 */
function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

export function parsePresetText(text: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(text)
    return isRecord(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

function readPrompts(preset: Record<string, unknown>): Record<string, unknown>[] {
  return Array.isArray(preset.prompts) ? preset.prompts.filter(isRecord) : []
}

interface OrderGroup {
  group: Record<string, unknown>
  order: Record<string, unknown>[]
}

function readOrderGroups(preset: Record<string, unknown>): OrderGroup[] {
  if (!Array.isArray(preset.prompt_order)) return []
  return preset.prompt_order.filter(isRecord).flatMap((group) => {
    if (!Array.isArray(group.order)) return []
    return [{ group, order: group.order.filter(isRecord) }]
  })
}

/**
 * 预设通常带多组按 character_id 区分的 prompt_order，内容几乎总是一致；
 * 取条目最多的一组作为展示与装配基准。
 */
function dominantOrder(preset: Record<string, unknown>): Record<string, unknown>[] {
  const groups = readOrderGroups(preset)
  if (!groups.length) return []
  return groups.reduce((best, item) => (item.order.length > best.order.length ? item : best)).order
}

function segmentFromPrompt(
  prompt: Record<string, unknown>,
  enabled: boolean,
  inOrder: boolean,
): PresetSegmentView {
  const marker = prompt.marker === true
  const content = readString(prompt.content)
  const role = readString(prompt.role) || (prompt.system_prompt === true ? 'system' : '')
  return {
    identifier: readString(prompt.identifier),
    name: readString(prompt.name) || readString(prompt.identifier) || '未命名段',
    role,
    content,
    charCount: content.length,
    enabled,
    marker,
    inOrder,
    stitchable: !marker,
  }
}

/** 按 prompt_order 顺序列出预设条目，孤儿条目（不在 order 中）附在末尾。 */
export function listPresetSegments(preset: Record<string, unknown>): PresetSegmentView[] {
  const prompts = readPrompts(preset)
  const byIdentifier = new Map(prompts.map((prompt) => [readString(prompt.identifier), prompt]))
  const order = dominantOrder(preset)
  const segments: PresetSegmentView[] = []
  const seen = new Set<string>()
  for (const entry of order) {
    const identifier = readString(entry.identifier)
    const prompt = byIdentifier.get(identifier)
    if (!prompt || seen.has(identifier)) continue
    seen.add(identifier)
    segments.push(segmentFromPrompt(prompt, entry.enabled !== false, true))
  }
  for (const prompt of prompts) {
    const identifier = readString(prompt.identifier)
    if (seen.has(identifier)) continue
    seen.add(identifier)
    segments.push(segmentFromPrompt(prompt, false, false))
  }
  return segments
}

/** 预设内嵌整组正则（extensions.regex_scripts）中的可缝条目。 */
export function listPresetRegexScripts(preset: Record<string, unknown>): Record<string, unknown>[] {
  const extensions = isRecord(preset.extensions) ? preset.extensions : undefined
  if (!Array.isArray(extensions?.regex_scripts)) return []
  return extensions.regex_scripts.filter(
    (item): item is Record<string, unknown> =>
      isRecord(item) &&
      (typeof item.scriptName === 'string' || typeof item.script_name === 'string'),
  )
}

export function regexScriptName(script: Record<string, unknown>): string {
  return readString(script.scriptName) || readString(script.script_name) || '未命名正则'
}

/** 由底板 prompt_order 建立初始装配区：底板行可停用、可排序，不可移除。 */
export function buildBaseAssembly(preset: Record<string, unknown>): AssemblyEntry[] {
  const prompts = new Map(
    readPrompts(preset).map((prompt) => [readString(prompt.identifier), prompt]),
  )
  return listPresetSegments(preset)
    .filter((segment) => segment.inOrder)
    .flatMap((segment) => {
      const prompt = prompts.get(segment.identifier)
      if (!prompt) return []
      return [
        {
          key: `base:${segment.identifier}`,
          origin: 'base' as const,
          identifier: segment.identifier,
          name: segment.name,
          role: segment.role,
          content: segment.content,
          charCount: segment.charCount,
          marker: segment.marker,
          enabled: segment.enabled,
          prompt: cloneJson(prompt),
          original: {
            name: segment.name,
            role: segment.role,
            content: segment.content,
            enabled: segment.enabled,
          },
        },
      ]
    })
}

export function buildPickEntry(
  sourceResourceId: string,
  sourceName: string,
  preset: Record<string, unknown>,
  identifier: string,
): AssemblyEntry | undefined {
  const prompt = readPrompts(preset).find((item) => readString(item.identifier) === identifier)
  if (!prompt || prompt.marker === true) return undefined
  const segment = segmentFromPrompt(prompt, true, true)
  return {
    key: `pick:${sourceResourceId}:${identifier}`,
    origin: 'pick',
    identifier,
    name: segment.name,
    role: segment.role,
    content: segment.content,
    charCount: segment.charCount,
    marker: false,
    enabled: true,
    sourceResourceId,
    sourceName,
    prompt: cloneJson(prompt),
    original: {
      name: segment.name,
      role: segment.role,
      content: segment.content,
      enabled: segment.enabled,
    },
  }
}

export function buildFavoriteEntry(favorite: PresetFavoriteSnapshot): AssemblyEntry {
  return {
    key: `favorite:${favorite.id}:${crypto.randomUUID()}`,
    origin: 'pick',
    identifier: favorite.identifier,
    name: favorite.name,
    role: favorite.role,
    content: favorite.content,
    charCount: favorite.content.length,
    marker: false,
    enabled: true,
    sourceResourceId: favorite.sourceResourceId,
    sourceName: favorite.sourceName || '已收藏条目',
    favoriteId: favorite.id,
    prompt: cloneJson(favorite.prompt),
    original: {
      name: favorite.name,
      role: favorite.role,
      content: favorite.content,
      enabled: true,
    },
  }
}

export function applyEntryEdit(
  entry: AssemblyEntry,
  value: { name: string; role: string; content: string },
): void {
  entry.name = value.name.trim() || entry.identifier || '未命名段'
  entry.role = value.role
  entry.content = value.content
  entry.charCount = value.content.length
  entry.prompt.name = entry.name
  entry.prompt.role = entry.role
  entry.prompt.content = entry.content
}

/**
 * 缝合：底板深拷贝 + 追加挑选段 + 按装配区重建 prompt_order + 合并整组正则。
 * identifier 冲突时换新 uuid 并在段名后加「·缝」；底板 prompts 与未知字段不动。
 */
export function stitchPreset(
  base: Record<string, unknown>,
  assembly: AssemblyEntry[],
  regexPicks: RegexGroupPick[] = [],
): StitchOutput {
  const preset = cloneJson(base)
  const provenance: StitchProvenance[] = []

  const prompts = Array.isArray(preset.prompts) ? preset.prompts : []
  preset.prompts = prompts
  const usedIdentifiers = new Set(
    prompts.filter(isRecord).map((prompt) => readString(prompt.identifier)),
  )

  const promptByIdentifier = new Map(
    prompts.filter(isRecord).map((prompt) => [readString(prompt.identifier), prompt] as const),
  )
  for (const entry of assembly) {
    if (entry.origin !== 'base' || entry.marker) continue
    const target = promptByIdentifier.get(entry.identifier)
    if (!target) continue
    target.name = entry.name
    target.role = entry.role
    target.content = entry.content
  }

  const finalIdentifiers = new Map<string, string>()
  for (const entry of assembly) {
    if (entry.origin !== 'pick') continue
    let identifier = entry.identifier
    let name = entry.name
    if (usedIdentifiers.has(identifier)) {
      identifier = crypto.randomUUID()
      name = name ? `${name}·缝` : name
    }
    usedIdentifiers.add(identifier)
    finalIdentifiers.set(entry.key, identifier)
    const clone = cloneJson(entry.prompt)
    clone.identifier = identifier
    clone.name = name
    clone.role = entry.role
    clone.content = entry.content
    prompts.push(clone)
    provenance.push({
      kind: 'segment',
      resourceId: entry.sourceResourceId ?? '',
      resourceName: entry.sourceName ?? '',
      identifier: entry.identifier,
      finalIdentifier: identifier,
      name: entry.name,
    })
  }

  const dominantIds = new Set(
    dominantOrder(base).map((orderEntry) => readString(orderEntry.identifier)),
  )
  const groups = readOrderGroups(preset)
  const applyOrder = (group: OrderGroup): void => {
    const originals = new Map(
      group.order.map((orderEntry) => [readString(orderEntry.identifier), orderEntry]),
    )
    const rebuilt = assembly.map((entry) => {
      const identifier =
        entry.origin === 'pick'
          ? (finalIdentifiers.get(entry.key) ?? entry.identifier)
          : entry.identifier
      const original = originals.get(identifier)
      if (original) return { ...cloneJson(original), enabled: entry.enabled }
      return { identifier, enabled: entry.enabled }
    })
    // 该组独有、不在装配基准里的条目保留在末尾，不丢失其他 character 组的私有顺序。
    const extras = group.order
      .filter((orderEntry) => !dominantIds.has(readString(orderEntry.identifier)))
      .map((orderEntry) => cloneJson(orderEntry))
    group.group.order = [...rebuilt, ...extras]
  }
  if (groups.length) {
    for (const group of groups) applyOrder(group)
  } else if (assembly.some((entry) => entry.origin === 'pick')) {
    preset.prompt_order = [
      {
        character_id: 100001,
        order: assembly.map((entry) => ({
          identifier:
            entry.origin === 'pick'
              ? (finalIdentifiers.get(entry.key) ?? entry.identifier)
              : entry.identifier,
          enabled: entry.enabled,
        })),
      },
    ]
  }

  if (regexPicks.length) {
    const extensions = isRecord(preset.extensions) ? preset.extensions : {}
    preset.extensions = extensions
    const regexScripts = Array.isArray(extensions.regex_scripts) ? extensions.regex_scripts : []
    extensions.regex_scripts = regexScripts
    const usedRegexIds = new Set(
      regexScripts.filter(isRecord).map((script) => readString(script.id)),
    )
    for (const pick of regexPicks) {
      for (const script of pick.scripts) {
        const clone = cloneJson(script)
        const originalId = readString(clone.id)
        let id = originalId
        if (!id || usedRegexIds.has(id)) id = crypto.randomUUID()
        usedRegexIds.add(id)
        clone.id = id
        regexScripts.push(clone)
        provenance.push({
          kind: 'regex',
          resourceId: pick.sourceResourceId,
          resourceName: pick.sourceName,
          identifier: originalId,
          finalIdentifier: id,
          name: regexScriptName(script),
        })
      }
    }
  }

  return { preset, provenance }
}

export function buildStitchReview(
  base: Record<string, unknown>,
  assembly: AssemblyEntry[],
  regexPicks: RegexGroupPick[] = [],
): StitchReviewItem[] {
  const original = buildBaseAssembly(base)
  const originalIndex = new Map(original.map((entry, index) => [entry.identifier, index]))
  const currentBaseIndex = new Map(
    assembly
      .filter((entry) => entry.origin === 'base')
      .map((entry, index) => [entry.identifier, index]),
  )
  const items: StitchReviewItem[] = []

  assembly.forEach((entry, index) => {
    if (entry.origin === 'pick') {
      const previous = assembly[index - 1]
      const contentDiff = buildContentDiff('', entry.content)
      items.push({
        kind: 'add',
        key: `add:${entry.key}`,
        title: `新增「${entry.name}」`,
        detail: previous ? `插入在「${previous.name}」之后` : '插入到主预设最前面',
        sourceName: entry.sourceName,
        ...contentDiff,
      })
      if (
        entry.name !== entry.original.name ||
        entry.role !== entry.original.role ||
        entry.content !== entry.original.content
      ) {
        const contentDiff = buildContentDiff(entry.original.content, entry.content)
        items.push({
          kind: 'edit',
          key: `edit:${entry.key}`,
          title: `修改新增条目「${entry.name}」`,
          detail: `${entry.original.content.length} 字 → ${entry.content.length} 字`,
          sourceName: entry.sourceName,
          ...contentDiff,
        })
      }
      return
    }

    const oldIndex = originalIndex.get(entry.identifier)
    const newIndex = currentBaseIndex.get(entry.identifier)
    if (oldIndex !== undefined && newIndex !== undefined && oldIndex !== newIndex) {
      items.push({
        kind: 'move',
        key: `move:${entry.key}`,
        title: `调整「${entry.name}」顺序`,
        detail: `主预设内第 ${oldIndex + 1} 位 → 第 ${newIndex + 1} 位`,
      })
    }
    const changedFields = [
      entry.name !== entry.original.name ? '名称' : '',
      entry.role !== entry.original.role ? '角色' : '',
      entry.content !== entry.original.content ? '正文' : '',
    ].filter(Boolean)
    if (changedFields.length) {
      const contentDiff = buildContentDiff(entry.original.content, entry.content)
      items.push({
        kind: 'edit',
        key: `edit:${entry.key}`,
        title: `编辑「${entry.name}」`,
        detail: `${changedFields.join('、')}已修改；正文 ${entry.original.content.length} 字 → ${entry.content.length} 字`,
        ...contentDiff,
      })
    }
    if (entry.enabled !== entry.original.enabled) {
      items.push({
        kind: 'toggle',
        key: `toggle:${entry.key}`,
        title: `${entry.enabled ? '启用' : '停用'}「${entry.name}」`,
        detail: '只改变 prompt_order 启用状态，不删除底板条目',
      })
    }
  })

  regexPicks.forEach((pick) => {
    items.push({
      kind: 'regex',
      key: `regex:${pick.sourceResourceId}`,
      title: `追加「${pick.sourceName}」配套正则`,
      detail: `${pick.scripts.length} 条正则脚本`,
      sourceName: pick.sourceName,
    })
  })
  return items
}

export function serializeStitchedPreset(preset: Record<string, unknown>): string {
  return JSON.stringify(preset, null, 2)
}

export function defaultStitchName(baseName: string): string {
  const trimmed = baseName.trim() || '未命名预设'
  return `${trimmed}·缝合`
}
