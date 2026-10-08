import 'fake-indexeddb/auto'

import Dexie from 'dexie'
import { describe, expect, it } from 'vitest'

import { AppDatabase } from '../database/AppDatabase'
import { hashBlob } from '../services/HashService'
import {
  AndroidAppDatabaseMigrator,
  decodeAppDatabaseValue,
  encodeAppDatabaseValue,
  fingerprintAppDatabaseStore,
} from './AndroidAppDatabaseMigration'

function createNativePort() {
  const records = new Map<string, Map<string, Record<string, unknown>>>()
  const states = new Map<string, string>()
  const blobs = new Map<string, Blob>()
  const bucket = (store: string) => {
    const current = records.get(store) ?? new Map<string, Record<string, unknown>>()
    records.set(store, current)
    return current
  }
  const blobKey = (store: string, key: string, path: string) => `${store}:${key}:${path}`

  return {
    records,
    states,
    async status() {
      return {
        schemaVersion: 2,
        counts: Object.fromEntries([...records].map(([store, rows]) => [store, rows.size])),
      }
    },
    async getState(key: string) {
      return states.get(key)
    },
    async putState(key: string, value: string) {
      states.set(key, value)
    },
    async clearStore(store: string) {
      records.delete(store)
      for (const key of [...blobs.keys()]) if (key.startsWith(`${store}:`)) blobs.delete(key)
    },
    async getRecordsByKeys(store: string, keys: string[]) {
      const rows = bucket(store)
      return keys.flatMap((key) => {
        const value = rows.get(key)
        return value ? [{ key, value }] : []
      })
    },
    async putRecords(store: string, rows: Array<{ key: string; value: Record<string, unknown> }>) {
      for (const row of rows) bucket(store).set(row.key, structuredClone(row.value))
      return rows.length
    },
    async putRecordsWithState(
      store: string,
      rows: Array<{ key: string; value: Record<string, unknown> }>,
      stateKey: string,
      stateValue: string,
    ) {
      for (const row of rows) bucket(store).set(row.key, structuredClone(row.value))
      states.set(stateKey, stateValue)
      return rows.length
    },
    async writeBlob(store: string, key: string, path: string, blob: Blob) {
      blobs.set(blobKey(store, key, path), blob)
      return { size: blob.size, mimeType: blob.type, sha256: await hashBlob(blob) }
    },
    async readBlob(store: string, key: string, path: string) {
      return blobs.get(blobKey(store, key, path))
    },
  }
}

