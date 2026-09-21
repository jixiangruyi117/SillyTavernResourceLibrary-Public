import { describe, expect, it } from 'vitest'

import { createFrontendWorkshopSourceDocument } from '../types/FrontendWorkshopSourceDocument'
import { analyzeFrontendWorkshopSource } from './FrontendWorkshopSourceAnalysis'
import type { FrontendWorkshopRuntimeDomNodeMapping } from './FrontendWorkshopRuntimeDomProvenance'
import type { FrontendWorkshopSourceRuntimeDomSelection } from './FrontendWorkshopSourceRuntime'
import {
  encodeFrontendWorkshopSourceAttributeValue,
  listFrontendWorkshopSourceElements,
  resolveFrontendWorkshopSourceSelection,
} from './FrontendWorkshopSourceSelection'

describe('explicit authored element selection', () => {
  it('edits a chosen literal without claiming script-created DOM provenance', () => {
    const source = sourceDocument(
      '<h2>重复标题</h2><h2>重复标题</h2><img src="old.png"><script>document.body.append(document.createElement("h2"))</script>',
    )
    const analysis = analyzeFrontendWorkshopSource(source)
    const entries = listFrontendWorkshopSourceElements(source, analysis)
    expect(entries).toHaveLength(3)
    expect(entries[0]!.id).not.toBe(entries[1]!.id)
    for (const entry of entries.slice(0, 2)) {
      expect(entry.selection.selectionOrigin).toBe('source')
      const range = entry.selection.exactTextTarget!.provenance.anchor.range
      expect(source.authorSource.slice(range.start, range.end)).toBe('重复标题')
    }
    const imageRange = entries[2]!.selection.exactAttributeTargets!.src!.provenance.anchor.range
    expect(source.authorSource.slice(imageRange.start, imageRange.end)).toBe('old.png')
    expect(listFrontendWorkshopSourceElements({ ...source, revision: 2 }, analysis)).toEqual([])
  })
})

function sourceDocument(authorSource = '<div id="hero"></div>', revision = 1) {
  const source = createFrontendWorkshopSourceDocument('project-selection', authorSource, 100)
  source.revision = revision
  return source
}

function runtimeSelection(
  elementId = 'hero',
  overrides: Partial<FrontendWorkshopSourceRuntimeDomSelection> = {},
): FrontendWorkshopSourceRuntimeDomSelection {
  const rect = overrides.rect ?? { x: 10, y: 20, width: 100, height: 50 }
  return {
    projectId: 'project-selection',
    sourceRevision: 1,
    instanceId: 'instance-a',
    runtimeNonce: 'nonce-a',
    runtimeNodeId: 'runtime-node-1',
    treeScope: 'document',
    tagName: 'div',
    elementId,
    ...overrides,
    rect,
  }
}

function exactMapping() {
  const source = sourceDocument()
  const analysis = analyzeFrontendWorkshopSource(source)
  const startTag = analysis.sourceMap.entities.find(
    (entity) =>
      entity.semanticKind === 'html.start-tag' && entity.provenance.kind === 'static-source',
  )
  if (!startTag || startTag.provenance.kind !== 'static-source')
    throw new Error('missing start tag')
  const startTagRange = startTag.provenance.anchor.range
  const mapping: FrontendWorkshopRuntimeDomNodeMapping = {
    runtimeNodeId: 'runtime-node-1',
    nodeKind: 'element',
    provenance: startTag.provenance,
    mappingConfidence: 'exact',
    sourceEntityId: startTag.id,
  }
  return { source, analysis, startTag, startTagRange, mapping }
}

