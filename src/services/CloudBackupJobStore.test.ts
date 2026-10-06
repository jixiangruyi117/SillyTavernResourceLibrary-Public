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

  it('migrates Android jobs and orphan state into native storage, verifies them, and keeps a live rollback mirror', async () => {
    const records = new Map<string, Map<string, Record<string, unknown>>>()
    const states = new Map<string, string>()
    const native = {
      async status() {
        return {
          schemaVersion: 2,
          counts: Object.fromEntries([...records].map(([name, values]) => [name, values.size])),
        }
      },
      async getState(key: string) {
        return states.get(key)
      },
      async putState(key: string, value: string) {
        states.set(key, value)
      },
      async getRecord(name: string, key: string) {
        return records.get(name)?.get(key)
      },
      async getRecords(name: string, afterKey: string | undefined, limit: number) {
        const rows = [...(records.get(name) ?? new Map())]
          .filter(([key]) => afterKey === undefined || key > afterKey)
          .sort(([left], [right]) => left.localeCompare(right))
          .slice(0, limit)
          .map(([key, value]) => ({ key, value }))
        return {
          rows,
          count: records.get(name)?.size ?? 0,
          nextKey: rows.length === limit ? rows.at(-1)?.key : undefined,
        }
      },
      async getRecordsByKeys(name: string, keys: string[]) {
        return keys.flatMap((key) => {
          const value = records.get(name)?.get(key)
          return value ? [{ key, value }] : []
        })
      },
      async putRecords(name: string, rows: Array<{ key: string; value: Record<string, unknown> }>) {
        const table = records.get(name) ?? new Map<string, Record<string, unknown>>()
        for (const row of rows) table.set(row.key, structuredClone(row.value))
        records.set(name, table)
        return rows.length
      },
      async deleteRecords(name: string, keys: string[]) {
        const table = records.get(name)
        let deleted = 0
        for (const key of keys) if (table?.delete(key)) deleted++
        return deleted
      },
    }

    const legacy = new CloudBackupJobStore()
    const restore = {
      item: { id: 'snapshot', objectKey: 'snapshot.json', size: 3, createdAt: 1 },
      target: {
        provider: 'github' as const,
        owner: 'owner',
        repository: 'repo',
        retention: 1,
        autoBackup: false,
      },
      resourceKeys: ['resource-1'],
      includeGallery: false,
    }
    const savedRestore = await legacy.beginRestore('restore-plan', restore)
    await legacy.fail(savedRestore, new Error('resume me'))
    await legacy.eligibleOrphans('scope', ['asset-1'], 100, 10)

    const android = new CloudBackupJobStore({ nativeDatabase: native, isAndroid: true })
    await expect(android.pendingRestores()).resolves.toEqual([
      expect.objectContaining({
        id: savedRestore.id,
        status: 'failed',
        restore: expect.objectContaining({ resourceKeys: ['resource-1'] }),
      }),
    ])
    await expect(android.pendingOrphans('scope')).resolves.toEqual(['asset-1'])
    expect(states.get('migration:cloud-backup-jobs:v1')).toBe('verified-v1')

    await android.begin('github', 'next-plan', ['file.json'])
    await expect(legacy.read('github', 'next-plan')).resolves.toMatchObject({
      status: 'running',
      objects: { 'file.json': 'pending' },
    })
    expect(records.get('cloudBackupJobs')?.has(JSON.stringify('github:next-plan'))).toBe(true)
  })
})
