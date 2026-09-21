import { describe, expect, it } from 'vitest'

import type { ResourceSummary } from '../types/Resource'
import { referenceIndex } from './ReferenceIndex'
import { rebuildResourceReferenceIndex } from './ResourceReferenceIndex'

function resource(id: string, relatedResourceIds: string[] = []): ResourceSummary {
  return {
    id,
    type: 'other',
    name: id,
    fileName: `${id}.json`,
    mimeType: 'application/json',
    fileSize: 1,
    contentHash: id.repeat(64).slice(0, 64),
    description: '',
    tags: [],
    categoryId: null,
    categoryIds: [],
    relatedResourceIds,
    sourceLinks: [],
    favorite: false,
    metadata: {},
    createdAt: 1,
    updatedAt: 1,
  }
}

describe('ResourceReferenceIndex', () => {
  it('indexes strong relation, weak loadout and UI-only cabinet impacts', () => {
    const missing = rebuildResourceReferenceIndex(
      [resource('a', ['b', 'missing']), resource('b')],
      [
        {
          id: 'loadout-1',
          name: '测试装配',
          primaryResourceId: 'b',
          resourceIds: ['b'],
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      ['b'],
    )
    expect(
      referenceIndex
        .impacts('resource', 'b')
        .map((item) => item.strength)
        .sort(),
    ).toEqual(['strong', 'ui', 'weak'])
    expect(missing).toMatchObject([{ ownerId: 'a', missingResourceId: 'missing' }])
  })
})
