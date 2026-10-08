import 'fake-indexeddb/auto'

import { afterEach, describe, expect, it, vi } from 'vitest'
import Dexie from 'dexie'
import { Capacitor } from '@capacitor/core'
import { BUILD_INFO } from '../core/BuildInfo'
import { deactivateAndroidNativeAppDatabase } from './AndroidNativeDexieCore'

import { AppDatabase } from '../database/AppDatabase'
import { APP_DATABASE_STORES, type NativeAppDatabaseStore } from './NativeAppDatabaseBridge'
import {
  AndroidAppDatabaseMigrator,
  encodeAppDatabaseKey,
  encodeAppDatabaseValue,
  fingerprintAppDatabaseStore,
} from './AndroidAppDatabaseMigration'
import { hashBlob } from '../services/HashService'
import {
  getRetainedIndexedDbCopy,
  clearRetainedIndexedDbCopy,
  resetIncompleteAndroidNativeAppDatabaseMigration,
  rollbackAndroidNativeAppDatabase,
  initializeAndroidNativeAppDatabase,
  type RetainedIndexedDbRecoverySource,
} from './AndroidNativeAppDatabaseRuntime'

const databases: AppDatabase[] = []

afterEach(async () => {
  deactivateAndroidNativeAppDatabase()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
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
    async clearIndexes() {},
    async putRecords(
      store: NativeAppDatabaseStore,
      records: Array<{ key: string; value: Record<string, unknown> }>,
    ) {
      for (const row of records) rows.get(store)!.set(row.key, row.value)
    },
    async putRecordsWithState(
      store: NativeAppDatabaseStore,
      records: Array<{ key: string; value: Record<string, unknown> }>,
      key: string,
      value: string,
    ) {
      await native.putRecords(store, records)
      state.set(key, value)
    },
    async verifyStore() {
      return { records: 0, files: 0, bytes: 0 }
    },
    async getState(key: string) {
      return state.get(key)
    },
    async putState(key: string, value: string) {
      state.set(key, value)
    },
    async clearStore(store: NativeAppDatabaseStore) {
      rows.get(store)!.clear()
      for (const key of [...blobs.keys()]) if (key.startsWith(`${store}\0`)) blobs.delete(key)
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
    async getRecordsByKeys(store: NativeAppDatabaseStore, keys: string[]) {
      return keys
        .filter((key) => rows.get(store)!.has(key))
        .map((key) => ({ key, value: rows.get(store)!.get(key)! }))
    },
    async readBlob(store: string, key: string, path: string) {
      return blobs.get(blobKey(store, key, path))
    },
    async writeBlob(store: string, key: string, path: string, blob: Blob, owner = key) {
      blobs.set(blobKey(store, owner, path), blob)
      return { sha256: await hashBlob(blob), size: blob.size, mimeType: blob.type }
    },
  }
  return { native, rows, blobs, state }
}

function enableAndroidStartup() {
  vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true)
  vi.spyOn(Capacitor, 'getPlatform').mockReturnValue('android')
  vi.stubGlobal('window', { Capacitor: { isNativePlatform: () => true } })
}

