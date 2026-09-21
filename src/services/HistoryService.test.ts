import 'fake-indexeddb/auto'

import { describe, expect, it } from 'vitest'

import { AppDatabase } from '../database/AppDatabase'
import { IndexedDbArchiveStorage } from '../storage/IndexedDbArchiveStorage'
import { RESOURCE_TYPE, type Resource } from '../types/Resource'
import { ExportService } from './ExportService'
import { HistoryService } from './HistoryService'
import { RestoreService } from './RestoreService'
import { VaultService } from './VaultService'

async function createResource(): Promise<Resource> {
  const content = '{"name":"Atlas","entries":{}}'
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(content))
  const contentHash = Array.from(new Uint8Array(digest), (value) =>
    value.toString(16).padStart(2, '0'),
  ).join('')
  return {
    id: 'atlas',
    type: RESOURCE_TYPE.WORLD_BOOK,
    name: 'Atlas',
    description: '',
    fileName: 'Atlas.json',
    mimeType: 'application/json',
    fileSize: new TextEncoder().encode(content).byteLength,
    contentHash,
    favorite: false,
    categoryId: null,
    tags: [],
    metadata: {},
    originalBlob: new Blob([content], { type: 'application/json' }),
    createdAt: 1,
    updatedAt: 1,
  }
}

describe('HistoryService', () => {
  it('stores a custom snapshot limit and removes only the oldest snapshots', async () => {
    const database = new AppDatabase(`history-limit-${crypto.randomUUID()}`)
    const vault = new VaultService(database)
    await vault.initialize()
    const archiveStorage = new IndexedDbArchiveStorage(database, vault)
    const history = new HistoryService(
      database,
      new ExportService(),
      new RestoreService(archiveStorage),
      vault,
    )
    await database.backupRecords.bulkPut(
      [1, 2, 3, 4].map((createdAt) => ({
        id: `snapshot-${createdAt}`,
        adapter: 'local-history',
        objectKey: `snapshot-${createdAt}.zip`,
        resourceCount: 0,
        categoryCount: 0,
        createdAt,
        reason: '测试快照',
        size: 1,
        blob: new Blob(['x']),
        encrypted: false,
      })),
    )

    expect(await history.getSnapshotLimit()).toBe(8)
    expect(await history.setSnapshotLimit(2)).toBe(2)
    expect((await history.list()).map((snapshot) => snapshot.id)).toEqual([
      'snapshot-4',
      'snapshot-3',
    ])
    expect(await history.getSnapshotLimit()).toBe(2)
    database.close()
    await database.delete()
  })

  it('captures and restores a complete local snapshot', async () => {
    const database = new AppDatabase(`history-${crypto.randomUUID()}`)
    const vault = new VaultService(database)
    await vault.initialize()
    const archiveStorage = new IndexedDbArchiveStorage(database, vault)
    const restoreService = new RestoreService(archiveStorage)
    const history = new HistoryService(database, new ExportService(), restoreService, vault)
    const resource = await createResource()

    const snapshot = await history.capture([resource], [], '手动快照')
    expect(snapshot.resourceCount).toBe(1)
    expect((await history.list())[0]?.reason).toBe('手动快照')
    await database.resources.clear()

    await history.restore(snapshot.id)

    const restored = await database.resources.get(resource.id)
    expect(restored && 'name' in restored ? restored.name : undefined).toBe('Atlas')
    database.close()
    await database.delete()
  })

  it('does not replace a normal safety snapshot with an unverified empty resource read', async () => {
    const database = new AppDatabase(`history-empty-guard-${crypto.randomUUID()}`)
    const vault = new VaultService(database)
    await vault.initialize()
    const history = new HistoryService(
      database,
      new ExportService(),
      new RestoreService(new IndexedDbArchiveStorage(database, vault)),
      vault,
    )
    await database.resources.put(await createResource())

    await expect(history.capture([], [], '错误读取结果')).rejects.toThrow('资源读取结果为空')
    expect(await database.backupRecords.count()).toBe(0)
    expect(await database.resources.count()).toBe(1)
    database.close()
    await database.delete()
  })
})
