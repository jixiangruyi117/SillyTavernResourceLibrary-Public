import { type TavernRegexArtifact } from '../types/FrontendWorkshopLegacy'

export function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function escapeHtml(value: unknown): string {
  return String(value ?? '未知').replace(
    /[&<>"']/g,
    (character) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[character]!,
  )
}

export const UNSAFE_PATH_SEGMENTS = new Set(['__proto__', 'prototype', 'constructor'])

export function setPath(target: Record<string, unknown>, path: string, value: unknown): void {
  const segments = path
    .split('.')
    .map((segment) => segment.trim())
    .filter(Boolean)
  if (segments.some((segment) => UNSAFE_PATH_SEGMENTS.has(segment.toLocaleLowerCase())))
    throw new Error('MVU 变量路径包含不安全的保留名称')
  let cursor = target
  segments.forEach((segment, index) => {
    if (index === segments.length - 1) {
      cursor[segment] = value
      return
    }
    const next = cursor[segment]
    if (!next || typeof next !== 'object' || Array.isArray(next)) cursor[segment] = {}
    cursor = cursor[segment] as Record<string, unknown>
  })
}

export function getPath(target: Record<string, unknown>, path: string): unknown {
  const segments = path
    .split('.')
    .map((item) => item.trim())
    .filter(Boolean)
  if (segments.some((segment) => UNSAFE_PATH_SEGMENTS.has(segment.toLocaleLowerCase())))
    return undefined
  let cursor: unknown = target
  for (const segment of segments) {
    if (!cursor || typeof cursor !== 'object' || Array.isArray(cursor)) return undefined
    cursor = (cursor as Record<string, unknown>)[segment]
  }
  return cursor
}

export function unwrapMvuValue(value: unknown): unknown {
  if (Array.isArray(value)) return value[0] ?? '未知'
  return value ?? '未知'
}

export function applyTavernRegex(regex: TavernRegexArtifact, source: string): string {
  const literal = regex.findRegex.match(/^\/([\s\S]*)\/([dgimsuvy]*)$/)
  if (!literal) return source
  const expression = new RegExp(literal[1]!, literal[2]!)
  return source.replace(expression, (...args: unknown[]) => {
    let result = regex.replaceString.replace(/{{match}}/gi, '$0')
    result = result.replace(/\$(\d+)/g, (_match, rawIndex: string) => {
      const value = args[Number(rawIndex)]
      return typeof value === 'string' ? value : ''
    })
    return result
  })
}
