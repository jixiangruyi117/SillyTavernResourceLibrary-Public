import type {
  FrontendWorkshopHtmlSegmentation,
  FrontendWorkshopHtmlSourceRange,
} from './FrontendWorkshopSourceHtmlSegmentation'
import { shouldAnalyzeFrontendWorkshopScriptAsJavaScript } from './FrontendWorkshopScriptSourceKind'

export type FrontendWorkshopRelationConfidence = 'exact' | 'partial' | 'inferred'

export interface FrontendWorkshopRelationSourceEntity {
  id: string
  semanticKind: string
  range: FrontendWorkshopHtmlSourceRange
  confidence: FrontendWorkshopRelationConfidence
}

export interface FrontendWorkshopRelationEdge {
  fromId: string
  toId: string
  relation: string
  confidence: FrontendWorkshopRelationConfidence
}

export interface FrontendWorkshopSourceRelationAnalysis {
  entities: readonly FrontendWorkshopRelationSourceEntity[]
  edges: readonly FrontendWorkshopRelationEdge[]
}

const HTML_URL_ATTRIBUTES = new Set([
  'background',
  'cite',
  'data',
  'formaction',
  'href',
  'manifest',
  'poster',
  'src',
  'xlink:href',
])
const HTML_URL_LIST_ATTRIBUTES = new Set(['imagesrcset', 'srcset'])
const CSS_CONTAINER_AT_RULES = new Set(['container', 'layer', 'media', 'scope', 'supports'])
const CSS_DECLARATION_AT_RULES = new Set(['counter-style', 'font-face', 'page', 'property'])
const JS_SELECTOR_CALLS = new Set(['closest', 'matches', 'querySelector', 'querySelectorAll'])
const JS_ID_CALLS = new Set(['getElementById'])

function isWhitespace(value: string): boolean {
  return value === ' ' || value === '\t' || value === '\n' || value === '\f' || value === '\r'
}

function isIdentifierStart(value: string): boolean {
  if (!value) return false
  const code = value.charCodeAt(0)
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || value === '_' || value === '$'
}

function isIdentifierPart(value: string): boolean {
  if (isIdentifierStart(value)) return true
  if (!value) return false
  const code = value.charCodeAt(0)
  return code >= 48 && code <= 57
}

function trimRange(
  source: string,
  range: FrontendWorkshopHtmlSourceRange,
): FrontendWorkshopHtmlSourceRange {
  let start = range.start
  let end = range.end
  while (start < end && isWhitespace(source[start]!)) start += 1
  while (end > start && isWhitespace(source[end - 1]!)) end -= 1
  return { start, end }
}

export function createFrontendWorkshopSourceEntityId(
  semanticKind: string,
  range: FrontendWorkshopHtmlSourceRange,
): string {
  return `source:${semanticKind}:${range.start}-${range.end}`
}

function segmentId(semanticKind: string, range: FrontendWorkshopHtmlSourceRange): string {
  return createFrontendWorkshopSourceEntityId(semanticKind, range)
}

function skipCssComment(source: string, cursor: number, end: number): number | undefined {
  if (!source.startsWith('/*', cursor)) return undefined
  const close = source.indexOf('*/', cursor + 2)
  return close < 0 || close + 2 > end ? end : close + 2
}

function skipCssIgnorable(source: string, cursor: number, end: number): number {
  while (cursor < end) {
    if (isWhitespace(source[cursor]!)) {
      cursor += 1
      continue
    }
    const commentEnd = skipCssComment(source, cursor, end)
    if (commentEnd !== undefined) {
      cursor = commentEnd
      continue
    }
    break
  }
  return cursor
}

function skipQuotedString(
  source: string,
  quoteStart: number,
  end: number,
): { contentRange: FrontendWorkshopHtmlSourceRange; end: number } | undefined {
  const quote = source[quoteStart]
  if (quote !== '"' && quote !== "'") return undefined
  for (let cursor = quoteStart + 1; cursor < end; cursor += 1) {
    if (source[cursor] === '\\') {
      cursor += 1
      continue
    }
    if (source[cursor] === quote) {
      return {
        contentRange: { start: quoteStart + 1, end: cursor },
        end: cursor + 1,
      }
    }
  }
  return undefined
}

