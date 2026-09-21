import 'fake-indexeddb/auto'

import { describe, expect, it, vi } from 'vitest'

import { AppDatabase } from '../database/AppDatabase'
import { findHistoricalDuplicateGroups } from '../services/ResourceVersionMatcher'
import { RESOURCE_TYPE, toResourceSummary, type Category, type Resource } from '../types/Resource'
import { IndexedDbArchiveStorage } from './IndexedDbArchiveStorage'
import { IndexedDbResourceStorage } from './IndexedDbResourceStorage'
import type { NativeBackedResourceRecord } from '../types/Vault'

describe('IndexedDbArchiveStorage', () => {
  it('stages Web restore bodies serially and rolls back when storage runs out', async () => {
    const database = new AppDatabase(`web-staged-${crypto.randomUUID()}`)
    const storage = new IndexedDbArchiveStorage(database)
    const records: Resource[] = Array.from({ length: 3 }, (_, index) => ({
      id: `web-${index}`,
      type: RESOURCE_TYPE.OTHER,
      name: `web-${index}`,
      description: '',
      fileName: `${index}.bin`,
      mimeType: 'application/octet-stream',
      fileSize: 1024,
      contentHash: index.toString(16).padStart(64, '0'),
      favorite: false,
      categoryId: null,
      tags: [],
      metadata: {},
      createdAt: 1,
      updatedAt: 1,
      originalBlob: new Blob([]),
    }))
    let reads = 0
    const hydrate = async (record: Resource) => {
      expect(await database.resources.count()).toBe(0)
      expect(await database.restoreStaging.count()).toBe(reads++)
      return { ...record, originalBlob: new Blob(['x'.repeat(1024)]) }
    }
    try {
      await storage.restore([], records, [], hydrate)
      expect(reads).toBe(3)
      expect(await database.resources.get('web-2')).toHaveProperty('originalBlob.size', 1024)
      expect(await database.restoreStaging.count()).toBe(0)
      const before = await database.resources.count()
      let attempts = 0
      await expect(
        storage.restore(
          [],
          records.map((r) => ({ ...r, id: `new-${r.id}` })),
          [],
          async (r) => {
            if (++attempts === 2) throw new DOMException('No storage space', 'QuotaExceededError')
            return r
          },
        ),
      ).rejects.toMatchObject({
        message: expect.stringContaining('存储空间不足'),
        cause: { name: 'QuotaExceededError' },
      })
      expect(await database.resources.count()).toBe(before)
      expect(await database.restoreStaging.count()).toBe(0)
      const fetchBlob = globalThis.fetch.bind(globalThis)
      const read = vi
        .spyOn(globalThis, 'fetch')
        .mockImplementationOnce(fetchBlob)
        .mockRejectedValueOnce(new Error('staged file disappeared'))
      try {
        await expect(
          storage.restore(
            [],
            records.map((r) => ({ ...r, id: `new-${r.id}` })),
          ),
        ).rejects.toThrow('staged file disappeared')
        expect(await database.resources.count()).toBe(before)
        expect(await database.restoreStaging.count()).toBe(0)
      } finally {
        read.mockRestore()
      }
    } finally {
      database.close()
      await database.delete()
    }
  })
  it('stages native card bodies one at a time before publishing current and historical indexes', async () => {
    const database = new AppDatabase(`native-staged-${crypto.randomUUID()}`)
    const storage = new IndexedDbArchiveStorage(database)
    const records = Array.from({ length: 6 }, (_, index): NativeBackedResourceRecord => ({
      id: `card-${index}`,
      type: RESOURCE_TYPE.CHARACTER_CARD,
      name: `Card ${index}`,
      description: '',
      fileName: `${index}.json`,
      mimeType: 'application/json',
      fileSize: 1024,
      contentHash: index.toString(16).padStart(64, '0'),
      favorite: false,
      categoryId: null,
      tags: [],
      metadata: {},
      createdAt: 1,
      updatedAt: 1,
      nativeOriginal: { version: 1, contentHash: index.toString(16).padStart(64, '0'), size: 1024 },
      ...(index === 5 ? { versionGroupId: 'card-0' } : {}),
    }))
    let hydrated = 0
    const hydrate = vi.fn(async (record: NativeBackedResourceRecord) => {
      expect(await database.resources.count()).toBe(0)
      expect(await database.resourceVersions.count()).toBe(0)
      expect(await database.restoreStaging.count()).toBe(hydrated++)
      return {
        ...record,
        metadata: { card: { name: record.name, description: 'x'.repeat(256 * 1024) } },
      }
    })
    try {
      await storage.restoreNative([], records.slice(0, 5), records.slice(5), hydrate)
      expect(hydrate).toHaveBeenCalledTimes(6)
      expect(await database.resources.count()).toBe(5)
      expect(await database.resourceVersions.count()).toBe(1)
      expect(await database.resourceVersionSummaries.get('card-5')).toMatchObject({
        versionGroupId: 'card-0',
      })
      expect(await database.resources.get('card-0')).toHaveProperty(
        'metadata.card.description',
        'x'.repeat(256 * 1024),
      )
      expect(await database.restoreStaging.count()).toBe(0)
      expect(records[0]?.metadata).toEqual({})
    } finally {
      database.close()
      await database.delete()
    }
  })

  it('does not publish any native indexes when card hydration or final index commit fails', async () => {
    const database = new AppDatabase(`native-staged-failure-${crypto.randomUUID()}`)
    const storage = new IndexedDbArchiveStorage(database)
    const record: NativeBackedResourceRecord = {
      id: 'incoming',
      type: RESOURCE_TYPE.CHARACTER_CARD,
      name: 'Incoming',
      description: '',
      fileName: 'incoming.json',
      mimeType: 'application/json',
      fileSize: 2,
      contentHash: 'a'.repeat(64),
      favorite: false,
      categoryId: null,
      tags: [],
      metadata: {},
      createdAt: 1,
      updatedAt: 1,
      nativeOriginal: { version: 1, contentHash: 'a'.repeat(64), size: 2 },
    }
    const existing = { ...record, id: 'existing', metadata: { card: { name: 'Keep' } } }
    await database.resources.put(existing)
    const category: Category = {
      id: 'new-category',
      name: 'New',
      color: '#123456',
      createdAt: 1,
      updatedAt: 1,
    }
    try {
      const hydrate = vi
        .fn()
        .mockResolvedValueOnce(record)
        .mockRejectedValueOnce(new Error('bad card'))
      await expect(
        storage.restoreNative([category], [record], [{ ...record, id: 'history' }], hydrate),
      ).rejects.toThrow('bad card')
      expect(await database.resources.toArray()).toEqual([existing])
      expect(await database.categories.count()).toBe(0)
      expect(await database.restoreStaging.count()).toBe(0)

      const failCommit = () => {
        throw new Error('index write failed')
      }
      database.resourceListSummaries.hook('creating', failCommit)
      await expect(
        storage.restoreNative([category], [record], [], async (value) => value),
      ).rejects.toThrow('index write failed')
      expect(await database.resources.toArray()).toEqual([existing])
      expect(await database.categories.count()).toBe(0)
      expect(await database.resourceSummaries.count()).toBe(0)
      expect(await database.restoreStaging.count()).toBe(0)
    } finally {
      database.close()
      await database.delete()
    }
  })

  it('writes restored categories and resources together', async () => {
    const database = new AppDatabase(`archive-storage-${crypto.randomUUID()}`)
    const storage = new IndexedDbArchiveStorage(database)
    const now = Date.now()
    const category: Category = {
      id: 'lore',
      name: '设定',
      color: '#486b5d',
      createdAt: now,
      updatedAt: now,
    }
    const resource: Resource = {
      id: 'atlas',
      type: RESOURCE_TYPE.WORLD_BOOK,
      name: 'Atlas',
      description: '',
      fileName: 'Atlas.json',
      mimeType: 'application/json',
      fileSize: 2,
      contentHash: 'a'.repeat(64),
      favorite: false,
      categoryId: category.id,
      tags: [],
      metadata: {},
      originalBlob: new Blob(['{}']),
      createdAt: now,
      updatedAt: now,
    }

    await storage.restore([category], [resource])

    expect(await database.categories.get(category.id)).toEqual(category)
    const restoredResource = await database.resources.get(resource.id)
    expect(
      restoredResource && 'categoryId' in restoredResource
        ? restoredResource.categoryId
        : undefined,
    ).toBe(category.id)
    database.close()
    await database.delete()
  })

  it('restores historical records and their recognition summaries atomically', async () => {
    const database = new AppDatabase(`archive-version-summary-${crypto.randomUUID()}`)
    const storage = new IndexedDbArchiveStorage(database)
    const now = Date.now()
    const resource: Resource = {
      id: 'current',
      type: RESOURCE_TYPE.CHARACTER_CARD,
      name: '当前版本',
      description: '',
      fileName: 'current.png',
      mimeType: 'image/png',
      fileSize: 7,
      contentHash: 'a'.repeat(64),
      favorite: false,
      categoryId: null,
      tags: [],
      metadata: {},
      originalBlob: new Blob(['current']),
      createdAt: now,
      updatedAt: now,
    }
    const version: Resource = {
      ...resource,
      id: 'history',
      fileName: 'history.png',
      versionGroupId: resource.id,
      originalBlob: new Blob(['history']),
    }

    await storage.restore([], [resource], [version])

    expect(await database.resourceVersions.get(version.id)).toBeDefined()
    expect(await database.resourceVersionSummaries.get(version.id)).toMatchObject({
      id: version.id,
      contentHash: version.contentHash,
      versionGroupId: resource.id,
    })
    const resourceStorage = new IndexedDbResourceStorage(database)
    const duplicateGroups = findHistoricalDuplicateGroups(
      await resourceStorage.listSummaries(),
      await resourceStorage.listVersionSummaries(),
    )
    expect(duplicateGroups[0]).toMatchObject({
      kind: 'exactFile',
      keeper: { id: resource.id },
      duplicates: [{ id: version.id }],
    })

    database.close()
    await database.delete()
  })

  it('replace clears ghost historical summaries before writing the restored timeline', async () => {
    const database = new AppDatabase(`archive-version-replace-${crypto.randomUUID()}`)
    const storage = new IndexedDbArchiveStorage(database)
    const now = Date.now()
    await database.resourceVersionSummaries.put(
      toResourceSummary({
        id: 'ghost-history',
        type: RESOURCE_TYPE.OTHER,
        name: '幽灵摘要',
        description: '',
        fileName: 'ghost.json',
        mimeType: 'application/json',
        fileSize: 2,
        contentHash: 'f'.repeat(64),
        favorite: false,
        categoryId: null,
        tags: [],
        metadata: {},
        versionGroupId: 'missing-owner',
        originalBlob: new Blob(['{}']),
        createdAt: now,
        updatedAt: now,
      }),
    )

    await storage.replace([], [], [])

    expect(await database.resourceVersions.toArray()).toEqual([])
    expect(await database.resourceVersionSummaries.toArray()).toEqual([])

    database.close()
    await database.delete()
  })

  it('APK 原生恢复只把已校验 NativeLibrary 引用提交到 IndexedDB', async () => {
    const database = new AppDatabase(`archive-native-restore-${crypto.randomUUID()}`)
    const storage = new IndexedDbArchiveStorage(database)
    const resource: NativeBackedResourceRecord = {
      id: 'native-large',
      type: RESOURCE_TYPE.OTHER,
      name: '原生大资源',
      description: '',
      fileName: 'large.bin',
      mimeType: 'application/octet-stream',
      fileSize: 3 * 1024 * 1024 * 1024,
      contentHash: 'c'.repeat(64),
      favorite: false,
      categoryId: null,
      tags: [],
      metadata: {},
      nativeOriginal: {
        version: 1,
        contentHash: 'c'.repeat(64),
        size: 3 * 1024 * 1024 * 1024,
      },
      createdAt: 1,
      updatedAt: 2,
    }

    await storage.restoreNative([], [resource])

    const stored = await database.resources.get(resource.id)
    expect(stored).toMatchObject({ nativeOriginal: resource.nativeOriginal })
    expect(stored && 'originalBlob' in stored).toBe(false)
    expect(await database.resourceSummaries.get(resource.id)).not.toHaveProperty('nativeOriginal')
    database.close()
    await database.delete()
  })
})
