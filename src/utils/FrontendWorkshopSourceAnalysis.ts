import type { FrontendWorkshopSourceDocument } from '../types/FrontendWorkshopSourceDocument'
import { segmentFrontendWorkshopAuthorSource } from './FrontendWorkshopSourceHtmlSegmentation'
import {
  analyzeFrontendWorkshopSourceRelations,
  createFrontendWorkshopSourceEntityId,
} from './FrontendWorkshopSourceRelations'

export const FRONTEND_WORKSHOP_SOURCE_ANALYSIS_VERSION = 1 as const
export const FRONTEND_WORKSHOP_SOURCE_OFFSET_UNIT = 'utf16-code-unit' as const

export type FrontendWorkshopSourceMappingConfidence = 'exact' | 'partial' | 'inferred'

/**
 * Author Source offsets use JavaScript string indices: UTF-16 code units with a half-open
 * [start, end) range. The range is meaningful only for the Source revision carried by its anchor.
 */
export interface FrontendWorkshopSourceRange {
  start: number
  end: number
}

export interface FrontendWorkshopSourceAnchor {
  projectId: string
  sourceRevision: number
  offsetUnit: typeof FRONTEND_WORKSHOP_SOURCE_OFFSET_UNIT
  range: FrontendWorkshopSourceRange
}

export interface FrontendWorkshopStaticSourceProvenance {
  kind: 'static-source'
  anchor: FrontendWorkshopSourceAnchor
}

/**
 * Runtime-created DOM is related to a Source revision but has no fabricated static Source range.
 */
export interface FrontendWorkshopRuntimeDynamicProvenance {
  kind: 'runtime-dynamic'
  projectId: string
  sourceRevision: number
  runtimeInstanceId?: string
}

export type FrontendWorkshopSourceProvenance =
  FrontendWorkshopStaticSourceProvenance | FrontendWorkshopRuntimeDynamicProvenance

/**
 * `semanticKind` is descriptive analyzer output, not a Registry / NodeKind / Capability whitelist.
 * Future analyzers may emit new labels without changing the Source truth contract.
 */
export interface FrontendWorkshopSourceMapEntity {
  id: string
  semanticKind: string
  confidence: FrontendWorkshopSourceMappingConfidence
  provenance: FrontendWorkshopSourceProvenance
}

export interface FrontendWorkshopUnknownSourceIsland {
  id: string
  reason: string
  provenance: FrontendWorkshopStaticSourceProvenance
}

export interface FrontendWorkshopSourceMap {
  projectId: string
  sourceRevision: number
  offsetUnit: typeof FRONTEND_WORKSHOP_SOURCE_OFFSET_UNIT
  sourceLength: number
  entities: readonly FrontendWorkshopSourceMapEntity[]
  unknownIslands: readonly FrontendWorkshopUnknownSourceIsland[]
}

export interface FrontendWorkshopEditGraphNode {
  id: string
  semanticKind: string
  provenance: FrontendWorkshopSourceProvenance
}

/** `relation` is intentionally open-ended and must never become an edit-capability whitelist. */
export interface FrontendWorkshopEditGraphEdge {
  fromId: string
  toId: string
  relation: string
  confidence: FrontendWorkshopSourceMappingConfidence
}

export interface FrontendWorkshopEditGraph {
  projectId: string
  sourceRevision: number
  nodes: readonly FrontendWorkshopEditGraphNode[]
  edges: readonly FrontendWorkshopEditGraphEdge[]
}

export interface FrontendWorkshopSourceAnalysisSnapshot {
  version: typeof FRONTEND_WORKSHOP_SOURCE_ANALYSIS_VERSION
  projectId: string
  sourceRevision: number
  sourceMap: FrontendWorkshopSourceMap
  editGraph: FrontendWorkshopEditGraph
}

interface FrontendWorkshopSourceIdentity {
  projectId: FrontendWorkshopSourceDocument['projectId']
  revision: FrontendWorkshopSourceDocument['revision']
}

interface FrontendWorkshopSourceTextIdentity extends FrontendWorkshopSourceIdentity {
  authorSource: FrontendWorkshopSourceDocument['authorSource']
}

function assertSourceIdentity(source: FrontendWorkshopSourceIdentity): void {
  if (!source.projectId) throw new Error('Source Analysis 缺少 projectId')
  if (!Number.isInteger(source.revision) || source.revision < 1) {
    throw new Error('Source Analysis revision 必须是正整数')
  }
}

export function createFrontendWorkshopSourceAnchor(
  source: FrontendWorkshopSourceTextIdentity,
  range: FrontendWorkshopSourceRange,
): FrontendWorkshopSourceAnchor {
  assertSourceIdentity(source)
  if (typeof source.authorSource !== 'string') throw new Error('Author Source 必须是字符串')
  if (!Number.isInteger(range.start) || !Number.isInteger(range.end)) {
    throw new Error('Source range 必须使用整数 UTF-16 offset')
  }
  if (range.start < 0 || range.end < range.start || range.end > source.authorSource.length) {
    throw new Error('Source range 超出当前 Author Source revision')
  }
  return {
    projectId: source.projectId,
    sourceRevision: source.revision,
    offsetUnit: FRONTEND_WORKSHOP_SOURCE_OFFSET_UNIT,
    range: { start: range.start, end: range.end },
  }
}

