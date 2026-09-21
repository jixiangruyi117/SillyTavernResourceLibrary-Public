import type { FrontendWorkshopSourceDocument } from '../types/FrontendWorkshopSourceDocument'
import type { FrontendWorkshopSourceRange } from './FrontendWorkshopSourceAnalysis'
import { segmentFrontendWorkshopAuthorSource } from './FrontendWorkshopSourceHtmlSegmentation'

const FOCUS_ATTRIBUTE = 'data-srl-ai-preview-focus'
const HIDDEN_ATTRIBUTE = 'data-srl-ai-preview-hidden'

function requireFocusRanges(
  source: FrontendWorkshopSourceDocument,
  ranges: readonly FrontendWorkshopSourceRange[],
): FrontendWorkshopSourceRange[] {
  if (!ranges.length) throw new Error('组件预览范围不能为空')
  const normalized = ranges
    .map((range) => ({ start: range.start, end: range.end }))
    .sort((left, right) => left.start - right.start || right.end - left.end)
  for (const range of normalized) {
    if (
      !Number.isInteger(range.start) ||
      !Number.isInteger(range.end) ||
      range.start < 0 ||
      range.end <= range.start ||
      range.end > source.authorSource.length
    ) {
      throw new Error('组件预览范围无效')
    }
  }
  const result: FrontendWorkshopSourceRange[] = []
  for (const range of normalized) {
    const owner = result.at(-1)
    if (owner && range.start < owner.end) {
      if (range.end <= owner.end) continue
      throw new Error('组件预览范围发生交叠')
    }
    result.push(range)
  }
  return result
}

function focusAttributeOffset(source: string, start: number, end: number): number {
  const raw = source.slice(start, end)
  const suffix = /\s*\/?>$/u.exec(raw)
  if (!suffix || suffix.index <= 0) throw new Error('单组件预览无法定位元素开始标签末端')
  return start + suffix.index
}

/**
 * Create a disposable focused projection for the existing Source Preview owner.
 *
 * The original Author Source and revision are never mutated or persisted. The projection marks
 * the selected root and hides unrelated body descendants at runtime while preserving its ancestor
 * chain, inherited styles, shared CSS, scripts and asset references.
 */
export function createFrontendWorkshopSourceAiFocusedPreviewDocument(
  source: FrontendWorkshopSourceDocument,
  requestedRanges: readonly FrontendWorkshopSourceRange[],
): FrontendWorkshopSourceDocument {
  const ranges = requireFocusRanges(source, requestedRanges)
  const segments = segmentFrontendWorkshopAuthorSource(source.authorSource).segments
  const inserts = ranges.map((range, index) => {
    const startTag = segments.find(
      (segment) =>
        segment.semanticKind === 'html.start-tag' &&
        segment.range.start >= range.start &&
        segment.range.start < range.end,
    )
    if (!startTag) throw new Error('组件预览范围内没有可识别的根元素')
    return {
      offset: focusAttributeOffset(source.authorSource, startTag.range.start, startTag.range.end),
      value: ` ${FOCUS_ATTRIBUTE}="focus-${source.revision}-${index}-${range.start}-${range.end}"`,
    }
  })
  let markedSource = source.authorSource
  for (const insert of inserts.sort((left, right) => right.offset - left.offset)) {
    markedSource = `${markedSource.slice(0, insert.offset)}${insert.value}${markedSource.slice(insert.offset)}`
  }
  const focusRuntime = [
    `<style data-srl-ai-preview-runtime>[${HIDDEN_ATTRIBUTE}]{display:none!important}</style>`,
    '<script data-srl-ai-preview-runtime>',
    '(() => {',
    `  const focuses = [...document.querySelectorAll('[${FOCUS_ATTRIBUTE}]')];`,
    '  if (!focuses.length || focuses.some((focus) => !document.body?.contains(focus))) return;',
    "  for (const element of document.body.querySelectorAll('*')) {",
    '    if (focuses.some((focus) => element === focus || element.contains(focus) || focus.contains(element))) continue;',
    `    element.setAttribute('${HIDDEN_ATTRIBUTE}', '');`,
    '  }',
    "  focuses[0].scrollIntoView({ block: 'start', inline: 'start' });",
    '})();',
    '</script>',
  ].join('\n')

  return {
    ...source,
    projectId: `source-ai-focused-preview-${source.projectId}`,
    authorSource: `${markedSource}\n${focusRuntime}`,
  }
}
