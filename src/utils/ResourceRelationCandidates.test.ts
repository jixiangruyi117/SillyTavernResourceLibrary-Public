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
