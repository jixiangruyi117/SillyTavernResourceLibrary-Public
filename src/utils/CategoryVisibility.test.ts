import { describe, expect, it } from 'vitest'

import { RESOURCE_TYPE, type Category, type ResourceSummary } from '../types/Resource'
import { getHiddenCategoryIds, isResourceHiddenByCategory } from './CategoryVisibility'

function createCategory(id: string, hidden?: boolean): Category {
  return {
    id,
    name: id,
    color: '#486b5d',
    hidden,
    createdAt: 1,
    updatedAt: 1,
  }
}

function createResource(categoryIds: string[]): ResourceSummary {
  return {
    id: 'resource',
    type: RESOURCE_TYPE.CHARACTER_CARD,
    name: '测试角色',
    description: '',
    fileName: 'test.json',
    fileSize: 1,
    mimeType: 'application/json',
    contentHash: 'hash',
    categoryId: categoryIds[0] ?? null,
    categoryIds,
    relatedResourceIds: [],
    tags: [],
    favorite: false,
    metadata: {},
    createdAt: 1,
    updatedAt: 1,
    versionCount: 1,
  }
}

describe('CategoryVisibility', () => {
  it('keeps legacy and visible categories in normal browsing', () => {
    const hiddenIds = getHiddenCategoryIds([
      createCategory('legacy'),
      createCategory('visible', false),
    ])

    expect(hiddenIds.size).toBe(0)
    expect(isResourceHiddenByCategory(createResource(['legacy']), hiddenIds)).toBe(false)
  })

  it('hides a resource when any assigned category is hidden', () => {
    const hiddenIds = getHiddenCategoryIds([
      createCategory('visible', false),
      createCategory('private', true),
    ])

    expect(isResourceHiddenByCategory(createResource(['visible', 'private']), hiddenIds)).toBe(true)
    expect(isResourceHiddenByCategory(createResource(['visible']), hiddenIds)).toBe(false)
  })
})
