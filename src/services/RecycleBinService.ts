import type { AppDatabase } from '../database/AppDatabase'
import type { BackupRecord, Resource } from '../types/Resource'
import type { CategoryService } from './CategoryService'
import type { ExportService } from './ExportService'
import type { ResourceService } from './ResourceService'
import type { RestoreService } from './RestoreService'
import type { VaultService } from './VaultService'

const RECYCLE_BIN_ADAPTER = 'local-recycle-bin'

function recycleArchiveFileName(createdAt: Date): string {
  const timestamp = createdAt.toISOString().replace(/[:.]/g, '-').slice(0, 19)
  return `回收站-${timestamp}.zip`
}

export class RecycleBinService {
  private readonly database: AppDatabase
  private readonly resourceService: ResourceService
  private readonly categoryService: CategoryService
  private readonly exportService: ExportService
  private readonly restoreService: RestoreService
  private readonly vaultService: VaultService

  constructor(
    database: AppDatabase,
    resourceService: ResourceService,
    categoryService: CategoryService,
    exportService: ExportService,
    restoreService: RestoreService,
    vaultService: VaultService,
  ) {
    this.database = database
    this.resourceService = resourceService
    this.categoryService = categoryService
    this.exportService = exportService
    this.restoreService = restoreService
    this.vaultService = vaultService
  }

  async list(): Promise<BackupRecord[]> {
    const records = await this.database.backupRecords
      .where('adapter')
      .equals(RECYCLE_BIN_ADAPTER)
      .toArray()
    return records.sort((left, right) => right.createdAt - left.createdAt)
  }

  async moveToRecycleBin(ids: string[]): Promise<BackupRecord> {
    const selectedIds = Array.from(new Set(ids.filter(Boolean)))
    if (!selectedIds.length) throw new Error('请选择要移入回收站的资源')

    const resources = (
      await Promise.all(selectedIds.map((id) => this.resourceService.get(id)))
    ).flatMap((resource): Resource[] => (resource ? [resource] : []))
    if (!resources.length) throw new Error('要删除的资源已经不存在')

    const [categories, versionGroups] = await Promise.all([
      this.categoryService.list(),
      Promise.all(resources.map((resource) => this.resourceService.listVersions(resource.id))),
    ])
    const resourceIds = new Set(resources.map((resource) => resource.id))
    const versions = Array.from(
      new Map(
        versionGroups
          .flat()
          .flatMap((version) => version.carriers ?? [version.resource])
          .filter((version) => !resourceIds.has(version.id))
          .map((version) => [version.id, version]),
      ).values(),
    )
    const archive = await this.exportService.createArchive(
      resources,
      categories,
      { mode: 'partial', preserveExternalRelatedResourceIds: true },
      versions,
    )
    const createdAt = Date.now()
    let blob = archive.blob
    let encrypted = false
    let encryptionIv: string | undefined
    if (this.vaultService.isEnabled()) {
      const protectedBlob = await this.vaultService.protectBlob(blob)
      blob = protectedBlob.data
      encrypted = true
      encryptionIv = protectedBlob.iv
    }
    const record: BackupRecord = {
      id: crypto.randomUUID(),
      adapter: RECYCLE_BIN_ADAPTER,
      objectKey: recycleArchiveFileName(new Date(createdAt)),
      resourceCount: resources.length,
      createdAt,
      reason:
        resources.length === 1
          ? resources[0]!.name
          : `${resources[0]!.name} 等 ${resources.length} 项资源`,
      size: blob.size,
      blob,
      encrypted,
      encryptionIv,
    }
    await this.database.backupRecords.put(record)
    await this.resourceService.deleteMany(resources.map((resource) => resource.id))
    return record
  }

  async restore(id: string): Promise<void> {
    const record = await this.getRecord(id)
    if (!record.blob) throw new Error('回收站记录已损坏，无法恢复')
    let blob = record.blob
    if (record.encrypted) {
      if (!record.encryptionIv) throw new Error('回收站记录缺少加密参数')
      blob = await this.vaultService.revealBlob(
        { iv: record.encryptionIv, data: record.blob },
        'application/zip',
      )
    }
    const [resources, categories] = await Promise.all([
      this.resourceService.listResourceListSummaries(),
      this.categoryService.list(),
    ])
    const prepared = await this.restoreService.prepare(
      new File([blob], record.objectKey, { type: 'application/zip' }),
      resources,
      categories,
      true,
    )
    if (prepared.preview.mode !== 'partial') throw new Error('回收站记录格式无效')
    await this.restoreService.restore(prepared)
    await this.resourceService.restoreRelatedLinks(prepared.resources)
    await this.database.backupRecords.delete(record.id)
  }

  async purge(id: string): Promise<void> {
    await this.getRecord(id)
    await this.database.backupRecords.delete(id)
  }

  async empty(): Promise<void> {
    const records = await this.list()
    if (records.length)
      await this.database.backupRecords.bulkDelete(records.map((record) => record.id))
  }

  private async getRecord(id: string): Promise<BackupRecord> {
    const record = await this.database.backupRecords.get(id)
    if (!record || record.adapter !== RECYCLE_BIN_ADAPTER) throw new Error('回收站记录已经不存在')
    return record
  }
}
