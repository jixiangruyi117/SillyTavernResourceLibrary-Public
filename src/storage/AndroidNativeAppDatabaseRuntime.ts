import type { AppDatabase } from '../database/AppDatabase'
import { BUILD_INFO } from '../core/BuildInfo'
import { isCapacitorApp } from '../utils/CapacitorDetection'
import {
  AndroidAppDatabaseMigrator,
  canonicalizeAppDatabaseValue,
  decodeAppDatabaseKey,
  decodeAppDatabaseValue,
  encodeAppDatabaseIndexes,
  encodeAppDatabaseValue,
} from './AndroidAppDatabaseMigration'
import {
  APP_DATABASE_STORES,
  nativeAppDatabase,
  type NativeAppDatabaseStore,
} from './NativeAppDatabaseBridge'
import {
  activateAndroidNativeAppDatabase,
  canUseAndroidNativeDexieCore,
  deactivateAndroidNativeAppDatabase,
} from './AndroidNativeDexieCore'

const ACTIVE_STATE_KEY = 'migration:appdb:v1:active'
const INDEX_STATE_KEY = 'migration:appdb:indexes:v1:active'
const ACTIVE_STATE_VERSION = 1

export interface AndroidNativeAppDatabaseStartupProgress {
  store: NativeAppDatabaseStore
  copied: number
  total: number
  status: 'copying' | 'failed' | 'verified'
}

export interface AndroidNativeAppDatabaseStartupResult {
  native: boolean
  migrated: boolean
  copied: number
  total: number
}

async function ensureNativeIndexes(database: AppDatabase): Promise<void> {
  if ((await nativeAppDatabase.getState(INDEX_STATE_KEY)) === 'verified-v1') return
  const available = new Set(database.tables.map((table) => table.name))
  for (const store of APP_DATABASE_STORES) {
    if (!available.has(store)) continue
    const table = database.table(store)
    await nativeAppDatabase.clearIndexes(store)
    let afterKey: string | undefined
    while (true) {
      const page = await nativeAppDatabase.getRecords(store, afterKey, 500)
      if (!page.rows.length) break
      await nativeAppDatabase.putRecords(
        store,
        page.rows.map((row) => ({
          ...row,
          indexes: encodeAppDatabaseIndexes(row.value, table.schema.indexes),
        })),
      )
      afterKey = page.nextKey ?? undefined
      if (!afterKey) break
    }
  }
  await nativeAppDatabase.putState(INDEX_STATE_KEY, 'verified-v1')
}

interface ActiveState {
  version: number
  databaseVersion: number
  activatedAt: number
  mode?: 'active' | 'legacy' | 'rolling-back'
}

function parseActiveState(value: string | undefined): ActiveState | undefined {
  if (!value) return undefined
  try {
    const parsed = JSON.parse(value) as Partial<ActiveState>
    if (
      parsed.version !== ACTIVE_STATE_VERSION ||
      !Number.isSafeInteger(parsed.databaseVersion) ||
      !Number.isFinite(parsed.activatedAt) ||
      (parsed.mode !== undefined &&
        parsed.mode !== 'active' &&
        parsed.mode !== 'legacy' &&
        parsed.mode !== 'rolling-back')
    )
      return undefined
    return parsed as ActiveState
  } catch {
    return undefined
  }
}

/**
 * Completes the first APK migration before app features can write to Dexie, then activates the
 * native DBCore for all AppDatabase tables. Browser and iOS PWA startup never enters this path.
 */