function findCssDelimiter(
  source: string,
  start: number,
  end: number,
  delimiters: ReadonlySet<string>,
): { index: number; value: string } | undefined {
  let parentheses = 0
  let brackets = 0
  for (let cursor = start; cursor < end; cursor += 1) {
    const commentEnd = skipCssComment(source, cursor, end)
    if (commentEnd !== undefined) {
      cursor = commentEnd - 1
      continue
    }
    const value = source[cursor]!
    if (value === '"' || value === "'") {
      const string = skipQuotedString(source, cursor, end)
      if (!string) return undefined
      cursor = string.end - 1
      continue
    }
    if (value === '(') {
      parentheses += 1
      continue
    }
    if (value === ')') {
      if (parentheses > 0) parentheses -= 1
      continue
    }
    if (value === '[') {
      brackets += 1
      continue
    }
    if (value === ']') {
      if (brackets > 0) brackets -= 1
      continue
    }
    if (parentheses === 0 && brackets === 0 && delimiters.has(value)) {
      return { index: cursor, value }
    }
  }
  return undefined
}

function findMatchingCssBrace(source: string, open: number, end: number): number | undefined {
  let depth = 1
  for (let cursor = open + 1; cursor < end; cursor += 1) {
    const commentEnd = skipCssComment(source, cursor, end)
    if (commentEnd !== undefined) {
      cursor = commentEnd - 1
      continue
    }
    const value = source[cursor]!
    if (value === '"' || value === "'") {
      const string = skipQuotedString(source, cursor, end)
      if (!string) return undefined
      cursor = string.end - 1
      continue
    }
    if (value === '{') depth += 1
    if (value === '}') {
      depth -= 1
      if (depth === 0) return cursor
    }
  }
  return undefined
}

function findCssDeclarationValueEnd(source: string, start: number, end: number): number {
  let parentheses = 0
  let brackets = 0
  let braces = 0
  for (let cursor = start; cursor < end; cursor += 1) {
    const commentEnd = skipCssComment(source, cursor, end)
    if (commentEnd !== undefined) {
      cursor = commentEnd - 1
      continue
    }
    const value = source[cursor]!
    if (value === '"' || value === "'") {
      const string = skipQuotedString(source, cursor, end)
      if (!string) return end
      cursor = string.end - 1
      continue
    }
    if (value === '(') parentheses += 1
    else if (value === ')' && parentheses > 0) parentheses -= 1
    else if (value === '[') brackets += 1
    else if (value === ']' && brackets > 0) brackets -= 1
    else if (value === '{') braces += 1
    else if (value === '}' && braces > 0) braces -= 1
    else if (value === ';' && parentheses === 0 && brackets === 0 && braces === 0) return cursor
  }
  return end
}

function cssAtRuleName(source: string, range: FrontendWorkshopHtmlSourceRange): string | undefined {
  let cursor = range.start
  if (source[cursor] !== '@') return undefined
  cursor += 1
  const start = cursor
  while (cursor < range.end) {
    const value = source[cursor]!
    if (!isIdentifierPart(value) && value !== '-') break
    cursor += 1
  }
  return cursor === start ? undefined : source.slice(start, cursor).toLowerCase()
}

function isSimpleCssPropertyName(value: string): boolean {
  return /^--[-_a-zA-Z0-9]+$/.test(value) || /^-?[_a-zA-Z][-_a-zA-Z0-9]*$/.test(value)
}

function skipJsWhitespace(source: string, cursor: number, end: number): number {
  while (cursor < end && isWhitespace(source[cursor]!)) cursor += 1
  return cursor
}

function findContainedSegment(
  segmentation: FrontendWorkshopHtmlSegmentation,
  semanticKind: string,
  parent: FrontendWorkshopHtmlSourceRange,
): FrontendWorkshopHtmlSourceRange | undefined {
  return segmentation.segments.find(
    (segment) =>
      segment.semanticKind === semanticKind &&
      segment.range.start >= parent.start &&
      segment.range.end <= parent.end,
  )?.range
}

/**
 * S3-C builds only relations that can be anchored to the current Author Source revision. It does not
 * execute, normalize, rebuild, or write back Source.
 */
