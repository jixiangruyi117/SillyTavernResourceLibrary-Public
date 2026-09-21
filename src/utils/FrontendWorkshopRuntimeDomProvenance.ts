import type { FrontendWorkshopSourceDocument } from '../types/FrontendWorkshopSourceDocument'
import type {
  FrontendWorkshopSourceAnalysisSnapshot,
  FrontendWorkshopSourceMapEntity,
  FrontendWorkshopSourceMappingConfidence,
  FrontendWorkshopStaticSourceProvenance,
} from './FrontendWorkshopSourceAnalysis'
import type {
  FrontendWorkshopSourceRuntimeDomNodeSnapshot,
  FrontendWorkshopSourceRuntimeDomSnapshot,
} from './FrontendWorkshopSourceRuntime'

export interface FrontendWorkshopRuntimeObservedProvenance {
  kind: 'runtime-observed'
  projectId: string
  sourceRevision: number
  runtimeInstanceId: string
  runtimeNonce: string
}

export interface FrontendWorkshopRuntimeDynamicDomProvenance {
  kind: 'runtime-dynamic'
  projectId: string
  sourceRevision: number
  runtimeInstanceId: string
  runtimeNonce: string
}

export type FrontendWorkshopRuntimeDomNodeProvenance =
  | FrontendWorkshopStaticSourceProvenance
  | FrontendWorkshopRuntimeObservedProvenance
  | FrontendWorkshopRuntimeDynamicDomProvenance

export interface FrontendWorkshopRuntimeDomSourceCandidate {
  sourceEntityId: string
  confidence: 'inferred'
  reason: 'unique-id-tag-match'
}

export interface FrontendWorkshopRuntimeDomNodeMapping {
  runtimeNodeId: string
  nodeKind: FrontendWorkshopSourceRuntimeDomNodeSnapshot['nodeKind']
  provenance: FrontendWorkshopRuntimeDomNodeProvenance
  mappingConfidence: FrontendWorkshopSourceMappingConfidence
  sourceEntityId?: string
  sourceCandidate?: FrontendWorkshopRuntimeDomSourceCandidate
}

export interface FrontendWorkshopRuntimeDomMappingSnapshot {
  projectId: string
  sourceRevision: number
  runtimeInstanceId: string
  runtimeNonce: string
  snapshotSequence: number
  truncated: boolean
  sourceAnalysisCurrent: boolean
  baselineComplete: boolean
  nodes: readonly FrontendWorkshopRuntimeDomNodeMapping[]
}

interface StaticElementDescriptor {
  sourceEntity: FrontendWorkshopSourceMapEntity & {
    provenance: FrontendWorkshopStaticSourceProvenance
  }
  tagName: string
  elementId?: string
  hasInlineHandler: boolean
}

function staticRange(entity: FrontendWorkshopSourceMapEntity) {
  return entity.provenance.kind === 'static-source' ? entity.provenance.anchor.range : undefined
}

function containsRange(
  owner: { start: number; end: number },
  candidate: { start: number; end: number },
): boolean {
  return candidate.start >= owner.start && candidate.end <= owner.end
}

function staticEntities(
  analysis: FrontendWorkshopSourceAnalysisSnapshot,
): Array<FrontendWorkshopSourceMapEntity & { provenance: FrontendWorkshopStaticSourceProvenance }> {
  return analysis.sourceMap.entities.filter(
    (
      entity,
    ): entity is FrontendWorkshopSourceMapEntity & {
      provenance: FrontendWorkshopStaticSourceProvenance
    } => entity.provenance.kind === 'static-source',
  )
}

