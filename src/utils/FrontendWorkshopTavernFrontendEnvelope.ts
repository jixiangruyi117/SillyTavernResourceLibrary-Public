import {
  formatSillyTavernMessage,
  isTavernHelperFrontendContent,
} from './SillyTavernMessageFormatter'

const FRONTEND_WRAPPER_SELECTOR = 'div.TH-render[data-srl-render-frontend="true"]'
const FENCED_BLOCK_OPENING_PATTERN = /(^|[\r\n])[ \t]{0,3}(?:`{3,}|~{3,})[^\r\n]*(?:\r?\n|$)/
const INDENTED_CODE_LINE_PATTERN = /(^|[\r\n])(?: {4,}|\t+)\S/
const LEADING_FENCE_PATTERN = /^[\uFEFF \t]*(?:`{3,}|~{3,})[^\r\n]*(?:\r?\n|$)/
const BODY_OPEN_PATTERN = /<body(?:\s[^>]*)?>/i
const BODY_CLOSE_PATTERN = /<\/body\s*>/i
const DOCUMENT_STRUCTURE_PATTERN = /<(?:html|head)(?:\s|>)/i

export type TavernHelperFrontendEnvelopeKind =
  'none' | 'single' | 'mixed' | 'multiple' | 'malformed'

export interface TavernHelperFrontendEnvelopeBlock {
  source: string
  hostRecognized: true
  officialBodyEnvelope: boolean
}

export interface TavernHelperFrontendEnvelopeAnalysis {
  kind: TavernHelperFrontendEnvelopeKind
  blocks: TavernHelperFrontendEnvelopeBlock[]
  hasNonFrontendContent: boolean
}

export interface TavernHelperFrontendEnvelopeSerialization {
  envelope: string
  payload: string
  fence: string
  wrappedBody: boolean
}

export class TavernHelperFrontendEnvelopeSerializationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TavernHelperFrontendEnvelopeSerializationError'
  }
}

function hasMeaningfulNonFrontendContent(formattedHtml: string): boolean {
  const template = document.createElement('template')
  template.innerHTML = formattedHtml
  template.content.querySelectorAll(FRONTEND_WRAPPER_SELECTOR).forEach((node) => node.remove())

  return Array.from(template.content.childNodes).some((node) => {
    if (node.nodeType === 3) return /\S/.test(node.textContent ?? '')
    return node.nodeType === 1
  })
}

function hasOfficialBodyEnvelope(source: string): boolean {
  return BODY_OPEN_PATTERN.test(source) && BODY_CLOSE_PATTERN.test(source)
}

function couldProduceMessageCodeBlock(source: string): boolean {
  return FENCED_BLOCK_OPENING_PATTERN.test(source) || INDENTED_CODE_LINE_PATTERN.test(source)
}

/**
 * Parse a Tavern/SillyTavern message representation exactly at the boundary used by TavernHelper:
 * Markdown is rendered by the existing SillyTavern formatter, then only formatted PRE blocks that
 * TavernHelper's isFrontend predicate recognizes are exposed as frontend payloads.
 *
 * This function never mounts a runtime, executes display regexes, compiles Browser Source, or writes
 * Source. The returned block source is the same decoded <code>.textContent shape that TH executes.
 */
export function parseTavernHelperFrontendEnvelope(
  messageSource: string,
): TavernHelperFrontendEnvelopeAnalysis {
  // Keep Source Editor typing cheap without making raw fence syntax the protocol. Showdown can create
  // PRE elements from fenced code and from four-space/tab-indented code; the formatted PRE remains the
  // compatibility truth in either case.
  if (!messageSource || !couldProduceMessageCodeBlock(messageSource)) {
    return { kind: 'none', blocks: [], hasNonFrontendContent: false }
  }

  const formatted = formatSillyTavernMessage(messageSource)
  const blocks = formatted.frontendBlocks.map((source) => ({
    source,
    hostRecognized: true as const,
    officialBodyEnvelope: hasOfficialBodyEnvelope(source),
  }))

  if (!blocks.length) {
    // "Malformed" is deliberately high-confidence: a draft that merely contains some fence-like text
    // plus <body> elsewhere can still be valid pure Author Source. Only an input that actually starts
    // like a message fence and contains a TH marker is blocked as a broken transport envelope.
    return LEADING_FENCE_PATTERN.test(messageSource) && isTavernHelperFrontendContent(messageSource)
      ? { kind: 'malformed', blocks: [], hasNonFrontendContent: true }
      : { kind: 'none', blocks: [], hasNonFrontendContent: false }
  }

  const hasNonFrontendContent = hasMeaningfulNonFrontendContent(formatted.html)
  const kind: TavernHelperFrontendEnvelopeKind =
    blocks.length > 1 ? 'multiple' : hasNonFrontendContent ? 'mixed' : 'single'

  return { kind, blocks, hasNonFrontendContent }
}

function maximumBacktickRun(source: string): number {
  let longest = 0
  for (const match of source.matchAll(/`+/g)) longest = Math.max(longest, match[0].length)
  return longest
}

/**
 * Serialize pure FrontendWorkshop authorSource to TavernHelper's documented message representation.
 * The creative source is never trimmed or formatted. If it does not already contain a complete body
 * envelope, a transport-only <body> wrapper is added because TavernHelper's current documentation
 * requires a fenced block containing a closed body element. The fence is lengthened when necessary
 * so author backticks stay data rather than closing the Markdown block.
 */
export function serializeTavernHelperFrontendEnvelope(
  authorSource: string,
): TavernHelperFrontendEnvelopeSerialization {
  const hasBodyOpen = BODY_OPEN_PATTERN.test(authorSource)
  const hasBodyClose = BODY_CLOSE_PATTERN.test(authorSource)
  if (hasBodyOpen !== hasBodyClose) {
    throw new TavernHelperFrontendEnvelopeSerializationError(
      'Source 中存在不成对的 <body> / </body>，无法生成官方 TavernHelper 前端格式',
    )
  }
  if (!hasBodyOpen && DOCUMENT_STRUCTURE_PATTERN.test(authorSource)) {
    throw new TavernHelperFrontendEnvelopeSerializationError(
      'Source 含 <html> 或 <head> 结构但没有闭合 <body>；为避免改变文档语义，请先补全 HTML 文档结构再导出',
    )
  }

  const wrappedBody = !hasBodyOpen
  const payload = wrappedBody ? `<body>${authorSource}</body>` : authorSource
  if (!isTavernHelperFrontendContent(payload)) {
    throw new TavernHelperFrontendEnvelopeSerializationError(
      '当前 TavernHelper 的 frontend marker 判断区分大小写；该 Source 虽有 HTML 结构，但导出后不会被当前宿主识别为 message frontend。请使用宿主可识别的 <body> / <head> / html> 标记。',
    )
  }

  const fence = '`'.repeat(Math.max(3, maximumBacktickRun(payload) + 1))
  const lineBreakBeforeFence = payload.endsWith('\n') ? '' : '\n'

  return {
    payload,
    fence,
    wrappedBody,
    envelope: `${fence}html\n${payload}${lineBreakBeforeFence}${fence}`,
  }
}