export function analyzeFrontendWorkshopSourceRelations(
  authorSource: string,
  segmentation: FrontendWorkshopHtmlSegmentation,
): FrontendWorkshopSourceRelationAnalysis {
  const entityMap = new Map<string, FrontendWorkshopRelationSourceEntity>()
  const edgeMap = new Map<string, FrontendWorkshopRelationEdge>()

  const addEntity = (
    semanticKind: string,
    range: FrontendWorkshopHtmlSourceRange,
    confidence: FrontendWorkshopRelationConfidence = 'exact',
  ): string => {
    const id = createFrontendWorkshopSourceEntityId(semanticKind, range)
    if (!entityMap.has(id)) entityMap.set(id, { id, semanticKind, range: { ...range }, confidence })
    return id
  }

  const addEdge = (
    fromId: string,
    toId: string,
    relation: string,
    confidence: FrontendWorkshopRelationConfidence = 'exact',
  ): void => {
    const key = `${fromId}\u0000${relation}\u0000${toId}`
    if (!edgeMap.has(key)) edgeMap.set(key, { fromId, toId, relation, confidence })
  }

  const addAssetReference = (
    ownerId: string,
    range: FrontendWorkshopHtmlSourceRange,
    confidence: FrontendWorkshopRelationConfidence = 'exact',
    semanticKind = 'asset.url-reference',
  ): void => {
    if (range.end <= range.start) return
    const assetId = addEntity(semanticKind, range, confidence)
    addEdge(ownerId, assetId, 'references-asset', confidence)
  }

  const scanCssUrlReferences = (range: FrontendWorkshopHtmlSourceRange, ownerId: string): void => {
    for (let cursor = range.start; cursor < range.end; cursor += 1) {
      const commentEnd = skipCssComment(authorSource, cursor, range.end)
      if (commentEnd !== undefined) {
        cursor = commentEnd - 1
        continue
      }
      const value = authorSource[cursor]!
      if (value === '"' || value === "'") {
        const string = skipQuotedString(authorSource, cursor, range.end)
        if (!string) return
        cursor = string.end - 1
        continue
      }
      if (authorSource.slice(cursor, cursor + 3).toLowerCase() !== 'url') continue
      if (cursor > range.start && isIdentifierPart(authorSource[cursor - 1]!)) continue
      if (isIdentifierPart(authorSource[cursor + 3]!)) continue

      let argumentStart = cursor + 3
      while (argumentStart < range.end && isWhitespace(authorSource[argumentStart]!))
        argumentStart += 1
      if (authorSource[argumentStart] !== '(') continue
      argumentStart += 1
      while (argumentStart < range.end && isWhitespace(authorSource[argumentStart]!))
        argumentStart += 1
      if (argumentStart >= range.end) return

      if (authorSource[argumentStart] === '"' || authorSource[argumentStart] === "'") {
        const string = skipQuotedString(authorSource, argumentStart, range.end)
        if (!string) return
        let close = string.end
        while (close < range.end && isWhitespace(authorSource[close]!)) close += 1
        if (authorSource[close] !== ')') continue
        addAssetReference(ownerId, string.contentRange)
        cursor = close
        continue
      }

      let close = argumentStart
      while (close < range.end) {
        if (authorSource[close] === '\\') {
          close += 2
          continue
        }
        if (authorSource[close] === ')') break
        close += 1
      }
      if (close >= range.end) return
      addAssetReference(ownerId, trimRange(authorSource, { start: argumentStart, end: close }))
      cursor = close
    }
  }

  const scanImportQuotedReference = (
    preludeRange: FrontendWorkshopHtmlSourceRange,
    ownerId: string,
  ): void => {
    if (cssAtRuleName(authorSource, preludeRange) !== 'import') return
    let cursor = preludeRange.start + '@import'.length
    cursor = skipCssIgnorable(authorSource, cursor, preludeRange.end)
    if (authorSource[cursor] !== '"' && authorSource[cursor] !== "'") return
    const string = skipQuotedString(authorSource, cursor, preludeRange.end)
    if (string) addAssetReference(ownerId, string.contentRange)
  }

  const analyzeDeclarations = (range: FrontendWorkshopHtmlSourceRange, ownerId: string): void => {
    let cursor = range.start
    while (cursor < range.end) {
      cursor = skipCssIgnorable(authorSource, cursor, range.end)
      if (cursor >= range.end) break
      const statementStart = cursor
      const delimiter = findCssDelimiter(authorSource, cursor, range.end, new Set([':', ';', '{']))
      if (!delimiter) break

      if (delimiter.value === ';') {
        cursor = delimiter.index + 1
        continue
      }

      if (delimiter.value === '{') {
        const close = findMatchingCssBrace(authorSource, delimiter.index, range.end)
        if (!close) break
        analyzeStylesheet({ start: statementStart, end: close + 1 }, ownerId)
        cursor = close + 1
        continue
      }

      const propertyRange = trimRange(authorSource, { start: statementStart, end: delimiter.index })
      const property = authorSource.slice(propertyRange.start, propertyRange.end)
      const valueEnd = findCssDeclarationValueEnd(authorSource, delimiter.index + 1, range.end)
      const valueRange = trimRange(authorSource, { start: delimiter.index + 1, end: valueEnd })
      if (propertyRange.end > propertyRange.start && valueRange.end > valueRange.start) {
        if (isSimpleCssPropertyName(property)) {
          const declarationRange = trimRange(authorSource, {
            start: statementStart,
            end: valueEnd,
          })
          const declarationId = addEntity('css.declaration', declarationRange)
          const propertyId = addEntity('css.property', propertyRange)
          const valueId = addEntity('css.value', valueRange)
          addEdge(ownerId, declarationId, 'contains-declaration')
          addEdge(declarationId, propertyId, 'contains-property')
          addEdge(declarationId, valueId, 'contains-value')
          scanCssUrlReferences(valueRange, valueId)
        }
      }
      cursor = valueEnd < range.end && authorSource[valueEnd] === ';' ? valueEnd + 1 : valueEnd
    }
  }

  const analyzeStylesheet = (range: FrontendWorkshopHtmlSourceRange, ownerId: string): void => {
    let cursor = range.start
    while (cursor < range.end) {
      cursor = skipCssIgnorable(authorSource, cursor, range.end)
      if (cursor >= range.end) break
      const statementStart = cursor
      const delimiter = findCssDelimiter(authorSource, cursor, range.end, new Set(['{', ';']))
      if (!delimiter) break

      const preludeRange = trimRange(authorSource, {
        start: statementStart,
        end: delimiter.index,
      })
      if (delimiter.value === ';') {
        if (authorSource[preludeRange.start] === '@') {
          const atRuleId = addEntity('css.at-rule', {
            start: statementStart,
            end: delimiter.index + 1,
          })
          addEdge(ownerId, atRuleId, 'contains-at-rule')
          scanCssUrlReferences(preludeRange, atRuleId)
          scanImportQuotedReference(preludeRange, atRuleId)
        }
        cursor = delimiter.index + 1
        continue
      }

      const close = findMatchingCssBrace(authorSource, delimiter.index, range.end)
      if (!close) break
      const blockRange = { start: statementStart, end: close + 1 }
      const bodyRange = { start: delimiter.index + 1, end: close }
      if (authorSource[preludeRange.start] === '@') {
        const atRuleId = addEntity('css.at-rule', blockRange)
        addEdge(ownerId, atRuleId, 'contains-at-rule')
        scanCssUrlReferences(preludeRange, atRuleId)
        const atRuleName = cssAtRuleName(authorSource, preludeRange)
        if (atRuleName && CSS_CONTAINER_AT_RULES.has(atRuleName)) {
          analyzeStylesheet(bodyRange, atRuleId)
        } else if (atRuleName && CSS_DECLARATION_AT_RULES.has(atRuleName)) {
          analyzeDeclarations(bodyRange, atRuleId)
        }
      } else if (preludeRange.end > preludeRange.start) {
        const ruleId = addEntity('css.rule', blockRange)
        const selectorId = addEntity('css.selector', preludeRange)
        addEdge(ownerId, ruleId, 'contains-style-rule')
        addEdge(ruleId, selectorId, 'contains-selector')
        analyzeDeclarations(bodyRange, ruleId)
      }
      cursor = close + 1
    }
  }

  const analyzeJsStaticRelations = (
    range: FrontendWorkshopHtmlSourceRange,
    ownerId: string,
  ): void => {
    let cursor = range.start
    while (cursor < range.end) {
      const value = authorSource[cursor]!
      if (isWhitespace(value)) {
        cursor += 1
        continue
      }
      if (authorSource.startsWith('//', cursor)) {
        const newline = authorSource.indexOf('\n', cursor + 2)
        cursor = newline < 0 || newline >= range.end ? range.end : newline + 1
        continue
      }
      if (authorSource.startsWith('/*', cursor)) {
        const close = authorSource.indexOf('*/', cursor + 2)
        cursor = close < 0 || close + 2 > range.end ? range.end : close + 2
        continue
      }
      if (value === '"' || value === "'") {
        const string = skipQuotedString(authorSource, cursor, range.end)
        if (!string) return
        cursor = string.end
        continue
      }
      if (value === '`') return
      if (value === '/') return
      if (!isIdentifierStart(value)) {
        cursor += 1
        continue
      }

      const identifierStart = cursor
      cursor += 1
      while (cursor < range.end && isIdentifierPart(authorSource[cursor]!)) cursor += 1
      const identifier = authorSource.slice(identifierStart, cursor)
      const semanticKind = JS_SELECTOR_CALLS.has(identifier)
        ? 'js.selector-literal'
        : JS_ID_CALLS.has(identifier)
          ? 'js.element-id-literal'
          : undefined
      if (!semanticKind) continue

      let callCursor = skipJsWhitespace(authorSource, cursor, range.end)
      if (authorSource[callCursor] !== '(') continue
      callCursor = skipJsWhitespace(authorSource, callCursor + 1, range.end)
      if (authorSource[callCursor] !== '"' && authorSource[callCursor] !== "'") continue
      const literal = skipQuotedString(authorSource, callCursor, range.end)
      if (!literal) return
      const literalId = addEntity(semanticKind, literal.contentRange)
      addEdge(
        ownerId,
        literalId,
        semanticKind === 'js.selector-literal'
          ? 'references-selector-literal'
          : 'references-element-id-literal',
        'inferred',
      )
      cursor = literal.end
    }
  }

  for (const segment of segmentation.segments) {
    if (segment.semanticKind === 'html.style-content') {
      const ownerId = segmentId(segment.semanticKind, segment.range)
      const stylesheetId = addEntity('css.stylesheet', segment.range)
      addEdge(ownerId, stylesheetId, 'interprets-as-stylesheet')
      analyzeStylesheet(segment.range, stylesheetId)
      continue
    }

    if (segment.semanticKind === 'html.script-content') {
      if (
        !shouldAnalyzeFrontendWorkshopScriptAsJavaScript(authorSource, segmentation, segment.range)
      ) {
        continue
      }
      const ownerId = segmentId(segment.semanticKind, segment.range)
      const scriptId = addEntity('js.script-body', segment.range)
      addEdge(ownerId, scriptId, 'interprets-as-script')
      analyzeJsStaticRelations(segment.range, scriptId)
      continue
    }

    if (segment.semanticKind !== 'html.attribute') continue
    const nameRange = findContainedSegment(segmentation, 'html.attribute-name', segment.range)
    const valueRange = findContainedSegment(segmentation, 'html.attribute-value', segment.range)
    if (!nameRange || !valueRange) continue
    const attributeName = authorSource.slice(nameRange.start, nameRange.end).toLowerCase()
    const attributeId = segmentId(segment.semanticKind, segment.range)

    if (attributeName === 'style') {
      const inlineStyleId = addEntity('css.inline-style', valueRange)
      addEdge(attributeId, inlineStyleId, 'interprets-as-inline-style')
      analyzeDeclarations(valueRange, inlineStyleId)
    }

    if (attributeName.startsWith('on') && attributeName.length > 2) {
      const inlineHandlerId = addEntity('js.inline-handler', valueRange)
      addEdge(attributeId, inlineHandlerId, 'interprets-as-inline-handler')
      analyzeJsStaticRelations(valueRange, inlineHandlerId)
    }

    if (HTML_URL_ATTRIBUTES.has(attributeName)) {
      addAssetReference(attributeId, valueRange)
    } else if (HTML_URL_LIST_ATTRIBUTES.has(attributeName)) {
      addAssetReference(attributeId, valueRange, 'partial', 'asset.url-reference-list')
    }
  }

  return {
    entities: [...entityMap.values()],
    edges: [...edgeMap.values()],
  }
}