function describeStaticElements(
  source: FrontendWorkshopSourceDocument,
  analysis: FrontendWorkshopSourceAnalysisSnapshot,
): StaticElementDescriptor[] {
  const entities = staticEntities(analysis)
  const startTags = entities.filter((entity) => entity.semanticKind === 'html.start-tag')
  const tagNames = entities.filter((entity) => entity.semanticKind === 'html.tag-name')
  const attributes = entities.filter((entity) => entity.semanticKind === 'html.attribute')
  const attributeNames = entities.filter((entity) => entity.semanticKind === 'html.attribute-name')
  const attributeValues = entities.filter(
    (entity) => entity.semanticKind === 'html.attribute-value',
  )
  const descriptors: StaticElementDescriptor[] = []

  for (const startTag of startTags) {
    const ownerRange = staticRange(startTag)
    if (!ownerRange) continue
    const tagNameEntity = tagNames.find((entity) => {
      const range = staticRange(entity)
      return range ? containsRange(ownerRange, range) : false
    })
    const tagNameRange = tagNameEntity ? staticRange(tagNameEntity) : undefined
    if (!tagNameRange) continue

    let elementId: string | undefined
    let hasInlineHandler = false
    for (const attribute of attributes) {
      const attributeRange = staticRange(attribute)
      if (!attributeRange || !containsRange(ownerRange, attributeRange)) continue
      const nameEntity = attributeNames.find((entity) => {
        const range = staticRange(entity)
        return range ? containsRange(attributeRange, range) : false
      })
      const nameRange = nameEntity ? staticRange(nameEntity) : undefined
      if (!nameRange) continue
      const attributeName = source.authorSource.slice(nameRange.start, nameRange.end).toLowerCase()
      if (attributeName.startsWith('on') && attributeName.length > 2) hasInlineHandler = true
      if (attributeName !== 'id') continue

      const valueEntity = attributeValues.find((entity) => {
        const range = staticRange(entity)
        return range ? containsRange(attributeRange, range) : false
      })
      const valueRange = valueEntity ? staticRange(valueEntity) : undefined
      if (!valueRange) continue
      const rawValue = source.authorSource.slice(valueRange.start, valueRange.end)
      if (rawValue && !rawValue.includes('&')) elementId = rawValue
    }

    descriptors.push({
      sourceEntity: startTag,
      tagName: source.authorSource.slice(tagNameRange.start, tagNameRange.end).toLowerCase(),
      ...(elementId ? { elementId } : {}),
      hasInlineHandler,
    })
  }

  return descriptors
}

function sourceAnalysisMatchesRuntime(
  source: FrontendWorkshopSourceDocument,
  analysis: FrontendWorkshopSourceAnalysisSnapshot,
  snapshot: FrontendWorkshopSourceRuntimeDomSnapshot,
): boolean {
  return (
    source.projectId === analysis.projectId &&
    source.revision === analysis.sourceRevision &&
    analysis.sourceMap.projectId === analysis.projectId &&
    analysis.sourceMap.sourceRevision === analysis.sourceRevision &&
    snapshot.projectId === analysis.projectId &&
    snapshot.sourceRevision === analysis.sourceRevision
  )
}

function runtimeSnapshotsShareIdentity(
  value: FrontendWorkshopSourceRuntimeDomSnapshot,
  snapshot: FrontendWorkshopSourceRuntimeDomSnapshot,
): boolean {
  return (
    value.projectId === snapshot.projectId &&
    value.sourceRevision === snapshot.sourceRevision &&
    value.instanceId === snapshot.instanceId &&
    value.runtimeNonce === snapshot.runtimeNonce
  )
}

function hasCompleteBaselineEvidence(
  snapshot: FrontendWorkshopSourceRuntimeDomSnapshot,
  baselineSnapshot?: FrontendWorkshopSourceRuntimeDomSnapshot,
): boolean {
  const baseline = snapshot.snapshotSequence === 1 ? snapshot : baselineSnapshot
  return Boolean(
    baseline &&
    baseline.snapshotSequence === 1 &&
    !baseline.truncated &&
    runtimeSnapshotsShareIdentity(baseline, snapshot),
  )
}

function runtimeObservedProvenance(
  snapshot: FrontendWorkshopSourceRuntimeDomSnapshot,
): FrontendWorkshopRuntimeObservedProvenance {
  return {
    kind: 'runtime-observed',
    projectId: snapshot.projectId,
    sourceRevision: snapshot.sourceRevision,
    runtimeInstanceId: snapshot.instanceId,
    runtimeNonce: snapshot.runtimeNonce,
  }
}

function runtimeDynamicProvenance(
  snapshot: FrontendWorkshopSourceRuntimeDomSnapshot,
): FrontendWorkshopRuntimeDynamicDomProvenance {
  return {
    kind: 'runtime-dynamic',
    projectId: snapshot.projectId,
    sourceRevision: snapshot.sourceRevision,
    runtimeInstanceId: snapshot.instanceId,
    runtimeNonce: snapshot.runtimeNonce,
  }
}

function sourceCandidateKey(tagName: string, elementId: string): string {
  return `${tagName}\u0000${elementId}`
}

/**
 * S3-D runtime DOM provenance bridge.
 *
 * Editor parser anchors bind the original node object to its current Source start tag. Without
 * that evidence, DOM resemblance alone is not proof. The legacy inert fallback requires a complete baseline and a unique
 * literal id/tag match when Source has no unknown islands, script element, or inline handler that
 * could have replaced the node before observation. A later first-seen node becomes runtime-dynamic
 * only when a complete sequence-1 snapshot for the same runtime identity is supplied as evidence.
 */
