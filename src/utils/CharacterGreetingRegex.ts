import { isRecord } from './UnknownValue'

export interface CharacterGreetingRegexRule {
  id: string
  name: string
  find: string
  replace: string
  phase?: CharacterGreetingRegexPhase
  trimStrings?: string[]
  substituteRegex?: number
}

export interface CharacterGreetingRegexResult {
  contents: string[]
  matchedRuleNames: string[]
  errors: string[]
  /** 兼容旧调用结构；显示正则删除的内容不会由预览层恢复。 */
  preservedBodyIndexes: number[]
}

export interface CharacterGreetingRegexContext {
  charName?: string
  userName?: string
}

type CharacterGreetingRegexPhase = 'aiOutput' | 'markdown'

const RULE_LIMIT = 128
const PATTERN_SIZE_LIMIT = 8192
const MESSAGE_SIZE_LIMIT = 512 * 1024
const AI_OUTPUT_PLACEMENT = 2
const OPENING_MESSAGE_DEPTH = 0
const MVU_UPDATE_BLOCK_DETECTION_PATTERN = /<UpdateVariable\b[^>]*>[\s\S]*?<\/UpdateVariable\s*>/i
const PREVIEW_TIMEOUT_MINIMUM_MS = 3_000
const PREVIEW_TIMEOUT_MAXIMUM_MS = 8_000
const PREVIEW_TIMEOUT_PER_256_KIB_MS = 500
const PREVIEW_TIMEOUT_PER_RULE_MS = 25

