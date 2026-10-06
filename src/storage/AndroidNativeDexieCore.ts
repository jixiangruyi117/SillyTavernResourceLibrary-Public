import { Capacitor } from '@capacitor/core'
import type {
  DBCore,
  DBCoreCursor,
  DBCoreIndex,
  DBCoreMutateRequest,
  DBCorePutRequest,
  DBCoreTable,
  DBCoreTransaction,
} from 'dexie'

import {
  decodeAppDatabaseKey,
  decodeAppDatabaseValue,
  encodeAppDatabaseIndexes,
  encodeAppDatabaseKey,
  encodeAppDatabaseValue,
} from './AndroidAppDatabaseMigration'
import {
  APP_DATABASE_STORES,
  nativeAppDatabase,
  type NativeAppDatabaseBatchOperation,
  type NativeAppDatabaseStore,
} from './NativeAppDatabaseBridge'

type StoreChange = { key: IDBValidKey; value?: unknown; deleted: boolean; encoded?: boolean }

interface NativeTransaction extends DBCoreTransaction {
  readonly mode: 'readonly' | 'readwrite'
  readonly storeNames: string[]
  readonly _explicit: boolean
  mutatedParts?: unknown
  oncomplete: ((event: Event) => void) | null
  onabort: ((event: Event) => void) | null
  onerror: ((event: Event) => void) | null
  objectStore(name: string): {
    get(key: IDBValidKey): {
      onsuccess: (() => void) | null
      onerror: ((event: Event) => void) | null
      result?: unknown
    }
  }
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: unknown,
  ): void
  removeEventListener(type: string, listener: EventListenerOrEventListenerObject): void
  commit(): void
}

interface StoredEntry {
  key: IDBValidKey
  value: unknown
  encoded?: boolean
}

interface IndexedRow {
  key: IDBValidKey
  primaryKey: IDBValidKey
  value: unknown
  encoded?: boolean
}

interface KeyRange {
  type: number
  lower: IDBValidKey | null
  lowerOpen?: boolean
  upper: IDBValidKey | null
  upperOpen?: boolean
}

const STORE_SET = new Set<string>(APP_DATABASE_STORES)
let nativeDatabaseActive = false

export function activateAndroidNativeAppDatabase(): void {
  nativeDatabaseActive = true
}

export function deactivateAndroidNativeAppDatabase(): void {
  nativeDatabaseActive = false
}

export function isAndroidNativeAppDatabaseActive(): boolean {
  return nativeDatabaseActive
}

function compareKeys(left: IDBValidKey, right: IDBValidKey): number {
  const rank = (value: IDBValidKey): number => {
    if (typeof value === 'number') return 1
    if (value instanceof Date) return 2
    if (typeof value === 'string') return 3
    if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) return 4
    if (Array.isArray(value)) return 5
    throw new Error('IndexedDB key type cannot be compared')
  }
  const leftRank = rank(left)
  const rightRank = rank(right)
  if (leftRank !== rightRank) return leftRank < rightRank ? -1 : 1
  if (leftRank === 1)
    return (left as number) < (right as number) ? -1 : (left as number) > (right as number) ? 1 : 0
  if (leftRank === 2) {
    const a = (left as Date).getTime()
    const b = (right as Date).getTime()
    return a < b ? -1 : a > b ? 1 : 0
  }
  if (leftRank === 3)
    return (left as string) < (right as string) ? -1 : (left as string) > (right as string) ? 1 : 0
  if (leftRank === 4) {
    const bytes = (value: IDBValidKey) =>
      value instanceof ArrayBuffer
        ? new Uint8Array(value)
        : new Uint8Array(
            (value as ArrayBufferView).buffer,
            (value as ArrayBufferView).byteOffset,
            (value as ArrayBufferView).byteLength,
          )
    const a = bytes(left)
    const b = bytes(right)
    for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
      if (a[index] !== b[index]) return a[index]! < b[index]! ? -1 : 1
    }
    return a.length < b.length ? -1 : a.length > b.length ? 1 : 0
  }
  const a = left as IDBValidKey[]
  const b = right as IDBValidKey[]
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    const order = compareKeys(a[index]!, b[index]!)
    if (order) return order
  }
  return a.length < b.length ? -1 : a.length > b.length ? 1 : 0
}

