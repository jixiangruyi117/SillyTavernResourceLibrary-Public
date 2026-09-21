export interface FrontendWorkshopHtmlSourceRange {
  start: number
  end: number
}

export interface FrontendWorkshopHtmlSourceSegment {
  semanticKind: string
  range: FrontendWorkshopHtmlSourceRange
}

export interface FrontendWorkshopHtmlUnknownSlice {
  reason: string
  range: FrontendWorkshopHtmlSourceRange
}

export interface FrontendWorkshopHtmlSegmentation {
  segments: readonly FrontendWorkshopHtmlSourceSegment[]
  unknownSlices: readonly FrontendWorkshopHtmlUnknownSlice[]
}

const RAW_TEXT_TAGS = new Set(['script', 'style', 'xmp', 'iframe', 'noembed', 'noframes'])
const RCDATA_TAGS = new Set(['textarea', 'title'])

function isHtmlWhitespace(value: string): boolean {
  return value === ' ' || value === '\t' || value === '\n' || value === '\f' || value === '\r'
}

function isAsciiLetter(value: string): boolean {
  if (!value) return false
  const code = value.charCodeAt(0)
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122)
}

function isTagNameChar(value: string): boolean {
  if (!value) return false
  const code = value.charCodeAt(0)
  return (
    isAsciiLetter(value) ||
    (code >= 48 && code <= 57) ||
    value === '-' ||
    value === '_' ||
    value === ':' ||
    value === '.'
  )
}

function isAttributeNameChar(value: string): boolean {
  return (
    Boolean(value) && !isHtmlWhitespace(value) && !['"', "'", '>', '/', '=', '<'].includes(value)
  )
}

function startsWithAsciiInsensitive(source: string, offset: number, token: string): boolean {
  return source.slice(offset, offset + token.length).toLowerCase() === token.toLowerCase()
}

function scanTagNameEnd(source: string, start: number): number {
  let cursor = start
  while (cursor < source.length && isTagNameChar(source[cursor]!)) cursor += 1
  return cursor
}

function scanTagEnd(source: string, start: number): number | undefined {
  let quote = ''
  for (let cursor = start + 1; cursor < source.length; cursor += 1) {
    const value = source[cursor]!
    if (quote) {
      if (value === quote) quote = ''
      continue
    }
    if (value === '"' || value === "'") {
      quote = value
      continue
    }
    if (value === '>') return cursor + 1
  }
  return undefined
}

function pushSegment(
  segments: FrontendWorkshopHtmlSourceSegment[],
  semanticKind: string,
  start: number,
  end: number,
): void {
  if (end <= start) return
  const previous = segments.at(-1)
  if (
    semanticKind === 'html.text' &&
    previous?.semanticKind === semanticKind &&
    previous.range.end === start
  ) {
    previous.range.end = end
    return
  }
  segments.push({ semanticKind, range: { start, end } })
}

function pushUnknown(
  unknownSlices: FrontendWorkshopHtmlUnknownSlice[],
  reason: string,
  start: number,
  end: number,
): void {
  if (end <= start) return
  const previous = unknownSlices.at(-1)
  if (previous?.reason === reason && previous.range.end === start) {
    previous.range.end = end
    return
  }
  unknownSlices.push({ reason, range: { start, end } })
}

