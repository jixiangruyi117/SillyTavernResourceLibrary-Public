import 'fake-indexeddb/auto'

import { describe, expect, it, vi } from 'vitest'

import { AppDatabase } from '../database/AppDatabase'
import { APP_DATABASE_STORES, nativeAppDatabase } from './NativeAppDatabaseBridge'
import { createAndroidNativeDexieCore } from './AndroidNativeDexieCore'

function createNativeStore() {
  const stores = new Map<string, Map<string, Record<string, unknown>>>()
  const blobs = new Map<string, Blob>()
  let failNextApplyBatch = false
  for (const name of APP_DATABASE_STORES) stores.set(name, new Map())
  const read = (store: string) => stores.get(store)!
  const blobKey = (store: string, key: string, path: string) => `${store}\0${key}\0${path}`
  const moveReferences = (value: unknown, store: string, key: string): unknown => {
    if (Array.isArray(value)) return value.map((item) => moveReferences(item, store, key))
    if (!value || typeof value !== 'object') return value
    const row = { ...(value as Record<string, unknown>) }
    if (typeof row.blobOwnerKey === 'string' && typeof row.fieldPath === 'string') {
      const from = blobKey(store, row.blobOwnerKey, row.fieldPath)
      const to = blobKey(store, key, row.fieldPath)
      const blob = blobs.get(from)
      if (!blob) throw new Error('staged blob missing')
      blobs.set(to, blob)
      blobs.delete(from)
      delete row.blobOwnerKey
    }
    for (const [name, item] of Object.entries(row)) row[name] = moveReferences(item, store, key)
    return row
  }
  const native = {
    async getRecord(store: string, key: string) {
      return read(store).get(key)
    },
    async getRecords(store: string, afterKey: string | undefined, limit: number) {
      const rows = [...read(store).entries()]
        .filter(([key]) => afterKey === undefined || key > afterKey)
        .sort(([left], [right]) => left.localeCompare(right))
        .slice(0, limit)
        .map(([key, value]) => ({ key, value }))
      const nextKey = rows.length === limit ? rows.at(-1)?.key : undefined
      return { rows, count: read(store).size, nextKey }
    },
    async getRecordsByKeys(store: string, keys: string[]) {
      return keys.flatMap((key) => {
        const value = read(store).get(key)
        return value ? [{ key, value }] : []
      })
    },
    async getIndexEntries(store: string, indexName: string, indexKey?: string) {
      const keyPaths = indexName.startsWith('[')
        ? indexName.slice(1, -1).split('+')
        : [indexName.replace(/^\*/u, '')]
      const rows: Array<{ indexKey: string; primaryKey: string }> = []
      for (const [primaryKey, value] of read(store)) {
        // SRL-PUBLIC-SYNC: PUBLIC-ONLY id=native-index-prefer-const-lint-compat
        // eslint-disable-next-line prefer-const
        let extracted: unknown = keyPaths.length === 1
          ? value[keyPaths[0]!]
          : keyPaths.map((path) => value[path])
        const candidates = indexName.startsWith('*') && Array.isArray(extracted)
          ? extracted
          : [extracted]
        for (const candidate of candidates) {
          if (candidate === undefined || candidate === null) continue
          const encoded = JSON.stringify(candidate)
          if (indexKey === undefined || indexKey === encoded)
            rows.push({ indexKey: encoded, primaryKey })
        }
      }
      return rows
    },
    async applyBatch(operations: Array<Record<string, unknown>>) {
      if (failNextApplyBatch) {
        failNextApplyBatch = false
        throw new Error('forced native commit failure')
      }
      for (const operation of operations) {
        const target = read(String(operation.store))
        if (operation.type === 'clear') target.clear()
        if (operation.type === 'delete') {
          for (const key of operation.keys as string[]) target.delete(key)
        }
        if (operation.type === 'put') {
          for (const row of operation.rows as Array<{
            key: string
            value: Record<string, unknown>
          }>) {
            target.set(
              row.key,
              moveReferences(row.value, String(operation.store), row.key) as Record<
                string,
                unknown
              >,
            )
          }
        }
      }
      return operations.length
    },
    async status() {
      return {
        schemaVersion: 1,
        counts: Object.fromEntries([...stores].map(([name, rows]) => [name, rows.size])),
      }
    },
    async getState() {
      return undefined
    },
    async putState() {},
    async putRecords(store: string, rows: Array<{ key: string; value: Record<string, unknown> }>) {
      for (const row of rows) read(store).set(row.key, row.value)
      return rows.length
    },
    async deleteRecords(store: string, keys: string[]) {
      for (const key of keys) read(store).delete(key)
      return keys.length
    },
    async clearStore(store: string) {
      read(store).clear()
    },
    async writeBlob(
      store: string,
      key: string,
      path: string,
      source: Blob,
      attachmentOwnerKey = key,
    ) {
      blobs.set(blobKey(store, attachmentOwnerKey, path), source)
      return {
        sha256: `${source.size}`.padStart(64, '0'),
        size: source.size,
        mimeType: source.type,
      }
    },
    async readBlob(store: string, key: string, path: string) {
      return blobs.get(blobKey(store, key, path))
    },
    async deleteBlob(store: string, key: string, path: string) {
      blobs.delete(blobKey(store, key, path))
    },
  } as unknown as typeof nativeAppDatabase
  return {
    stores,
    blobs,
    native,
    failNextNativeBatch() {
      failNextApplyBatch = true
    },
    blobKey,
  }
}

