import 'fake-indexeddb/auto'

import { afterEach, describe, expect, it } from 'vitest'

import { AppDatabase } from '../database/AppDatabase'
import { RESOURCE_TYPE, type Resource } from '../types/Resource'
import { CharacterDrawService, filterCharacterDrawPool } from './CharacterDrawService'

function character(id: string, overrides: Partial<Resource> = {}): Resource {
  return {
    id,
    type: RESOURCE_TYPE.CHARACTER_CARD,
    name: id,
    description: '',
    fileName: `${id}.json`,
    mimeType: 'application/json',
    fileSize: 2,
    contentHash: id,
    favorite: false,
    categoryId: null,
    categoryIds: [],
    relatedResourceIds: [],
    tags: [],
    metadata: {},
    originalBlob: new Blob(['{}']),
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

const databases: AppDatabase[] = []

afterEach(async () => {
  for (const database of databases.splice(0)) {
    database.close()
    await database.delete()
  }
})

describe('CharacterDrawService', () => {
  it('combines folder, tag, favorite and freshness filters', () => {
    const now = 10 * 24 * 60 * 60 * 1000
    const resources = [
      character('eligible', {
        categoryId: 'folder',
        categoryIds: ['folder'],
        tags: ['侦探'],
        favorite: true,
      }),
      character('recent', {
        categoryId: 'folder',
        categoryIds: ['folder'],
        tags: ['侦探'],
        favorite: true,
      }),
      character('wrong-tag', {
        categoryId: 'folder',
        categoryIds: ['folder'],
        tags: ['科幻'],
        favorite: true,
      }),
    ]
    const pool = filterCharacterDrawPool(
      resources,
      {
        totalDraws: 1,
        totalSessions: 1,
        records: {
          recent: {
            resourceId: 'recent',
            count: 1,
            firstDrawnAt: now - 1000,
            lastDrawnAt: now - 1000,
          },
        },
        history: [],
      },
      {
        count: 1,
        categoryId: 'folder',
        tag: '侦探',
        favoritesOnly: true,
        freshness: 'notSevenDays',
      },
      now,
    )
    expect(pool.map((resource) => resource.id)).toEqual(['eligible'])
  })

  it('persists counts and keeps a ten draw unique when the pool is large enough', async () => {
    const database = new AppDatabase(`draw-${crypto.randomUUID()}`)
    databases.push(database)
    const service = new CharacterDrawService(database, () => 0.25)
    const resources = Array.from({ length: 12 }, (_, index) => character(`card-${index}`))

    const first = await service.draw(resources, { count: 10, freshness: 'all' }, 100)
    expect(new Set(first.resourceIds).size).toBe(10)
    expect(first.state.totalDraws).toBe(10)
    expect(first.state.totalSessions).toBe(1)

    const second = await service.draw(resources, { count: 1, freshness: 'all' }, 200)
    expect(second.state.totalDraws).toBe(11)
    expect(second.state.totalSessions).toBe(2)
    expect((await service.load()).history).toHaveLength(2)

    const cleared = await service.clear()
    expect(cleared.totalDraws).toBe(0)
    expect((await service.load()).records).toEqual({})
  })
})
