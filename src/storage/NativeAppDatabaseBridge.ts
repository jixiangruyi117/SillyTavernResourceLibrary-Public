import { Capacitor, registerPlugin } from '@capacitor/core'

import { nativeBytesToBase64 } from '../core/NativeStreamTransfer'

export interface NativeAppDatabaseStatus {
  schemaVersion: number
  counts: Record<string, number>
}

export interface NativeAppDatabaseIndexValue {
  name: string
  keys: string[]
}

interface NativeAppDatabasePlugin {
  getStatus(): Promise<NativeAppDatabaseStatus>
  getRecord(options: { store: string; key: string }): Promise<{ found: boolean; value?: unknown }>
  getRecords(options: { store: string; afterKey?: string; limit: number }): Promise<{
    rows: Array<{ key: string; value: Record<string, unknown> }>
    count: number
    nextKey?: string | null
  }>
  getRecordsByKeys(options: { store: string; keys: string[] }): Promise<{
    rows: Array<{ key: string; value: Record<string, unknown> }>
  }>
  getIndexEntries(options: { store: string; indexName: string; indexKey?: string }): Promise<{
    rows: Array<{ indexKey: string; primaryKey: string }>
  }>
  putRecords(options: {
    store: string
    rows: Array<{
      key: string
      value: Record<string, unknown>
      indexes?: NativeAppDatabaseIndexValue[]
    }>
  }): Promise<{ written: number }>
  putRecordsWithState(options: {
    store: string
    rows: Array<{
      key: string
      value: Record<string, unknown>
      indexes?: NativeAppDatabaseIndexValue[]
    }>
    stateKey: string
    stateValue: string
  }): Promise<{ written: number }>
  applyBatch(options: {
    operations: NativeAppDatabaseBatchOperation[]
    requireActiveLibrary?: boolean
  }): Promise<{ applied: number }>
  deleteRecords(options: { store: string; keys: string[] }): Promise<{ deleted: number }>
  clearStore(options: { store: string }): Promise<void>
  clearIndexes(options: { store: string }): Promise<void>
  getState(options: { key: string }): Promise<{ found: boolean; value?: string }>
  putState(options: { key: string; value: string }): Promise<void>
  beginBlob(options: {
    store: string
    key: string
    fieldPath: string
    size: number
    mimeType: string
  }): Promise<{ token: string; offset: number; alreadyStored: boolean }>
  appendBlob(options: { token: string; offset: number; data: string }): Promise<{ offset: number }>
  completeBlob(options: { token: string }): Promise<{
    store: string
    key: string
    fieldPath: string
    mimeType: string
    size: number
    sha256: string
  }>
  readBlobChunk(options: {
    store: string
    key: string
    fieldPath: string
    offset: number
    length: number
  }): Promise<{
    found: boolean
    blob?: {
      mimeType: string
      size: number
      sha256: string
      offset: number
      data: string
      eof: boolean
    }
  }>
  deleteBlob(options: { store: string; key: string; fieldPath: string }): Promise<void>
}

export type NativeAppDatabaseBatchOperation =
  | {
      type: 'put'
      store: NativeAppDatabaseStore
      rows: Array<{
        key: string
        value: Record<string, unknown>
        indexes?: NativeAppDatabaseIndexValue[]
      }>
    }
  | { type: 'delete'; store: NativeAppDatabaseStore; keys: string[] }
  | { type: 'clear'; store: NativeAppDatabaseStore }

const databasePlugin = registerPlugin<NativeAppDatabasePlugin>('NativeAppDatabase')
export const APP_DATABASE_STORES = [
  'resources',
  'resourceSummaries',
  'resourceListSummaries',
  'resourceVersions',
  'resourceVersionSummaries',
  'categories',
  'settings',
  'backupRecords',
  'externalApps',
  'externalAppRuntimes',
  'externalAppData',
  'externalAppDrafts',
  'frontendWorkshopProjects',
  'frontendWorkshopProjectLastGood',
  'frontendWorkshopSourceDocuments',
  'frontendWorkshopSourceDocumentLastGood',
  'frontendWorkshopSourceComponents',
  'generatedImages',
  'generatedImageFiles',
  'restoreStaging',
  'restoreStagingChunks',
  'assets',
  'assetFiles',
  'communitySources',
  'communitySourceMessages',
  'resourceSourceBindings',
  'cloudBackupJobs',
  'cloudBackupOrphans',
] as const

export type NativeAppDatabaseStore = (typeof APP_DATABASE_STORES)[number]
const BLOB_CHUNK_BYTES = 256 * 1024

function assertAndroidDatabase(): void {
  if (
    !Capacitor.isNativePlatform() ||
    Capacitor.getPlatform() !== 'android' ||
    !Capacitor.isPluginAvailable('NativeAppDatabase')
  ) {
    throw new Error('Android 原生数据库不可用')
  }
}

function decodeBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value)
  const bytes = new Uint8Array(new ArrayBuffer(binary.length))
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