function cloneValue<T>(value: T): T {
  if (typeof structuredClone === 'function') return structuredClone(value)
  return value
}

function matchesRange(key: IDBValidKey, range: KeyRange): boolean {
  if (range.type === 3) return true
  if (range.type === 4) return false
  if (range.type === 1) return range.lower !== null && compareKeys(key, range.lower) === 0
  const lower = range.lower == null ? 1 : compareKeys(key, range.lower)
  const upper = range.upper == null ? -1 : compareKeys(key, range.upper)
  return (
    (range.lower == null || lower > 0 || (lower === 0 && !range.lowerOpen)) &&
    (range.upper == null || upper < 0 || (upper === 0 && !range.upperOpen))
  )
}

function extractedKeys(index: DBCoreIndex, value: unknown, primaryKey: IDBValidKey): IDBValidKey[] {
  if (index.isPrimaryKey) return [primaryKey]
  const extracted = index.extractKey?.(value)
  if (extracted === undefined) return []
  if (index.multiEntry && Array.isArray(extracted)) {
    const distinct: IDBValidKey[] = []
    for (const key of extracted as IDBValidKey[]) {
      if (!distinct.some((existing) => compareKeys(existing, key) === 0)) distinct.push(key)
    }
    return distinct
  }
  return [extracted as IDBValidKey]
}

function collectStagedBlobs(
  value: unknown,
  store: NativeAppDatabaseStore,
  output: Array<{ store: NativeAppDatabaseStore; key: string; fieldPath: string }>,
): void {
  if (Array.isArray(value)) {
    for (const item of value) collectStagedBlobs(item, store, output)
    return
  }
  if (!value || typeof value !== 'object') return
  const record = value as Record<string, unknown>
  if (
    typeof record.fieldPath === 'string' &&
    typeof record.blobOwnerKey === 'string' &&
    ['blob', 'file', 'text', 'array-buffer', 'typed-array'].includes(
      String(record.__srlAppDatabaseValueV1),
    )
  ) {
    output.push({ store, key: record.blobOwnerKey, fieldPath: record.fieldPath })
  }
  for (const item of Object.values(record)) collectStagedBlobs(item, store, output)
}

class NativeTransactionFacade implements NativeTransaction {
  readonly storeNames: string[]
  readonly mode: 'readonly' | 'readwrite'
  readonly _explicit = true
  mutatedParts?: unknown
  oncomplete: ((event: Event) => void) | null = null
  onabort: ((event: Event) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  private readonly listeners = new Map<string, Set<EventListenerOrEventListenerObject>>()
  private readonly cache = new Map<string, Map<string, StoreChange>>()
  private readonly tables = new Map<string, Map<string, StoreChange>>()
  private readonly loaded = new Set<string>()
  private aborted = false
  private finished = false
  private activeRequests = 0
  private autoCompleteTimer?: ReturnType<typeof setTimeout>
  readonly native: typeof nativeAppDatabase
  private readonly emitComplete: (error?: unknown) => Promise<void>

  constructor(
    stores: string[],
    mode: 'readonly' | 'readwrite',
    emitComplete: (error?: unknown) => Promise<void>,
    native: typeof nativeAppDatabase,
  ) {
    this.storeNames = [...stores]
    this.mode = mode
    this.native = native
    this.emitComplete = emitComplete
  }

  addEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: unknown) {
    const listeners = this.listeners.get(type) ?? new Set()
    listeners.add(listener)
    this.listeners.set(type, listeners)
    const signal = (options as { signal?: AbortSignal } | undefined)?.signal
    if (signal)
      signal.addEventListener('abort', () => this.removeEventListener(type, listener), {
        once: true,
      })
  }

  objectStore(name: string) {
    if (!this.storeNames.includes(name)) throw new Error(`事务未包含数据表：${name}`)
    return {
      get: (key: IDBValidKey) => {
        const request: {
          onsuccess: (() => void) | null
          onerror: ((event: Event) => void) | null
          result?: unknown
        } = {
          onsuccess: null,
          onerror: null,
        }
        if (key === Number.NEGATIVE_INFINITY || key === Number.POSITIVE_INFINITY) {
          // Dexie's waitFor() issues get(-Infinity) requests as keep-alives while it awaits
          // native async work. Cancel any pending auto-close so a slow bridge round-trip
          // cannot close the readwrite transaction before Dexie resumes it.
          this.pauseAutoComplete()
          setTimeout(() => request.onsuccess?.(), 0)
          return request
        }
        void this.get(name, key).then(
          (value) => {
            request.result = value
            setTimeout(() => {
              request.onsuccess?.()
              this.scheduleAutoComplete()
            }, 0)
          },
          (error) => request.onerror?.(new ErrorEvent('error', { error }) as unknown as Event),
        )
        return request
      },
    }
  }

