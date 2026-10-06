import Dexie from 'dexie'

import {
  APP_DATABASE_STORES,
  nativeAppDatabase,
  type NativeAppDatabaseIndexValue,
  type NativeAppDatabaseStore,
} from './NativeAppDatabaseBridge'

const CHECKPOINT_PREFIX = 'migration:appdb:v1:'
const KEY_DATE_TAG = '__srlIdbDateKeyV1'
const KEY_BINARY_TAG = '__srlIdbBinaryKeyV1'
const VALUE_TAG = '__srlAppDatabaseValueV1'
const LARGE_STRING_THRESHOLD = 256 * 1024
const MAX_BATCH_JSON_CHARS = 768 * 1024
// The native bridge accepts up to 100 records per transaction. Keep the existing
// byte-size guard below as the second bound, while reducing bridge round trips on
// first-run migration of libraries with many small records.
const DEFAULT_BATCH_SIZE = 100

interface EncodedBlobValue {
  [VALUE_TAG]: 'blob' | 'file' | 'text' | 'array-buffer' | 'typed-array'
  fieldPath: string
  size: number
  sha256: string
  mimeType: string
  viewType?: string
  name?: string
  lastModified?: number
  blobOwnerKey?: string
}

interface StoreCheckpoint {
  version: 1
  status: 'copying' | 'failed' | 'verified'
  sourceCount: number
  copiedCount: number
  lastKey?: string
  updatedAt: number
  error?: string
}

export interface AppDatabaseMigrationProgress {
  store: NativeAppDatabaseStore
  copied: number
  total: number
  status: StoreCheckpoint['status']
}

export interface AppDatabaseMigrationSummary {
  stores: AppDatabaseMigrationProgress[]
  copied: number
  total: number
}

type NativeMigrationPort = Pick<
  typeof nativeAppDatabase,
  | 'status'
  | 'getState'
  | 'putState'
  | 'getRecordsByKeys'
  | 'putRecordsWithState'
  | 'writeBlob'
  | 'readBlob'
>

export function encodeAppDatabaseKey(key: IDBValidKey): string {
  const encode = (part: IDBValidKey): unknown => {
    if (part instanceof Date) return { [KEY_DATE_TAG]: part.toISOString() }
    if (part instanceof ArrayBuffer) return { [KEY_BINARY_TAG]: Array.from(new Uint8Array(part)) }
    if (Array.isArray(part)) return part.map(encode)
    if (typeof part === 'string' || (typeof part === 'number' && Number.isFinite(part))) return part
    throw new Error('IndexedDB 主键类型不受支持')
  }
  const result = JSON.stringify(encode(key))
  if (!result || result.length > 2048) throw new Error('IndexedDB 主键超出原生存储范围')
  return result
}

export function decodeAppDatabaseKey(encoded: string): IDBValidKey {
  const decode = (part: unknown): IDBValidKey => {
    if (Array.isArray(part)) return part.map(decode)
    if (part && typeof part === 'object') {
      const record = part as Record<string, unknown>
      if (typeof record[KEY_DATE_TAG] === 'string') return new Date(record[KEY_DATE_TAG])
      if (Array.isArray(record[KEY_BINARY_TAG])) {
        return new Uint8Array(record[KEY_BINARY_TAG] as number[]).buffer
      }
    }
    if (typeof part === 'string' || (typeof part === 'number' && Number.isFinite(part))) return part
    throw new Error('IndexedDB 迁移检查点中的主键无效')
  }
  return decode(JSON.parse(encoded))
}

export function encodeAppDatabaseIndexes(
  value: unknown,
  indexes: Array<{
    name: string | null
    keyPath?: string | string[] | null
    multiEntry?: boolean
    multi?: boolean
  }>,
): NativeAppDatabaseIndexValue[] {
  const readPath = (path: string): unknown =>
    path.split('.').reduce<unknown>((current, part) => {
      if (!current || typeof current !== 'object') return undefined
      return (current as Record<string, unknown>)[part]
    }, value)
  const result: NativeAppDatabaseIndexValue[] = []
  for (const index of indexes) {
    if (!index.name || !index.keyPath) continue
    const extracted = Array.isArray(index.keyPath)
      ? index.keyPath.map(readPath)
      : readPath(index.keyPath)
    const candidates =
      (index.multiEntry ?? index.multi) && Array.isArray(extracted) ? extracted : [extracted]
    const keys: string[] = []
    for (const candidate of candidates) {
      if (candidate === undefined || candidate === null) continue
      try {
        const encoded = encodeAppDatabaseKey(candidate as IDBValidKey)
        if (!keys.includes(encoded)) keys.push(encoded)
      } catch {
        // IndexedDB silently omits values that are not valid index keys.
      }
    }
    if (keys.length) result.push({ name: index.name, keys })
  }
  return result
}

