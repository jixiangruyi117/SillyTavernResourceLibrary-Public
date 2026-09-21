import { describe, expect, it } from 'vitest'

import { createFrontendWorkshopSourceDocument } from '../types/FrontendWorkshopSourceDocument'
import { mapFrontendWorkshopRuntimeDomSnapshot } from './FrontendWorkshopRuntimeDomProvenance'
import { FrontendWorkshopSourceAnalysisCache } from './FrontendWorkshopSourceAnalysisCache'
import type { FrontendWorkshopSourceRuntimeDomSnapshot } from './FrontendWorkshopSourceRuntime'

function sourceDocument(authorSource: string, revision: number) {
  const source = createFrontendWorkshopSourceDocument('project-integration', authorSource, 100)
  source.revision = revision
  return source
}

function snapshot(
  sourceRevision: number,
  options: {
    snapshotSequence?: number
    firstSeenSequence?: number
    instanceId?: string
    runtimeNonce?: string
    tagName?: string
    elementId?: string
    truncated?: boolean
  } = {},
): FrontendWorkshopSourceRuntimeDomSnapshot {
  const snapshotSequence = options.snapshotSequence ?? 1
  return {
    projectId: 'project-integration',
    sourceRevision,
    instanceId: options.instanceId ?? 'instance-a',
    runtimeNonce: options.runtimeNonce ?? 'nonce-a',
    requestId: `request-${snapshotSequence}`,
    snapshotSequence,
    truncated: options.truncated ?? false,
    nodes: [
      {
        runtimeNodeId: `runtime-node-${snapshotSequence}`,
        nodeKind: 'element',
        treeScope: 'document',
        firstSeenSequence: options.firstSeenSequence ?? 1,
        tagName: options.tagName ?? 'div',
        elementId: options.elementId ?? 'hero',
      },
    ],
  }
}

describe('FrontendWorkshop S3 revision/cache/runtime integration', () => {
  it('never promotes an old cached Source revision into a newer runtime snapshot', () => {
    const cache = new FrontendWorkshopSourceAnalysisCache()
    const oldSource = sourceDocument('<div id="hero"></div>', 1)
    const currentSource = sourceDocument('<span id="hero"></span>', 2)
    const staleAnalysis = cache.analyze(oldSource)

    const mapping = mapFrontendWorkshopRuntimeDomSnapshot(
      currentSource,
      staleAnalysis,
      snapshot(2, { tagName: 'span' }),
    )

    expect(mapping.sourceAnalysisCurrent).toBe(false)
    expect(mapping.nodes[0]?.provenance.kind).toBe('runtime-observed')
    expect(mapping.nodes[0]).not.toHaveProperty('sourceEntityId')
  })

  it('recomputes a same-revision source conflict before runtime static promotion', () => {
    const cache = new FrontendWorkshopSourceAnalysisCache()
    cache.analyze(sourceDocument('<div id="first"></div>', 4))
    const currentSource = sourceDocument('<span id="second"></span>', 4)
    const currentAnalysis = cache.analyze(currentSource)

    const mapping = mapFrontendWorkshopRuntimeDomSnapshot(
      currentSource,
      currentAnalysis,
      snapshot(4, { tagName: 'span', elementId: 'second' }),
    )

    expect(mapping.sourceAnalysisCurrent).toBe(true)
    expect(mapping.baselineComplete).toBe(true)
    expect(mapping.nodes[0]?.provenance.kind).toBe('static-source')
  })

  it('requires a complete baseline from the same disposable runtime identity before dynamic proof', () => {
    const cache = new FrontendWorkshopSourceAnalysisCache()
    const source = sourceDocument('<div id="hero"></div>', 6)
    const analysis = cache.analyze(source)
    const later = snapshot(6, {
      snapshotSequence: 2,
      firstSeenSequence: 2,
      elementId: 'later',
    })
    const wrongBaseline = snapshot(6, { runtimeNonce: 'nonce-other' })

    const ambiguous = mapFrontendWorkshopRuntimeDomSnapshot(source, analysis, later, wrongBaseline)
    expect(ambiguous.baselineComplete).toBe(false)
    expect(ambiguous.nodes[0]?.provenance.kind).toBe('runtime-observed')

    const proven = mapFrontendWorkshopRuntimeDomSnapshot(source, analysis, later, snapshot(6))
    expect(proven.baselineComplete).toBe(true)
    expect(proven.nodes[0]?.provenance.kind).toBe('runtime-dynamic')
    expect(proven.nodes[0]?.provenance).not.toHaveProperty('anchor')
  })
})
