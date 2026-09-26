import type { AppDatabase } from '../database/AppDatabase'
import type { BackupRecord, Category, Resource } from '../types/Resource'
import type { ArchiveSource, ExportService } from './ExportService'
import type { RestoreService } from './RestoreService'
import type { VaultService } from './VaultService'
import { formatBytes } from '../utils/LibraryFormatting'

const LOCAL_HISTORY_ADAPTER = 'local-history'
const HISTORY_LIMIT_SETTING_ID = 'history.snapshotLimit'
export const DEFAULT_HISTORY_SNAPSHOT_LIMIT = 8
export const MIN_HISTORY_SNAPSHOT_LIMIT = 1
export const MAX_HISTORY_SNAPSHOT_LIMIT = 30
const HISTORY_QUOTA_RATIO = 0.2
const STORAGE_HARD_LIMIT_RATIO = 0.95

interface SnapshotStorageBudget {
  maxHistoryBytes?: number
  remainingBeforeHardLimit?: number
  estimatedQuotaBytes?: number
}

function normalizeSnapshotLimit(value: unknown): number {
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) return DEFAULT_HISTORY_SNAPSHOT_LIMIT
  return Math.min(
    MAX_HISTORY_SNAPSHOT_LIMIT,
    Math.max(MIN_HISTORY_SNAPSHOT_LIMIT, Math.round(numeric)),
  )
}

export class HistoryService {
  private readonly database: AppDatabase
  private readonly exportService: ExportService
  private readonly restoreService: RestoreService
  private readonly vaultService: VaultService

  constructor(
    database: AppDatabase,
    exportService: ExportService,
    restoreService: RestoreService,
    vaultService: VaultService,
  ) {
    this.database = database
    this.exportService = exportService
    this.restoreService = restoreService
    this.vaultService = vaultService
  }

  async list(): Promise<BackupRecord[]> {
    const snapshots = await this.database.backupRecords
      .where('adapter')
      .equals(LOCAL_HISTORY_ADAPTER)
      .toArray()
    return snapshots.sort((left, right) => right.createdAt - left.createdAt)
  }

  async getSnapshotLimit(): Promise<number> {
    const setting = await this.database.settings.get(HISTORY_LIMIT_SETTING_ID)
    return normalizeSnapshotLimit(setting?.value)
  }

  async setSnapshotLimit(value: number): Promise<number> {
    const limit = normalizeSnapshotLimit(value)
    await this.database.settings.put({
      id: HISTORY_LIMIT_SETTING_ID,
      value: limit,
      updatedAt: Date.now(),
    })
    await this.prune(limit)
    return limit
  }

  async capture(
    resources: Resource[] | ArchiveSource,
    categories: Category[],
    reason: string,
    protectedSnapshotIds: readonly string[] = [],
  ): Promise<BackupRecord> {
    const count = Array.isArray(resources) ? resources.length : resources.resources.length
    if (!count && (await this.database.resources.count()))
      throw new Error('资源读取结果为空但数据库仍有资源，已停止覆盖安全快照')
    let archive: { blob: Blob; fileName: string }
    if (Array.isArray(resources)) {
      const versions: Resource[] = []
      for (const id of await this.database.resourceVersions.toCollection().primaryKeys()) {
        const version = await this.database.resourceVersions.get(id)
        if (version) versions.push(await this.vaultService.decodeResource(version))
      }
      archive = await this.exportService.createArchive(
        resources,
        categories,
        { mode: 'full' },
        versions,
      )
    } else {
      archive = (
        await this.exportService.createArchivesFromSource(resources, categories, { mode: 'full' })
      )[0]!
    }
    let blob = archive.blob
    let encrypted = false
    let encryptionIv: string | undefined
    if (this.vaultService.isEnabled()) {
      const protectedBlob = await this.vaultService.protectBlob(blob)
      blob = protectedBlob.data
      encrypted = true
      encryptionIv = protectedBlob.iv
    }
    const storageBudget = await this.getStorageBudget()
    if (storageBudget.maxHistoryBytes !== undefined && blob.size > storageBudget.maxHistoryBytes) {
      const quotaDescription = storageBudget.estimatedQuotaBytes
        ? `（浏览器当前估算配额 ${formatBytes(storageBudget.estimatedQuotaBytes)} 的 20%）`
        : ''
      throw new Error(
        `快照约 ${formatBytes(blob.size)}，超过本应用单份内部快照上限 ${formatBytes(storageBudget.maxHistoryBytes)}${quotaDescription}。这是应用的保护阈值，不是浏览器公布的固定容量；可取消快照后继续操作，或使用完整导出备份。`,
      )
    }
    if (
      storageBudget.remainingBeforeHardLimit !== undefined &&
      blob.size > storageBudget.remainingBeforeHardLimit
    ) {
      throw new Error('本机存储空间接近上限，已停止创建内部快照，请先导出备份或释放空间')
    }
    const record: BackupRecord = {
      id: crypto.randomUUID(),
      adapter: LOCAL_HISTORY_ADAPTER,
      objectKey: archive.fileName,
      resourceCount: Array.isArray(resources) ? resources.length : resources.resources.length,
      categoryCount: categories.length,
      createdAt: Date.now(),
      reason: reason.trim() || '手动快照',
      size: blob.size,
      blob,
      encrypted,
      encryptionIv,
    }
    await this.database.backupRecords.put(record)
    await this.prune(undefined, storageBudget.maxHistoryBytes, protectedSnapshotIds)
    return record
  }

