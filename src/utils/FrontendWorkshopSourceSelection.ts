import type { FrontendWorkshopSourceDocument } from '../types/FrontendWorkshopSourceDocument'
import type {
  FrontendWorkshopSourceAnalysisSnapshot,
  FrontendWorkshopSourceMapEntity,
  FrontendWorkshopSourceMappingConfidence,
  FrontendWorkshopStaticSourceProvenance,
} from './FrontendWorkshopSourceAnalysis'
import type { FrontendWorkshopRuntimeDomNodeMapping } from './FrontendWorkshopRuntimeDomProvenance'
import type { FrontendWorkshopSourceRuntimeDomSelection } from './FrontendWorkshopSourceRuntime'
import { extractFrontendWorkshopSourceComponentHtml } from './FrontendWorkshopSourceComponent'

export type FrontendWorkshopExactSourceMapEntity = FrontendWorkshopSourceMapEntity & {
  confidence: 'exact'
  provenance: FrontendWorkshopStaticSourceProvenance
}

export interface FrontendWorkshopResolvedSourceSelection {
  selectionOrigin?: 'source'
  projectId: string
  sourceRevision: number
  instanceId: string
  runtimeNonce: string
  runtimeNodeId: string
  tagName: string
  elementId?: string
  treeScope: FrontendWorkshopSourceRuntimeDomSelection['treeScope']
  mappingConfidence: FrontendWorkshopSourceMappingConfidence
  provenanceKind: FrontendWorkshopRuntimeDomNodeMapping['provenance']['kind'] | 'runtime-observed'
  sourceEntityId?: string
  sourceCandidateEntityId?: string
  sourceRange?: { start: number; end: number }
  exactIdValueTarget?: FrontendWorkshopExactSourceMapEntity
  exactAttributeTargets?: Record<string, FrontendWorkshopExactSourceMapEntity>
  exactTextTarget?: FrontendWorkshopExactSourceMapEntity
  layout?: FrontendWorkshopSourceRuntimeDomSelection['layout']
}

/** Explicit selection of an authored element, not a claim that a runtime node came from it. */
export function listFrontendWorkshopSourceElements(
  source: FrontendWorkshopSourceDocument,
  analysis: FrontendWorkshopSourceAnalysisSnapshot,
): Array<{
  id: string
  label: string
  thumbnail?: string
  kind: string
  selection: FrontendWorkshopResolvedSourceSelection
}> {
  return analysis.sourceMap.entities.flatMap((entity) => {
    if (entity.semanticKind !== 'html.start-tag' || !isCurrentStaticEntity(source, entity))
      return []
    const range = entity.provenance.anchor.range
    const opening = source.authorSource.slice(range.start, range.end)
    const tagName = /^<([\w:-]+)/u.exec(opening)?.[1]?.toLowerCase()
    if (
      !tagName ||
      ['html', 'head', 'body', 'script', 'style', 'meta', 'link', 'title'].includes(tagName)
    )
      return []
    const attributes = findExactAttributeTargets(source, analysis, entity)
    const idRange = attributes.id?.provenance.anchor.range
    const elementId = idRange ? source.authorSource.slice(idRange.start, idRange.end) : undefined
    const text = /^[^<]*/u.exec(source.authorSource.slice(range.end))?.[0]?.trim() ?? ''
    const names: Record<string, string> = {
      img: '图片',
      h1: '标题',
      h2: '标题',
      h3: '标题',
      p: '正文',
      span: '文字',
      button: '按钮',
      a: '链接',
      section: '区域',
      article: '内容组',
      div: '容器',
      ul: '列表',
      li: '条目',
      audio: '音乐',
      video: '视频',
      input: '输入框',
    }
    const kind = names[tagName] ?? '元素'
    const readAttribute = (name: string) => {
      const attr = attributes[name]?.provenance.anchor.range
      return attr ? source.authorSource.slice(attr.start, attr.end) : ''
    }
    const label = [
      kind,
      readAttribute('data-fw-layer-name') ||
        readAttribute('aria-label') ||
        readAttribute('alt') ||
        text ||
        elementId,
    ]
      .filter(Boolean)
      .join(' · ')
      .slice(0, 140)
    const selection = resolveFrontendWorkshopSourceSelection(
      source,
      analysis,
      {
        projectId: source.projectId,
        sourceRevision: source.revision,
        instanceId: `source-revision-${source.revision}`,
        runtimeNonce: 'source-outline',
        runtimeNodeId: entity.id,
        treeScope: 'document',
        tagName,
        ...(elementId ? { elementId } : {}),
        rect: { x: 0, y: 0, width: 0, height: 0 },
      },
      {
        runtimeNodeId: entity.id,
        nodeKind: 'element',
        provenance: entity.provenance,
        mappingConfidence: 'exact',
        sourceEntityId: entity.id,
      },
    )
    selection.selectionOrigin = 'source'
    const src = tagName === 'img' ? readAttribute('src') : ''
    const thumbnail = /^(https?:|data:image\/)/iu.test(src) ? src : undefined
    return [{ id: entity.id, label, kind, thumbnail, selection }]
  })
}

