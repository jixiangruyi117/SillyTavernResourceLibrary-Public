import type { AppDatabase } from '../database/AppDatabase'
import type { BackupRecord } from '../types/Resource'
import type { CategoryService } from './CategoryService'
import { createResourceArchiveSource, type ExportService } from './ExportService'
import type { ResourceService } from './ResourceService'
import type { RestoreService } from './RestoreService'
import type { VaultService } from './VaultService'

const RECYCLE_BIN_ADAPTER = 'local-recycle-bin'

export interface RecycleBinMoveProgress {
  phase: 'archive' | 'save' | 'delete'
  writtenBytes?: number
  completed?: number
  total?: number
}

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

  async moveToRecycleBin(
    ids: string[],
    onProgress?: (progress: RecycleBinMoveProgress) => void,
  ): Promise<BackupRecord> {
    const selectedIds = Array.from(new Set(ids.filter(Boolean)))
    if (!selectedIds.length) throw new Error('请选择要移入回收站的资源')

    const source = await createResourceArchiveSource(this.resourceService)
    const selected = new Set(selectedIds)
    const resources = source.resources.filter((resource) => selected.has(resource.id))
    if (!resources.length) throw new Error('要删除的资源已经不存在')

    const categories = await this.categoryService.list()
    const resourceIds = new Set(resources.map((resource) => resource.id))
    const versions = source.versions.filter(
      (version) => version.versionGroupId && resourceIds.has(version.versionGroupId),
    )
    onProgress?.({ phase: 'archive' })
    const [archive] = await this.exportService.createArchivesFromSource(
      { ...source, resources, versions },
      categories,
      { mode: 'partial', preserveExternalRelatedResourceIds: true },
      undefined,
      {
        onProgress: ({ writtenBytes }) => onProgress?.({ phase: 'archive', writtenBytes }),
      },
    )
    if (!archive) throw new Error('未能创建回收站恢复记录')
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
    onProgress?.({ phase: 'save' })
    await this.database.backupRecords.put(record)
    onProgress?.({ phase: 'delete', completed: 0, total: resources.length + versions.length })
    await this.resourceService.deleteMany(
      resources.map((resource) => resource.id),
      ({ completed, total }) => onProgress?.({ phase: 'delete', completed, total }),
    )
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

  async purge(
    id: string,
    onProgress?: (progress: { completed: number; total: number }) => void,
  ): Promise<void> {
    await this.getRecord(id)
    onProgress?.({ completed: 0, total: 1 })
    await this.database.backupRecords.delete(id)
    onProgress?.({ completed: 1, total: 1 })
  }

  async empty(
    onProgress?: (progress: { completed: number; total: number }) => void,
  ): Promise<void> {
    const records = await this.list()
    if (!records.length) return
    const total = records.length
    const batchSize = 16
    let completed = 0
    onProgress?.({ completed, total })
    for (let offset = 0; offset < total; offset += batchSize) {
      const batch = records.slice(offset, offset + batchSize)
      await this.database.backupRecords.bulkDelete(batch.map((record) => record.id))
      completed += batch.length
      onProgress?.({ completed, total })
    }
  }

  private async getRecord(id: string): Promise<BackupRecord> {
    const record = await this.database.backupRecords.get(id)
    if (!record || record.adapter !== RECYCLE_BIN_ADAPTER) throw new Error('回收站记录已经不存在')
    return record
  }
}
