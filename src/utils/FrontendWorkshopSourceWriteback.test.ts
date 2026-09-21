import { describe, expect, it } from 'vitest'

import { createFrontendWorkshopSourceDocument } from '../types/FrontendWorkshopSourceDocument'
import {
  analyzeFrontendWorkshopSource,
  createFrontendWorkshopRuntimeDynamicProvenance,
} from './FrontendWorkshopSourceAnalysis'
import { applyFrontendWorkshopExactSourceWriteback } from './FrontendWorkshopSourceWriteback'

function sourceDocument(authorSource: string, revision = 1) {
  const source = createFrontendWorkshopSourceDocument('project-writeback', authorSource, 100)
  source.revision = revision
  return source
}

describe('FrontendWorkshopSourceWriteback', () => {
  it('replaces only an exact static Source range and preserves surrounding raw bytes', () => {
    const source = sourceDocument(
      '😀\r\n<div data-x="old"> keep  </div>\r\n<script>window.raw = "  x  "</script>',
    )
    const before = source.authorSource
    const analysis = analyzeFrontendWorkshopSource(source)
    const value = analysis.sourceMap.entities.find(
      (entity) =>
        entity.semanticKind === 'html.attribute-value' &&
        entity.provenance.kind === 'static-source' &&
        source.authorSource.slice(
          entity.provenance.anchor.range.start,
          entity.provenance.anchor.range.end,
        ) === 'old',
    )
    if (!value) throw new Error('missing attribute value mapping')

    const next = applyFrontendWorkshopExactSourceWriteback(source, value, 'new-value')

    expect(source.authorSource).toBe(before)
    expect(next).toBe(
      '😀\r\n<div data-x="new-value"> keep  </div>\r\n<script>window.raw = "  x  "</script>',
    )
  })

  it('rejects stale, inferred and runtime-only mappings', () => {
    const source = sourceDocument('<div id="hero"></div>', 2)
    const stale = analyzeFrontendWorkshopSource(sourceDocument('<div id="hero"></div>', 1))
    const staleEntity = stale.sourceMap.entities.find(
      (entity) => entity.semanticKind === 'html.start-tag',
    )
    if (!staleEntity) throw new Error('missing stale entity')

    expect(() => applyFrontendWorkshopExactSourceWriteback(source, staleEntity, '<span>')).toThrow(
      /失效/u,
    )
    expect(() =>
      applyFrontendWorkshopExactSourceWriteback(
        source,
        { ...staleEntity, confidence: 'inferred' },
        '<span>',
      ),
    ).toThrow(/exact/u)
    expect(() =>
      applyFrontendWorkshopExactSourceWriteback(
        source,
        {
          confidence: 'exact',
          provenance: createFrontendWorkshopRuntimeDynamicProvenance(
            { projectId: source.projectId, revision: source.revision },
            'instance-a',
          ),
        },
        '<span>',
      ),
    ).toThrow(/static-source/u)
  })

  it('rejects a static mapping from another project or an invalid range', () => {
    const source = sourceDocument('<div id="hero"></div>')
    const analysis = analyzeFrontendWorkshopSource(source)
    const entity = analysis.sourceMap.entities.find(
      (candidate) => candidate.semanticKind === 'html.start-tag',
    )
    if (!entity || entity.provenance.kind !== 'static-source')
      throw new Error('missing static entity')

    expect(() =>
      applyFrontendWorkshopExactSourceWriteback(
        { ...source, projectId: 'project-other' },
        entity,
        '<span>',
      ),
    ).toThrow(/失效/u)

    const invalid = {
      ...entity,
      provenance: {
        ...entity.provenance,
        anchor: {
          ...entity.provenance.anchor,
          range: { start: 0, end: source.authorSource.length + 1 },
        },
      },
    }
    expect(() => applyFrontendWorkshopExactSourceWriteback(source, invalid, '<span>')).toThrow(
      /range/u,
    )
  })
})
