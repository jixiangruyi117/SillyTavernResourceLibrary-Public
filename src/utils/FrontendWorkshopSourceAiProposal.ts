import type { FrontendWorkshopSourceDocument } from '../types/FrontendWorkshopSourceDocument'
import type { FrontendWorkshopSourceComponentDraft } from '../types/FrontendWorkshopSourceComponent'
import { readFrontendWorkshopAiComponentDraft } from './FrontendWorkshopSourceAiArtifacts'
import { FRONTEND_WORKSHOP_SOURCE_OFFSET_UNIT } from './FrontendWorkshopSourceAnalysis'
import {
  FRONTEND_WORKSHOP_SOURCE_AI_CONTEXT_VERSION,
  type FrontendWorkshopSourceAiContextBundle,
  type FrontendWorkshopSourceAiResolvedWriteScope,
} from './FrontendWorkshopSourceAiContext'
import { FRONTEND_WORKSHOP_SOURCE_PATCH_MAX_EDITS } from './FrontendWorkshopSourcePatch'

export const FRONTEND_WORKSHOP_SOURCE_AI_MAX_HOST_REFERENCE_REQUESTS = 16
export const FRONTEND_WORKSHOP_SOURCE_AI_MAX_WARNINGS = 32

export interface FrontendWorkshopSourceAiProposalEdit {
  start: number
  end: number
  expectedText: string
  replacement: string
  reason: string
}

export interface FrontendWorkshopSourceAiProposal {
  kind: 'source-ai-proposal'
  projectId: string
  sourceRevision: number
  summary: string
  generationPrompt?: string
  componentDraft?: FrontendWorkshopSourceComponentDraft
  rejectedComponentDraft?: unknown
  edits: readonly FrontendWorkshopSourceAiProposalEdit[]
  hostReferenceRequests: readonly string[]
  warnings: readonly string[]
}

const ROOT_KEYS = [
  'kind',
  'projectId',
  'sourceRevision',
  'summary',
  'edits',
  'hostReferenceRequests',
  'warnings',
] as const

const EDIT_KEYS = ['expectedText', 'replacement'] as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function assertRequiredKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  label: string,
): void {
  const missing = expected.filter((key) => !Object.hasOwn(value, key))
  if (missing.length) {
    throw new Error(`${label} 字段不匹配，缺少 ${missing.join(', ')}`)
  }
}

function requireString(value: unknown, label: string, allowEmpty = false): string {
  if (typeof value !== 'string') throw new Error(`${label} 必须是字符串`)
  if (!allowEmpty && !value.trim()) throw new Error(`${label} 不能为空`)
  return value
}