  removeEventListener(type: string, listener: EventListenerOrEventListenerObject) {
    this.listeners.get(type)?.delete(listener)
  }

  abort(): void {
    if (this.finished || this.aborted) return
    this.aborted = true
    this.finished = true
    if (this.autoCompleteTimer) clearTimeout(this.autoCompleteTimer)
    this.dispatch('abort')
  }

  commit(): void {
    if (this.autoCompleteTimer) clearTimeout(this.autoCompleteTimer)
    if (this.finished || this.aborted || this.mode !== 'readwrite') {
      if (!this.finished && !this.aborted) {
        this.finished = true
        this.dispatch('complete')
      }
      return
    }
    this.finished = true
    void this.emitComplete().then(
      () => this.dispatch('complete'),
      (error) => {
        this.aborted = true
        this.dispatch('error', error)
        this.dispatch('abort', error)
      },
    )
  }

  async load(store: string): Promise<Map<string, StoredEntry>> {
    if (!this.storeNames.includes(store)) throw new Error(`事务未包含数据表：${store}`)
    if (!STORE_SET.has(store)) throw new Error(`原生数据库不支持数据表：${store}`)
    if (this.loaded.has(store)) return this.entriesFor(store)
    const nativeStore = store as NativeAppDatabaseStore
    let afterKey: string | undefined
    const entries = this.cacheFor(store)
    while (true) {
      const page = await this.native.getRecords(nativeStore, afterKey, 500)
      for (const row of page.rows) {
        const key = decodeAppDatabaseKey(row.key)
        // Keep blob descriptors encoded while scanning indexes. Decoding every row here would
        // materialize the entire resource archive (potentially gigabytes) just to find matches.
        entries.set(row.key, { key, value: row.value, deleted: false, encoded: true })
      }
      if (!page.nextKey) break
      afterKey = page.nextKey
    }
    this.loaded.add(store)
    return this.entriesFor(store)
  }

  async get(store: string, key: IDBValidKey): Promise<unknown> {
    if (!this.storeNames.includes(store)) throw new Error(`事务未包含数据表：${store}`)
    const token = encodeAppDatabaseKey(key)
    const changes = this.changesFor(store)
    const staged = changes.get(token)
    if (staged) {
      return staged.deleted ? undefined : cloneValue(staged.value)
    }
    const cached = this.cacheFor(store).get(token)
    if (cached) {
      if (cached.deleted) return undefined
      if (cached.encoded) {
        const decoded = await decodeAppDatabaseValue(
          cached.value,
          store as NativeAppDatabaseStore,
          token,
          this.native,
        )
        this.cacheFor(store).set(token, { ...cached, value: decoded, encoded: false })
        return cloneValue(decoded)
      }
      return cloneValue(cached.value)
    }
    const nativeStore = store as NativeAppDatabaseStore
    const value = await this.native.getRecord(nativeStore, token)
    if (value === undefined) return undefined
    const decoded = await decodeAppDatabaseValue(value, nativeStore, token, this.native)
    this.cacheFor(store).set(token, { key, value: decoded, deleted: false, encoded: false })
    return cloneValue(decoded)
  }