export function mapFrontendWorkshopRuntimeDomSnapshot(
  source: FrontendWorkshopSourceDocument,
  analysis: FrontendWorkshopSourceAnalysisSnapshot,
  snapshot: FrontendWorkshopSourceRuntimeDomSnapshot,
  baselineSnapshot?: FrontendWorkshopSourceRuntimeDomSnapshot,
): FrontendWorkshopRuntimeDomMappingSnapshot {
  const sourceAnalysisCurrent = sourceAnalysisMatchesRuntime(source, analysis, snapshot)
  const baselineComplete = hasCompleteBaselineEvidence(snapshot, baselineSnapshot)
  const descriptors = sourceAnalysisCurrent ? describeStaticElements(source, analysis) : []
  const sourceCandidates = new Map<string, StaticElementDescriptor[]>()
  const runtimeCandidateCounts = new Map<string, number>()

  for (const descriptor of descriptors) {
    if (!descriptor.elementId) continue
    const key = sourceCandidateKey(descriptor.tagName, descriptor.elementId)
    const list = sourceCandidates.get(key) ?? []
    list.push(descriptor)
    sourceCandidates.set(key, list)
  }

  for (const node of snapshot.nodes) {
    if (
      node.nodeKind !== 'element' ||
      node.treeScope !== 'document' ||
      !node.tagName ||
      !node.elementId
    ) {
      continue
    }
    const key = sourceCandidateKey(node.tagName.toLowerCase(), node.elementId)
    runtimeCandidateCounts.set(key, (runtimeCandidateCounts.get(key) ?? 0) + 1)
  }

  const sourceHasMutationRisk =
    !sourceAnalysisCurrent ||
    analysis.sourceMap.unknownIslands.length > 0 ||
    descriptors.some((descriptor) => descriptor.tagName === 'script' || descriptor.hasInlineHandler)

  const nodes = snapshot.nodes.map((node): FrontendWorkshopRuntimeDomNodeMapping => {
    const anchored =
      node.sourceEntityId && node.nodeKind === 'element' && node.treeScope === 'document'
        ? descriptors.find(
            (descriptor) =>
              descriptor.sourceEntity.id === node.sourceEntityId &&
              descriptor.tagName === node.tagName?.toLowerCase(),
          )
        : undefined
    if (anchored && anchored.sourceEntity.confidence === 'exact') {
      return {
        runtimeNodeId: node.runtimeNodeId,
        nodeKind: node.nodeKind,
        provenance: anchored.sourceEntity.provenance,
        mappingConfidence: 'exact',
        sourceEntityId: anchored.sourceEntity.id,
      }
    }
    if (node.firstSeenSequence > 1 && baselineComplete) {
      return {
        runtimeNodeId: node.runtimeNodeId,
        nodeKind: node.nodeKind,
        provenance: runtimeDynamicProvenance(snapshot),
        mappingConfidence: 'exact',
      }
    }

    let sourceCandidate: FrontendWorkshopRuntimeDomSourceCandidate | undefined
    let exactSourceEntity: StaticElementDescriptor['sourceEntity'] | undefined
    if (
      sourceAnalysisCurrent &&
      node.nodeKind === 'element' &&
      node.treeScope === 'document' &&
      node.tagName &&
      node.elementId
    ) {
      const key = sourceCandidateKey(node.tagName.toLowerCase(), node.elementId)
      const candidates = sourceCandidates.get(key) ?? []
      if (candidates.length === 1 && runtimeCandidateCounts.get(key) === 1) {
        const descriptor = candidates[0]!
        sourceCandidate = {
          sourceEntityId: descriptor.sourceEntity.id,
          confidence: 'inferred',
          reason: 'unique-id-tag-match',
        }
        if (snapshot.snapshotSequence === 1 && baselineComplete && !sourceHasMutationRisk) {
          exactSourceEntity = descriptor.sourceEntity
        }
      }
    }

    if (exactSourceEntity) {
      return {
        runtimeNodeId: node.runtimeNodeId,
        nodeKind: node.nodeKind,
        provenance: exactSourceEntity.provenance,
        mappingConfidence: 'exact',
        sourceEntityId: exactSourceEntity.id,
      }
    }

    return {
      runtimeNodeId: node.runtimeNodeId,
      nodeKind: node.nodeKind,
      provenance: runtimeObservedProvenance(snapshot),
      mappingConfidence: sourceCandidate ? 'inferred' : 'partial',
      ...(sourceCandidate ? { sourceCandidate } : {}),
    }
  })

  return {
    projectId: snapshot.projectId,
    sourceRevision: snapshot.sourceRevision,
    runtimeInstanceId: snapshot.instanceId,
    runtimeNonce: snapshot.runtimeNonce,
    snapshotSequence: snapshot.snapshotSequence,
    truncated: snapshot.truncated,
    sourceAnalysisCurrent,
    baselineComplete,
    nodes,
  }
}