describe('FrontendWorkshopSourceSelection', () => {
  it('exposes an exact existing id value target only for exact static runtime mapping', () => {
    const { source, analysis, mapping } = exactMapping()
    const resolved = resolveFrontendWorkshopSourceSelection(
      source,
      analysis,
      runtimeSelection(),
      mapping,
    )

    expect(resolved).toMatchObject({
      projectId: source.projectId,
      sourceRevision: source.revision,
      instanceId: 'instance-a',
      runtimeNonce: 'nonce-a',
      runtimeNodeId: 'runtime-node-1',
      mappingConfidence: 'exact',
      provenanceKind: 'static-source',
    })
    expect(resolved.sourceRange).toBeDefined()
    expect(resolved.exactIdValueTarget?.semanticKind).toBe('html.attribute-value')
    const range = resolved.exactIdValueTarget?.provenance.anchor.range
    if (!range) throw new Error('missing id value range')
    expect(source.authorSource.slice(range.start, range.end)).toBe('hero')
  })

  it('ignores a mapping for another runtime node instead of borrowing its Source provenance', () => {
    const { source, analysis, mapping } = exactMapping()
    const resolved = resolveFrontendWorkshopSourceSelection(source, analysis, runtimeSelection(), {
      ...mapping,
      runtimeNodeId: 'runtime-node-other',
    })

    expect(resolved.mappingConfidence).toBe('partial')
    expect(resolved.provenanceKind).toBe('runtime-observed')
    expect(resolved.sourceEntityId).toBeUndefined()
    expect(resolved.sourceRange).toBeUndefined()
    expect(resolved.exactIdValueTarget).toBeUndefined()
  })

  it('ignores stale static provenance even when the newer Source has identical ranges', () => {
    const { mapping } = exactMapping()
    const current = sourceDocument('<div id="hero"></div>', 2)
    const analysis = analyzeFrontendWorkshopSource(current)
    const resolved = resolveFrontendWorkshopSourceSelection(
      current,
      analysis,
      runtimeSelection('hero', { sourceRevision: 2 }),
      mapping,
    )

    expect(resolved.sourceRevision).toBe(2)
    expect(resolved.mappingConfidence).toBe('partial')
    expect(resolved.provenanceKind).toBe('runtime-observed')
    expect(resolved.sourceEntityId).toBeUndefined()
    expect(resolved.exactIdValueTarget).toBeUndefined()
  })

  it('keeps inferred Source candidates navigable without promoting them to writable targets', () => {
    const { source, analysis, startTag, startTagRange } = exactMapping()
    const mapping: FrontendWorkshopRuntimeDomNodeMapping = {
      runtimeNodeId: 'runtime-node-1',
      nodeKind: 'element',
      provenance: {
        kind: 'runtime-observed',
        projectId: source.projectId,
        sourceRevision: source.revision,
        runtimeInstanceId: 'instance-a',
        runtimeNonce: 'nonce-a',
      },
      mappingConfidence: 'inferred',
      sourceCandidate: {
        sourceEntityId: startTag.id,
        confidence: 'inferred',
        reason: 'unique-id-tag-match',
      },
    }

    const resolved = resolveFrontendWorkshopSourceSelection(
      source,
      analysis,
      runtimeSelection(),
      mapping,
    )
    expect(resolved.mappingConfidence).toBe('inferred')
    expect(resolved.sourceCandidateEntityId).toBe(startTag.id)
    expect(resolved.sourceRange).toEqual(startTagRange)
    expect(resolved.exactIdValueTarget).toBeUndefined()
  })

  it('keeps an unmapped runtime observation selectable without inventing Source provenance', () => {
    const source = sourceDocument('<section></section>')
    const analysis = analyzeFrontendWorkshopSource(source)
    const resolved = resolveFrontendWorkshopSourceSelection(source, analysis, {
      ...runtimeSelection('dynamic'),
      tagName: 'button',
    })

    expect(resolved.mappingConfidence).toBe('partial')
    expect(resolved.provenanceKind).toBe('runtime-observed')
    expect(resolved.sourceRange).toBeUndefined()
    expect(resolved.exactIdValueTarget).toBeUndefined()
  })

  it('encodes only the edited attribute value for its existing quote context', () => {
    const { source, analysis, mapping } = exactMapping()
    const resolved = resolveFrontendWorkshopSourceSelection(
      source,
      analysis,
      runtimeSelection(),
      mapping,
    )
    const target = resolved.exactIdValueTarget
    if (!target) throw new Error('missing id target')

    expect(encodeFrontendWorkshopSourceAttributeValue(source, target, 'new "id" & <x>')).toBe(
      'new &quot;id&quot; &amp; &lt;x&gt;',
    )
    expect(source.authorSource).toBe('<div id="hero"></div>')
  })
})