function keyPathValue(value: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((current, part) => {
    if (current === null || typeof current !== 'object') return undefined
    return (current as Record<string, unknown>)[part]
  }, value)
}

function getPrimaryKey(value: unknown, keyPath: string | string[]): IDBValidKey {
  if (Array.isArray(keyPath)) {
    const key = keyPath.map((path) => keyPathValue(value, path))
    if (key.some((part) => part === undefined)) throw new Error('IndexedDB 复合主键字段缺失')
    return key as IDBValidKey
  }
  const key = keyPathValue(value, keyPath)
  if (
    typeof key !== 'string' &&
    typeof key !== 'number' &&
    !(key instanceof Date) &&
    !Array.isArray(key)
  ) {
    throw new Error('IndexedDB 主键类型不受支持')
  }
  return key as IDBValidKey
}

function fieldPath(parent: string, segment: string | number): string {
  return `${parent}/${String(segment).replaceAll('~', '~0').replaceAll('/', '~1')}`
}

function isEncodedBlobValue(value: unknown): value is EncodedBlobValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const candidate = value as Partial<EncodedBlobValue>
  return (
    ['blob', 'file', 'text', 'array-buffer', 'typed-array'].includes(candidate[VALUE_TAG] ?? '') &&
    typeof candidate.fieldPath === 'string' &&
    Number.isSafeInteger(candidate.size) &&
    typeof candidate.sha256 === 'string' &&
    typeof candidate.mimeType === 'string'
  )
}

function typedArrayBytes(value: ArrayBufferView): ArrayBuffer {
  const buffer = value.buffer
  if (!(buffer instanceof ArrayBuffer)) throw new Error('共享内存视图不能迁入原生数据库')
  return buffer.slice(value.byteOffset, value.byteOffset + value.byteLength)
}

export async function encodeAppDatabaseValue(
  value: unknown,
  store: NativeAppDatabaseStore,
  key: string,
  native: NativeMigrationPort = nativeAppDatabase,
  blobOwnerKey = key,
): Promise<unknown> {
  const ancestors = new WeakSet<object>()

  const visit = async (current: unknown, path: string): Promise<unknown> => {
    if (current === undefined) return { [VALUE_TAG]: 'undefined' }
    if (typeof current === 'bigint') return { [VALUE_TAG]: 'bigint', value: current.toString() }
    if (typeof current === 'number' && !Number.isFinite(current)) {
      return { [VALUE_TAG]: 'number', value: String(current) }
    }
    if (typeof current === 'function' || typeof current === 'symbol') {
      throw new Error('IndexedDB 记录包含无法迁移的值')
    }
    if (typeof current === 'string' && current.length > LARGE_STRING_THRESHOLD) {
      const blob = new Blob([current], { type: 'text/plain;charset=utf-8' })
      const stored = await native.writeBlob(store, key, path, blob, blobOwnerKey)
      return {
        [VALUE_TAG]: 'text',
        fieldPath: path,
        ...stored,
        ...(blobOwnerKey !== key ? { blobOwnerKey } : {}),
      }
    }
    if (current === null || typeof current !== 'object') return current

    if (current instanceof Blob) {
      const stored = await native.writeBlob(store, key, path, current, blobOwnerKey)
      const isFile = typeof File !== 'undefined' && current instanceof File
      return {
        [VALUE_TAG]: isFile ? 'file' : 'blob',
        fieldPath: path,
        ...stored,
        ...(blobOwnerKey !== key ? { blobOwnerKey } : {}),
        ...(isFile ? { name: current.name, lastModified: current.lastModified } : {}),
      }
    }
    if (current instanceof ArrayBuffer) {
      const stored = await native.writeBlob(
        store,
        blobOwnerKey,
        path,
        new Blob([current], { type: 'application/octet-stream' }),
        blobOwnerKey,
      )
      return {
        [VALUE_TAG]: 'array-buffer',
        fieldPath: path,
        ...stored,
        ...(blobOwnerKey !== key ? { blobOwnerKey } : {}),
      }
    }
    if (ArrayBuffer.isView(current)) {
      const stored = await native.writeBlob(
        store,
        blobOwnerKey,
        path,
        new Blob([typedArrayBytes(current)], { type: 'application/octet-stream' }),
        blobOwnerKey,
      )
      return {
        [VALUE_TAG]: 'typed-array',
        fieldPath: path,
        ...stored,
        ...(blobOwnerKey !== key ? { blobOwnerKey } : {}),
        viewType: current.constructor.name,
      }
    }
    if (current instanceof Date) return { [VALUE_TAG]: 'date', value: current.toISOString() }
    if (current instanceof RegExp)
      return { [VALUE_TAG]: 'regexp', source: current.source, flags: current.flags }

    if (ancestors.has(current)) throw new Error('IndexedDB 记录包含循环引用，已停止迁移')
    ancestors.add(current)
    try {
      if (Array.isArray(current)) {
        return Promise.all(current.map((item, index) => visit(item, fieldPath(path, index))))
      }
      if (current instanceof Map) {
        const entries = await Promise.all(
          [...current.entries()].map(async ([mapKey, mapValue], index) => [
            await visit(mapKey, fieldPath(path, `key-${index}`)),
            await visit(mapValue, fieldPath(path, `value-${index}`)),
          ]),
        )
        return { [VALUE_TAG]: 'map', entries }
      }
      if (current instanceof Set) {
        return {
          [VALUE_TAG]: 'set',
          values: await Promise.all(
            [...current].map((item, index) => visit(item, fieldPath(path, index))),
          ),
        }
      }
      const prototype = Object.getPrototypeOf(current)
      if (prototype !== Object.prototype && prototype !== null) {
        throw new Error(
          `IndexedDB 记录包含暂不支持的对象类型：${prototype?.constructor?.name ?? 'unknown'}`,
        )
      }
      if (Object.prototype.hasOwnProperty.call(current, VALUE_TAG)) {
        return {
          [VALUE_TAG]: 'object',
          entries: await Promise.all(
            Object.entries(current).map(async ([property, item]) => [
              property,
              await visit(item, fieldPath(path, property)),
            ]),
          ),
        }
      }
      const record: Record<string, unknown> = {}
      for (const [property, item] of Object.entries(current)) {
        record[property] = await visit(item, fieldPath(path, property))
      }
      return record
    } finally {
      ancestors.delete(current)
    }
  }

  return visit(value, '$')
}