  async restore(id: string): Promise<void> {
    const snapshot = await this.database.backupRecords.get(id)
    if (!snapshot?.blob) throw new Error('历史版本不存在或已损坏')
    let blob = snapshot.blob
    if (snapshot.encrypted) {
      if (!snapshot.encryptionIv) throw new Error('历史版本缺少加密参数')
      blob = await this.vaultService.revealBlob(
        { iv: snapshot.encryptionIv, data: snapshot.blob },
        'application/zip',
      )
    }
    const file = new File([blob], snapshot.objectKey, { type: 'application/zip' })
    const prepared = await this.restoreService.prepare(file, [], [], true)
    if (prepared.preview.mode !== 'full') throw new Error('历史版本不是完整快照')
    await this.restoreService.replace(prepared)
  }

  async delete(id: string): Promise<void> {
    await this.database.backupRecords.delete(id)
  }

  private async getStorageBudget(): Promise<SnapshotStorageBudget> {
    if (typeof navigator === 'undefined' || !navigator.storage?.estimate) return {}
    try {
      const estimate = await navigator.storage.estimate()
      if (!estimate.quota) return {}
      return {
        estimatedQuotaBytes: estimate.quota,
        maxHistoryBytes: Math.floor(estimate.quota * HISTORY_QUOTA_RATIO),
        remainingBeforeHardLimit: Math.max(
          0,
          Math.floor(estimate.quota * STORAGE_HARD_LIMIT_RATIO - (estimate.usage ?? 0)),
        ),
      }
    } catch {
      return {}
    }
  }

  private async prune(
    requestedLimit?: number,
    requestedMaxBytes?: number,
    protectedSnapshotIds: readonly string[] = [],
  ): Promise<void> {
    const limit = requestedLimit ?? (await this.getSnapshotLimit())
    const maxBytes = requestedMaxBytes ?? (await this.getStorageBudget()).maxHistoryBytes
    const snapshots = await this.list()
    const protectedIds = new Set(protectedSnapshotIds)
    let retainedBytes = 0
    let ordinaryRetained = 0
    const expired = snapshots.filter((snapshot) => {
      if (protectedIds.has(snapshot.id)) {
        retainedBytes += snapshot.size ?? snapshot.blob?.size ?? 0
        return false
      }
      const index = ordinaryRetained++
      const snapshotSize = snapshot.size ?? snapshot.blob?.size ?? 0
      if (index >= limit) return true
      if (index === 0) {
        retainedBytes += snapshotSize
        return false
      }
      if (maxBytes !== undefined && retainedBytes + snapshotSize > maxBytes) return true
      retainedBytes += snapshotSize
      return false
    })
    if (expired.length) {
      await this.database.backupRecords.bulkDelete(expired.map((snapshot) => snapshot.id))
    }
  }
}
