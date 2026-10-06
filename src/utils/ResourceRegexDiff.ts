import {
  type FieldDiff,
  type EntryDiff,
  asText,
  pushFieldDiff,
  stableJson,
} from './ResourceDiffShared'

import type { Resource } from '../types/Resource'

import { RESOURCE_TYPE } from '../types/Resource'

import { humanizeRegexMatch, summarizeRegexEffect } from './RegexEffectPreview'

import { isRecord } from './UnknownValue'

export interface NormalizedRegexRule {
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

export const REGEX_PLACEMENTS: Record<number, string> = {
  0: 'Markdown 显示（旧版）',
  1: '用户输入',
  2: 'AI 输出',
  3: '斜杠命令',
  5: '世界书',
  6: '推理内容',
}

export const REGEX_SCOPE_LABELS: Record<string, string> = {
  global: '全局',
  scoped: '角色范围',
  character: '角色范围',
  preset: '预设范围',
  当前资源: '当前资源',
}

export function readRegexRule(
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

export function readRegexRules(
  value: unknown,
  resourceType: Resource['type'],
): NormalizedRegexRule[] {
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

export function formatRegexDepth(rule: NormalizedRegexRule): string {
  if (rule.minDepth === undefined && rule.maxDepth === undefined) return '默认范围'
  const minimum = rule.minDepth === undefined ? '不限' : String(rule.minDepth)
  const maximum = rule.maxDepth === undefined ? '不限' : String(rule.maxDepth)
  return `${minimum} 至 ${maximum} 层消息`
}

export function describeRegexMatch(pattern: string): string {
  if (!pattern) return '未填写匹配规则'
  if (/(?:\\[dDwWsSbBAZztnrfupPx]|\\[1-9]|\\k[<{]|\(\?[=!<]|\(\?\(|\|)/.test(pattern)) {
    return '复杂正则表达式（展开技术细节可查看原规则）'
  }
  return humanizeRegexMatch(pattern)
}

export function describeRegexFlags(flags: string): string {
  if (!flags) return '默认匹配选项'
  const descriptions: string[] = []
  if (flags.includes('i')) descriptions.push('不区分大小写')
  if (flags.includes('g')) descriptions.push('替换所有匹配项')
  if (flags.includes('m')) descriptions.push('逐行匹配起止位置')
  if (flags.includes('s')) descriptions.push('允许匹配跨行内容')
  if (flags.includes('u')) descriptions.push('按 Unicode 字符匹配')
  return descriptions.length ? descriptions.join('、') : '其他匹配选项已设置'
}

export function describeMacroSubstitution(mode: number | undefined): string {
  if (mode === 0) return '按原文匹配，不展开宏'
  if (mode === 1) return '匹配前展开宏'
  if (mode === 2) return '转义宏内容后再匹配'
  return '默认处理方式'
}

export function regexRuleDetails(
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

export function diffRegexRules(
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
