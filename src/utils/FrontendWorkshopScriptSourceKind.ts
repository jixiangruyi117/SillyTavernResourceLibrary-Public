import type {
  FrontendWorkshopHtmlSegmentation,
  FrontendWorkshopHtmlSourceRange,
} from './FrontendWorkshopSourceHtmlSegmentation'

const JAVASCRIPT_MIME_TYPE_ESSENCES = new Set([
  'application/ecmascript',
  'application/javascript',
  'application/x-ecmascript',
  'application/x-javascript',
  'text/ecmascript',
  'text/javascript',
  'text/javascript1.0',
  'text/javascript1.1',
  'text/javascript1.2',
  'text/javascript1.3',
  'text/javascript1.4',
  'text/javascript1.5',
  'text/jscript',
  'text/livescript',
  'text/x-ecmascript',
  'text/x-javascript',
])

function containedSegments(
  segmentation: FrontendWorkshopHtmlSegmentation,
  semanticKind: string,
  parent: FrontendWorkshopHtmlSourceRange,
) {
  return segmentation.segments.filter(
    (segment) =>
      segment.semanticKind === semanticKind &&
      segment.range.start >= parent.start &&
      segment.range.end <= parent.end,
  )
}

/**
 * Returns true only when a lexical `<script>` start tag gives enough evidence that its raw body is
 * JavaScript. This controls analyzer precision only; returning false never blocks Source Runtime.
 */
export function shouldAnalyzeFrontendWorkshopScriptAsJavaScript(
  authorSource: string,
  segmentation: FrontendWorkshopHtmlSegmentation,
  scriptContentRange: FrontendWorkshopHtmlSourceRange,
): boolean {
  const startTags = segmentation.segments.filter(
    (segment) =>
      segment.semanticKind === 'html.start-tag' && segment.range.end === scriptContentRange.start,
  )
  if (startTags.length !== 1) return false
  const startTag = startTags[0]!

  const tagName = containedSegments(segmentation, 'html.tag-name', startTag.range)[0]
  if (!tagName) return false
  if (authorSource.slice(tagName.range.start, tagName.range.end).toLowerCase() !== 'script') {
    return false
  }

  const typeAttributes = containedSegments(segmentation, 'html.attribute', startTag.range).filter(
    (attribute) => {
      const name = containedSegments(segmentation, 'html.attribute-name', attribute.range)[0]
      return name && authorSource.slice(name.range.start, name.range.end).toLowerCase() === 'type'
    },
  )
  if (typeAttributes.length === 0) return true
  if (typeAttributes.length !== 1) return false

  const value = containedSegments(segmentation, 'html.attribute-value', typeAttributes[0]!.range)[0]
  const rawType = value ? authorSource.slice(value.range.start, value.range.end).trim() : ''
  if (!rawType) return true
  if (rawType.includes('&')) return false

  const normalized = rawType.toLowerCase()
  if (normalized === 'module') return true
  const essence = normalized.split(';', 1)[0]?.trim()
  return Boolean(essence && JAVASCRIPT_MIME_TYPE_ESSENCES.has(essence))
}
