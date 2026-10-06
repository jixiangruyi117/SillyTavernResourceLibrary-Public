import 'fake-indexeddb/auto'

import Dexie from 'dexie'
import { describe, expect, it, vi } from 'vitest'

import { AppDatabase } from '../database/AppDatabase'
import { IndexedDbGeneratedImageAlbumStorage } from './IndexedDbGeneratedImageAlbumStorage'

const MIGRATION_SETTING_ID = 'migration.generatedImageFiles.blob.v17'

function bytesToBase64(value: string): string {
  return btoa(value)
}

describe('IndexedDbGeneratedImageAlbumStorage', () => {
  it('does not open page or facet cursors when the album is empty', async () => {
    const database = new AppDatabase(`generated-image-empty-${crypto.randomUUID()}`)
    const storage = new IndexedDbGeneratedImageAlbumStorage(database)
    const orderBy = vi.spyOn(database.generatedImages, 'orderBy')

    await expect(storage.query({ page: 1, pageSize: 18, sort: 'newest' })).resolves.toEqual({
      items: [],
      total: 0,
      page: 1,
      pageSize: 18,
      pageCount: 1,
      categories: [],
      mimeTypes: [],
    })
    expect(orderBy).not.toHaveBeenCalled()

    database.close()
    await database.delete()
  })

  it('uses IndexedDB count and compound indexes for real metadata pagination', async () => {
    const database = new AppDatabase(`generated-image-query-${crypto.randomUUID()}`)
    const storage = new IndexedDbGeneratedImageAlbumStorage(database)
    await database.generatedImages.bulkPut(
      Array.from({ length: 75 }, (_, index) => ({
        id: `item-${index.toString().padStart(3, '0')}`,
        name: `图片 ${index}`,
        source: 'imported' as const,
        category: index % 2 ? '人物' : '背景',
        mimeType: index % 3 ? 'image/webp' : 'image/png',
        sizeBytes: index + 1,
        createdAt: index,
        updatedAt: index,
      })),
    )

    await expect(storage.count()).resolves.toBe(75)
    const result = await storage.query({
      category: '背景',
      mimeType: 'image/webp',
      page: 2,
      pageSize: 7,
      sort: 'newest',
    })
    expect(result.total).toBe(25)
    expect(result.items).toHaveLength(7)
    expect(
      result.items.every((item) => item.category === '背景' && item.mimeType === 'image/webp'),
    ).toBe(true)
    expect(result.items[0]!.createdAt).toBeGreaterThan(result.items.at(-1)!.createdAt)
    expect(result.categories).toEqual(['人物', '背景'].sort())

    database.close()
    await database.delete()
  })

  it('migrates 100 legacy Base64 files to Blob without retaining expanded strings', async () => {
    const name = `generated-image-blob-migration-${crypto.randomUUID()}`
    const legacy = new Dexie(name)
    legacy.version(16).stores({
      generatedImages: 'id, createdAt, updatedAt',
      generatedImageFiles: 'id, updatedAt',
      settings: 'id, updatedAt',
    })
    const records = Array.from({ length: 100 }, (_, index) => {
      const id = `image-${index.toString().padStart(3, '0')}`
      return {
        id,
        originalBase64: bytesToBase64(`original-${id}`),
        originalMimeType: 'image/png',
        thumbnailBase64: bytesToBase64(`thumbnail-${id}`),
        thumbnailMimeType: 'image/webp',
        updatedAt: index,
      }
    })
    await legacy.table('generatedImageFiles').bulkPut(records)
    legacy.close()

    const database = new AppDatabase(name)
    const storage = new IndexedDbGeneratedImageAlbumStorage(database)
    await storage.list()

    const migrated = await database.generatedImageFiles.toArray()
    expect(migrated).toHaveLength(100)
    expect(migrated.every((file) => file.originalBlob instanceof Blob)).toBe(true)
    expect(migrated.every((file) => !file.originalBase64 && !file.thumbnailBase64)).toBe(true)
    await expect(migrated[73]?.originalBlob?.text()).resolves.toBe('original-image-073')
    await expect(migrated[73]?.thumbnailBlob?.text()).resolves.toBe('thumbnail-image-073')
    await expect(database.settings.get(MIGRATION_SETTING_ID)).resolves.toMatchObject({
      value: { version: 17, status: 'complete', migrated: 100 },
    })

    database.close()
    await database.delete()
  })

  it('resumes strictly after a committed checkpoint', async () => {
    const name = `generated-image-blob-resume-${crypto.randomUUID()}`
    const database = new AppDatabase(name)
    await database.generatedImageFiles.bulkPut([
      {
        id: 'image-001',
        originalBlob: new Blob(['already-migrated'], { type: 'image/png' }),
        originalMimeType: 'image/png',
        updatedAt: 1,
      },
      {
        id: 'image-002',
        originalBase64: bytesToBase64('resume-me'),
        originalMimeType: 'image/png',
        updatedAt: 2,
      },
    ])
    await database.settings.put({
      id: MIGRATION_SETTING_ID,
      value: {
        version: 17,
        status: 'running',
        checkpoint: 'image-001',
        migrated: 1,
      },
      updatedAt: 1,
    })

    const storage = new IndexedDbGeneratedImageAlbumStorage(database)
    await storage.list()

    await expect(database.generatedImageFiles.get('image-001')).resolves.toMatchObject({
      originalMimeType: 'image/png',
    })
    const resumed = await database.generatedImageFiles.get('image-002')
    await expect(resumed?.originalBlob?.text()).resolves.toBe('resume-me')
    expect(resumed?.originalBase64).toBeUndefined()
    await expect(database.settings.get(MIGRATION_SETTING_ID)).resolves.toMatchObject({
      value: { status: 'complete', migrated: 2 },
    })

    database.close()
    await database.delete()
  })

  it('keeps the committed checkpoint after a quota interruption and skips a corrupt record on resume', async () => {
    const name = `generated-image-blob-quota-${crypto.randomUUID()}`
    const database = new AppDatabase(name)
    await database.generatedImageFiles.bulkPut([
      ...Array.from({ length: 20 }, (_, index) => ({
        id: `image-${index.toString().padStart(3, '0')}`,
        originalBase64: bytesToBase64(`image-${index}`),
        originalMimeType: 'image/png',
        updatedAt: index,
      })),
      { id: 'image-020', originalMimeType: '', updatedAt: 20 },
    ])
    const originalBulkPut = database.generatedImageFiles.bulkPut.bind(database.generatedImageFiles)
    let batch = 0
    const bulkPut = vi
      .spyOn(database.generatedImageFiles, 'bulkPut')
      .mockImplementation((...args): ReturnType<typeof originalBulkPut> => {
        batch += 1
        if (batch === 2) {
          return Promise.reject(
            new DOMException('Quota exceeded', 'QuotaExceededError'),
          ) as ReturnType<typeof originalBulkPut>
        }
        return originalBulkPut(...args)
      })

    const interrupted = new IndexedDbGeneratedImageAlbumStorage(database)
    await expect(interrupted.list()).rejects.toMatchObject({ name: 'QuotaExceededError' })
    await expect(database.settings.get(MIGRATION_SETTING_ID)).resolves.toMatchObject({
      value: { status: 'running', checkpoint: 'image-009', migrated: 10 },
    })

    bulkPut.mockRestore()
    const resumed = new IndexedDbGeneratedImageAlbumStorage(database)
    await resumed.list()
    await expect(database.settings.get(MIGRATION_SETTING_ID)).resolves.toMatchObject({
      value: { status: 'complete', migrated: 20 },
    })
    expect((await database.generatedImageFiles.get('image-020'))?.originalBlob).toBeUndefined()

    database.close()
    await database.delete()
  })
})
