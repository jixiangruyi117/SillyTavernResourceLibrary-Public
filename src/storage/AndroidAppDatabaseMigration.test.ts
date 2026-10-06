import 'fake-indexeddb/auto'

import Dexie from 'dexie'
import { describe, expect, it } from 'vitest'

import { AppDatabase } from '../database/AppDatabase'
import { AndroidAppDatabaseMigrator, decodeAppDatabaseValue } from './AndroidAppDatabaseMigration'

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
      return { size: blob.size, mimeType: blob.type, sha256: `sha256-${blob.size}` }
    },
    async readBlob(store: string, key: string, path: string) {
      return blobs.get(blobKey(store, key, path))
    },
  }
}

describe('AndroidAppDatabaseMigrator', () => {
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
    await database.delete()
  })
})