function segmentAttributes(
  source: string,
  start: number,
  tagEnd: number,
): FrontendWorkshopHtmlSegmentation {
  const segments: FrontendWorkshopHtmlSourceSegment[] = []
  const unknownSlices: FrontendWorkshopHtmlUnknownSlice[] = []
  const limit = tagEnd - 1
  let cursor = start

  while (cursor < limit) {
    while (cursor < limit && isHtmlWhitespace(source[cursor]!)) cursor += 1
    if (cursor >= limit) break
    if (source[cursor] === '/' && cursor + 1 === limit) break

    const attributeStart = cursor
    while (cursor < limit && isAttributeNameChar(source[cursor]!)) cursor += 1
    if (cursor === attributeStart) {
      pushUnknown(unknownSlices, 'unclassified-attribute-syntax', cursor, limit)
      break
    }

    const nameEnd = cursor
    while (cursor < limit && isHtmlWhitespace(source[cursor]!)) cursor += 1

    let attributeEnd = nameEnd
    let valueRange: FrontendWorkshopHtmlSourceRange | undefined
    if (source[cursor] === '=') {
      cursor += 1
      while (cursor < limit && isHtmlWhitespace(source[cursor]!)) cursor += 1
      if (cursor >= limit) {
        pushSegment(segments, 'html.attribute-name', attributeStart, nameEnd)
        pushUnknown(unknownSlices, 'missing-attribute-value', attributeStart, limit)
        break
      }

      const quote = source[cursor]!
      if (quote === '"' || quote === "'") {
        const valueStart = cursor + 1
        const quoteEnd = source.indexOf(quote, valueStart)
        if (quoteEnd < 0 || quoteEnd >= limit) {
          pushSegment(segments, 'html.attribute-name', attributeStart, nameEnd)
          pushUnknown(unknownSlices, 'unterminated-attribute-value', attributeStart, limit)
          break
        }
        valueRange = { start: valueStart, end: quoteEnd }
        cursor = quoteEnd + 1
        attributeEnd = cursor
      } else {
        const valueStart = cursor
        while (cursor < limit && !isHtmlWhitespace(source[cursor]!) && source[cursor] !== '>') {
          cursor += 1
        }
        if (cursor === valueStart) {
          pushSegment(segments, 'html.attribute-name', attributeStart, nameEnd)
          pushUnknown(unknownSlices, 'missing-attribute-value', attributeStart, cursor + 1)
          cursor += 1
          continue
        }
        valueRange = { start: valueStart, end: cursor }
        attributeEnd = cursor
      }
    }

    pushSegment(segments, 'html.attribute', attributeStart, attributeEnd)
    pushSegment(segments, 'html.attribute-name', attributeStart, nameEnd)
    if (valueRange) {
      pushSegment(segments, 'html.attribute-value', valueRange.start, valueRange.end)
    }
  }

  return { segments, unknownSlices }
}

function rawContentKind(tagName: string): string {
  if (tagName === 'script') return 'html.script-content'
  if (tagName === 'style') return 'html.style-content'
  if (RCDATA_TAGS.has(tagName)) return 'html.rcdata-content'
  return 'html.raw-text-content'
}

function findRawClosingTagStart(source: string, from: number, tagName: string): number | undefined {
  const expression = new RegExp(`</${tagName}(?=[\\t\\n\\f\\r />])`, 'gi')
  expression.lastIndex = from
  return expression.exec(source)?.index
}

function segmentEndTag(
  source: string,
  start: number,
  segments: FrontendWorkshopHtmlSourceSegment[],
  unknownSlices: FrontendWorkshopHtmlUnknownSlice[],
): number | undefined {
  const nameStart = start + 2
  if (!isAsciiLetter(source[nameStart]!)) return undefined
  const nameEnd = scanTagNameEnd(source, nameStart)
  const tagEnd = scanTagEnd(source, start)
  if (!tagEnd) {
    pushUnknown(unknownSlices, 'unterminated-end-tag', start, source.length)
    return source.length
  }
  pushSegment(segments, 'html.end-tag', start, tagEnd)
  pushSegment(segments, 'html.tag-name', nameStart, nameEnd)
  return tagEnd
}

function segmentRawTextAfterStartTag(
  source: string,
  contentStart: number,
  tagName: string,
  segments: FrontendWorkshopHtmlSourceSegment[],
  unknownSlices: FrontendWorkshopHtmlUnknownSlice[],
): number {
  if (tagName === 'plaintext') {
    pushSegment(segments, 'html.raw-text-content', contentStart, source.length)
    return source.length
  }

  const closingStart = findRawClosingTagStart(source, contentStart, tagName)
  if (closingStart === undefined) {
    pushSegment(segments, rawContentKind(tagName), contentStart, source.length)
    return source.length
  }

  pushSegment(segments, rawContentKind(tagName), contentStart, closingStart)
  return segmentEndTag(source, closingStart, segments, unknownSlices) ?? closingStart + 1
}

