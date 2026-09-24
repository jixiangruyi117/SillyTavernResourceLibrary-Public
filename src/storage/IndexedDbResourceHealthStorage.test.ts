import 'fake-indexeddb/auto'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AppDatabase } from '../database/AppDatabase'
import type { Resource } from '../types/Resource'
import { IndexedDbResourceHealthStorage } from './IndexedDbResourceHealthStorage'
import { IndexedDbResourceStorage } from './IndexedDbResourceStorage'

function resource(id: string, body = '{"ok":true}'): Resource {
  return {
    id,
    type: 'other',
    name: id,
    description: '',
    fileName: `${id}.json`,
    mimeType: 'application/json',
    fileSize: body.length,
    contentHash: `hash-${id}`,
    favorite: false,
    categoryId: null,
    categoryIds: [],
    relatedResourceIds: [],
    sourceLinks: [],
    tags: [],
    metadata: {},
    originalBlob: new Blob([body], { type: 'application/json' }),
    createdAt: 1,
    updatedAt: 2,
  }
}

describe('IndexedDbResourceHealthStorage', () => {
  let database: AppDatabase
  let storage: IndexedDbResourceStorage
  let health: IndexedDbResourceHealthStorage

  beforeEach(() => {
    database = new AppDatabase(`health-${crypto.randomUUID()}`)
    storage = new IndexedDbResourceStorage(database)
    health = new IndexedDbResourceHealthStorage(database, storage)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 204 })),
    )
  })

  afterEach(async () => {
    await database.delete()
    vi.unstubAllGlobals()
  })

  it('reports derived-index drift and repairs only the derived tables', async () => {
    const source = resource('source')
    await storage.save(source)
    await database.resourceSummaries.update(source.id, { contentHash: 'stale' })
    await database.resourceListSummaries.delete(source.id)

    const audit = await health.audit()
    expect(audit.currentSummaryDrift).toEqual(['source'])
    expect(audit.listSummaryDrift).toEqual(['source'])

    await health.repairDerivedIndexes()
    const storedSource = await database.resources.get(source.id)
    expect(
      storedSource && 'originalBlob' in storedSource && storedSource.originalBlob,
    ).toBeInstanceOf(ArrayBuffer)
    expect((await database.resourceSummaries.get(source.id))?.contentHash).toBe('hash-source')
    expect((await database.resourceListSummaries.get(source.id))?.contentHash).toBe('hash-source')
  })

  it('reports corrupt JSON and both generated-image ownership failures without deleting files', async () => {
    await storage.save(resource('broken', '{'))
    await database.generatedImages.put({
      id: 'metadata-only',
      name: 'missing',
      source: 'generated',
      category: '',
      mimeType: 'image/png',
      sizeBytes: 1,
      createdAt: 1,
      updatedAt: 1,
    })
    await database.generatedImageFiles.put({
      id: 'file-only',
      originalBlob: new Blob(['x']),
      originalMimeType: 'image/png',
      updatedAt: 1,
    })

    const audit = await health.audit()
    expect(audit.corruptJsonResources).toEqual(['broken'])
    expect(audit.missingGeneratedImageFiles).toEqual(['metadata-only'])
    expect(audit.orphanGeneratedImageFiles).toEqual(['file-only'])
    expect(await database.generatedImageFiles.get('file-only')).toBeDefined()
  })
})
