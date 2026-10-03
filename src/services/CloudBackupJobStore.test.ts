import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { reactive } from 'vue'

import { CloudBackupJobStore } from './CloudBackupJobStore'

describe('CloudBackupJobStore orphan grace', () => {
  beforeEach(() => {
    vi.stubGlobal('indexedDB', new IDBFactory())
  })

  it('starts grace when an object first becomes orphan and forgets it when referenced again', async () => {
    const store = new CloudBackupJobStore()
    const day = 24 * 60 * 60 * 1000

    await expect(store.eligibleOrphans('scope', ['object-a'], 1_000, day)).resolves.toEqual([])
    await expect(
      store.eligibleOrphans('scope', ['object-a'], 1_000 + day - 1, day),
    ).resolves.toEqual([])
    await expect(store.eligibleOrphans('scope', ['object-a'], 1_000 + day, day)).resolves.toEqual([
      'object-a',
    ])

    await store.eligibleOrphans('scope', [], 1_000 + day + 1, day)
    await expect(
      store.eligibleOrphans('scope', ['object-a'], 1_000 + day + 2, day),
    ).resolves.toEqual([])
  })

  it('retains the selected restore scope across reopening until metadata import completes', async () => {
    const store = new CloudBackupJobStore()
    const selection = reactive({
      item: {
        id: 'snapshot',
        objectKey: 'snapshot.json.gz',
        size: 1,
        createdAt: 1,
        kind: 'githubSnapshot' as const,
      },
      target: {
        provider: 'github' as const,
        owner: 'owner',
        repository: 'private-backups',
        retention: 1,
        autoBackup: false,
      },
      resourceKeys: ['chosen'],
      includeGallery: false,
    })
    const job = await store.beginRestore('plan', selection)
    selection.resourceKeys.push('later-selection')
    await store.fail(job, new Error('WebView interrupted'))
    const reopened = new CloudBackupJobStore()
    expect(await reopened.pendingRestores()).toEqual([
      expect.objectContaining({
        status: 'failed',
        restore: expect.objectContaining({ resourceKeys: ['chosen'], includeGallery: false }),
      }),
    ])
    await reopened.complete(job, 'snapshot.json.gz')
    expect(await reopened.pendingRestores()).toEqual([])
  })
})