/**
 * S3-B tolerant HTML/source segmentation.
 *
 * This scanner only claims lexical Source ranges that can be proven from the original string. It is
 * not a DOM parser and does not normalize, repair, rebuild, pair, or otherwise rewrite Author Source.
 */
export function segmentFrontendWorkshopAuthorSource(
  authorSource: string,
): FrontendWorkshopHtmlSegmentation {
  const segments: FrontendWorkshopHtmlSourceSegment[] = []
  const unknownSlices: FrontendWorkshopHtmlUnknownSlice[] = []
  let cursor = 0

  while (cursor < authorSource.length) {
    if (authorSource[cursor] !== '<') {
      const nextMarkup = authorSource.indexOf('<', cursor)
      const end = nextMarkup < 0 ? authorSource.length : nextMarkup
      pushSegment(segments, 'html.text', cursor, end)
      cursor = end
      continue
    }

    if (authorSource.startsWith('<!--', cursor)) {
      const commentEnd = authorSource.indexOf('-->', cursor + 4)
      if (commentEnd < 0) {
        pushUnknown(unknownSlices, 'unterminated-comment', cursor, authorSource.length)
        break
      }
      const end = commentEnd + 3
      pushSegment(segments, 'html.comment', cursor, end)
      cursor = end
      continue
    }

    if (startsWithAsciiInsensitive(authorSource, cursor, '<!doctype')) {
      const boundary = authorSource[cursor + '<!doctype'.length]
      if (!boundary || isHtmlWhitespace(boundary) || boundary === '>') {
        const end = scanTagEnd(authorSource, cursor)
        if (!end) {
          pushUnknown(unknownSlices, 'unterminated-doctype', cursor, authorSource.length)
          break
        }
        pushSegment(segments, 'html.doctype', cursor, end)
        cursor = end
        continue
      }
    }

    if (authorSource.startsWith('<!', cursor)) {
      const end = scanTagEnd(authorSource, cursor)
      if (!end) {
        pushUnknown(unknownSlices, 'unterminated-markup-declaration', cursor, authorSource.length)
        break
      }
      pushSegment(segments, 'html.declaration', cursor, end)
      cursor = end
      continue
    }

    if (authorSource.startsWith('<?', cursor)) {
      const end = scanTagEnd(authorSource, cursor)
      if (!end) {
        pushUnknown(
          unknownSlices,
          'unsupported-processing-instruction',
          cursor,
          authorSource.length,
        )
        break
      }
      pushUnknown(unknownSlices, 'unsupported-processing-instruction', cursor, end)
      cursor = end
      continue
    }

    if (authorSource.startsWith('</', cursor)) {
      const end = segmentEndTag(authorSource, cursor, segments, unknownSlices)
      if (end !== undefined) {
        cursor = end
        continue
      }
    }

    if (isAsciiLetter(authorSource[cursor + 1]!)) {
      const nameStart = cursor + 1
      const nameEnd = scanTagNameEnd(authorSource, nameStart)
      const tagEnd = scanTagEnd(authorSource, cursor)
      if (!tagEnd) {
        pushUnknown(unknownSlices, 'unterminated-start-tag', cursor, authorSource.length)
        break
      }

      pushSegment(segments, 'html.start-tag', cursor, tagEnd)
      pushSegment(segments, 'html.tag-name', nameStart, nameEnd)
      const attributes = segmentAttributes(authorSource, nameEnd, tagEnd)
      segments.push(...attributes.segments)
      unknownSlices.push(...attributes.unknownSlices)

      const tagName = authorSource.slice(nameStart, nameEnd).toLowerCase()
      if (RAW_TEXT_TAGS.has(tagName) || RCDATA_TAGS.has(tagName) || tagName === 'plaintext') {
        cursor = segmentRawTextAfterStartTag(authorSource, tagEnd, tagName, segments, unknownSlices)
        continue
      }

      cursor = tagEnd
      continue
    }

    pushSegment(segments, 'html.text', cursor, cursor + 1)
    cursor += 1
  }

  return { segments, unknownSlices }
}