function boundedStringArray(value: unknown, maximumItems: number, label: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${label} 必须是数组`)
  if (value.length > maximumItems) throw new Error(`${label} 数量超出上限`)
  return value.map((item, index) => requireString(item, `${label}[${index}]`, false))
}

function assertContextCurrent(
  source: FrontendWorkshopSourceDocument,
  bundle: FrontendWorkshopSourceAiContextBundle,
): void {
  if (bundle.version !== FRONTEND_WORKSHOP_SOURCE_AI_CONTEXT_VERSION) {
    throw new Error('AI proposal Context Bundle version 不匹配')
  }
  if (
    bundle.projectId !== source.projectId ||
    bundle.sourceRevision !== source.revision ||
    bundle.sourceCreatedAt !== source.createdAt
  ) {
    throw new Error('AI proposal Context Bundle 已失效')
  }
  const scope = bundle.writeScope
  if (scope.kind !== 'read-only' && scope.kind !== 'whole-source' && scope.kind !== 'ranges') {
    throw new Error('AI proposal Write Scope kind 非法')
  }
  if (
    scope.projectId !== source.projectId ||
    scope.sourceRevision !== source.revision ||
    scope.sourceCreatedAt !== source.createdAt ||
    scope.offsetUnit !== FRONTEND_WORKSHOP_SOURCE_OFFSET_UNIT
  ) {
    throw new Error('AI proposal Write Scope 已失效')
  }
  if (!Number.isInteger(scope.maxEdits) || scope.maxEdits < 0) {
    throw new Error('AI proposal Write Scope maxEdits 非法')
  }
  if (scope.maxEdits > FRONTEND_WORKSHOP_SOURCE_PATCH_MAX_EDITS) {
    throw new Error('AI proposal Write Scope 超出 Source Patch 上限')
  }
  for (const range of scope.allowedRanges) {
    if (
      !Number.isInteger(range.start) ||
      !Number.isInteger(range.end) ||
      range.start < 0 ||
      range.end < range.start ||
      range.end > source.authorSource.length
    ) {
      throw new Error('AI proposal Write Scope range 非法')
    }
  }
  if (scope.kind === 'read-only') {
    if (scope.maxEdits !== 0 || scope.allowedRanges.length !== 0) {
      throw new Error('AI proposal read-only Write Scope 非法')
    }
  } else if (scope.allowedRanges.length === 0 || scope.maxEdits < 1) {
    throw new Error('AI proposal writable Write Scope 非法')
  }
}

export function assertFrontendWorkshopSourceAiContextCurrent(
  source: FrontendWorkshopSourceDocument,
  bundle: FrontendWorkshopSourceAiContextBundle,
): void {
  assertContextCurrent(source, bundle)
}

function rangeInsideScope(
  scope: FrontendWorkshopSourceAiResolvedWriteScope,
  start: number,
  end: number,
): boolean {
  return scope.allowedRanges.some((range) => start >= range.start && end <= range.end)
}

function parseEdit(
  value: unknown,
  index: number,
  source: FrontendWorkshopSourceDocument,
  bundle: FrontendWorkshopSourceAiContextBundle,
): FrontendWorkshopSourceAiProposalEdit {
  if (!isRecord(value)) throw new Error(`AI proposal edit ${index} 必须是对象`)
  assertRequiredKeys(value, EDIT_KEYS, `AI proposal edit ${index}`)

  const scope = bundle.writeScope
  const expectedText = requireString(
    value.expectedText,
    `AI proposal edit ${index} expectedText`,
    true,
  )
  const allowed = (start: number, end: number) =>
    start >= 0 &&
    end >= start &&
    end <= source.authorSource.length &&
    rangeInsideScope(scope, start, end) &&
    (bundle.sourceCoverage.complete ||
      bundle.sourceCoverage.chunks.some(
        (chunk) => start >= chunk.range.start && end <= chunk.range.end,
      ))
  let resolvedStart = value.start as number
  let resolvedEnd = value.end as number
  if (!(
    Number.isInteger(resolvedStart) &&
    Number.isInteger(resolvedEnd) &&
    allowed(resolvedStart, resolvedEnd) &&
    source.authorSource.slice(resolvedStart, resolvedEnd) === expectedText
  )) {
    if (!expectedText) {
      if (source.authorSource.length === 0 && allowed(0, 0)) {
        resolvedStart = resolvedEnd = 0
      } else throw new Error(`AI proposal edit ${index} 空原文插入需要明确且有效的位置`)
    } else {
      const matches = new Set<number>()
      let position = source.authorSource.indexOf(expectedText)
      while (position !== -1 && matches.size < 2) {
        if (allowed(position, position + expectedText.length)) matches.add(position)
        position = source.authorSource.indexOf(expectedText, position + 1)
      }
      if (matches.size !== 1) {
        throw new Error(
          `AI proposal edit ${index} ${matches.size ? '原文匹配不唯一，请提供更多上下文' : 'expectedText 已失效或超出可写/已提供范围'}`,
        )
      }
      resolvedStart = [...matches][0]!
      resolvedEnd = resolvedStart + expectedText.length
    }
  }

  return {
    start: resolvedStart,
    end: resolvedEnd,
    expectedText,
    replacement: requireString(value.replacement, `AI proposal edit ${index} replacement`, true),
    reason: typeof value.reason === 'string' ? value.reason : '',
  }
}

function assertNonOverlapping(edits: readonly FrontendWorkshopSourceAiProposalEdit[]): void {
  const sorted = edits
    .map((edit, index) => ({ edit, index }))
    .sort(
      (left, right) =>
        left.edit.start - right.edit.start ||
        left.edit.end - right.edit.end ||
        left.index - right.index,
    )
  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1]!
    const current = sorted[index]!
    if (current.edit.start < previous.edit.end || current.edit.start === previous.edit.start) {
      throw new Error(`AI proposal edits 重叠或重复：${previous.index} 与 ${current.index}`)
    }
  }
}

// Escape only literal control characters inside otherwise JSON strings. Do not guess quotes,
// missing delimiters or truncated code; JSON.parse and the normal write checks still decide.
function escapeLiteralStringControls(text: string): string {
  let inString = false
  let escaped = false
  const parts: string[] = []
  let start = 0
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!
    if (escaped) {
      escaped = false
      continue
    }
    if (inString && char === '\\') escaped = true
    else if (char === '"') inString = !inString
    else if (inString && char.charCodeAt(0) < 0x20) {
      parts.push(text.slice(start, index), `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`)
      start = index + 1
    }
  }
  return parts.length ? parts.join('') + text.slice(start) : text
}

/**
 * Parse one model response as an untrusted Source proposal. This function never creates Source
 * provenance and never mutates Author Source. It validates only against the current Source and the
 * typed Write Scope carried by the S6-A context bundle; S7 must still rebuild exact static targets
 * and submit through the existing Patch / History / CAS owner before anything can be persisted.
 */
export function parseFrontendWorkshopSourceAiProposal(
  rawText: string,
  source: FrontendWorkshopSourceDocument,
  bundle: FrontendWorkshopSourceAiContextBundle,
): FrontendWorkshopSourceAiProposal {
  assertContextCurrent(source, bundle)
  if (typeof rawText !== 'string') throw new Error('AI proposal response 必须是字符串')
  if (!rawText.trim()) throw new Error('AI proposal response 为空')

  let parsed: unknown
  try {
    parsed = JSON.parse(escapeLiteralStringControls(rawText.trim())) as unknown
  } catch (error) {
    throw new Error(
      'AI 回复不是有效的纯 JSON，未应用修改。可能含额外说明、代码字符串转义错误或内容不完整；请重新生成。此错误不能单独证明是 Markdown 包装问题。',
      {
        cause: error,
      },
    )
  }
  if (!isRecord(parsed)) throw new Error('AI proposal 根节点必须是对象')
  assertRequiredKeys(
    parsed,
    ROOT_KEYS.filter((key) => !['summary', 'hostReferenceRequests', 'warnings'].includes(key)),
    'AI proposal',
  )

  if (parsed.kind !== 'source-ai-proposal') throw new Error('AI proposal kind 不匹配')
  if (parsed.projectId !== source.projectId || parsed.projectId !== bundle.projectId) {
    throw new Error('AI proposal projectId 不匹配')
  }
  if (
    !Number.isInteger(parsed.sourceRevision) ||
    parsed.sourceRevision !== source.revision ||
    parsed.sourceRevision !== bundle.sourceRevision
  ) {
    throw new Error('AI proposal sourceRevision 已失效')
  }

  let summary =
    typeof parsed.summary === 'string' && parsed.summary.trim() ? parsed.summary : 'AI 已返回结果。'
  const hostReferenceRequests = boundedStringArray(
    parsed.hostReferenceRequests ?? [],
    FRONTEND_WORKSHOP_SOURCE_AI_MAX_HOST_REFERENCE_REQUESTS,
    'AI proposal hostReferenceRequests',
  )
  const warnings = boundedStringArray(
    parsed.warnings ?? [],
    FRONTEND_WORKSHOP_SOURCE_AI_MAX_WARNINGS,
    'AI proposal warnings',
  )

  if (!Array.isArray(parsed.edits)) throw new Error('AI proposal edits 必须是数组')
  if (bundle.writeScope.kind === 'read-only' && parsed.edits.length > 0) {
    throw new Error('AI proposal read-only 请求不得包含 edits')
  }
  if (parsed.edits.length > bundle.writeScope.maxEdits) {
    throw new Error('AI proposal edits 超出 Write Scope 上限')
  }
  if (hostReferenceRequests.length > 0 && parsed.edits.length > 0) {
    throw new Error('AI proposal 缺少 Host Reference 证据时不得同时提交 edits')
  }

  const edits = parsed.edits.map((edit, index) => parseEdit(edit, index, source, bundle))
  assertNonOverlapping(edits)
  let componentDraft: FrontendWorkshopSourceComponentDraft | undefined
  let rejectedComponentDraft: unknown
  if (
    parsed.componentDraft !== undefined &&
    !['plan', 'explain'].includes(bundle.mode) &&
    !hostReferenceRequests.length
  ) {
    try {
      componentDraft = readFrontendWorkshopAiComponentDraft(parsed.componentDraft, source)
    } catch (error) {
      rejectedComponentDraft = parsed.componentDraft
      const message = error instanceof Error ? error.message : '组件草稿无法读取'
      warnings.push(message)
      summary += '\n\n组件草稿未就绪：' + message + '。可以继续对话补齐，已收到的原文仍保留。'
    }
    if (componentDraft && edits.length)
      throw new Error('提取组件不能同时修改原作品；请保持 edits 为空并返回组件草稿')
  }

  return {
    kind: 'source-ai-proposal',
    projectId: source.projectId,
    sourceRevision: source.revision,
    summary,
    ...(bundle.mode === 'plan' &&
    typeof parsed.generationPrompt === 'string' &&
    parsed.generationPrompt.trim()
      ? { generationPrompt: requireString(parsed.generationPrompt, '生成提示词') }
      : {}),
    edits,
    ...(componentDraft ? { componentDraft } : {}),
    ...(rejectedComponentDraft !== undefined ? { rejectedComponentDraft } : {}),
    hostReferenceRequests,
    warnings,
  }
}
