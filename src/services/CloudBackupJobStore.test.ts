import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, it, vi } from 'vitest'

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
})