describe('AndroidNativeDexieCore', () => {
  it('uses native reads, secondary-index queries, and cursor iteration', async () => {
    const name = `native-core-read-${crypto.randomUUID()}`
    const seed = new AppDatabase(name)
    await seed.open()
    seed.close()

    const { stores, native } = createNativeStore()
    stores.get('resources')!.set('"a"', { id: 'a', type: 'character', name: 'A' })
    stores.get('resources')!.set('"b"', { id: 'b', type: 'chat', name: 'B' })
    const database = new AppDatabase(name)
    database.use(createAndroidNativeDexieCore({ enabled: () => true, native }))

    const resource = await database.resources.get('a')
    expect(resource && 'name' in resource ? resource.name : undefined).toBe('A')
    expect(
      (await database.resources.where('type').equals('character').toArray()).map((row) => row.id),
    ).toEqual(['a'])
    const visited: string[] = []
    await database.resources.orderBy('id').each((row) => visited.push(row.id))
    expect(visited).toEqual(['a', 'b'])

    const modified = await database.resources
      .where('type')
      .equals('character')
      .modify({
        favorite: true,
      } as never)
    expect(modified).toBe(1)
    expect(await database.resources.get('a')).toMatchObject({ favorite: true })
    await database.resources.delete('b')
    expect(await database.resources.get('b')).toBeUndefined()

    database.close()
    await database.delete()
  })

  it('does not hydrate unrelated attachments while scanning a native secondary index', async () => {
    const name = `native-core-lazy-blob-${crypto.randomUUID()}`
    const seed = new AppDatabase(name)
    await seed.open()
    seed.close()
    const { stores, blobs, native, blobKey } = createNativeStore()
    const fieldPath = '$/originalBlob'
    const attachment = new Blob(['large attachment'], { type: 'image/png' })
    stores.get('resources')!.set('"match"', {
      id: 'match',
      type: 'character',
      name: 'matching row',
      originalBlob: {
        __srlAppDatabaseValueV1: 'blob',
        fieldPath,
        size: attachment.size,
        mimeType: attachment.type,
        sha256: `${attachment.size}`.padStart(64, '0'),
      },
    })
    stores.get('resources')!.set('"other"', {
      id: 'other',
      type: 'chat',
      name: 'unmatched row',
      originalBlob: {
        __srlAppDatabaseValueV1: 'blob',
        fieldPath,
        size: attachment.size,
        mimeType: attachment.type,
        sha256: `${attachment.size}`.padStart(64, '0'),
      },
    })
    blobs.set(blobKey('resources', '"match"', fieldPath), attachment)
    blobs.set(blobKey('resources', '"other"', fieldPath), attachment)
    const readBlob = vi.spyOn(native, 'readBlob')
    const database = new AppDatabase(name)
    database.use(createAndroidNativeDexieCore({ enabled: () => true, native }))

    expect(await database.resources.where('type').equals('character').count()).toBe(1)
    expect(readBlob).not.toHaveBeenCalled()
    const matching = await database.resources.where('type').equals('character').toArray()
    expect(matching).toHaveLength(1)
    expect(readBlob).toHaveBeenCalledTimes(1)

    database.close()
    await database.delete()
  })

  it('commits cross-store mutations atomically and leaves native rows unchanged on abort', async () => {
    const name = `native-core-transaction-${crypto.randomUUID()}`
    const seed = new AppDatabase(name)
    await seed.open()
    seed.close()
    const { stores, native } = createNativeStore()
    const database = new AppDatabase(name)
    database.use(createAndroidNativeDexieCore({ enabled: () => true, native }))

    await expect(
      database.transaction('rw', database.resources, database.resourceSummaries, async () => {
        await database.resources.put({
          id: 'discarded',
          type: 'character',
          name: 'discarded',
        } as never)
        await database.resourceSummaries.put({ id: 'discarded', type: 'character' } as never)
        throw new Error('force rollback')
      }),
    ).rejects.toThrow('force rollback')
    expect(stores.get('resources')!.size).toBe(0)
    expect(stores.get('resourceSummaries')!.size).toBe(0)

    await database.transaction('rw', database.resources, database.resourceSummaries, async () => {
      await database.resources.put({ id: 'saved', type: 'character', name: 'saved' } as never)
      await database.resourceSummaries.put({ id: 'saved', type: 'character' } as never)
    })
    expect(await database.resources.get('saved')).toMatchObject({ id: 'saved', name: 'saved' })
    expect(await database.resourceSummaries.get('saved')).toMatchObject({ id: 'saved' })

    database.close()
    await database.delete()
  })

  it('preserves unique secondary-index constraints', async () => {
    const name = `native-core-unique-index-${crypto.randomUUID()}`
    const seed = new AppDatabase(name)
    await seed.open()
    seed.close()
    const { native, stores } = createNativeStore()
    const database = new AppDatabase(name)
    database.use(createAndroidNativeDexieCore({ enabled: () => true, native }))

    await database.communitySources.put({
      id: 'source-1',
      platform: 'discord',
      sourceKeyHash: 'same-hash',
      updatedAt: 1,
    } as never)
    await expect(
      database.communitySources.put({
        id: 'source-2',
        platform: 'discord',
        sourceKeyHash: 'same-hash',
        updatedAt: 2,
      } as never),
    ).rejects.toMatchObject({ name: 'ConstraintError' })
    expect(stores.get('communitySources')?.size).toBe(1)

    database.close()
    await database.delete()
  })

  it('commits restore-sized writes above the former 1,000-row limit atomically', async () => {
    const name = `native-core-large-batch-${crypto.randomUUID()}`
    const seed = new AppDatabase(name)
    await seed.open()
    seed.close()
    const { native, stores } = createNativeStore()
    const database = new AppDatabase(name)
    database.use(createAndroidNativeDexieCore({ enabled: () => true, native }))
    const rows = Array.from({ length: 1_001 }, (_, index) => ({
      id: `resource-${index}`,
      type: 'characterCard',
      name: `卡片 ${index}`,
    }))

    await database.resources.bulkPut(rows as never[])

    expect(stores.get('resources')?.size).toBe(1_001)
    expect(await database.resources.count()).toBe(1_001)
    database.close()
    await database.delete()
  })

  it('keeps the downstream Dexie core when native storage is not activated', async () => {
    const transaction = vi.fn(() => ({ abort() {} }))
    const downstream = { stack: 'dbcore', schema: {}, table: vi.fn(), transaction }
    const middleware = createAndroidNativeDexieCore({ enabled: () => false })
    const wrapped = middleware.create(downstream as never)
    expect(wrapped.transaction(['resources'], 'readonly')).toEqual({ abort: expect.any(Function) })
    expect(transaction).toHaveBeenCalledOnce()
  })

  it('keeps old native attachments intact if a new record commit fails', async () => {
    const name = `native-core-blob-rollback-${crypto.randomUUID()}`
    const seed = new AppDatabase(name)
    await seed.open()
    seed.close()
    const { stores, blobs, native, failNextNativeBatch, blobKey } = createNativeStore()
    const key = '"blob-card"'
    const oldBlob = new Blob(['old attachment'], { type: 'image/png' })
    const fieldPath = '$/originalBlob'
    stores.get('resources')!.set(key, {
      id: 'blob-card',
      originalBlob: {
        __srlAppDatabaseValueV1: 'blob',
        fieldPath,
        size: oldBlob.size,
        mimeType: oldBlob.type,
        sha256: `${oldBlob.size}`.padStart(64, '0'),
      },
    })
    blobs.set(blobKey('resources', key, fieldPath), oldBlob)
    expect(await native.readBlob('resources', key, fieldPath)).toBe(oldBlob)
    const database = new AppDatabase(name)
    database.use(createAndroidNativeDexieCore({ enabled: () => true, native }))
    const existing = await database.resources.get('blob-card')
    expect(existing && 'originalBlob' in existing ? await existing.originalBlob.text() : '').toBe(
      'old attachment',
    )

    failNextNativeBatch()
    await expect(
      database.transaction('rw', database.resources, async () => {
        await database.resources.put({
          ...(existing as unknown as Record<string, unknown>),
          originalBlob: new Blob(['replacement'], { type: 'image/png' }),
        } as never)
      }),
    ).rejects.toThrow('forced native commit failure')

    const afterFailure = await database.resources.get('blob-card')
    expect(
      afterFailure && 'originalBlob' in afterFailure ? await afterFailure.originalBlob.text() : '',
    ).toBe('old attachment')
    expect(blobs.get(blobKey('resources', key, fieldPath))?.size).toBe(oldBlob.size)
    expect([...blobs.keys()].some((storedKey) => storedKey.includes('__srl_tx_'))).toBe(false)

    database.close()
    await database.delete()
  })
})
