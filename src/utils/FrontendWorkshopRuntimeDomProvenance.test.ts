import { describe, expect, it } from 'vitest'

import { createFrontendWorkshopSourceDocument } from '../types/FrontendWorkshopSourceDocument'
import { analyzeFrontendWorkshopSource } from './FrontendWorkshopSourceAnalysis'
import { mapFrontendWorkshopRuntimeDomSnapshot } from './FrontendWorkshopRuntimeDomProvenance'
import type {
  FrontendWorkshopSourceRuntimeDomNodeSnapshot,
  FrontendWorkshopSourceRuntimeDomSnapshot,
} from './FrontendWorkshopSourceRuntime'

function sourceDocument(authorSource: string, revision = 1) {
  const source = createFrontendWorkshopSourceDocument('project-runtime-dom', authorSource, 100)
  source.revision = revision
  return source
}

function runtimeSnapshot(
  nodes: FrontendWorkshopSourceRuntimeDomNodeSnapshot[],
  snapshotSequence = 1,
  sourceRevision = 1,
  truncated = false,
): FrontendWorkshopSourceRuntimeDomSnapshot {
  return {
    projectId: 'project-runtime-dom',
    sourceRevision,
    instanceId: 'instance-a',
    runtimeNonce: 'nonce-a',
    requestId: `request-${snapshotSequence}`,
    snapshotSequence,
    nodes,
    truncated,
  }
}

function elementNode(
  runtimeNodeId: string,
  tagName: string,
  elementId: string,
  firstSeenSequence = 1,
  extras: Partial<FrontendWorkshopSourceRuntimeDomNodeSnapshot> = {},
): FrontendWorkshopSourceRuntimeDomNodeSnapshot {
  return {
    runtimeNodeId,
    nodeKind: 'element',
    treeScope: 'document',
    firstSeenSequence,
    tagName,
    elementId,
    ...extras,
  }
}