export async function decodeAppDatabaseValue(
  value: unknown,
  store: NativeAppDatabaseStore,
  key: string,
  native: NativeMigrationPort = nativeAppDatabase,
): Promise<unknown> {
  const visit = async (current: unknown): Promise<unknown> => {
    if (Array.isArray(current)) return Promise.all(current.map(visit))
    if (!current || typeof current !== 'object') return current
    const tagged = current as Record<string, unknown>
    const kind = tagged[VALUE_TAG]
    if (kind === 'undefined') return undefined
    if (kind === 'bigint') return BigInt(String(tagged.value))
    if (kind === 'number') {
      if (tagged.value === 'NaN') return Number.NaN
      if (tagged.value === 'Infinity') return Number.POSITIVE_INFINITY
      if (tagged.value === '-Infinity') return Number.NEGATIVE_INFINITY
    }
    if (kind === 'date') return new Date(String(tagged.value))
    if (kind === 'regexp') return new RegExp(String(tagged.source), String(tagged.flags))
    if (kind === 'map') {
      const entries = await Promise.all(
        (tagged.entries as Array<[unknown, unknown]>).map(
          async ([mapKey, mapValue]): Promise<[unknown, unknown]> => [
            await visit(mapKey),
            await visit(mapValue),
          ],
        ),
      )
      return new Map(entries)
    }
    if (kind === 'set') return new Set(await Promise.all((tagged.values as unknown[]).map(visit)))
    if (kind === 'object') {
      const entries = tagged.entries as Array<[string, unknown]>
      const record: Record<string, unknown> = {}
      for (const [property, item] of entries) record[property] = await visit(item)
      return record
    }
    if (isEncodedBlobValue(current)) {
      const blob = await native.readBlob(store, current.blobOwnerKey ?? key, current.fieldPath)
      if (!blob || blob.size !== current.size || blob.type !== current.mimeType) {
        throw new Error(
          `原生数据库附件缺失或元数据不匹配（${store}/${current.blobOwnerKey ?? key}/${current.fieldPath}，期望 ${current.size}/${current.mimeType}，实际 ${blob?.size ?? 'missing'}/${blob?.type ?? ''}）`,
        )
      }
      if (kind === 'text') return blob.text()
      if (kind === 'array-buffer') return blob.arrayBuffer()
      if (kind === 'typed-array') {
        const buffer = await blob.arrayBuffer()
        const constructors: Record<string, (buffer: ArrayBuffer) => ArrayBufferView> = {
          Int8Array: (data) => new Int8Array(data),
          Uint8Array: (data) => new Uint8Array(data),
          Uint8ClampedArray: (data) => new Uint8ClampedArray(data),
          Int16Array: (data) => new Int16Array(data),
          Uint16Array: (data) => new Uint16Array(data),
          Int32Array: (data) => new Int32Array(data),
          Uint32Array: (data) => new Uint32Array(data),
          Float32Array: (data) => new Float32Array(data),
          Float64Array: (data) => new Float64Array(data),
          BigInt64Array: (data) => new BigInt64Array(data),
          BigUint64Array: (data) => new BigUint64Array(data),
          DataView: (data) => new DataView(data),
        }
        const constructor = constructors[String(current.viewType)]
        if (!constructor) throw new Error('原生数据库附件包含未知 TypedArray 类型')
        return constructor(buffer)
      }
      if (kind === 'file' && typeof File !== 'undefined') {
        return new File([blob], String(current.name), {
          type: current.mimeType,
          lastModified: Number(current.lastModified),
        })
      }
      return blob
    }
    const record: Record<string, unknown> = {}
    for (const [property, item] of Object.entries(tagged)) record[property] = await visit(item)
    return record
  }

  return visit(value)
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

export function canonicalizeAppDatabaseValue(value: unknown): string {
  return canonicalJson(value)
}

export class AndroidAppDatabaseMigrator {
  private readonly database: Dexie
  private readonly native: NativeMigrationPort
  private readonly isQuiesced: () => boolean
  private readonly batchSize: number

  constructor(options: {
    database: Dexie
    native?: NativeMigrationPort
    isQuiesced: () => boolean
    batchSize?: number
  }) {
    this.database = options.database
    this.native = options.native ?? nativeAppDatabase
    this.isQuiesced = options.isQuiesced
    this.batchSize = Math.max(1, Math.min(100, options.batchSize ?? DEFAULT_BATCH_SIZE))
  }

  async migrateAllStores(
    onProgress?: (progress: AppDatabaseMigrationProgress) => void,
  ): Promise<AppDatabaseMigrationSummary> {
    if (!this.isQuiesced()) throw new Error('迁移期间必须暂停应用数据库写入')
    const available = new Set(this.database.tables.map((table) => table.name))
    const stores = APP_DATABASE_STORES.filter((store) => available.has(store))
    const missing = APP_DATABASE_STORES.filter(
      (store) =>
        !available.has(store) && store !== 'cloudBackupJobs' && store !== 'cloudBackupOrphans',
    )
    if (missing.length) throw new Error(`IndexedDB 数据表未纳入迁移清单：${missing.join(', ')}`)

    const results: AppDatabaseMigrationProgress[] = []
    for (const store of stores) {
      if (!this.isQuiesced()) throw new Error('应用数据库已恢复写入，迁移已暂停')
      results.push(await this.migrateStore(store, onProgress))
    }
    return {
      stores: results,
      copied: results.reduce((sum, store) => sum + store.copied, 0),
      total: results.reduce((sum, store) => sum + store.total, 0),
    }
  }

  async migrateStore(
    storeName: NativeAppDatabaseStore,
    onProgress?: (progress: AppDatabaseMigrationProgress) => void,
  ): Promise<AppDatabaseMigrationProgress> {
    if (!APP_DATABASE_STORES.includes(storeName)) throw new Error('目标不是受支持的原生数据库表')
    if (!this.isQuiesced()) throw new Error('迁移期间必须暂停应用数据库写入')
    const table = this.database.table(storeName)
    if (!table) throw new Error(`IndexedDB 数据表不存在：${storeName}`)
    const sourceCount = await table.count()
    const stateKey = `${CHECKPOINT_PREFIX}${storeName}`
    const rawState = await this.native.getState(stateKey)
    let checkpoint = rawState ? (JSON.parse(rawState) as StoreCheckpoint) : undefined
    const nativeCount = (await this.native.status()).counts[storeName] ?? 0

    if (
      checkpoint?.status === 'verified' &&
      checkpoint.sourceCount === sourceCount &&
      nativeCount === sourceCount
    ) {
      return { store: storeName, copied: sourceCount, total: sourceCount, status: 'verified' }
    }
    if (!checkpoint && nativeCount > 0) {
      throw new Error(`原生表 ${storeName} 已有数据但没有迁移检查点；为避免覆盖，已停止`)
    }
    if (checkpoint && checkpoint.sourceCount !== sourceCount) {
      throw new Error(`IndexedDB 表 ${storeName} 在迁移期间发生变化；保留原数据并停止续传`)
    }
    if (!checkpoint) {
      checkpoint = {
        version: 1,
        status: 'copying',
        sourceCount,
        copiedCount: 0,
        updatedAt: Date.now(),
      }
    } else {
      checkpoint.status = 'copying'
      delete checkpoint.error
    }

    const primaryKey = table.schema.primKey
    const primaryIndex = primaryKey.name
    const keyPath = primaryKey.keyPath
    if (!keyPath) throw new Error(`IndexedDB 表 ${storeName} 使用了不支持的外置主键`)
    let copied = checkpoint.copiedCount
    let lastKey: IDBValidKey | undefined = checkpoint.lastKey
      ? decodeAppDatabaseKey(checkpoint.lastKey)
      : undefined
    onProgress?.({ store: storeName, copied, total: sourceCount, status: 'copying' })

    try {
      while (copied < sourceCount) {
        if (!this.isQuiesced()) throw new Error('应用数据库已恢复写入，迁移已暂停')
        const collection = this.database
          .table(storeName)
          .where(primaryIndex)
          .above(lastKey ?? Dexie.minKey)
        const values = await collection.limit(this.batchSize).toArray()
        if (values.length === 0) throw new Error('IndexedDB 游标提前结束，原数据保持不变')
        const rows: Array<{
          key: string
          value: Record<string, unknown>
          indexes?: NativeAppDatabaseIndexValue[]
        }> = []
        const sourceKeys: Array<{ encoded: string; nativeKey: string }> = []
        let chars = 0
        for (const value of values) {
          const sourceKey = getPrimaryKey(value, keyPath)
          const nativeKey = encodeAppDatabaseKey(sourceKey)
          const encodedValue = await encodeAppDatabaseValue(
            value,
            storeName,
            nativeKey,
            this.native,
          )
          if (!encodedValue || typeof encodedValue !== 'object' || Array.isArray(encodedValue)) {
            throw new Error(`IndexedDB 表 ${storeName} 包含非对象记录`)
          }
          const row = {
            key: nativeKey,
            value: encodedValue as Record<string, unknown>,
            indexes: encodeAppDatabaseIndexes(value, table.schema.indexes),
          }
          rows.push(row)
          sourceKeys.push({ encoded: encodeAppDatabaseKey(sourceKey), nativeKey })
          const rowChars = JSON.stringify(row).length
          if (rowChars > MAX_BATCH_JSON_CHARS) {
            throw new Error(`IndexedDB 表 ${storeName} 单条记录超过原生迁移批次上限`)
          }
          chars += rowChars
          if (chars > MAX_BATCH_JSON_CHARS && rows.length > 1) {
            rows.pop()
            sourceKeys.pop()
            break
          }
        }
        if (rows.length === 0) throw new Error('单条 IndexedDB 记录超过原生迁移批次上限')

        const nextCopied = copied + rows.length
        const nextLastKey = sourceKeys.at(-1)!.encoded
        checkpoint = {
          version: 1,
          status: 'copying',
          sourceCount,
          copiedCount: nextCopied,
          lastKey: nextLastKey,
          updatedAt: Date.now(),
        }
        await this.native.putRecordsWithState(storeName, rows, stateKey, JSON.stringify(checkpoint))
        const storedRows = await this.native.getRecordsByKeys(
          storeName,
          rows.map((row) => row.key),
        )
        const storedByKey = new Map(storedRows.map((row) => [row.key, row.value]))
        for (const row of rows) {
          const actual = storedByKey.get(row.key)
          if (!actual || canonicalJson(actual) !== canonicalJson(row.value)) {
            throw new Error(`原生数据库表 ${storeName} 读回校验失败`)
          }
        }
        copied = nextCopied
        lastKey = decodeAppDatabaseKey(nextLastKey)
        onProgress?.({ store: storeName, copied, total: sourceCount, status: 'copying' })
      }

      const verifiedCount = (await this.native.status()).counts[storeName] ?? 0
      if (copied !== sourceCount || verifiedCount !== sourceCount) {
        throw new Error(`原生数据库表 ${storeName} 记录数校验失败`)
      }
      checkpoint.status = 'verified'
      checkpoint.updatedAt = Date.now()
      delete checkpoint.error
      await this.native.putState(stateKey, JSON.stringify(checkpoint))
      const result = { store: storeName, copied, total: sourceCount, status: 'verified' as const }
      onProgress?.(result)
      return result
    } catch (error) {
      checkpoint.status = 'failed'
      checkpoint.error = (error instanceof Error ? error.message : String(error)).slice(0, 512)
      checkpoint.updatedAt = Date.now()
      await this.native.putState(stateKey, JSON.stringify(checkpoint)).catch(() => undefined)
      onProgress?.({ store: storeName, copied, total: sourceCount, status: 'failed' })
      throw error
    }
  }
}