  async queryIndex(
    store: string,
    index: DBCoreIndex,
    range: KeyRange,
    direction: string,
  ): Promise<IndexedRow[]> {
    if (!index.name || index.isPrimaryKey) throw new Error('原生次级索引查询缺少索引名')
    const exactKey =
      range.type === 1 && range.lower !== null ? encodeAppDatabaseKey(range.lower) : undefined
    const nativeRows = await this.native.getIndexEntries(
      store as NativeAppDatabaseStore,
      index.name,
      exactKey,
    )
    const changed = this.changesFor(store)
    const rows: IndexedRow[] = []
    for (const row of nativeRows) {
      const primaryKey = decodeAppDatabaseKey(row.primaryKey)
      if (changed.has(row.primaryKey)) continue
      const key = decodeAppDatabaseKey(row.indexKey)
      if (matchesRange(key, range)) rows.push({ key, primaryKey, value: undefined, encoded: true })
    }
    for (const change of changed.values()) {
      if (change.deleted) continue
      for (const key of extractedKeys(index, change.value, change.key)) {
        if (matchesRange(key, range))
          rows.push({ key, primaryKey: change.key, value: change.value, encoded: false })
      }
    }
    const reverse = direction.startsWith('prev')
    rows.sort((left, right) => {
      const byIndex = compareKeys(left.key, right.key)
      const byPrimary = byIndex || compareKeys(left.primaryKey, right.primaryKey)
      return reverse ? -byPrimary : byPrimary
    })
    if (direction.endsWith('unique')) {
      const unique: IndexedRow[] = []
      for (const row of rows) {
        if (!unique.length || compareKeys(unique.at(-1)!.key, row.key) !== 0) unique.push(row)
      }
      return unique
    }
    return rows
  }

  scheduleAutoComplete(): void {
    if (this.finished || this.aborted || this.activeRequests > 0) return
    if (this.autoCompleteTimer) clearTimeout(this.autoCompleteTimer)
    this.autoCompleteTimer = setTimeout(() => this.commit(), 0)
  }

  pauseAutoComplete(): void {
    if (this.autoCompleteTimer) clearTimeout(this.autoCompleteTimer)
    this.autoCompleteTimer = undefined
  }

  async runRequest<T>(operation: () => Promise<T>): Promise<T> {
    this.pauseAutoComplete()
    this.activeRequests += 1
    try {
      return await operation()
    } finally {
      this.activeRequests -= 1
      if (this.activeRequests === 0) this.scheduleAutoComplete()
    }
  }

  entriesFor(store: string): Map<string, StoredEntry> {
    const entries = new Map<string, StoredEntry>()
    const tokens = new Set([...this.cacheFor(store).keys(), ...this.changesFor(store).keys()])
    for (const token of tokens) {
      const change = this.changesFor(store).get(token) ?? this.cacheFor(store).get(token)!
      if (!change.deleted)
        entries.set(token, { key: change.key, value: change.value, encoded: change.encoded })
    }
    return entries
  }

  cacheFor(store: string): Map<string, StoreChange> {
    let cache = this.cache.get(store)
    if (!cache) {
      cache = new Map()
      this.cache.set(store, cache)
    }
    return cache
  }

  changesFor(store: string): Map<string, StoreChange> {
    let changes = this.tables.get(store)
    if (!changes) {
      changes = new Map()
      this.tables.set(store, changes)
    }
    return changes
  }

  private dispatch(type: string, error?: unknown): void {
    const event = new Event(type)
    if (error !== undefined) Object.defineProperty(event, 'error', { value: error })
    const handler =
      type === 'complete' ? this.oncomplete : type === 'abort' ? this.onabort : this.onerror
    handler?.(event)
    for (const listener of this.listeners.get(type) ?? []) {
      if (typeof listener === 'function') listener.call(this, event)
      else listener.handleEvent(event)
    }
  }
}

function getCursorRows(
  entries: Map<string, StoredEntry>,
  index: DBCoreIndex,
  range: KeyRange,
  direction: string,
): Array<{ key: IDBValidKey; primaryKey: IDBValidKey; value: unknown; encoded?: boolean }> {
  const rows: Array<{
    key: IDBValidKey
    primaryKey: IDBValidKey
    value: unknown
    encoded?: boolean
  }> = []
  for (const entry of entries.values()) {
    for (const key of extractedKeys(index, entry.value, entry.key)) {
      if (matchesRange(key, range))
        rows.push({ key, primaryKey: entry.key, value: entry.value, encoded: entry.encoded })
    }
  }
  const reverse = direction.startsWith('prev')
  rows.sort((left, right) => {
    const byIndex = compareKeys(left.key, right.key)
    const byPrimary = byIndex || compareKeys(left.primaryKey, right.primaryKey)
    return reverse ? -byPrimary : byPrimary
  })
  if (direction.endsWith('unique')) {
    const unique: typeof rows = []
    let previous: IDBValidKey | undefined
    for (const row of rows) {
      if (previous === undefined || compareKeys(previous, row.key) !== 0) unique.push(row)
      previous = row.key
    }
    return unique
  }
  return rows
}