describe('completed native startup', () => {
  it.each([0, 1, 5000])(
    'restores a verified receipt once, then cold/warm opens without source or attachment scans: %s retained rows',
    async (count) => {
      const database = new AppDatabase(`native-startup-${crypto.randomUUID()}`)
      databases.push(database)
      await database.open()
      if (count)
        await database.resources.bulkPut(
          Array.from({ length: count }, (_, i) => ({
            id: `old-${i}`,
            originalBlob: new Blob(['old']),
          })) as never,
        )
      database.close()
      const { native, state, rows } = createNativePort()
      state.set('migration:appdb:indexes:v1:active', 'verified-v1')
      rows.get('resources')!.set('"current"', { id: 'current', name: 'native edits retained' })
      const status = vi.spyOn(native, 'status')
      const getRows = vi.spyOn(native, 'getRecords')
      const readBlob = vi.spyOn(native, 'readBlob')
      const sourceCount = vi.spyOn(IDBObjectStore.prototype, 'count')
      const sourceCursor = vi.spyOn(IDBObjectStore.prototype, 'openCursor')
      const sourceGet = vi.spyOn(IDBObjectStore.prototype, 'getAll')
      const reads = vi.spyOn(native, 'getState')
      const writes = vi.spyOn(native, 'putState')
      const progress = vi.fn()
      enableAndroidStartup()
      expect(await initializeAndroidNativeAppDatabase(database, progress, native as never)).toEqual(
        { native: true, migrated: false, copied: 0, total: 0 },
      )
      expect(reads.mock.calls.map(([key]) => key)).toEqual([
        'migration:appdb:v1:active',
        'migration:appdb:indexes:v1:active',
      ])
      expect(writes).toHaveBeenCalledOnce()
      expect(JSON.parse(state.get('migration:appdb:v1:active')!).indexSchema).toMatch(
        /^[a-f0-9]{64}$/,
      )
      reads.mockClear()
      writes.mockClear()
      database.close()
      await initializeAndroidNativeAppDatabase(database, progress, native as never)
      await initializeAndroidNativeAppDatabase(database, progress, native as never)
      expect(reads.mock.calls.map(([key]) => key)).toEqual([
        'migration:appdb:v1:active',
        'migration:appdb:v1:active',
      ])
      expect(writes).not.toHaveBeenCalled()
      for (const operation of [
        status,
        getRows,
        readBlob,
        sourceCount,
        sourceCursor,
        sourceGet,
        progress,
      ])
        expect(operation).not.toHaveBeenCalled()
      expect(rows.get('resources')!.get('"current"')).toMatchObject({
        name: 'native edits retained',
      })
    },
  )

  it('rebuilds indexes from native metadata only when the schema changes, then resumes the fast path', async () => {
    const database = new AppDatabase(`native-schema-${crypto.randomUUID()}`)
    databases.push(database)
    await database.open()
    const { native, state, rows } = createNativePort()
    state.set('migration:appdb:indexes:v1:active', 'verified-v1')
    enableAndroidStartup()
    await initializeAndroidNativeAppDatabase(database, undefined, native as never)
    state.set(
      'migration:appdb:v1:active',
      JSON.stringify({
        ...JSON.parse(state.get('migration:appdb:v1:active')!),
        indexSchema: 'a'.repeat(64),
        databaseVersion: BUILD_INFO.databaseVersion - 1,
      }),
    )
    rows.get('resources')!.set('"native-only"', { id: 'native-only', name: 'current' })
    const getRows = vi.spyOn(native, 'getRecords')
    const readBlob = vi.spyOn(native, 'readBlob')
    const sourceCount = vi.spyOn(IDBObjectStore.prototype, 'count')
    await initializeAndroidNativeAppDatabase(database, undefined, native as never)
    expect(getRows).toHaveBeenCalled()
    expect(sourceCount).not.toHaveBeenCalled()
    expect(readBlob).not.toHaveBeenCalled()
    getRows.mockClear()
    await initializeAndroidNativeAppDatabase(database, undefined, native as never)
    expect(getRows).not.toHaveBeenCalled()
    expect(rows.get('resources')!.has('"native-only"')).toBe(true)
  })

  it('keeps the old receipt after an index rebuild failure so the next open cannot silently skip it', async () => {
    const database = new AppDatabase(`native-index-failed-${crypto.randomUUID()}`)
    databases.push(database)
    await database.open()
    const { native, state } = createNativePort()
    state.set(
      'migration:appdb:v1:active',
      JSON.stringify({
        version: 1,
        activatedAt: 1,
        databaseVersion: BUILD_INFO.databaseVersion,
        indexSchema: 'a'.repeat(64),
      }),
    )
    const prior = state.get('migration:appdb:v1:active')
    vi.spyOn(native, 'getRecords').mockRejectedValue(new Error('native unavailable'))
    enableAndroidStartup()
    await expect(
      initializeAndroidNativeAppDatabase(database, undefined, native as never),
    ).rejects.toThrow('native unavailable')
    expect(state.get('migration:appdb:v1:active')).toBe(prior)
    expect(state.get('migration:appdb:indexes:v1:active')).toBe('')
  })

  it('finishes an inactive partial migration with verified source content and preserves its attachments', async () => {
    const database = new AppDatabase(`native-partial-${crypto.randomUUID()}`)
    databases.push(database)
    await database.open()
    await database.resources.put({
      id: 'source',
      originalBlob: new Blob(['source bytes']),
    } as never)
    const { native, state, rows } = createNativePort()
    state.delete('migration:appdb:v1:active')
    await new AndroidAppDatabaseMigrator({
      database,
      native: native as never,
      isQuiesced: () => true,
    }).migrateStore('resources')
    const progress = vi.fn()
    enableAndroidStartup()
    const result = await initializeAndroidNativeAppDatabase(database, progress, native as never)
    expect(result).toMatchObject({ native: true, migrated: true, copied: 1 })
    expect(progress).toHaveBeenCalled()
    expect(rows.get('resources')!.has('"source"')).toBe(true)
    expect(await database.resources.count()).toBe(1)
    const source = await database.resources.get('source')
    expect(source && 'originalBlob' in source ? await source.originalBlob.text() : undefined).toBe(
      'source bytes',
    )
  })

  it.each([
    'invalid-json',
    JSON.stringify({
      version: 1,
      databaseVersion: 25,
      activatedAt: 1,
      indexSchema: 'not-a-receipt',
    }),
  ])('rejects an invalid active receipt without enumerating the source: %s', async (receipt) => {
    const database = new AppDatabase(`native-bad-state-${crypto.randomUUID()}`)
    databases.push(database)
    const { native, state } = createNativePort()
    state.set('migration:appdb:v1:active', receipt)
    const status = vi.spyOn(native, 'status')
    enableAndroidStartup()
    await expect(
      initializeAndroidNativeAppDatabase(database, undefined, native as never),
    ).rejects.toThrow('启用状态无法识别')
    expect(status).not.toHaveBeenCalled()
    expect(state.get('migration:appdb:v1:active')).toBe(receipt)
  })
})

