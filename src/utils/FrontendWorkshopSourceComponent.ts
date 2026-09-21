import type { FrontendWorkshopSourceComponent } from '../types/FrontendWorkshopSourceComponent'
import {
  createFrontendWorkshopSourceDocument,
  type FrontendWorkshopSourceDocument,
} from '../types/FrontendWorkshopSourceDocument'
import { createFrontendWorkshopStaticSourceProvenance } from './FrontendWorkshopSourceAnalysis'
import type { FrontendWorkshopSourceRange } from './FrontendWorkshopSourceAnalysis'
import { segmentFrontendWorkshopAuthorSource } from './FrontendWorkshopSourceHtmlSegmentation'
import type { FrontendWorkshopSourcePatch } from './FrontendWorkshopSourcePatch'
import type { FrontendWorkshopResolvedSourceSelection } from './FrontendWorkshopSourceSelection'

export type FrontendWorkshopSourceComponentSelection = Pick<
  FrontendWorkshopResolvedSourceSelection,
  | 'projectId'
  | 'sourceRevision'
  | 'tagName'
  | 'elementId'
  | 'mappingConfidence'
  | 'provenanceKind'
  | 'sourceRange'
>

export interface FrontendWorkshopSourceComponentAiProjection {
  document: FrontendWorkshopSourceDocument
  ranges: {
    html: FrontendWorkshopSourceRange
    css: FrontendWorkshopSourceRange
    javascript: FrontendWorkshopSourceRange
  }
}

const COMPONENT_AI_FIELDS = ['html', 'css', 'javascript'] as const
type FrontendWorkshopSourceComponentAiField = (typeof COMPONENT_AI_FIELDS)[number]

const HTML_VOID_ELEMENTS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
])

function tagNameFromTag(source: string, start: number, end: number): string {
  const raw = source.slice(start, end)
  const match = /^<\/?\s*([^\s/>]+)/u.exec(raw)
  return match?.[1]?.toLowerCase() ?? ''
}

function isSelfClosingTag(source: string, start: number, end: number): boolean {
  return /\/\s*>$/u.test(source.slice(start, end))
}

/** Resolve one exact static runtime selection to its raw outer HTML range. */
export function extractFrontendWorkshopSourceComponentHtml(
  source: FrontendWorkshopSourceDocument,
  selection: FrontendWorkshopSourceComponentSelection,
): { html: string; range: { start: number; end: number }; tagName: string } {
  if (
    selection.projectId !== source.projectId ||
    selection.sourceRevision !== source.revision ||
    selection.mappingConfidence !== 'exact' ||
    selection.provenanceKind !== 'static-source' ||
    !selection.sourceRange
  ) {
    throw new Error('只有当前 revision 的 exact Source 元素可以保存为组件')
  }

  const segmentation = segmentFrontendWorkshopAuthorSource(source.authorSource)
  const startTag = segmentation.segments.find(
    (segment) =>
      segment.semanticKind === 'html.start-tag' &&
      segment.range.start === selection.sourceRange?.start &&
      segment.range.end === selection.sourceRange.end,
  )
  if (!startTag) throw new Error('当前元素缺少可证明的 Source 起始标签范围')

  const tagName = tagNameFromTag(source.authorSource, startTag.range.start, startTag.range.end)
  if (!tagName) throw new Error('当前元素的 Source 标签名无法识别')
  if (
    HTML_VOID_ELEMENTS.has(tagName) ||
    isSelfClosingTag(source.authorSource, startTag.range.start, startTag.range.end)
  ) {
    return {
      html: source.authorSource.slice(startTag.range.start, startTag.range.end),
      range: { ...startTag.range },
      tagName,
    }
  }

  let depth = 1
  for (const segment of segmentation.segments) {
    if (segment.range.start < startTag.range.end) continue
    if (segment.semanticKind !== 'html.start-tag' && segment.semanticKind !== 'html.end-tag') {
      continue
    }
    if (tagNameFromTag(source.authorSource, segment.range.start, segment.range.end) !== tagName) {
      continue
    }
    if (segment.semanticKind === 'html.start-tag') {
      if (!isSelfClosingTag(source.authorSource, segment.range.start, segment.range.end)) depth += 1
      continue
    }
    depth -= 1
    if (depth === 0) {
      const range = { start: startTag.range.start, end: segment.range.end }
      return { html: source.authorSource.slice(range.start, range.end), range, tagName }
    }
  }

  throw new Error(`当前 <${tagName}> 没有可证明的闭合标签，已停止保存以保护原始 Source`)
}