function createCursor(
  trans: DBCoreTransaction,
  rows: Array<{ key: IDBValidKey; primaryKey: IDBValidKey; value: unknown; encoded?: boolean }>,
  values: boolean,
  reverse: boolean,
  decode: (value: unknown, row: (typeof rows)[number]) => Promise<unknown>,
  nativeTransaction: NativeTransactionFacade,
): DBCoreCursor {
  nativeTransaction.pauseAutoComplete()
  let position = 0
  let done = rows.length === 0
  let callback: (() => void) | undefined
  let resolveIteration: ((value?: unknown) => void) | undefined
  const cursor: DBCoreCursor = {
    trans,
    get key() {
      return rows[position]?.key
    },
    get primaryKey() {
      return rows[position]?.primaryKey
    },
    get value() {
      return values ? rows[position]?.value : undefined
    },
    get done() {
      return done
    },
    start(onNext) {
      callback = onNext
      return new Promise((resolve) => {
        resolveIteration = resolve
        queueMicrotask(run)
      })
    },
    continue(key) {
      if (done) return
      position += 1
      if (key !== undefined) {
        while (
          position < rows.length &&
          (reverse
            ? compareKeys(rows[position]!.key, key) >= 0
            : compareKeys(rows[position]!.key, key) <= 0)
        )
          position += 1
      }
      queueMicrotask(run)
    },
    continuePrimaryKey(key, primaryKey) {
      if (done) return
      position += 1
      while (
        position < rows.length &&
        (reverse
          ? compareKeys(rows[position]!.key, key) > 0 ||
            (compareKeys(rows[position]!.key, key) === 0 &&
              compareKeys(rows[position]!.primaryKey, primaryKey) >= 0)
          : compareKeys(rows[position]!.key, key) < 0 ||
            (compareKeys(rows[position]!.key, key) === 0 &&
              compareKeys(rows[position]!.primaryKey, primaryKey) <= 0))
      )
        position += 1
      queueMicrotask(run)
    },
    advance(count) {
      if (done) return
      position += Math.max(1, count)
      queueMicrotask(run)
    },
    stop(value) {
      if (done && resolveIteration === undefined) return
      done = true
      nativeTransaction.scheduleAutoComplete()
      resolveIteration?.(value)
      resolveIteration = undefined
    },
    fail(error) {
      done = true
      // Dexie's cursor consumer owns the promise rejection through this method.
      resolveIteration?.(Promise.reject(error))
      resolveIteration = undefined
    },
    async next() {
      if (done) return cursor
      await new Promise<void>((resolve, reject) => {
        const previous = callback
        callback = () => {
          try {
            previous?.()
            resolve()
          } catch (error) {
            reject(error)
          }
        }
        if (!resolveIteration) resolveIteration = () => resolve()
        queueMicrotask(run)
      })
      return cursor
    },
  }

  async function run(): Promise<void> {
    if (done) return
    if (position >= rows.length) {
      done = true
      nativeTransaction.scheduleAutoComplete()
      resolveIteration?.()
      resolveIteration = undefined
      return
    }
    try {
      if (values && rows[position]!.encoded) {
        rows[position]!.value = await decode(rows[position]!.value, rows[position]!)
        rows[position]!.encoded = false
      }
      callback?.()
    } catch (error) {
      cursor.fail(error as Error)
    }
  }
  return cursor
}