describe('AndroidAppDatabaseMigrator', () => {
  it('retains inline Unicode that would change when encoded as a text attachment', async () => {
    const database = new Dexie(`runtime-unicode-${crypto.randomUUID()}`)
    database.version(1).stores({ externalAppRuntimes: 'id' })
    const native = createNativePort()
    const value = { id: 'app', runtimeHtml: '\uD800' }
    try {
      await database.table('externalAppRuntimes').put(value)
      const encoded = await encodeAppDatabaseValue(
        value,
        'externalAppRuntimes',
        '"app"',
        native,
        '"app"',
        0,
      )
      await native.putRecords('externalAppRuntimes', [
        { key: '"app"', value: encoded as Record<string, unknown> },
      ])
      expect(await decodeAppDatabaseValue(encoded, 'externalAppRuntimes', '"app"', native)).toEqual(
        { id: 'app', runtimeHtml: '\uFFFD' },
      )
      const result = await fingerprintAppDatabaseStore(database, 'externalAppRuntimes', {
        native,
        compareNative: true,
      })
      expect(result.matches).toBe(false)
      expect(result.firstMismatch?.fields).toEqual(['runtimeHtml'])
    } finally {
      await database.delete()
    }
  })

  it.each([false, true])(
    'compares byte-compacted APP rows with normal native encoding (%s)',
    async (changed) => {
      const database = new Dexie(`runtime-encoding-${crypto.randomUUID()}`)
      database.version(1).stores({ externalAppRuntimes: 'id, updatedAt' })
      const native = createNativePort()
      const value = {
        id: 'app',
        runtimeHtml: '<main>same app</main>',
        packageFiles: Object.fromEntries(
          Array.from({ length: 4 }, (_, index) => [`${index}.js`, 'x'.repeat(200 * 1024)]),
        ),
        metadata: { items: ['a'], map: new Map([['key', 'value']]), set: new Set(['value']) },
        updatedAt: 1,
      }
      try {
        await database.table('externalAppRuntimes').put(value)
        const encoded = await encodeAppDatabaseValue(
          changed ? { ...value, runtimeHtml: '<main>different</main>' } : value,
          'externalAppRuntimes',
          '"app"',
          native,
        )
        await native.putRecords('externalAppRuntimes', [
          { key: '"app"', value: encoded as Record<string, unknown> },
        ])
        // The source exceeds the bridge byte guard and uses threshold 0, unlike the native row.
        expect(JSON.stringify(encoded).length).toBeGreaterThan(768 * 1024)
        native.writeBlob = async () => {
          throw new Error('Comparison must not write attachments')
        }
        native.readBlob = async () => {
          throw new Error('Comparison must not materialize native attachments')
        }
        const result = await fingerprintAppDatabaseStore(database, 'externalAppRuntimes', {
          native,
          compareNative: true,
        })
        expect(result.matches).toBe(!changed)
        expect(result.firstMismatch).toEqual(
          changed ? { key: '"app"', fields: ['runtimeHtml'] } : undefined,
        )
      } finally {
        await database.delete()
      }
    },
  )

  it('revalidates already copied attachment bytes when the fallback source changes with equal size', async () => {
    const database = new Dexie(`android-native-migrate-blob-changed-${crypto.randomUUID()}`)
    database.version(1).stores({ resources: 'id' })
    const native = createNativePort()
    try {
      await database.table('resources').put({ id: 'r1', originalBlob: new Blob(['before']) })
      const migrator = new AndroidAppDatabaseMigrator({ database, native, isQuiesced: () => true })
      await migrator.migrateStore('resources')
      await database.table('resources').put({ id: 'r1', originalBlob: new Blob(['AFTER!']) })
      await migrator.migrateStore('resources')
      const actual = (await decodeAppDatabaseValue(
        native.records.get('resources')!.get('"r1"'),
        'resources',
        '"r1"',
        native,
      )) as { originalBlob: Blob }
      expect(await actual.originalBlob.text()).toBe('AFTER!')
    } finally {
      await database.delete()
    }
  })
  it('does not reuse verified rows after the retained source changes without changing its count', async () => {
    const database = new Dexie(`android-native-migrate-same-count-${crypto.randomUUID()}`)
    database.version(1).stores({ resources: 'id' })
    const native = createNativePort()
    try {
      await database.table('resources').put({ id: 'r1', name: 'before' })
      const migrator = new AndroidAppDatabaseMigrator({ database, native, isQuiesced: () => true })
      await migrator.migrateStore('resources')
      await database.table('resources').put({ id: 'r1', name: 'after fallback editing' })
      await migrator.migrateStore('resources')
      expect(native.records.get('resources')!.get('"r1"')!.name).toBe('after fallback editing')
    } finally {
      await database.delete()
    }
  })

  it('rejects real cycles while allowing duplicate references', async () => {
    const cyclic: unknown[] = []
    cyclic.push(cyclic)
    await expect(
      encodeAppDatabaseValue({ id: 'cycle', cyclic }, 'settings', '"cycle"', createNativePort()),
    ).rejects.toThrow('循环引用')
  })
  it('preserves repeated non-cyclic objects within arrays and maps', async () => {
    const native = createNativePort()
    const shared = { body: '同一对象被两处使用', values: [1, 2] }
    const original = {
      id: 'shared',
      items: [shared, shared],
      mapping: new Map([
        ['a', shared],
        ['b', shared],
      ]),
    }
    const encoded = await encodeAppDatabaseValue(original, 'settings', '"shared"', native)
    expect(await decodeAppDatabaseValue(encoded, 'settings', '"shared"', native)).toEqual(original)
  })
  it('uses the native bridge batch capacity by default for faster first-run migration', async () => {
    const database = new Dexie(`android-native-migrate-batched-${crypto.randomUUID()}`)
    database.version(1).stores({ resources: 'id' })
    await database
      .table('resources')
      .bulkPut(Array.from({ length: 250 }, (_, index) => ({ id: `resource-${index}` })))
    const native = createNativePort()
    const putRecordsWithState = native.putRecordsWithState.bind(native)
    let batchCount = 0
    native.putRecordsWithState = async (...args) => {
      batchCount += 1
      return putRecordsWithState(...args)
    }
    const migrator = new AndroidAppDatabaseMigrator({
      database,
      native,
      isQuiesced: () => true,
    })

    await expect(migrator.migrateStore('resources')).resolves.toMatchObject({
      copied: 250,
      total: 250,
      status: 'verified',
    })
    expect(batchCount).toBe(3)
    expect(native.records.get('resources')?.size).toBe(250)
    expect(JSON.parse(native.states.get('migration:appdb:v1:resources')!).sourceDigest).toBe(
      (await fingerprintAppDatabaseStore(database, 'resources')).digest,
    )
    await database.delete()
  })

  it('copies and verifies a store while preserving structured values and binary attachments', async () => {
    const name = `android-native-migration-${crypto.randomUUID()}`
    const database = new Dexie(name)
    database.version(1).stores({ resources: 'id' })
    const legacyValue = {
      id: 'resource-1',
      createdAt: new Date('2026-01-02T03:04:05.000Z'),
      blob: new Blob(['binary payload'], { type: 'text/plain' }),
      arrayBuffer: new Uint8Array([1, 2, 3]).buffer,
      map: new Map([['key', new Set(['value'])]]),
      markerLikeUserData: { __srlAppDatabaseValueV1: 'date', value: 'keep me' },
      undefinedValue: undefined,
    }
    await database.table('resources').put(legacyValue)
    const native = createNativePort()
    const migrator = new AndroidAppDatabaseMigrator({
      database,
      native,
      isQuiesced: () => true,
      batchSize: 1,
    })

    const result = await migrator.migrateStore('resources')
    const encodedKey = JSON.stringify('resource-1')
    const encoded = native.records.get('resources')?.get(encodedKey)
    expect(result).toMatchObject({ copied: 1, total: 1, status: 'verified' })
    expect(encoded).toBeDefined()
    await expect(decodeAppDatabaseValue(encoded, 'resources', encodedKey, native)).resolves.toEqual(
      legacyValue,
    )
    expect(await database.table('resources').get('resource-1')).toEqual(legacyValue)
    await database.delete()
  })

  it('externalizes strings when one record would exceed the native bridge payload limit', async () => {
    const database = new Dexie(`android-native-migrate-large-record-${crypto.randomUUID()}`)
    database.version(1).stores({ resources: 'id' })
    const value = {
      id: 'large-record',
      first: 'a'.repeat(220 * 1024),
      second: 'b'.repeat(220 * 1024),
      third: 'c'.repeat(220 * 1024),
      fourth: 'd'.repeat(220 * 1024),
    }
    await database.table('resources').put(value)
    const native = createNativePort()
    const migrator = new AndroidAppDatabaseMigrator({
      database,
      native,
      isQuiesced: () => true,
      batchSize: 1,
    })

    await expect(migrator.migrateStore('resources')).resolves.toMatchObject({
      copied: 1,
      total: 1,
      status: 'verified',
    })
    const encodedKey = JSON.stringify('large-record')
    const encoded = native.records.get('resources')?.get(encodedKey)
    expect(encoded).toBeDefined()
    expect(JSON.stringify(encoded).length).toBeLessThan(1024)
    expect(JSON.parse(native.states.get('migration:appdb:v1:resources')!).sourceDigest).toBe(
      (await fingerprintAppDatabaseStore(database, 'resources')).digest,
    )
    await expect(decodeAppDatabaseValue(encoded, 'resources', encodedKey, native)).resolves.toEqual(
      value,
    )
    await database.delete()
  })

  it('stops without changing either store if writes are not quiesced', async () => {
    const name = `android-native-migration-paused-${crypto.randomUUID()}`
    const database = new Dexie(name)
    database.version(1).stores({ resources: 'id' })
    await database.table('resources').put({ id: 'keep' })
    const native = createNativePort()
    const migrator = new AndroidAppDatabaseMigrator({
      database,
      native,
      isQuiesced: () => false,
    })

    await expect(migrator.migrateStore('resources')).rejects.toThrow(
      '迁移期间必须暂停应用数据库写入',
    )
    expect(await database.table('resources').get('keep')).toEqual({ id: 'keep' })
    expect(native.records.size).toBe(0)
    await database.delete()
  })

  it('migrates every Dexie app table and keeps source data available after verification', async () => {
    const database = new AppDatabase(`android-native-migrate-all-${crypto.randomUUID()}`)
    await database.resources.put({ id: 'r1', type: 'character', name: '卡片' } as never)
    await database.categories.put({
      id: 'c1',
      name: '分类',
      color: '#fff',
      createdAt: 1,
      updatedAt: 1,
    } as never)
    const native = createNativePort()
    const migrator = new AndroidAppDatabaseMigrator({
      database,
      native,
      isQuiesced: () => true,
      batchSize: 2,
    })

    const summary = await migrator.migrateAllStores()

    expect(summary.total).toBe(2)
    expect(summary.stores.every((store) => store.status === 'verified')).toBe(true)
    expect(summary.stores.map((store) => store.store)).toContain('frontendWorkshopSourceComponents')
    expect(await database.resources.get('r1')).toMatchObject({ name: '卡片' })
    expect(await database.categories.get('c1')).toMatchObject({ name: '分类' })
    await database.delete()
  })

  it('resumes after an atomic batch checkpoint even when read-back verification is interrupted', async () => {
    const database = new Dexie(`android-native-migrate-resume-${crypto.randomUUID()}`)
    database.version(1).stores({ resources: 'id' })
    await database.table('resources').bulkPut([{ id: 'r1' }, { id: 'r2' }])
    const native = createNativePort()
    const getRecordsByKeys = native.getRecordsByKeys.bind(native)
    let interrupt = true
    native.getRecordsByKeys = async (...args) => {
      if (interrupt) {
        interrupt = false
        throw new Error('simulated process interruption after native commit')
      }
      return getRecordsByKeys(...args)
    }

    const interrupted = new AndroidAppDatabaseMigrator({
      database,
      native,
      isQuiesced: () => true,
      batchSize: 1,
    })
    await expect(interrupted.migrateStore('resources')).rejects.toThrow(
      'simulated process interruption',
    )
    expect(JSON.parse(native.states.get('migration:appdb:v1:resources') ?? '{}')).toMatchObject({
      copiedCount: 1,
    })

    const resumed = new AndroidAppDatabaseMigrator({
      database,
      native,
      isQuiesced: () => true,
      batchSize: 1,
    })
    await expect(resumed.migrateStore('resources')).resolves.toMatchObject({
      copied: 2,
      total: 2,
      status: 'verified',
    })
    expect(native.records.get('resources')?.size).toBe(2)
    expect(JSON.parse(native.states.get('migration:appdb:v1:resources')!).sourceDigest).toBe(
      (await fingerprintAppDatabaseStore(database, 'resources')).digest,
    )
    await database.delete()
  })

  it('rebuilds an inactive partial store when its IndexedDB row count changed since the checkpoint', async () => {
    const database = new Dexie(`android-native-migrate-changed-source-${crypto.randomUUID()}`)
    database.version(1).stores({ resources: 'id' })
    await database.table('resources').bulkPut([{ id: 'r1' }, { id: 'r2' }])
    const native = createNativePort()
    const getRecordsByKeys = native.getRecordsByKeys.bind(native)
    let interrupt = true
    native.getRecordsByKeys = async (...args) => {
      if (interrupt) {
        interrupt = false
        throw new Error('simulated interruption after first committed batch')
      }
      return getRecordsByKeys(...args)
    }
    const firstAttempt = new AndroidAppDatabaseMigrator({
      database,
      native,
      isQuiesced: () => true,
      batchSize: 1,
    })
    await expect(firstAttempt.migrateStore('resources')).rejects.toThrow('simulated interruption')

    await database.table('resources').delete('r1')
    const retry = new AndroidAppDatabaseMigrator({
      database,
      native,
      isQuiesced: () => true,
      batchSize: 1,
    })

    await expect(retry.migrateStore('resources')).resolves.toMatchObject({
      copied: 1,
      total: 1,
      status: 'verified',
    })
    expect([...native.records.get('resources')!.keys()]).toEqual([JSON.stringify('r2')])
    await database.delete()
  })

  it('does not clear a changed store if the native database is already active', async () => {
    const database = new Dexie(`android-native-migrate-active-change-${crypto.randomUUID()}`)
    database.version(1).stores({ resources: 'id' })
    await database.table('resources').bulkPut([{ id: 'r1' }, { id: 'r2' }])
    const native = createNativePort()
    native.states.set('migration:appdb:v1:active', '{"mode":"active"}')
    native.states.set(
      'migration:appdb:v1:resources',
      JSON.stringify({
        version: 1,
        status: 'copying',
        sourceCount: 1,
        copiedCount: 1,
        updatedAt: 1,
      }),
    )
    native.records.set('resources', new Map([[JSON.stringify('r1'), { id: 'r1' }]]))
    const stale = new AndroidAppDatabaseMigrator({
      database,
      native,
      isQuiesced: () => true,
      batchSize: 1,
    })
    await expect(stale.migrateStore('resources')).rejects.toThrow(
      '原生数据库已启用；拒绝重置表 resources 的迁移副本',
    )
    expect(native.records.get('resources')?.has(JSON.stringify('r1'))).toBe(true)
    await database.delete()
  })
})