function escapeMarkerAttribute(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;')
}

/** Build one runnable fragment while preserving each stored Source field byte-for-byte. */
export function renderFrontendWorkshopSourceComponentFragment(
  component: FrontendWorkshopSourceComponent,
): string {
  if (/<\/style(?=[\s>])/iu.test(component.source.css)) {
    throw new Error('组件 CSS 含 </style>，无法安全嵌入当前 HTML Source')
  }
  if (/<\/script(?=[\s>])/iu.test(component.source.javascript)) {
    throw new Error('组件 JavaScript 含 </script>，无法安全嵌入当前 HTML Source')
  }
  const marker = escapeMarkerAttribute(component.id)
  const parts = [`<!-- srl-source-component:${marker}:start -->`]
  if (component.source.css) {
    parts.push(`<style data-srl-source-component="${marker}">\n${component.source.css}\n</style>`)
  }
  parts.push(component.source.html)
  if (component.source.javascript) {
    parts.push(
      `<script data-srl-source-component="${marker}">\n${component.source.javascript}\n</script>`,
    )
  }
  parts.push(`<!-- srl-source-component:${marker}:end -->`)
  return parts.join('\n')
}

/** Build a disposable projection for the existing Source Runtime Preview owner. */
export function createFrontendWorkshopSourceComponentPreviewDocument(
  component: FrontendWorkshopSourceComponent,
): FrontendWorkshopSourceDocument {
  const colorScheme =
    component.preview.colorScheme === 'auto' ? 'light dark' : component.preview.colorScheme
  const previewSource = [
    `<style data-srl-source-component-preview>:root{color-scheme:${colorScheme};}</style>`,
    renderFrontendWorkshopSourceComponentFragment(component),
  ].join('\n')
  const document = createFrontendWorkshopSourceDocument(
    `source-component-preview-${component.id}`,
    previewSource,
    component.createdAt,
  )
  return {
    ...document,
    revision: component.revision,
    updatedAt: component.updatedAt,
  }
}

function componentAiMarker(field: FrontendWorkshopSourceComponentAiField, edge: 'start' | 'end') {
  return `<!-- srl-source-component-ai:${field}:${edge} -->`
}

/** Build a disposable, range-bounded Source projection for the existing Source AI pipeline. */
export function createFrontendWorkshopSourceComponentAiProjection(
  component: FrontendWorkshopSourceComponent,
): FrontendWorkshopSourceComponentAiProjection {
  let authorSource = ''
  const ranges = {} as FrontendWorkshopSourceComponentAiProjection['ranges']
  for (const field of COMPONENT_AI_FIELDS) {
    const startMarker = componentAiMarker(field, 'start')
    const endMarker = componentAiMarker(field, 'end')
    authorSource += `${startMarker}\n`
    const start = authorSource.length
    authorSource += component.source[field]
    ranges[field] = { start, end: authorSource.length }
    authorSource += `\n${endMarker}\n`
  }
  const document = createFrontendWorkshopSourceDocument(
    `source-component-ai-${component.id}`,
    authorSource,
    component.createdAt,
    'ai',
  )
  return {
    document: { ...document, revision: component.revision, updatedAt: component.updatedAt },
    ranges,
  }
}