async function applyMutations(
  trans: NativeTransactionFacade,
  store: string,
  schema: DBCoreTable['schema'],
  request: DBCoreMutateRequest,
) {
  if (trans.mode !== 'readwrite') throw new Error('只读事务不能写入')
  const changes = trans.changesFor(store)
  const failures: Record<number, Error> = {}
  const results: unknown[] = []
  let lastResult: unknown
  const putOne = async (value: unknown, key?: IDBValidKey, index?: number) => {
    const actualKey = key ?? schema.primaryKey.extractKey?.(value)
    if (actualKey === undefined) throw new Error(`数据表 ${store} 缺少主键`)
    const token = encodeAppDatabaseKey(actualKey)
    if (request.type === 'add' && (await trans.get(store, actualKey)) !== undefined) {
      failures[index ?? 0] = new DOMException('主键已存在', 'ConstraintError')
      return
    }
    if (
      request.type === 'put' &&
      request.upsert === false &&
      (await trans.get(store, actualKey)) === undefined
    )
      return
    const uniqueIndexes = schema.indexes.filter(
      (candidate) => candidate.unique && !candidate.isPrimaryKey,
    )
    if (uniqueIndexes.length) {
      for (const uniqueIndex of uniqueIndexes) {
        const candidateKeys = extractedKeys(uniqueIndex, value, actualKey)
        if (!uniqueIndex.name) continue
        for (const candidateKey of candidateKeys) {
          const encodedIndexKey = encodeAppDatabaseKey(candidateKey)
          const existing = await trans.native.getIndexEntries(
            store as NativeAppDatabaseStore,
            uniqueIndex.name,
            encodedIndexKey,
          )
          const pending = trans.changesFor(store)
          if (
            existing.some((entry) => {
              if (entry.primaryKey === token) return false
              return !pending.has(entry.primaryKey)
            })
          ) {
            throw new DOMException(`唯一索引 ${uniqueIndex.name} 已存在相同值`, 'ConstraintError')
          }
          for (const [pendingKey, change] of pending) {
            if (change.deleted || pendingKey === token) continue
            if (
              extractedKeys(uniqueIndex, change.value, change.key).some(
                (key) => compareKeys(key, candidateKey) === 0,
              )
            ) {
              throw new DOMException(`唯一索引 ${uniqueIndex.name} 已存在相同值`, 'ConstraintError')
            }
          }
        }
      }
    }
    changes.set(token, { key: actualKey, value: cloneValue(value), deleted: false })
    lastResult = actualKey
    results.push(actualKey)
  }

  if (request.type === 'add' || request.type === 'put') {
    const putRequest = request as DBCorePutRequest
    if (putRequest.updates) {
      for (let index = 0; index < putRequest.updates.keys.length; index += 1) {
        const key = putRequest.updates.keys[index] as IDBValidKey
        const current = (await trans.get(store, key)) as Record<string, unknown> | undefined
        if (!current) continue
        const updated = { ...current }
        for (const [path, value] of Object.entries(putRequest.updates.changeSpecs[index] ?? {})) {
          const parts = path.split('.')
          let target = updated
          for (const part of parts.slice(0, -1)) {
            const nested = target[part]
            if (!nested || typeof nested !== 'object') target[part] = {}
            target = target[part] as Record<string, unknown>
          }
          target[parts.at(-1)!] = value
        }
        await putOne(updated, key, index)
      }
    } else if (putRequest.criteria && putRequest.changeSpec) {
      const entries = await trans.load(store)
      const index = putRequest.criteria.index
        ? schema.getIndexByKeyPath(putRequest.criteria.index)
        : schema.primaryKey
      if (!index) throw new Error(`数据表 ${store} 不存在指定索引`)
      let indexOffset = 0
      for (const entry of entries.values()) {
        if (
          !extractedKeys(index, entry.value, entry.key).some((key) =>
            matchesRange(key, putRequest.criteria!.range),
          )
        )
          continue
        const updated = { ...(entry.value as Record<string, unknown>) }
        for (const [path, value] of Object.entries(putRequest.changeSpec)) {
          const parts = path.split('.')
          let target = updated
          for (const part of parts.slice(0, -1)) {
            const nested = target[part]
            if (!nested || typeof nested !== 'object') target[part] = {}
            target = target[part] as Record<string, unknown>
          }
          target[parts.at(-1)!] = value
        }
        await putOne(updated, entry.key, indexOffset++)
      }
    } else {
      for (let index = 0; index < request.values.length; index += 1) {
        await putOne(request.values[index], request.keys?.[index] as IDBValidKey | undefined, index)
      }
    }
  } else if (request.type === 'delete') {
    if (request.criteria) {
      const entries = await trans.load(store)
      const index = request.criteria.index
        ? schema.getIndexByKeyPath(request.criteria.index)
        : schema.primaryKey
      if (!index) throw new Error(`数据表 ${store} 不存在指定索引`)
      for (const entry of entries.values()) {
        if (
          !extractedKeys(index, entry.value, entry.key).some((key) =>
            matchesRange(key, request.criteria!.range),
          )
        )
          continue
        changes.set(encodeAppDatabaseKey(entry.key), { key: entry.key, deleted: true })
        lastResult = entry.key
      }
    } else {
      for (const key of request.keys) {
        changes.set(encodeAppDatabaseKey(key), { key, deleted: true })
        lastResult = key
      }
    }
  } else {
    const entries = await trans.load(store)
    for (const entry of entries.values()) {
      const primaryKey = schema.primaryKey.extractKey?.(entry.value) as IDBValidKey
      if (matchesRange(primaryKey, request.range)) {
        changes.set(encodeAppDatabaseKey(primaryKey), { key: primaryKey, deleted: true })
        lastResult = primaryKey
      }
    }
  }
  return { numFailures: Object.keys(failures).length, failures, results, lastResult }
}

