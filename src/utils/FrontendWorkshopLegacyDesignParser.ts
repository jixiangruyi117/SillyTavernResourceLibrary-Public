import { type StatusField } from '../types/FrontendWorkshopLegacy'

export function parseStatusFields(source: string): StatusField[] {
  const fields: StatusField[] = []
  let group = '基础信息'
  const kindAliases: Record<string, StatusField['kind']> = {
    文本: 'text',
    数字: 'number',
    数值: 'number',
    百分比: 'percent',
    进度: 'percent',
    标签: 'tags',
    列表: 'tags',
    长文本: 'longText',
    描述: 'longText',
  }
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) continue
    const heading = line.match(/^(?:#{1,3}\s*|\[|【)([^】\]]+?)(?:】|\])?$/)
    if (heading) {
      group = heading[1]!.trim().slice(0, 24) || group
      continue
    }
    if (fields.length >= 24) break
    const split = line.match(/^(.{1,40}?)[：:]\s*(.*)$/)
    const rawLabel = (split?.[1] ?? line).trim()
    const kindHint = rawLabel.match(/^(.+?)(?:\u005b|【)([^】\u005d]+)(?:\u005d|】)$/)
    const label = (kindHint?.[1] ?? rawLabel).trim().slice(0, 24)
    const example = split?.[2]?.trim() || `示例${fields.length + 1}`
    const explicitKind = kindAliases[kindHint?.[2]?.trim() ?? '']
    const inferredKind: StatusField['kind'] =
      explicitKind ??
      (/%$/.test(example)
        ? 'percent'
        : /^-?\d+(?:\.\d+)?$/.test(example)
          ? 'number'
          : /[、,，|]/.test(example)
            ? 'tags'
            : example.length > 28
              ? 'longText'
              : 'text')
    const path = group === '基础信息' ? label : `${group}.${label}`
    fields.push({ label, example, group, kind: inferredKind, path })
  }
  const seen = new Set<string>()
  return fields.filter((field) => {
    const key = field.label.toLocaleLowerCase()
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export const STATUS_FIELD_KIND_LABELS: Record<StatusField['kind'], string> = {
  text: '文本',
  number: '数字',
  percent: '百分比',
  tags: '标签',
  longText: '长文本',
}

export function serializeStatusFields(fields: StatusField[]): string {
  const lines: string[] = []
  let activeGroup = ''
  fields.slice(0, 24).forEach((field, index) => {
    const group = field.group.trim().slice(0, 24) || '基础信息'
    const label = field.label.trim().slice(0, 24) || `新字段${index + 1}`
    const example = field.example.trim() || `示例${index + 1}`
    if (group !== activeGroup) {
      if (lines.length) lines.push('')
      if (group !== '基础信息' || activeGroup) lines.push(`[${group}]`)
      activeGroup = group
    }
    lines.push(`${label}[${STATUS_FIELD_KIND_LABELS[field.kind]}]：${example}`)
  })
  return lines.join('\n')
}

export function extractJsonObject(source: string): Record<string, unknown> {
  const fenced = source.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]
  const candidate = extractFirstJsonObject(fenced ?? source)
  if (!candidate) throw new Error('AI 没有返回 JSON 对象')
  try {
    return JSON.parse(candidate) as Record<string, unknown>
  } catch (initialError) {
    try {
      return JSON.parse(repairJsonStringEscapes(candidate)) as Record<string, unknown>
    } catch (repairError) {
      const detail =
        repairError instanceof Error
          ? repairError.message
          : initialError instanceof Error
            ? initialError.message
            : '未知 JSON 错误'
      throw new Error(`AI 返回的 JSON 转义有误，自动修复后仍无法读取：${detail}`, {
        cause: repairError,
      })
    }
  }
}

export function extractWorkshopDesign(source: string): Record<string, unknown> {
  const template = source.match(/<SRL_TEMPLATE>\s*([\s\S]*?)\s*<\/SRL_TEMPLATE>/i)?.[1]?.trim()
  if (!template) {
    try {
      const legacyDesign = extractJsonObject(source)
      if (typeof legacyDesign.htmlTemplate === 'string' && legacyDesign.htmlTemplate.trim())
        return legacyDesign
    } catch (error) {
      if (source.trim().startsWith('{')) throw error
    }
    const bareTemplate = extractBareWorkshopTemplate(source)
    if (bareTemplate) return { htmlTemplate: bareTemplate }
    throw new Error(
      'AI 输出协议不完整：缺少 <SRL_TEMPLATE> 分区，且旧 JSON 输出没有可用的 htmlTemplate 字符串',
    )
  }
  const metaSource = source.match(/<SRL_META>\s*([\s\S]*?)\s*<\/SRL_META>/i)?.[1]
  let meta: Record<string, unknown> = {}
  if (metaSource) {
    try {
      meta = extractJsonObject(metaSource)
    } catch {
      meta = {}
    }
  }
  return { ...meta, htmlTemplate: template }
}

export function extractBareWorkshopTemplate(source: string): string {
  const trimmed = source.trim()
  const fenced = trimmed.match(/^```(?:html|css)?\s*\n?([\s\S]*?)\n?```$/i)?.[1]?.trim() ?? trimmed
  if (!/^<style\b/i.test(fenced) || !/<(?:section|div|article)\b/i.test(fenced)) return ''
  return fenced
}

export function extractFirstJsonObject(source: string): string {
  const start = source.indexOf('{')
  if (start < 0) return ''
  let depth = 0
  let insideString = false
  let escaped = false
  for (let index = start; index < source.length; index += 1) {
    const current = source[index]!
    if (insideString) {
      if (escaped) escaped = false
      else if (current === '\\') escaped = true
      else if (current === '"') insideString = false
      continue
    }
    if (current === '"') {
      insideString = true
      continue
    }
    if (current === '{') depth += 1
    if (current === '}') {
      depth -= 1
      if (depth === 0) return source.slice(start, index + 1)
    }
  }
  return source.slice(start)
}

export function repairJsonStringEscapes(source: string): string {
  let result = ''
  let insideString = false
  for (let index = 0; index < source.length; index += 1) {
    const current = source[index]!
    if (!insideString) {
      result += current
      if (current === '"') insideString = true
      continue
    }
    if (current === '"') {
      result += current
      insideString = false
      continue
    }
    if (current === '\\') {
      const next = source[index + 1]
      if (next && '"\\/bfnrt'.includes(next)) {
        result += current + next
        index += 1
        continue
      }
      if (next === 'u' && /^[0-9a-f]{4}$/i.test(source.slice(index + 2, index + 6))) {
        result += source.slice(index, index + 6)
        index += 5
        continue
      }
      result += '\\\\'
      continue
    }
    if (current === '\n') {
      result += '\\n'
      continue
    }
    if (current === '\r') {
      if (source[index + 1] === '\n') index += 1
      result += '\\n'
      continue
    }
    if (current === '\t') {
      result += '\\t'
      continue
    }
    if (current.charCodeAt(0) < 0x20) {
      result += `\\u${current.charCodeAt(0).toString(16).padStart(4, '0')}`
      continue
    }
    result += current
  }
  return result
}