function readComponentAiField(
  authorSource: string,
  field: FrontendWorkshopSourceComponentAiField,
): string {
  const startMarker = `${componentAiMarker(field, 'start')}\n`
  const endMarker = `\n${componentAiMarker(field, 'end')}`
  const start = authorSource.indexOf(startMarker)
  if (start < 0 || authorSource.indexOf(startMarker, start + startMarker.length) >= 0) {
    throw new Error(`AI component ${field} 起始标记已失效`)
  }
  const contentStart = start + startMarker.length
  const contentEnd = authorSource.indexOf(endMarker, contentStart)
  if (contentEnd < 0 || authorSource.indexOf(endMarker, contentEnd + endMarker.length) >= 0) {
    throw new Error(`AI component ${field} 结束标记已失效`)
  }
  return authorSource.slice(contentStart, contentEnd)
}

function rootTagNameFromComponentHtml(html: string): string {
  const match = /^(?:\s|<!--[\s\S]*?-->)*<([a-z][a-z0-9:._-]*)(?=[\s/>])/iu.exec(html)
  if (!match?.[1]) throw new Error('AI component HTML 必须以一个可识别的根元素开始')
  return match[1].toLowerCase()
}

/** Recover only the three writable fields after an exact bounded AI Patch. */
export function readFrontendWorkshopSourceComponentAiProjection(
  component: FrontendWorkshopSourceComponent,
  authorSource: string,
): Pick<FrontendWorkshopSourceComponent, 'source' | 'root'> {
  const source = {
    html: readComponentAiField(authorSource, 'html'),
    css: readComponentAiField(authorSource, 'css'),
    javascript: readComponentAiField(authorSource, 'javascript'),
  }
  const root = { tagName: rootTagNameFromComponentHtml(source.html) }
  renderFrontendWorkshopSourceComponentFragment({ ...component, source, root })
  return { source, root }
}

export function findFrontendWorkshopSourceBodyInsertionOffset(
  source: FrontendWorkshopSourceDocument,
): number {
  const segments = segmentFrontendWorkshopAuthorSource(source.authorSource).segments
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    const segment = segments[index]!
    if (
      segment.semanticKind === 'html.end-tag' &&
      tagNameFromTag(source.authorSource, segment.range.start, segment.range.end) === 'body'
    ) {
      return segment.range.start
    }
  }
  return source.authorSource.length
}

export function createFrontendWorkshopSourceComponentInsertionPatch(
  source: FrontendWorkshopSourceDocument,
  component: FrontendWorkshopSourceComponent,
): FrontendWorkshopSourcePatch {
  return createFrontendWorkshopSourceInsertionPatch(
    source,
    renderFrontendWorkshopSourceComponentFragment(component),
  )
}

export function createFrontendWorkshopSourceInsertionPatch(
  source: FrontendWorkshopSourceDocument,
  fragment: string,
): FrontendWorkshopSourcePatch {
  const offset = findFrontendWorkshopSourceBodyInsertionOffset(source)
  const leadingNewline = offset > 0 && source.authorSource[offset - 1] !== '\n' ? '\n' : ''
  const trailingNewline = offset < source.authorSource.length ? '\n' : ''
  return {
    projectId: source.projectId,
    sourceRevision: source.revision,
    edits: [
      {
        target: {
          confidence: 'exact',
          provenance: createFrontendWorkshopStaticSourceProvenance(source, {
            start: offset,
            end: offset,
          }),
        },
        expectedText: '',
        replacement: `${leadingNewline}${fragment}${trailingNewline}`,
      },
    ],
  }
}

export function normalizeFrontendWorkshopSourceComponentScopes<
  T extends { range: FrontendWorkshopSourceRange },
>(scopes: readonly T[]): T[] {
  const ordered = [...scopes].sort(
    (left, right) => left.range.start - right.range.start || right.range.end - left.range.end,
  )
  const normalized: T[] = []
  for (const scope of ordered) {
    const owner = normalized.at(-1)
    if (owner && scope.range.start < owner.range.end) {
      if (scope.range.end <= owner.range.end) continue
      throw new Error('多选组件 Source 范围发生交叠，已停止建立 AI 范围')
    }
    normalized.push(scope)
  }
  return normalized
}
