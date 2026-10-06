import { describe, expect, it } from 'vitest'

import { RESOURCE_TYPE, type ResourceSummary } from '../types/Resource'
import { buildTavernSyncPlan, summarizeTavernSyncPlan } from './TavernSyncPlan'

function local(id: string, updatedAt: number): ResourceSummary {
  return {
    id,
    type: RESOURCE_TYPE.PRESET,
    name: id,
    description: '',
    fileName: `${id}.json`,
    mimeType: 'application/json',
    fileSize: 1,
    contentHash: `hash-${id}`,
    favorite: false,
    categoryId: null,
    tags: [],
    metadata: {},
    createdAt: 1,
    updatedAt,
  }
}

describe('TavernSyncPlan', () => {
  it('separates missing, newer, equal and legacy unverified matches', () => {
    const entries = buildTavernSyncPlan(
      [local('only-local', 2), local('same', 2), local('new', 9)],
      [
        {
          id: 'remote-same',
          kind: 'preset',
          name: 'same',
          fileName: 'same.json',
          detail: '',
          contentHash: 'hash-same',
        },
        {
          id: 'remote-new',
          kind: 'preset',
          name: 'new',
          fileName: 'new.json',
          detail: '',
          updatedAt: 3,
        },
        { id: 'only-tavern', kind: 'preset', name: 'remote', fileName: 'remote.json', detail: '' },
      ],
    )
    expect(summarizeTavernSyncPlan(entries)).toMatchObject({
      'local-only': 1,
      'tavern-only': 1,
      'local-newer': 1,
      consistent: 1,
    })
  })
})
