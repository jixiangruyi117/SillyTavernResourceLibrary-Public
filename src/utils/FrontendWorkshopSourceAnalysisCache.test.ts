import { describe, expect, it } from 'vitest'

import { createFrontendWorkshopSourceDocument } from '../types/FrontendWorkshopSourceDocument'
import { FrontendWorkshopSourceAnalysisCache } from './FrontendWorkshopSourceAnalysisCache'

function sourceDocument(projectId: string, authorSource: string, revision = 1) {
  const source = createFrontendWorkshopSourceDocument(projectId, authorSource, 100)
  source.revision = revision
  return source
}

describe('FrontendWorkshopSourceAnalysisCache', () => {
  it('reuses only an exact project/revision/source match and freezes the derived snapshot', () => {
    const cache = new FrontendWorkshopSourceAnalysisCache()
    const source = sourceDocument('project-a', '<div id="a"></div>')

    const first = cache.analyze(source)
    const second = cache.analyze(source)

    expect(second).toBe(first)
    expect(Object.isFrozen(first)).toBe(true)
    expect(Object.isFrozen(first.sourceMap.entities)).toBe(true)
    expect(Object.isFrozen(first.editGraph.edges)).toBe(true)
    expect(cache.size).toBe(1)
  })

  it('misses when revision changes and never reuses an old Source anchor for a new revision', () => {
    const cache = new FrontendWorkshopSourceAnalysisCache()
    const firstSource = sourceDocument('project-a', '<div id="first"></div>', 1)
    const secondSource = sourceDocument('project-a', '<div id="second"></div>', 2)

    const first = cache.analyze(firstSource)
    const second = cache.analyze(secondSource)

    expect(second).not.toBe(first)
    expect(first.sourceRevision).toBe(1)
    expect(second.sourceRevision).toBe(2)
    expect(cache.size).toBe(2)
  })

  it('defensively replaces a same-revision entry if the raw Author Source differs', () => {
    const cache = new FrontendWorkshopSourceAnalysisCache()
    const original = sourceDocument('project-a', '<div id="first"></div>', 4)
    const conflicting = sourceDocument('project-a', '<span id="second"></span>', 4)

    const first = cache.analyze(original)
    const second = cache.analyze(conflicting)

    expect(second).not.toBe(first)
    expect(second.sourceMap.sourceLength).toBe(conflicting.authorSource.length)
    expect(cache.size).toBe(1)
    const startTag = second.sourceMap.entities.find(
      (entity) => entity.semanticKind === 'html.start-tag',
    )
    expect(startTag?.provenance.kind).toBe('static-source')
    if (startTag?.provenance.kind !== 'static-source') throw new Error('expected static Source')
    expect(
      conflicting.authorSource.slice(
        startTag.provenance.anchor.range.start,
        startTag.provenance.anchor.range.end,
      ),
    ).toBe('<span id="second">')
  })

  it('uses bounded LRU eviction and supports project-scoped invalidation', () => {
    const cache = new FrontendWorkshopSourceAnalysisCache(2)
    const first = sourceDocument('project-a', '<div id="a"></div>', 1)
    const second = sourceDocument('project-b', '<div id="b"></div>', 1)
    const third = sourceDocument('project-c', '<div id="c"></div>', 1)

    const firstSnapshot = cache.analyze(first)
    const secondSnapshot = cache.analyze(second)
    expect(cache.analyze(first)).toBe(firstSnapshot)
    cache.analyze(third)
    expect(cache.size).toBe(2)

    const secondAfterEviction = cache.analyze(second)
    expect(secondAfterEviction).not.toBe(secondSnapshot)
    expect(cache.size).toBe(2)

    cache.invalidateProject('project-c')
    expect(cache.size).toBe(1)
    cache.clear()
    expect(cache.size).toBe(0)
  })

  it('rejects an unbounded or invalid cache size', () => {
    expect(() => new FrontendWorkshopSourceAnalysisCache(0)).toThrow()
    expect(() => new FrontendWorkshopSourceAnalysisCache(1.5)).toThrow()
  })
})