describe('AndroidNativeAppDatabaseRuntime rollback', () => {
  it('clears only an inactive migration copy and leaves a retry request consumed', async () => {
    const { native, rows, state } = createNativePort()
    state.delete('migration:appdb:v1:active')
    state.set('migration:appdb:v1:retry-requested', 'requested-v1')
    state.set('migration:appdb:v1:resources', '{"copiedCount":4}')
    rows.get('resources')!.set('stale', { id: 'stale' })

    await resetIncompleteAndroidNativeAppDatabaseMigration(native as never)

    expect(rows.get('resources')?.size).toBe(0)
    expect(state.get('migration:appdb:v1:resources')).toBe('')
    expect(state.get('migration:appdb:v1:retry-requested')).toBe('')
  })

  it('refuses to clear an active native database', async () => {
    const { native, rows } = createNativePort()
    rows.get('resources')!.set('active-data', { id: 'active-data' })

    await expect(resetIncompleteAndroidNativeAppDatabaseMigration(native as never)).rejects.toThrow(
      '检测到原生数据库启用状态',
    )
    expect(rows.get('resources')?.has('active-data')).toBe(true)
  })

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

describe('retained IndexedDB cleanup', () => {
  async function fixture() {
    const database = new AppDatabase(`retained-cleanup-${crypto.randomUUID()}`)
    databases.push(database)
    await database.open()
    await database.resources.put({
      id: 'old',
      type: 'characterCard',
      originalBlob: new Blob(['old data']),
    } as never)
    const port = createNativePort()
    port.state.set('migration:appdb:indexes:v1:active', 'verified-v1')
    const plan = await getRetainedIndexedDbCopy(database.name)
    for (const [store, count] of Object.entries(plan.counts)) {
      const { digest } = await fingerprintAppDatabaseStore(
        database,
        store as NativeAppDatabaseStore,
      )
      port.state.set(
        `migration:appdb:v1:${store}`,
        JSON.stringify({
          version: 1,
          status: 'verified',
          sourceCount: count,
          copiedCount: count,
          sourceDigest: digest,
        }),
      )
    }
    return { database, plan, ...port }
  }
  const collect = async (source: RetainedIndexedDbRecoverySource) => {
    expect(Dexie.currentTransaction).not.toBeNull()
    const result: Array<{ store: NativeAppDatabaseStore; key: string; value: unknown }> = []
    await source.readRecords(async (row) => {
      expect(Dexie.currentTransaction).toBeNull()
      result.push(row)
    })
    return result
  }

  it('archives the settings screenshot 19-to-3 differences and preserves current native settings', async () => {
    const { database, native, state, rows } = await fixture()
    const settings = ['feature.characterDraw', 'other.preference', 'third.preference'].map(
      (id) => ({ id, value: { selected: 'old' }, updatedAt: 1 }),
    )
    await database.settings.bulkPut(settings)
    state.set(
      'migration:appdb:v1:settings',
      JSON.stringify({ version: 1, status: 'verified', sourceCount: 19, copiedCount: 19 }),
    )
    const current = { ...settings[0]!, value: { selected: 'current' }, updatedAt: 2 }
    rows.get('settings')!.set('"feature.characterDraw"', current)
    const saved: unknown[] = []
    await clearRetainedIndexedDbCopy(
      database.name,
      await getRetainedIndexedDbCopy(database.name),
      undefined,
      native as never,
      async (source) => {
        saved.push(...(await collect(source)))
      },
    )
    expect(saved.filter((row) => (row as { store: string }).store === 'settings')).toEqual(
      settings.map((value) => ({ store: 'settings', key: JSON.stringify(value.id), value })),
    )
    expect(saved).toContainEqual(expect.objectContaining({ store: 'resources', key: '"old"' }))
    expect((await getRetainedIndexedDbCopy(database.name)).records).toBe(0)
    expect(rows.get('settings')!.get('"feature.characterDraw"')).toEqual(current)
  })

  it.each(APP_DATABASE_STORES)(
    'archives unreceipted unique content in %s without a table-specific exemption',
    async (store) => {
      const { database, native, state, rows } = await fixture()
      if (!database.tables.some((table) => table.name === store)) {
        database.close()
        database.version(26).stores({ [store]: 'id' })
        await database.open()
      }
      const table = database.table(store)
      const paths = table.schema.primKey.keyPath!
      const value: Record<string, unknown> = { updatedAt: 1, value: { unique: store } }
      for (const path of typeof paths === 'string' ? [paths] : paths) value[path] = `legacy-${path}`
      await table.put(value)
      state.delete(`migration:appdb:v1:${store}`)
      const saved: unknown[] = []
      const before = [...rows.get(store)!]
      await clearRetainedIndexedDbCopy(
        database.name,
        await getRetainedIndexedDbCopy(database.name),
        undefined,
        native as never,
        async (source) => {
          saved.push(...(await collect(source)))
        },
      )
      expect(saved).toContainEqual(expect.objectContaining({ store, value }))
      expect((await getRetainedIndexedDbCopy(database.name)).records).toBe(0)
      expect([...rows.get(store)!]).toEqual(before)
    },
  )

  it('clears receipted copies despite normal native updates and does not save redundant recovery data', async () => {
    const { database, native, plan, rows, state } = await fixture()
    const preserve = vi.fn()
    const active = state.get('migration:appdb:v1:active')
    rows.get('resources')!.set('"new-native"', { id: 'new-native', type: 'preset' })
    await clearRetainedIndexedDbCopy(database.name, plan, undefined, native as never, preserve)
    database.close()
    await database.open()
    expect((await getRetainedIndexedDbCopy(database.name)).records).toBe(0)
    expect(rows.get('resources')!.get('"new-native"')).toEqual({ id: 'new-native', type: 'preset' })
    expect(preserve).not.toHaveBeenCalled()
    expect(state.get('migration:appdb:v1:active')).toBe(active)
  })

  it('saves same-count edits and original Blob bytes rather than rejecting their differences', async () => {
    const { database, native } = await fixture()
    await database.resources.update('old', { originalBlob: new Blob(['unique bytes']) } as never)
    const saved: Array<{ store: NativeAppDatabaseStore; key: string; value: unknown }> = []
    await clearRetainedIndexedDbCopy(
      database.name,
      await getRetainedIndexedDbCopy(database.name),
      undefined,
      native as never,
      async (source) => {
        saved.push(...(await collect(source)))
      },
    )
    expect(await (saved[0]!.value as { originalBlob: Blob }).originalBlob.text()).toBe(
      'unique bytes',
    )
    expect(await database.resources.count()).toBe(0)
  })

  it.each(['archive failed', 'readback hash failed', 'cancelled'])(
    'retains every old table if recovery fails: %s',
    async (message) => {
      const { database, native, state } = await fixture()
      await database.settings.put({ id: 'feature.characterDraw', value: 'old', updatedAt: 1 })
      state.delete('migration:appdb:v1:settings')
      const plan = await getRetainedIndexedDbCopy(database.name)
      await expect(
        clearRetainedIndexedDbCopy(
          database.name,
          plan,
          undefined,
          native as never,
          async (source) => {
            await collect(source)
            throw new Error(message)
          },
        ),
      ).rejects.toThrow(message)
      expect((await getRetainedIndexedDbCopy(database.name)).records).toBe(plan.records)
      expect(await database.resources.get('old')).toBeDefined()
      expect(await database.settings.get('feature.characterDraw')).toBeDefined()
    },
  )

  it('reads a 251-record retained table in locked key batches without skipping or duplicating records', async () => {
    const { database, native } = await fixture()
    const settings = Array.from({ length: 251 }, (_, index) => ({
      id: `key-${String(index).padStart(3, '0')}`,
      value: index,
      updatedAt: 1,
    }))
    await database.settings.bulkPut(settings)
    const saved: Array<{ store: NativeAppDatabaseStore; key: string; value: unknown }> = []
    await clearRetainedIndexedDbCopy(
      database.name,
      await getRetainedIndexedDbCopy(database.name),
      undefined,
      native as never,
      async (source) => {
        await source.readRecords(async (row) => {
          expect(Dexie.currentTransaction).toBeNull()
          await new Blob(['external hash input']).arrayBuffer()
          await new Promise<void>((resolve) => setTimeout(resolve, 0))
          saved.push(row)
        })
      },
    )
    expect(saved.filter((row) => row.store === 'settings').map((row) => row.value)).toEqual(
      settings,
    )
    expect((await getRetainedIndexedDbCopy(database.name)).records).toBe(0)
  })

  it('requires a verified recovery writer when source data cannot be proven migrated', async () => {
    const { database, native, state } = await fixture()
    state.delete('migration:appdb:v1:resources')
    await expect(
      clearRetainedIndexedDbCopy(
        database.name,
        await getRetainedIndexedDbCopy(database.name),
        undefined,
        native as never,
      ),
    ).rejects.toThrow('先保存恢复档')
    expect(await database.resources.get('old')).toBeDefined()
  })

  it('retains all old data if native integrity verification fails before archiving', async () => {
    const { database, native, plan } = await fixture()
    const preserve = vi.fn()
    native.verifyStore = async () => {
      throw new Error('missing native attachment')
    }
    await expect(
      clearRetainedIndexedDbCopy(database.name, plan, undefined, native as never, preserve),
    ).rejects.toThrow('missing native attachment')
    expect(preserve).not.toHaveBeenCalled()
    expect((await getRetainedIndexedDbCopy(database.name)).records).toBe(plan.records)
  })

  it('rejects source count changes after confirmation and rollback state before deleting anything', async () => {
    const { database, native, state, plan } = await fixture()
    await database.resources.put({ id: 'new-old-source-record' } as never)
    const preserve = vi.fn()
    await expect(
      clearRetainedIndexedDbCopy(database.name, plan, undefined, native as never, preserve),
    ).rejects.toThrow('请重新确认')
    state.set(
      'migration:appdb:v1:active',
      JSON.stringify({ version: 1, databaseVersion: 25, activatedAt: 1, mode: 'rolling-back' }),
    )
    await expect(
      clearRetainedIndexedDbCopy(database.name, plan, undefined, native as never, preserve),
    ).rejects.toThrow('尚未完成迁移')
    expect(preserve).not.toHaveBeenCalled()
    expect(await database.resources.count()).toBe(2)
  })

  it('allows only one concurrent cleanup to commit the same confirmed source', async () => {
    const { database, native, state } = await fixture()
    state.delete('migration:appdb:v1:resources')
    const plan = await getRetainedIndexedDbCopy(database.name)
    let started!: () => void
    const archiveStarted = new Promise<void>((resolve) => {
      started = resolve
    })
    let finish!: () => void
    const allowFinish = new Promise<void>((resolve) => {
      finish = resolve
    })
    const preserve = vi.fn(async (source: RetainedIndexedDbRecoverySource) => {
      await collect(source)
      started()
      await Dexie.waitFor(allowFinish, Infinity)
    })
    const first = clearRetainedIndexedDbCopy(
      database.name,
      plan,
      undefined,
      native as never,
      preserve,
    )
    await archiveStarted
    const second = clearRetainedIndexedDbCopy(
      database.name,
      plan,
      undefined,
      native as never,
      preserve,
    )
    const results = Promise.allSettled([first, second])
    finish()
    const statuses = await results
    expect(statuses[0]!.status).toBe('fulfilled')
    expect(statuses[1]!.status).toBe('rejected')
    expect(preserve).toHaveBeenCalledOnce()
    expect((await getRetainedIndexedDbCopy(database.name)).records).toBe(0)
  })

  it('keeps the source if active native identity changes after recovery saving', async () => {
    const { database, native, state } = await fixture()
    state.delete('migration:appdb:v1:resources')
    await expect(
      clearRetainedIndexedDbCopy(
        database.name,
        await getRetainedIndexedDbCopy(database.name),
        undefined,
        native as never,
        async (source) => {
          await collect(source)
          state.set('migration:appdb:v1:active', 'changed')
        },
      ),
    ).rejects.toThrow('原生主库状态已变化')
    expect(await database.resources.count()).toBe(1)
  })
})