function firstDefined(record: Record<string, unknown>, ...keys: string[]): unknown {
  for (const key of keys) {
    if (record[key] !== undefined) return record[key]
  }
  return undefined
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function finiteNumber(value: unknown, fallback = 0): number {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function appliesAtOpeningDepth(script: Record<string, unknown>): boolean {
  const minimum = Number(firstDefined(script, 'minDepth', 'min_depth'))
  const maximum = Number(firstDefined(script, 'maxDepth', 'max_depth'))
  if (Number.isFinite(minimum) && minimum >= -1 && OPENING_MESSAGE_DEPTH < minimum) return false
  if (Number.isFinite(maximum) && maximum >= 0 && OPENING_MESSAGE_DEPTH > maximum) return false
  return true
}

function resolvePhase(script: Record<string, unknown>): CharacterGreetingRegexPhase | undefined {
  if (script.disabled === true || script.enabled === false || !appliesAtOpeningDepth(script)) {
    return undefined
  }

  const source = isRecord(script.source) ? script.source : undefined
  const destination = isRecord(script.destination) ? script.destination : undefined
  const placements = Array.isArray(script.placement)
    ? script.placement.map(Number).filter(Number.isFinite)
    : []
  if (!placements.includes(AI_OUTPUT_PLACEMENT) && source?.ai_output !== true) return undefined

  const displayOnly =
    script.markdownOnly === true || script.markdown_only === true || destination?.display === true
  if (displayOnly) return 'markdown'

  const promptOnly =
    script.promptOnly === true || script.prompt_only === true || destination?.prompt === true
  return promptOnly ? undefined : 'aiOutput'
}

export function extractCharacterGreetingRegexRules(value: unknown): CharacterGreetingRegexRule[] {
  if (!Array.isArray(value)) return []

  const rules: CharacterGreetingRegexRule[] = []
  for (const [index, candidate] of value.entries()) {
    if (rules.length >= RULE_LIMIT || !isRecord(candidate)) break
    const phase = resolvePhase(candidate)
    if (!phase) continue

    const find = stringValue(firstDefined(candidate, 'findRegex', 'find_regex')).trim()
    if (!find || find.length > PATTERN_SIZE_LIMIT) continue
    const rawTrimStrings = firstDefined(candidate, 'trimStrings', 'trim_strings')

    rules.push({
      id: stringValue(candidate.id) || String(index),
      name:
        stringValue(firstDefined(candidate, 'scriptName', 'script_name', 'name')).trim() ||
        `角色正则 ${index + 1}`,
      find,
      replace: stringValue(firstDefined(candidate, 'replaceString', 'replace_string')),
      phase,
      trimStrings: Array.isArray(rawTrimStrings)
        ? rawTrimStrings.filter((item): item is string => typeof item === 'string')
        : [],
      substituteRegex: finiteNumber(firstDefined(candidate, 'substituteRegex', 'substitute_regex')),
    })
  }
  return rules
}

/**
 * The Worker deadline covers startup, structured cloning and the result trip back to the UI,
 * not only regular-expression execution. Keep a bounded margin for larger character cards.
 */
export function getCharacterGreetingRegexPreviewTimeoutMs(
  contents: string[],
  rules: CharacterGreetingRegexRule[],
): number {
  const contentBytes = contents.reduce(
    (total, content) => total + new TextEncoder().encode(content).byteLength,
    0,
  )
  const ruleBytes = rules.reduce(
    (total, rule) =>
      total +
      new TextEncoder().encode(rule.find).byteLength +
      new TextEncoder().encode(rule.replace).byteLength,
    0,
  )
  const sizeAllowance =
    Math.floor((contentBytes + ruleBytes) / (256 * 1024)) * PREVIEW_TIMEOUT_PER_256_KIB_MS
  return Math.min(
    PREVIEW_TIMEOUT_MAXIMUM_MS,
    Math.max(
      PREVIEW_TIMEOUT_MINIMUM_MS,
      PREVIEW_TIMEOUT_MINIMUM_MS + sizeAllowance + rules.length * PREVIEW_TIMEOUT_PER_RULE_MS,
    ),
  )
}

/**
 * 解析用户保存的 `/pattern/flags` 或裸表达式。分隔符从字符串末端向前寻找，
 * 使转义斜杠和旧资源中尾随的非 flag 字符仍能按既有预览结果处理。
 */
function compileUserPattern(source: string): RegExp | undefined {
  const build = (pattern: string, flags?: string): RegExp | undefined => {
    try {
      return new RegExp(pattern, flags)
    } catch {
      return undefined
    }
  }

  if (!source.startsWith('/')) return build(source)
  const closingSlash = source.lastIndexOf('/')
  if (closingSlash <= 0) return build(source)

  const pattern = source.slice(1, closingSlash)
  const flagPrefix = source.slice(closingSlash + 1).match(/^[a-z]*/i)?.[0] ?? ''
  return build(pattern, flagPrefix) ?? build(source)
}

const REGEX_ESCAPE_CODES: Record<string, string> = {
  '\n': '\\n',
  '\r': '\\r',
  '\t': '\\t',
  '\v': '\\v',
  '\f': '\\f',
  '\0': '\\0',
}

function escapeForPattern(value: string): string {
  return value.replace(/[\n\r\t\v\f\0.^$*+?{}[\]\\/|()]/g, (character) => {
    return REGEX_ESCAPE_CODES[character] ?? `\\${character}`
  })
}

function expandPreviewMacros(
  source: string,
  context: CharacterGreetingRegexContext,
  escapeForRegex = false,
): string {
  const transform = (value: string): string => (escapeForRegex ? escapeForPattern(value) : value)
  const replacements: Array<[RegExp, string]> = [
    [/\{\{\s*char\s*\}\}/gi, context.charName?.trim() || '角色'],
    [/\{\{\s*user\s*\}\}/gi, context.userName?.trim() || '用户'],
    [/\{\{\s*newline\s*\}\}/gi, '\n'],
  ]
  return replacements.reduce(
    (value, [pattern, replacement]) => value.replace(pattern, transform(replacement)),
    source,
  )
}

function patternForRule(
  rule: CharacterGreetingRegexRule,
  context: CharacterGreetingRegexContext,
): string {
  if (rule.substituteRegex === 1) return expandPreviewMacros(rule.find, context)
  if (rule.substituteRegex === 2) return expandPreviewMacros(rule.find, context, true)
  return rule.find
}

function cleanCapture(
  capture: unknown,
  trimStrings: string[],
  context: CharacterGreetingRegexContext,
): string {
  let value = capture == null ? '' : String(capture)
  for (const trimString of trimStrings) {
    value = value.replaceAll(expandPreviewMacros(trimString, context), '')
  }
  return value
}

function renderReplacement(
  template: string,
  callbackArguments: unknown[],
  trimStrings: string[],
  context: CharacterGreetingRegexContext,
): string {
  const namedGroups = isRecord(callbackArguments.at(-1))
    ? (callbackArguments.at(-1) as Record<string, unknown>)
    : undefined
  const normalizedTemplate = template.replace(/\{\{match\}\}/gi, '$0')
  const expandedCaptures = normalizedTemplate.replace(
    /\$(\d+)|\$<([^>]+)>/g,
    (_token, numericIndex: string | undefined, groupName: string | undefined) => {
      const capture = numericIndex
        ? callbackArguments[Number(numericIndex)]
        : namedGroups?.[groupName ?? '']
      return cleanCapture(capture, trimStrings, context)
    },
  )
  return expandPreviewMacros(expandedCaptures, context)
}

function applyRule(
  source: string,
  expression: RegExp,
  rule: CharacterGreetingRegexRule,
  context: CharacterGreetingRegexContext,
): string {
  return source.replace(expression, (...callbackArguments: unknown[]) =>
    renderReplacement(rule.replace, callbackArguments, rule.trimStrings ?? [], context),
  )
}

export function hasMvuUpdateInstruction(value: string): boolean {
  return MVU_UPDATE_BLOCK_DETECTION_PATTERN.test(value)
}

export function applyCharacterGreetingRegex(
  contents: string[],
  rules: CharacterGreetingRegexRule[],
  context: CharacterGreetingRegexContext = {},
): CharacterGreetingRegexResult {
  const matchedRuleNames = new Set<string>()
  const errors = new Set<string>()
  const phases: CharacterGreetingRegexPhase[] = ['aiOutput', 'markdown']

  const transformed = contents.map((source, greetingIndex) => {
    if (source.length > MESSAGE_SIZE_LIMIT) {
      errors.add(`第 ${greetingIndex + 1} 条开场白超过预览处理上限`)
      return source
    }

    let output = source
    for (const phase of phases) {
      for (const rule of rules) {
        if ((rule.phase ?? 'markdown') !== phase) continue
        const expression = compileUserPattern(patternForRule(rule, context))
        if (!expression) {
          errors.add(`${rule.name} 的查找表达式无效`)
          continue
        }
        const next = applyRule(output, expression, rule, context)
        if (next !== output) matchedRuleNames.add(rule.name)
        output = next
      }
    }
    return output
  })

  return {
    contents: transformed,
    matchedRuleNames: [...matchedRuleNames],
    errors: [...errors],
    preservedBodyIndexes: [],
  }
}