/** APK-only persistence bridge. The browser/PWA remains on its existing IndexedDB adapters. */
export const nativeAppDatabase = {
  async status(): Promise<NativeAppDatabaseStatus> {
    assertAndroidDatabase()
    return databasePlugin.getStatus()
  },

  async getRecord(store: NativeAppDatabaseStore, key: string): Promise<unknown | undefined> {
    assertAndroidDatabase()
    const result = await databasePlugin.getRecord({ store, key })
    return result.found ? result.value : undefined
  },

  async getRecords(
    store: NativeAppDatabaseStore,
    afterKey: string | undefined,
    limit = 250,
  ): Promise<{
    rows: Array<{ key: string; value: Record<string, unknown> }>
    count: number
    nextKey?: string | null
  }> {
    assertAndroidDatabase()
    return databasePlugin.getRecords({ store, afterKey, limit })
  },

  async getRecordsByKeys(
    store: NativeAppDatabaseStore,
    keys: string[],
  ): Promise<Array<{ key: string; value: Record<string, unknown> }>> {
    assertAndroidDatabase()
    return (await databasePlugin.getRecordsByKeys({ store, keys })).rows
  },

  async getIndexEntries(
    store: NativeAppDatabaseStore,
    indexName: string,
    indexKey?: string,
  ): Promise<Array<{ indexKey: string; primaryKey: string }>> {
    assertAndroidDatabase()
    return (await databasePlugin.getIndexEntries({ store, indexName, indexKey })).rows
  },

  async putRecords(
    store: NativeAppDatabaseStore,
    rows: Array<{
      key: string
      value: Record<string, unknown>
      indexes?: NativeAppDatabaseIndexValue[]
    }>,
  ): Promise<number> {
    assertAndroidDatabase()
    return (await databasePlugin.putRecords({ store, rows })).written
  },

  async putRecordsWithState(
    store: NativeAppDatabaseStore,
    rows: Array<{
      key: string
      value: Record<string, unknown>
      indexes?: NativeAppDatabaseIndexValue[]
    }>,
    stateKey: string,
    stateValue: string,
  ): Promise<number> {
    assertAndroidDatabase()
    return (await databasePlugin.putRecordsWithState({ store, rows, stateKey, stateValue })).written
  },

  async applyBatch(
    operations: NativeAppDatabaseBatchOperation[],
    options: { requireActiveLibrary?: boolean } = {},
  ): Promise<number> {
    assertAndroidDatabase()
    return (await databasePlugin.applyBatch({ operations, ...options })).applied
  },

  async deleteRecords(store: NativeAppDatabaseStore, keys: string[]): Promise<number> {
    assertAndroidDatabase()
    return (await databasePlugin.deleteRecords({ store, keys })).deleted
  },

  async clearStore(store: NativeAppDatabaseStore): Promise<void> {
    assertAndroidDatabase()
    await databasePlugin.clearStore({ store })
  },

  async clearIndexes(store: NativeAppDatabaseStore): Promise<void> {
    assertAndroidDatabase()
    await databasePlugin.clearIndexes({ store })
  },

  async getState(key: string): Promise<string | undefined> {
    assertAndroidDatabase()
    const result = await databasePlugin.getState({ key })
    return result.found ? result.value : undefined
  },

  async putState(key: string, value: string): Promise<void> {
    assertAndroidDatabase()
    await databasePlugin.putState({ key, value })
  },

  async writeBlob(
    store: NativeAppDatabaseStore,
    key: string,
    fieldPath: string,
    source: Blob,
    attachmentOwnerKey = key,
  ): Promise<{ sha256: string; size: number; mimeType: string }> {
    assertAndroidDatabase()
    const type = source.type
    const transfer = await databasePlugin.beginBlob({
      store,
      key: attachmentOwnerKey,
      fieldPath,
      size: source.size,
      mimeType: type,
    })
    let offset = transfer.offset
    while (offset < source.size) {
      const end = Math.min(source.size, offset + BLOB_CHUNK_BYTES)
      const bytes = new Uint8Array(await source.slice(offset, end).arrayBuffer())
      const result = await databasePlugin.appendBlob({
        token: transfer.token,
        offset,
        data: nativeBytesToBase64(bytes),
      })
      if (result.offset !== end) throw new Error('Android 原生二进制写入位置不一致')
      offset = result.offset
    }
    const committed = await databasePlugin.completeBlob({ token: transfer.token })
    return { sha256: committed.sha256, size: committed.size, mimeType: committed.mimeType }
  },

  async readBlob(
    store: NativeAppDatabaseStore,
    key: string,
    fieldPath: string,
  ): Promise<Blob | undefined> {
    assertAndroidDatabase()
    const parts: BlobPart[] = []
    let offset = 0
    let mimeType: string | undefined
    let expectedSize: number | undefined
    while (true) {
      const response = await databasePlugin.readBlobChunk({
        store,
        key,
        fieldPath,
        offset,
        length: BLOB_CHUNK_BYTES,
      })
      if (!response.found || !response.blob) return undefined
      const chunk = response.blob
      if (chunk.offset !== offset) throw new Error('Android 原生二进制读取位置不一致')
      if (mimeType === undefined) mimeType = chunk.mimeType
      else if (mimeType !== chunk.mimeType) throw new Error('Android 原生二进制类型不一致')
      if (expectedSize === undefined) expectedSize = chunk.size
      else if (expectedSize !== chunk.size) throw new Error('Android 原生二进制大小不一致')
      const bytes = decodeBase64(chunk.data)
      if (bytes.byteLength === 0 && !chunk.eof) throw new Error('Android 原生二进制读取未前进')
      parts.push(bytes)
      offset += bytes.byteLength
      if (chunk.eof) break
    }
    if (expectedSize === undefined || offset !== expectedSize)
      throw new Error('Android 原生二进制读取大小校验失败')
    return new Blob(parts, { type: mimeType ?? '' })
  },

  async deleteBlob(store: NativeAppDatabaseStore, key: string, fieldPath: string): Promise<void> {
    assertAndroidDatabase()
    await databasePlugin.deleteBlob({ store, key, fieldPath })
  },
}