function isCurrentStaticEntity(
  source: FrontendWorkshopSourceDocument,
  entity: FrontendWorkshopSourceMapEntity | undefined,
): entity is FrontendWorkshopExactSourceMapEntity {
  return Boolean(
    entity &&
    entity.confidence === 'exact' &&
    entity.provenance.kind === 'static-source' &&
    entity.provenance.anchor.projectId === source.projectId &&
    entity.provenance.anchor.sourceRevision === source.revision,
  )
}

function containsRange(
  owner: { start: number; end: number },
  candidate: { start: number; end: number },
): boolean {
  return candidate.start >= owner.start && candidate.end <= owner.end
}

function mappingMatchesSelection(
  mapping: FrontendWorkshopRuntimeDomNodeMapping,
  selection: FrontendWorkshopSourceRuntimeDomSelection,
): boolean {
  if (mapping.runtimeNodeId !== selection.runtimeNodeId) return false
  const provenance = mapping.provenance
  if (provenance.kind === 'static-source') {
    return (
      provenance.anchor.projectId === selection.projectId &&
      provenance.anchor.sourceRevision === selection.sourceRevision
    )
  }
  return (
    provenance.projectId === selection.projectId &&
    provenance.sourceRevision === selection.sourceRevision &&
    provenance.runtimeInstanceId === selection.instanceId &&
    provenance.runtimeNonce === selection.runtimeNonce
  )
}

function findExactAttributeTargets(
  source: FrontendWorkshopSourceDocument,
  analysis: FrontendWorkshopSourceAnalysisSnapshot,
  startTag: FrontendWorkshopExactSourceMapEntity,
): Record<string, FrontendWorkshopExactSourceMapEntity> {
  const result: Record<string, FrontendWorkshopExactSourceMapEntity> = {}
  const seen = new Set<string>()
  const startTagRange = startTag.provenance.anchor.range
  const entities = analysis.sourceMap.entities.filter((entity) =>
    isCurrentStaticEntity(source, entity),
  )
  const attributes = entities.filter((entity) => {
    if (entity.semanticKind !== 'html.attribute') return false
    return containsRange(startTagRange, entity.provenance.anchor.range)
  })

  for (const attribute of attributes) {
    const attributeRange = attribute.provenance.anchor.range
    const name = entities.find(
      (entity) =>
        entity.semanticKind === 'html.attribute-name' &&
        containsRange(attributeRange, entity.provenance.anchor.range),
    )
    if (!name) continue
    const nameRange = name.provenance.anchor.range
    const key = source.authorSource.slice(nameRange.start, nameRange.end).toLowerCase()
    if (seen.has(key)) {
      delete result[key]
      continue
    }
    seen.add(key)
    const value = entities.find(
      (entity) =>
        entity.semanticKind === 'html.attribute-value' &&
        containsRange(attributeRange, entity.provenance.anchor.range),
    )
    if (value) result[key] = value
  }
  return result
}

/**
 * S4-B selection resolver. Runtime observation is always selectable, but only an exact current
 * static mapping may expose an exact write target. An inferred candidate may expose a Source range
 * for navigation without being promoted into writable provenance. The resolved selection keeps the
 * Source/runtime identity that produced it so later S4 stages can reject stale derived state even
 * when a newer revision happens to have identical text/range entity ids.
 */
