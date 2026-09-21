import { describe, expect, it } from 'vitest'

import { RESOURCE_TYPE, type ResourceSummary } from '../types/Resource'
import { ResourceQueryEngine, ResourceStatsIndex } from './ResourceQueryEngine'

function resource(index: number): ResourceSummary {
  const type = index % 2 ? RESOURCE_TYPE.CHARACTER_CARD : RESOURCE_TYPE.PRESET
  return {
    id: `r-${index}`,
    type,
    name: `资源 ${index}`,
    fileName: `${index}.json`,
    mimeType: 'application/json',
    fileSize: index,
    contentHash: String(index).padStart(64, '0'),
    description: '',
    tags: index % 3 ? ['常用'] : ['测试'],
    categoryId: index % 5 ? 'folder' : null,
    categoryIds: index % 5 ? ['folder'] : [],
    relatedResourceIds: [],
    sourceLinks: [],
    favorite: index % 7 === 0,
    metadata: {},
    createdAt: index,
    updatedAt: index,
  }
}

describe('ResourceQueryEngine', () => {
  it('centralizes indexed-condition semantics and bounded pagination for 3000 summaries', () => {
    const resources = Array.from({ length: 3000 }, (_, index) => resource(index))
    const result = new ResourceQueryEngine().query(resources, {
      filter: 'favorites',
      categoryId: 'folder',
      tag: '常用',
      sort: 'newest',
      offset: 5,
      limit: 20,
    })
    expect(result.items).toHaveLength(20)
    expect(result.total).toBeGreaterThan(20)
    expect(
      result.items.every((item) => item.favorite && item.categoryIds?.includes('folder')),
    ).toBe(true)
    expect(result.items[0]!.updatedAt).toBeGreaterThan(result.items.at(-1)!.updatedAt)
  })

  it('maintains type/favorite/tag facets behind one StatsIndex API', () => {
    const stats = new ResourceStatsIndex()
    stats.replace([resource(1), resource(2), resource(7)])
    expect(stats.snapshot().favorites).toBe(1)
    stats.remove('r-7')
    expect(stats.snapshot().favorites).toBe(0)
    stats.upsert(resource(14))
    expect(stats.snapshot().typeCounts.get(RESOURCE_TYPE.PRESET)).toBe(2)
  })
})
