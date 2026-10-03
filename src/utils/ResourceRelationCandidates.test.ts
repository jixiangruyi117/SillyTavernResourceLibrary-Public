import { describe, expect, it } from 'vitest'

import { RESOURCE_TYPE, type ResourceSummary } from '../types/Resource'
import {
  filterResourceRelationCandidates,
  isResourceBoundElsewhere,
} from './ResourceRelationCandidates'

function resource(id: string, name: string, relatedResourceIds: string[] = []): ResourceSummary {
  return {
    id,
    name,
    description: '',
    type: RESOURCE_TYPE.WORLD_BOOK,
    fileName: `${name}.json`,
    mimeType: 'application/json',
    fileSize: 1,
    contentHash: id,
    favorite: false,
    categoryId: null,
    relatedResourceIds,
    tags: [],
    metadata: {},
    createdAt: 1,
    updatedAt: 1,
  }
}

describe('ResourceRelationCandidates', () => {
  it('combines resource type with folders without changing selected IDs', () => {
    const resources = [
      { ...resource('book', '世界书'), categoryId: 'a' },
      { ...resource('card', '角色卡'), type: RESOURCE_TYPE.CHARACTER_CARD, categoryId: 'a' },
      { ...resource('other-card', '未分类角色卡'), type: RESOURCE_TYPE.CHARACTER_CARD },
    ]
    const selectedResourceIds = new Set(['book'])
    expect(
      filterResourceRelationCandidates(resources, {
        currentResourceId: 'current',
        selectedResourceIds,
        query: '',
        hideBoundElsewhere: false,
        categoryId: 'a',
        resourceType: RESOURCE_TYPE.CHARACTER_CARD,
      }).map((resource) => resource.id),
    ).toEqual(['card'])
    expect([...selectedResourceIds]).toEqual(['book'])
  })
  it('filters legacy and multiple folder assignments while keeping selection independent', () => {
    const resources = [
      resource('current', '当前'),
      { ...resource('legacy', '旧分类'), categoryId: 'a' },
      { ...resource('multi', '多分类'), categoryIds: ['a', 'b'] },
      resource('none', '未分类'),
    ]
    const options = {
      currentResourceId: 'current',
      selectedResourceIds: new Set(['multi']),
      query: '',
      hideBoundElsewhere: false,
    }
    expect(
      filterResourceRelationCandidates(resources, { ...options, categoryId: 'a' }).map(
        (item) => item.id,
      ),
    ).toEqual(['multi', 'legacy'])
    expect(
      filterResourceRelationCandidates(resources, { ...options, categoryId: 'b' }).map(
        (item) => item.id,
      ),
    ).toEqual(['multi'])
    expect(
      filterResourceRelationCandidates(resources, { ...options, categoryId: null }).map(
        (item) => item.id,
      ),
    ).toEqual(['none'])
    expect(options.selectedResourceIds.has('multi')).toBe(true)
    expect(filterResourceRelationCandidates(resources, options)).toHaveLength(3)
  })
  it('隐藏已关联到其他资源的候选，但保留当前已选项以便解除关联', () => {
    const resources = [
      resource('current', '当前资源'),
      resource('free', '未关联'),
      resource('other-bound', '已被其他资源关联', ['other']),
      resource('current-bound', '当前已关联', ['current', 'other']),
    ]

    const result = filterResourceRelationCandidates(resources, {
      currentResourceId: 'current',
      selectedResourceIds: new Set(['current-bound']),
      query: '',
      hideBoundElsewhere: true,
    })

    expect(result.map((item) => item.id)).toEqual(['current-bound', 'free'])
  })

  it('关闭筛选时继续显示所有候选并支持名称查询', () => {
    const resources = [resource('current', '当前'), resource('a', '北境世界书', ['other'])]

    expect(
      filterResourceRelationCandidates(resources, {
        currentResourceId: 'current',
        selectedResourceIds: new Set(),
        query: '北境',
        hideBoundElsewhere: false,
      }).map((item) => item.id),
    ).toEqual(['a'])
  })

  it('只把指向其他资源的关系视为被占用', () => {
    expect(isResourceBoundElsewhere(resource('a', 'A', ['current']), 'current')).toBe(false)
    expect(isResourceBoundElsewhere(resource('a', 'A', ['current', 'other']), 'current')).toBe(true)
  })
})