export async function initializeAndroidNativeAppDatabase(
  database: AppDatabase,
  onProgress?: (progress: AndroidNativeAppDatabaseStartupProgress) => void,
): Promise<AndroidNativeAppDatabaseStartupResult> {
  if (!isCapacitorApp() || !canUseAndroidNativeDexieCore()) {
    return { native: false, migrated: false, copied: 0, total: 0 }
  }

  const active = parseActiveState(await nativeAppDatabase.getState(ACTIVE_STATE_KEY))
  if (active?.mode === 'legacy') {
    await database.open()
    return { native: false, migrated: false, copied: 0, total: 0 }
  }
  if (active?.mode === 'rolling-back') {
    await rollbackAndroidNativeAppDatabase(database)
    return { native: false, migrated: false, copied: 0, total: 0 }
  }
  if (active) {
    activateAndroidNativeAppDatabase()
    await database.open()
    await ensureNativeIndexes(database)
    if (active.databaseVersion !== BUILD_INFO.databaseVersion) {
      await nativeAppDatabase.putState(
        ACTIVE_STATE_KEY,
        JSON.stringify({ ...active, databaseVersion: BUILD_INFO.databaseVersion }),
      )
    }
    return { native: true, migrated: false, copied: 0, total: 0 }
  }

  // Open and finish the existing Dexie schema migrations while the native middleware remains
  // inactive. This creates the final source schema before we take the immutable migration snapshot.
  await database.open()
  const migrator = new AndroidAppDatabaseMigrator({ database, isQuiesced: () => true })
  const summary = await migrator.migrateAllStores(onProgress)
  const nativeStatus = await nativeAppDatabase.status()
  for (const table of database.tables) {
    if (!APP_DATABASE_STORES.includes(table.name as NativeAppDatabaseStore)) continue
    const sourceCount = await table.count()
    const nativeCount = nativeStatus.counts[table.name] ?? 0
    if (sourceCount !== nativeCount) {
      throw new Error(
        `原生数据库表 ${table.name} 最终计数核验失败（IndexedDB ${sourceCount}，SQLite ${nativeCount}）`,
      )
    }
  }

  await nativeAppDatabase.putState(INDEX_STATE_KEY, 'verified-v1')

  const nextState: ActiveState = {
    version: ACTIVE_STATE_VERSION,
    databaseVersion: BUILD_INFO.databaseVersion,
    activatedAt: Date.now(),
  }
  await nativeAppDatabase.putState(ACTIVE_STATE_KEY, JSON.stringify(nextState))
  activateAndroidNativeAppDatabase()
  return {
    native: true,
    migrated: true,
    copied: summary.copied,
    total: summary.total,
  }
}

/**
 * Rebuilds the retained IndexedDB copy from verified native rows before disabling native storage.
 * Each record is written and re-read before the next one; a failed rollback leaves the active
 * marker in place so the app will keep using the native source and the operation can be retried.
 */
export async function rollbackAndroidNativeAppDatabase(
  database: AppDatabase,
  onProgress?: (progress: AndroidNativeAppDatabaseStartupProgress) => void,
  native: typeof nativeAppDatabase = nativeAppDatabase,
): Promise<void> {
  const active = parseActiveState(await native.getState(ACTIVE_STATE_KEY))
  if (!active || active.mode === 'legacy') throw new Error('当前没有可回退的 Android 原生主库')

  await native.putState(ACTIVE_STATE_KEY, JSON.stringify({ ...active, mode: 'rolling-back' }))
  database.close()
  deactivateAndroidNativeAppDatabase()
  try {
    await database.open()
    const status = await native.status()
    const stores = database.tables
      .map((table) => table.name)
      .filter((name): name is NativeAppDatabaseStore =>
        APP_DATABASE_STORES.includes(name as NativeAppDatabaseStore),
      )

    for (const store of stores) {
      const table = database.table(store)
      const expected = status.counts[store] ?? 0
      await table.clear()
      let afterKey: string | undefined
      let restored = 0
      while (true) {
        const page = await native.getRecords(store, afterKey, 100)
        for (const row of page.rows) {
          const key = decodeAppDatabaseKey(row.key)
          const value = await decodeAppDatabaseValue(row.value, store, row.key, native)
          await table.put(value as never)
          const actual = await table.get(key as never)
          if (actual === undefined) throw new Error(`回退核验失败：${store}/${row.key} 未写入`)
          const reencoded = await encodeAppDatabaseValue(actual, store, row.key, native)
          if (canonicalizeAppDatabaseValue(reencoded) !== canonicalizeAppDatabaseValue(row.value)) {
            throw new Error(`回退核验失败：${store}/${row.key} 内容不一致`)
          }
          restored += 1
          onProgress?.({ store, copied: restored, total: expected, status: 'copying' })
        }
        if (!page.nextKey) break
        afterKey = page.nextKey
      }
      const actualCount = await table.count()
      if (actualCount !== expected || restored !== expected) {
        throw new Error(`回退核验失败：${store} 原生 ${expected} 条，IndexedDB ${actualCount} 条`)
      }
      onProgress?.({ store, copied: restored, total: expected, status: 'verified' })
    }

    await native.putState(
      ACTIVE_STATE_KEY,
      JSON.stringify({
        version: ACTIVE_STATE_VERSION,
        databaseVersion: BUILD_INFO.databaseVersion,
        activatedAt: active.activatedAt,
        mode: 'legacy',
      } satisfies ActiveState),
    )
  } catch (error) {
    await native.putState(ACTIVE_STATE_KEY, JSON.stringify({ ...active, mode: 'active' }))
    database.close()
    activateAndroidNativeAppDatabase()
    await database.open()
    throw error
  }
}
