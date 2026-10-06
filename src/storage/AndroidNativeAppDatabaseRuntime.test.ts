import 'fake-indexeddb/auto'

import { afterEach, describe, expect, it } from 'vitest'

import { AppDatabase } from '../database/AppDatabase'
import { APP_DATABASE_STORES, type NativeAppDatabaseStore } from './NativeAppDatabaseBridge'
import { encodeAppDatabaseKey, encodeAppDatabaseValue } from './AndroidAppDatabaseMigration'
import { rollbackAndroidNativeAppDatabase } from './AndroidNativeAppDatabaseRuntime'

const databases: AppDatabase[] = []

afterEach(async () => {
  for (const database of databases.splice(0)) {
    database.close()
    await database.delete()
  }
})

function createNativePort() {
  const rows = new Map<NativeAppDatabaseStore, Map<string, Record<string, unknown>>>()
  const blobs = new Map<string, Blob>()
  const state = new Map<string, string>([
    [
      'migration:appdb:v1:active',
      JSON.stringify({ version: 1, databaseVersion: 25, activatedAt: 1 }),
    ],
  ])
  for (const store of APP_DATABASE_STORES) rows.set(store, new Map())
  const blobKey = (store: string, key: string, path: string) => `${store}\0${key}\0${path}`
  const native = {
    async getState(key: string) {
      return state.get(key)
    },
    async putState(key: string, value: string) {
      state.set(key, value)
    },
    async status() {
      return {
        schemaVersion: 1,
        counts: Object.fromEntries([...rows].map(([store, values]) => [store, values.size])),
      }
    },
    async getRecords(store: NativeAppDatabaseStore, afterKey: string | undefined, limit: number) {
      const values = rows.get(store)!
      const result = [...values.entries()]
        .filter(([key]) => afterKey === undefined || key > afterKey)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .slice(0, limit)
        .map(([key, value]) => ({ key, value }))
      return {
        rows: result,
        count: values.size,
        nextKey: result.length === limit ? result.at(-1)?.key : undefined,
      }
    },
    async readBlob(store: string, key: string, path: string) {
      return blobs.get(blobKey(store, key, path))
    },
    async writeBlob(store: string, key: string, path: string, blob: Blob) {
      blobs.set(blobKey(store, key, path), blob)
      return { sha256: 'a'.repeat(64), size: blob.size, mimeType: blob.type }
    },
  }
  return { native, rows, blobs, state }
}

describe('AndroidNativeAppDatabaseRuntime rollback', () => {
  it('restores and verifies native records and attachments before selecting the legacy database', async () => {
    const name = `native-rollback-${crypto.randomUUID()}`
    const database = new AppDatabase(name)
    databases.push(database)
    await database.open()
    await database.resources.put({ id: 'old-copy', type: 'characterCard' } as never)

    const { native, rows, state } = createNativePort()
    const store = 'resources'
    const key = encodeAppDatabaseKey('native-card')
    const blob = new Blob(['native attachment'], { type: 'image/png' })
    const value = await encodeAppDatabaseValue(
      {
        id: 'native-card',
        type: 'characterCard',
        originalBlob: blob,
      },
      store,
      key,
      native as never,
    )
    rows.get(store)!.set(key, value as Record<string, unknown>)

    await rollbackAndroidNativeAppDatabase(database, undefined, native as never)

    expect(await database.resources.get('old-copy')).toBeUndefined()
    const restored = await database.resources.get('native-card')
    expect(restored && 'originalBlob' in restored ? await restored.originalBlob.text() : '').toBe(
      'native attachment',
    )
    expect(JSON.parse(state.get('migration:appdb:v1:active') ?? '{}').mode).toBe('legacy')
  })

  it('restores the active marker when rollback verification fails so native data stays authoritative', async () => {
    const name = `native-rollback-recovery-${crypto.randomUUID()}`
    const database = new AppDatabase(name)
    databases.push(database)
    await database.open()
    const { native, state } = createNativePort()
    native.getRecords = async () => {
      throw new Error('simulated interrupted rollback')
    }

    await expect(
      rollbackAndroidNativeAppDatabase(database, undefined, native as never),
    ).rejects.toThrow('simulated interrupted rollback')
    expect(JSON.parse(state.get('migration:appdb:v1:active') ?? '{}').mode).toBe('active')
  })
})