export function resolveFrontendWorkshopSourceSelection(
  source: FrontendWorkshopSourceDocument,
  analysis: FrontendWorkshopSourceAnalysisSnapshot,
  selection: FrontendWorkshopSourceRuntimeDomSelection,
  mapping?: FrontendWorkshopRuntimeDomNodeMapping,
): FrontendWorkshopResolvedSourceSelection {
  const currentMapping =
    mapping && mappingMatchesSelection(mapping, selection) ? mapping : undefined
  const sourceEntityId = currentMapping?.sourceEntityId
  const sourceCandidateEntityId = currentMapping?.sourceCandidate?.sourceEntityId
  const mappedEntity = sourceEntityId
    ? analysis.sourceMap.entities.find((entity) => entity.id === sourceEntityId)
    : undefined
  const candidateEntity = sourceCandidateEntityId
    ? analysis.sourceMap.entities.find((entity) => entity.id === sourceCandidateEntityId)
    : undefined
  const exactStartTag = isCurrentStaticEntity(source, mappedEntity) ? mappedEntity : undefined
  const navigableEntity =
    exactStartTag ?? (isCurrentStaticEntity(source, candidateEntity) ? candidateEntity : undefined)
  const sourceRange = navigableEntity?.provenance.anchor.range
  const exactAttributes =
    currentMapping?.mappingConfidence === 'exact' && exactStartTag
      ? findExactAttributeTargets(source, analysis, exactStartTag)
      : undefined
  // Only a literal text-only child is editable; nested markup and script-created text stay intact.
  const textTarget =
    exactStartTag && exactAttributes
      ? analysis.sourceMap.entities.find(
          (entity) =>
            isCurrentStaticEntity(source, entity) &&
            entity.semanticKind === 'html.text' &&
            entity.provenance.anchor.range.start === exactStartTag.provenance.anchor.range.end &&
            /^<\/([^\s>]+)\s*>/u
              .exec(source.authorSource.slice(entity.provenance.anchor.range.end))?.[1]
              ?.toLowerCase() === selection.tagName.toLowerCase(),
        )
      : undefined

  return {
    projectId: selection.projectId,
    sourceRevision: selection.sourceRevision,
    instanceId: selection.instanceId,
    runtimeNonce: selection.runtimeNonce,
    runtimeNodeId: selection.runtimeNodeId,
    tagName: selection.tagName,
    ...(selection.elementId ? { elementId: selection.elementId } : {}),
    treeScope: selection.treeScope,
    ...(selection.layout ? { layout: selection.layout } : {}),
    mappingConfidence: currentMapping?.mappingConfidence ?? 'partial',
    provenanceKind: currentMapping?.provenance.kind ?? 'runtime-observed',
    ...(sourceEntityId ? { sourceEntityId } : {}),
    ...(sourceCandidateEntityId ? { sourceCandidateEntityId } : {}),
    ...(sourceRange ? { sourceRange: { ...sourceRange } } : {}),
    ...(currentMapping?.mappingConfidence === 'exact' && exactStartTag
      ? {
          exactIdValueTarget: exactAttributes?.id,
          exactAttributeTargets: exactAttributes,
          ...(isCurrentStaticEntity(source, textTarget) ? { exactTextTarget: textTarget } : {}),
        }
      : {}),
  }
}

/** Individual literal ranges inside a container, never a flattened textContent replacement. */
export function listFrontendWorkshopSourceContent(
  source: FrontendWorkshopSourceDocument,
  analysis: FrontendWorkshopSourceAnalysisSnapshot,
  selection: FrontendWorkshopResolvedSourceSelection,
): Array<{ label: string; target: FrontendWorkshopExactSourceMapEntity; text: boolean }> {
  let range
  try {
    range = extractFrontendWorkshopSourceComponentHtml(source, selection).range
  } catch {
    return []
  }
  const result: ReturnType<typeof listFrontendWorkshopSourceContent> = []
  for (const entity of analysis.sourceMap.entities) {
    if (
      !isCurrentStaticEntity(source, entity) ||
      !containsRange(range, entity.provenance.anchor.range)
    )
      continue
    const own = entity.provenance.anchor.range
    if (
      entity.semanticKind === 'html.text' &&
      source.authorSource.slice(own.start, own.end).trim()
    ) {
      if (entity.id !== selection.exactTextTarget?.id)
        result.push({ label: '文字', target: entity, text: true })
    }
    if (entity.semanticKind !== 'html.start-tag' || own.start === range.start) continue
    const tag = /^<([\w:-]+)/u
      .exec(source.authorSource.slice(own.start, own.end))?.[1]
      ?.toLowerCase()
    const attributes = findExactAttributeTargets(source, analysis, entity)
    for (const [name, label] of Object.entries({
      src: tag === 'img' ? '图片地址' : '素材地址',
      alt: '图片说明',
      href: '链接地址',
    })) {
      if (attributes[name]) result.push({ label, target: attributes[name], text: false })
    }
  }
  return result
}

/**
 * Convert a user-facing DOM attribute value back to safe raw Source text for the existing literal
 * attribute value range. Only the edited range is encoded; surrounding Author Source is untouched.
 */
export function encodeFrontendWorkshopSourceAttributeValue(
  source: Pick<FrontendWorkshopSourceDocument, 'authorSource'>,
  target: FrontendWorkshopExactSourceMapEntity,
  value: string,
): string {
  const range = target.provenance.anchor.range
  const before = range.start > 0 ? source.authorSource[range.start - 1] : ''
  const after = range.end < source.authorSource.length ? source.authorSource[range.end] : ''
  const quote = (before === '"' || before === "'") && after === before ? before : ''

  return Array.from(value)
    .map((character) => {
      if (character === '&') return '&amp;'
      if (character === '<') return '&lt;'
      if (character === '>') return '&gt;'
      if (character === '"') return quote === '"' || !quote ? '&quot;' : character
      if (character === "'") return quote === "'" || !quote ? '&#39;' : character
      if (!quote && (character === '=' || character === '`' || /\s/u.test(character))) {
        return `&#${character.codePointAt(0)};`
      }
      return character
    })
    .join('')
}