describe('FrontendWorkshopRuntimeDomProvenance', () => {
  it('promotes only a uniquely provable inert light-DOM element in a complete baseline snapshot', () => {
    const source = sourceDocument('<section id="hero"><span id="label">Hello</span></section>')
    const analysis = analyzeFrontendWorkshopSource(source)
    const snapshot = runtimeSnapshot([
      elementNode('runtime-1', 'section', 'hero'),
      elementNode('runtime-2', 'span', 'label', 1, { parentRuntimeNodeId: 'runtime-1' }),
    ])

    const mapping = mapFrontendWorkshopRuntimeDomSnapshot(source, analysis, snapshot)

    expect(mapping.sourceAnalysisCurrent).toBe(true)
    expect(mapping.baselineComplete).toBe(true)
    expect(mapping.nodes).toHaveLength(2)
    for (const node of mapping.nodes) {
      expect(node.provenance.kind).toBe('static-source')
      expect(node.mappingConfidence).toBe('exact')
      expect(node.sourceEntityId).toBeTruthy()
      if (node.provenance.kind !== 'static-source') throw new Error('expected static provenance')
      const slice = source.authorSource.slice(
        node.provenance.anchor.range.start,
        node.provenance.anchor.range.end,
      )
      expect(slice.startsWith('<')).toBe(true)
      expect(slice.endsWith('>')).toBe(true)
    }
  })

  it('keeps an initial DOM node observed when executable Source could have replaced it', () => {
    const source = sourceDocument(
      '<div id="hero">before</div><script>document.getElementById("hero").replaceWith(document.createElement("div"))</script>',
    )
    const analysis = analyzeFrontendWorkshopSource(source)
    const mapping = mapFrontendWorkshopRuntimeDomSnapshot(
      source,
      analysis,
      runtimeSnapshot([elementNode('runtime-1', 'div', 'hero')]),
    )
    const node = mapping.nodes[0]!

    expect(node.provenance.kind).toBe('runtime-observed')
    expect(node.mappingConfidence).toBe('inferred')
    expect(node.sourceCandidate?.reason).toBe('unique-id-tag-match')
    expect(node).not.toHaveProperty('sourceEntityId')
    expect(node.provenance).not.toHaveProperty('anchor')
  })

  it('marks a later first-seen node runtime-dynamic only with a complete same-instance baseline', () => {
    const source = sourceDocument('<div id="later"></div>')
    const analysis = analyzeFrontendWorkshopSource(source)
    const baseline = runtimeSnapshot([], 1)
    const mapping = mapFrontendWorkshopRuntimeDomSnapshot(
      source,
      analysis,
      runtimeSnapshot([elementNode('runtime-2', 'div', 'later', 2)], 2),
      baseline,
    )
    const node = mapping.nodes[0]!

    expect(mapping.baselineComplete).toBe(true)
    expect(node.provenance).toEqual({
      kind: 'runtime-dynamic',
      projectId: source.projectId,
      sourceRevision: source.revision,
      runtimeInstanceId: 'instance-a',
      runtimeNonce: 'nonce-a',
    })
    expect(node.mappingConfidence).toBe('exact')
    expect(node).not.toHaveProperty('sourceEntityId')
    expect(node).not.toHaveProperty('sourceCandidate')
    expect(node.provenance).not.toHaveProperty('anchor')
  })

  it('keeps later first-seen nodes runtime-observed when baseline evidence is missing or truncated', () => {
    const source = sourceDocument('<div id="later"></div>')
    const analysis = analyzeFrontendWorkshopSource(source)
    const later = runtimeSnapshot([elementNode('runtime-2', 'div', 'later', 2)], 2)

    const withoutBaseline = mapFrontendWorkshopRuntimeDomSnapshot(source, analysis, later)
    const withTruncatedBaseline = mapFrontendWorkshopRuntimeDomSnapshot(
      source,
      analysis,
      later,
      runtimeSnapshot([], 1, 1, true),
    )

    for (const mapping of [withoutBaseline, withTruncatedBaseline]) {
      expect(mapping.baselineComplete).toBe(false)
      expect(mapping.nodes[0]?.provenance.kind).toBe('runtime-observed')
      expect(mapping.nodes[0]?.mappingConfidence).toBe('inferred')
      expect(mapping.nodes[0]?.sourceCandidate?.reason).toBe('unique-id-tag-match')
    }
  })

  it('rejects a baseline snapshot from another runtime identity as dynamic evidence', () => {
    const source = sourceDocument('<div id="later"></div>')
    const analysis = analyzeFrontendWorkshopSource(source)
    const baseline = {
      ...runtimeSnapshot([], 1),
      runtimeNonce: 'other-nonce',
    }
    const mapping = mapFrontendWorkshopRuntimeDomSnapshot(
      source,
      analysis,
      runtimeSnapshot([elementNode('runtime-2', 'div', 'later', 2)], 2),
      baseline,
    )

    expect(mapping.baselineComplete).toBe(false)
    expect(mapping.nodes[0]?.provenance.kind).toBe('runtime-observed')
  })

  it('maps a static custom-element host conservatively but not its open shadow descendants', () => {
    const source = sourceDocument('<odd-card id="host"></odd-card>')
    const analysis = analyzeFrontendWorkshopSource(source)
    const snapshot = runtimeSnapshot([
      elementNode('runtime-host', 'odd-card', 'host'),
      elementNode('runtime-shadow', 'span', 'inside', 1, {
        treeScope: 'shadow',
        shadowHostRuntimeNodeId: 'runtime-host',
      }),
    ])

    const mapping = mapFrontendWorkshopRuntimeDomSnapshot(source, analysis, snapshot)

    expect(mapping.nodes[0]?.provenance.kind).toBe('static-source')
    expect(mapping.nodes[1]?.provenance.kind).toBe('runtime-observed')
    expect(mapping.nodes[1]?.sourceCandidate).toBeUndefined()
  })

  it('does not reuse static Source provenance when the analysis revision is stale', () => {
    const analyzedSource = sourceDocument('<div id="hero"></div>', 1)
    const currentSource = sourceDocument('<div id="hero">changed</div>', 2)
    const analysis = analyzeFrontendWorkshopSource(analyzedSource)
    const snapshot = runtimeSnapshot([elementNode('runtime-1', 'div', 'hero')], 1, 2)

    const mapping = mapFrontendWorkshopRuntimeDomSnapshot(currentSource, analysis, snapshot)

    expect(mapping.sourceAnalysisCurrent).toBe(false)
    expect(mapping.nodes[0]?.provenance.kind).toBe('runtime-observed')
    expect(mapping.nodes[0]?.sourceCandidate).toBeUndefined()
  })

  it('keeps static promotion disabled when any Source island remains unknown', () => {
    const source = sourceDocument('<?srl payload?><div id="hero"></div>')
    const analysis = analyzeFrontendWorkshopSource(source)
    const mapping = mapFrontendWorkshopRuntimeDomSnapshot(
      source,
      analysis,
      runtimeSnapshot([elementNode('runtime-1', 'div', 'hero')]),
    )

    expect(analysis.sourceMap.unknownIslands.length).toBeGreaterThan(0)
    expect(mapping.nodes[0]?.provenance.kind).toBe('runtime-observed')
    expect(mapping.nodes[0]?.sourceCandidate?.sourceEntityId).toBeTruthy()
  })
})
