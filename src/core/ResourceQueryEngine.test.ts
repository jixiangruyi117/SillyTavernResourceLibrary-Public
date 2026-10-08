import { describe, expect, it, vi } from 'vitest'

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
  it.each([1000, 10000])(
    'keeps Chinese page ordering stable without sorting all %i matches',
    (size) => {
      const resources = Array.from({ length: size }, (_, index) => resource(index))
      let state = 123456789
      for (let index = resources.length - 1; index > 0; index--) {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0
        const target = state % (index + 1)
        ;[resources[index], resources[target]] = [resources[target]!, resources[index]!]
      }
      resources.forEach((item) => {
        item.name = `角色${Number(item.id.slice(2)) % 137}`
      })
      const oracle = new Intl.Collator('zh-CN')
      const expected = resources
        .slice()
        .sort((a, b) => oracle.compare(a.name, b.name))
        .slice(20, 44)
      const compare = vi.fn(oracle.compare)
      const collator: Intl.Collator = {
        compare,
        resolvedOptions: oracle.resolvedOptions.bind(oracle),
      }
      const result = new ResourceQueryEngine().query(resources, {
        filter: 'all',
        categoryId: undefined,
        sort: 'name',
        nameCollator: collator,
        offset: 20,
        limit: 24,
      })
      expect(result.items.map((item) => item.id)).toEqual(expected.map((item) => item.id))
      expect(result.total).toBe(size)
      expect(compare.mock.calls.length).toBeLessThan(size * 3)
    },
  )

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

  it.each(['name', 'size', 'newest'] as const)(
    'matches complete stable %s sorting at every tested page boundary without mutating input',
    (sort) => {
      const resources = Array.from({ length: 97 }, (_, index) => ({
        ...resource(index),
        name: ['阿', 'É', '爱', 'A', '阿'][index % 5]!,
        fileSize: (index * 7) % 11,
        updatedAt: (index * 13) % 17,
      }))
      const originalIds = resources.map((item) => item.id)
      const collator = new Intl.Collator('zh-CN')
      const compare =
        sort === 'name'
          ? (a: ResourceSummary, b: ResourceSummary) => collator.compare(a.name, b.name)
          : sort === 'size'
            ? (a: ResourceSummary, b: ResourceSummary) => b.fileSize - a.fileSize
            : (a: ResourceSummary, b: ResourceSummary) => b.updatedAt - a.updatedAt
      const matching = resources.filter((item) => item.tags.includes('常用'))
      const expected = matching.slice().sort(compare)
      for (const offset of [0, 1, 7, 20, 45, 64, 100]) {
        const actual = new ResourceQueryEngine().query(resources, {
          filter: 'all',
          categoryId: undefined,
          tag: '常用',
          sort,
          nameCollator: collator,
          offset,
          limit: 7,
        })
        expect(actual.items.map((item) => item.id)).toEqual(
          expected.slice(offset, offset + 7).map((item) => item.id),
        )
        expect(actual.total).toBe(matching.length)
      }
      expect(resources.map((item) => item.id)).toEqual(originalIds)
      expect(new ResourceQueryEngine().page(resources, { sort, limit: 0 }).items).toEqual([])
    },
  )

  it('preserves the previous query boundary behavior for non-finite offset/limit values', () => {
    const resources = [resource(3), resource(1), resource(2)]
    for (const sort of ['name', 'size', 'newest'] as const) {
      const collator = new Intl.Collator('zh-CN')
      const expected = resources
        .slice()
        .sort(
          sort === 'name'
            ? (a, b) => collator.compare(a.name, b.name)
            : sort === 'size'
              ? (a, b) => b.fileSize - a.fileSize
              : (a, b) => b.updatedAt - a.updatedAt,
        )
      for (const [offset, limit] of [
        [NaN, 1],
        [NaN, 4],
        [0, NaN],
        [1, NaN],
        [Infinity, 1],
        [0, Infinity],
      ]) {
        const actual = new ResourceQueryEngine().page(resources, { sort, offset, limit })
        expect(actual.items).toEqual(
          offset || limit! < resources.length ? expected.slice(offset, offset! + limit!) : expected,
        )
      }
    }
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