export function createFrontendWorkshopStaticSourceProvenance(
  source: FrontendWorkshopSourceTextIdentity,
  range: FrontendWorkshopSourceRange,
): FrontendWorkshopStaticSourceProvenance {
  return {
    kind: 'static-source',
    anchor: createFrontendWorkshopSourceAnchor(source, range),
  }
}

export function createFrontendWorkshopRuntimeDynamicProvenance(
  source: FrontendWorkshopSourceIdentity,
  runtimeInstanceId?: string,
): FrontendWorkshopRuntimeDynamicProvenance {
  assertSourceIdentity(source)
  return {
    kind: 'runtime-dynamic',
    projectId: source.projectId,
    sourceRevision: source.revision,
    ...(runtimeInstanceId ? { runtimeInstanceId } : {}),
  }
}

export function isFrontendWorkshopSourceRevisionCurrent(
  value: { projectId: string; sourceRevision: number },
  source: FrontendWorkshopSourceIdentity,
): boolean {
  return value.projectId === source.projectId && value.sourceRevision === source.revision
}

/**
 * S3 Source analyzer entry point. S3-B provides tolerant lexical segmentation; S3-C adds only
 * revision-anchored CSS / JavaScript / asset relations and a derived Edit Graph. Author Source is
 * never normalized or rewritten here.
 */
export function analyzeFrontendWorkshopSource(
  source: FrontendWorkshopSourceDocument,
): FrontendWorkshopSourceAnalysisSnapshot {
  assertSourceIdentity(source)
  if (typeof source.authorSource !== 'string') throw new Error('Author Source 必须是字符串')

  const sourceLength = source.authorSource.length
  const segmentation = segmentFrontendWorkshopAuthorSource(source.authorSource)
  const relationAnalysis = analyzeFrontendWorkshopSourceRelations(source.authorSource, segmentation)
  const entityMap = new Map<string, FrontendWorkshopSourceMapEntity>()

  for (const segment of segmentation.segments) {
    const id = createFrontendWorkshopSourceEntityId(segment.semanticKind, segment.range)
    entityMap.set(id, {
      id,
      semanticKind: segment.semanticKind,
      confidence: 'exact',
      provenance: createFrontendWorkshopStaticSourceProvenance(source, segment.range),
    })
  }

  for (const relationEntity of relationAnalysis.entities) {
    if (entityMap.has(relationEntity.id)) continue
    entityMap.set(relationEntity.id, {
      id: relationEntity.id,
      semanticKind: relationEntity.semanticKind,
      confidence: relationEntity.confidence,
      provenance: createFrontendWorkshopStaticSourceProvenance(source, relationEntity.range),
    })
  }

  const entities = [...entityMap.values()]
  const unknownIslands: FrontendWorkshopUnknownSourceIsland[] = segmentation.unknownSlices.map(
    (slice) => ({
      id: `unknown:${slice.reason}:${slice.range.start}-${slice.range.end}`,
      reason: slice.reason,
      provenance: createFrontendWorkshopStaticSourceProvenance(source, slice.range),
    }),
  )

  if (sourceLength && entities.length === 0 && unknownIslands.length === 0) {
    unknownIslands.push({
      id: `unknown:unclassified-source:0-${sourceLength}`,
      reason: 'unclassified-source',
      provenance: createFrontendWorkshopStaticSourceProvenance(source, {
        start: 0,
        end: sourceLength,
      }),
    })
  }

  const editGraphNodes: FrontendWorkshopEditGraphNode[] = entities.map((entity) => ({
    id: entity.id,
    semanticKind: entity.semanticKind,
    provenance: entity.provenance,
  }))
  const editGraphNodeIds = new Set(editGraphNodes.map((node) => node.id))
  const editGraphEdges: FrontendWorkshopEditGraphEdge[] = relationAnalysis.edges.filter(
    (edge) => editGraphNodeIds.has(edge.fromId) && editGraphNodeIds.has(edge.toId),
  )

  return {
    version: FRONTEND_WORKSHOP_SOURCE_ANALYSIS_VERSION,
    projectId: source.projectId,
    sourceRevision: source.revision,
    sourceMap: {
      projectId: source.projectId,
      sourceRevision: source.revision,
      offsetUnit: FRONTEND_WORKSHOP_SOURCE_OFFSET_UNIT,
      sourceLength,
      entities,
      unknownIslands,
    },
    editGraph: {
      projectId: source.projectId,
      sourceRevision: source.revision,
      nodes: editGraphNodes,
      edges: editGraphEdges,
    },
  }
}