/** DBCore backend used only after Android's per-store migration has been verified. */
export function createAndroidNativeDexieCore(options: {
  enabled: () => boolean
  native?: typeof nativeAppDatabase
}) {
  const native = options.native ?? nativeAppDatabase
  return {
    stack: 'dbcore' as const,
    level: 100,
    name: 'AndroidNativeAppDatabase',
    create(downstream: DBCore): DBCore {
      const txByFacade = new WeakMap<object, NativeTransactionFacade>()
      const core: DBCore = {
        ...downstream,
        transaction(stores, mode) {
          if (!options.enabled()) return downstream.transaction(stores, mode)
          const facade = new NativeTransactionFacade(
            stores,
            mode,
            async () => {
              const operations: NativeAppDatabaseBatchOperation[] = []
              const stagedBlobs: Array<{
                store: NativeAppDatabaseStore
                key: string
                fieldPath: string
              }> = []
              try {
                for (const store of stores) {
                  const changes = txByFacade.get(facade)?.changesFor(store)
                  if (!changes?.size) continue
                  const tableSchema = downstream.table(store).schema
                  const puts: Array<{
                    key: string
                    value: Record<string, unknown>
                    indexes?: ReturnType<typeof encodeAppDatabaseIndexes>
                  }> = []
                  const deletes: string[] = []
                  for (const [key, change] of changes) {
                    if (change.deleted) deletes.push(key)
                    else {
                      const blobOwnerKey = `__srl_tx_${crypto.randomUUID()}`
                      const encoded = await encodeAppDatabaseValue(
                        change.value,
                        store as NativeAppDatabaseStore,
                        key,
                        native,
                        blobOwnerKey,
                      )
                      if (!encoded || typeof encoded !== 'object' || Array.isArray(encoded))
                        throw new Error(`原生数据库记录必须是对象：${store}`)
                      collectStagedBlobs(encoded, store as NativeAppDatabaseStore, stagedBlobs)
                      puts.push({
                        key,
                        value: encoded as Record<string, unknown>,
                        indexes: encodeAppDatabaseIndexes(change.value, tableSchema.indexes),
                      })
                    }
                  }
                  if (puts.length)
                    operations.push({
                      type: 'put',
                      store: store as NativeAppDatabaseStore,
                      rows: puts,
                    })
                  if (deletes.length)
                    operations.push({
                      type: 'delete',
                      store: store as NativeAppDatabaseStore,
                      keys: deletes,
                    })
                }
                if (operations.length)
                  await native.applyBatch(operations, { requireActiveLibrary: true })
              } catch (error) {
                await Promise.all(
                  stagedBlobs.map(({ store, key, fieldPath }) =>
                    native.deleteBlob(store, key, fieldPath).catch(() => undefined),
                  ),
                )
                throw error
              }
            },
            native,
          )
          txByFacade.set(facade, facade)
          return facade as unknown as ReturnType<DBCore['transaction']>
        },
        table(name) {
          const downstreamTable = downstream.table(name)
          if (!STORE_SET.has(name)) return downstreamTable
          const table: DBCoreTable = {
            ...downstreamTable,
            async get(request) {
              if (!options.enabled()) return downstreamTable.get(request)
              const trans = request.trans as NativeTransactionFacade
              return trans.runRequest(() => trans.get(name, request.key))
            },
            async getMany(request) {
              if (!options.enabled()) return downstreamTable.getMany(request)
              const trans = request.trans as NativeTransactionFacade
              return trans.runRequest(() =>
                Promise.all(request.keys.map((key) => trans.get(name, key))),
              )
            },
            async query(request) {
              if (!options.enabled()) return downstreamTable.query(request)
              const trans = request.trans as NativeTransactionFacade
              return trans.runRequest(async () => {
                if (!request.query.index.isPrimaryKey && request.query.index.name) {
                  let rows = await trans.queryIndex(
                    name,
                    request.query.index,
                    request.query.range,
                    request.direction ?? 'next',
                  )
                  if (request.limit !== undefined) rows = rows.slice(0, request.limit)
                  const result =
                    request.values === false
                      ? rows.map((row) => cloneValue(row.primaryKey))
                      : await Promise.all(
                          rows.map(async (row) =>
                            cloneValue(
                              row.encoded ? await trans.get(name, row.primaryKey) : row.value,
                            ),
                          ),
                        )
                  return { result }
                }
                const entries = await trans.load(name)
                const direction = request.direction ?? 'next'
                let rows = getCursorRows(
                  entries,
                  request.query.index,
                  request.query.range,
                  direction,
                )
                if (request.limit !== undefined) rows = rows.slice(0, request.limit)
                const result =
                  request.values === false
                    ? rows.map((row) => cloneValue(row.primaryKey))
                    : await Promise.all(
                        rows.map(async (row) =>
                          cloneValue(
                            row.encoded
                              ? await decodeAppDatabaseValue(
                                  row.value,
                                  name as NativeAppDatabaseStore,
                                  encodeAppDatabaseKey(row.primaryKey),
                                  trans.native,
                                )
                              : row.value,
                          ),
                        ),
                      )
                return { result }
              })
            },
            async count(request) {
              if (!options.enabled()) return downstreamTable.count(request)
              const trans = request.trans as NativeTransactionFacade
              return trans.runRequest(async () => {
                if (!request.query.index.isPrimaryKey && request.query.index.name) {
                  return (
                    await trans.queryIndex(name, request.query.index, request.query.range, 'next')
                  ).length
                }
                const entries = await trans.load(name)
                return getCursorRows(entries, request.query.index, request.query.range, 'next')
                  .length
              })
            },
            async mutate(request) {
              if (!options.enabled()) return downstreamTable.mutate(request)
              const trans = request.trans as NativeTransactionFacade
              return trans.runRequest(() =>
                applyMutations(trans, name, downstreamTable.schema, request),
              )
            },
            async openCursor(request) {
              if (!options.enabled()) return downstreamTable.openCursor(request)
              const trans = request.trans as NativeTransactionFacade
              trans.pauseAutoComplete()
              if (!request.query.index.isPrimaryKey && request.query.index.name) {
                const rows = await trans.queryIndex(
                  name,
                  request.query.index,
                  request.query.range,
                  request.reverse
                    ? request.unique
                      ? 'prevunique'
                      : 'prev'
                    : request.unique
                      ? 'nextunique'
                      : 'next',
                )
                if (!rows.length) {
                  trans.scheduleAutoComplete()
                  return null
                }
                return rows.length
                  ? createCursor(
                      request.trans,
                      rows,
                      request.values !== false,
                      request.reverse ?? false,
                      async (value, row) => (row.encoded ? trans.get(name, row.primaryKey) : value),
                      trans,
                    )
                  : null
              }
              const entries = await trans.load(name)
              const direction = request.reverse
                ? request.unique
                  ? 'prevunique'
                  : 'prev'
                : request.unique
                  ? 'nextunique'
                  : 'next'
              const rows = getCursorRows(
                entries,
                request.query.index,
                request.query.range,
                direction,
              )
              if (!rows.length) {
                trans.scheduleAutoComplete()
                return null
              }
              return rows.length
                ? createCursor(
                    request.trans,
                    rows,
                    request.values !== false,
                    request.reverse ?? false,
                    (value, row) =>
                      decodeAppDatabaseValue(
                        value,
                        name as NativeAppDatabaseStore,
                        encodeAppDatabaseKey(row.primaryKey),
                        trans.native,
                      ),
                    trans,
                  )
                : null
            },
          }
          return table
        },
      }
      return core
    },
  }
}

export function canUseAndroidNativeDexieCore(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android'
}
