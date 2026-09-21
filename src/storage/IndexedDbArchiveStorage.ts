import { restoreVersionKey } from '../utils/RestoreIdentity'
import Dexie from 'dexie'
import type { AppDatabase } from '../database/AppDatabase'
import type { VaultService } from '../services/VaultService'
import {
  isUserPersonaAvatarAttachment,
  toResourceListSummary,
  toResourceSummary,
  type Category,
  type Resource,
  type ResourceSummary,
} from '../types/Resource'
import {
  isEncryptedResource,
  isNativeBackedResource,
  type NativeBackedResourceRecord,
  type StoredResource,
  type StoredResourceSummary,
} from '../types/Vault'
import type { ArchiveStorageAdapter } from './ArchiveStorageAdapter'
import type { StagedArchiveRecord } from '../types/RestoreStaging'
import { IndexedDbAssetStore } from './IndexedDbAssetStore'
import { linkNativeResourceObjects } from './NativeResourceFileMirror'

async function detachStoredBlob(blob: Blob): Promise<Blob> {
  // Use the browser's local Blob loader. Response(blob.stream()) can stall in WebKit
  // when copying a large IDB-backed file while its write transaction is active.
  const url = URL.createObjectURL(blob)
  try {
    const response = await fetch(url)
    if (!response.ok) throw new Error('无法读取恢复暂存原文件')
    const detached = await response.blob()
    if (detached.size !== blob.size) throw new Error('恢复暂存原文件读取不完整')
    return detached.slice(0, detached.size, blob.type)
  } finally {
    URL.revokeObjectURL(url)
  }
}

export class IndexedDbArchiveStorage implements ArchiveStorageAdapter {
  private readonly database: AppDatabase
  private readonly vault?: VaultService
  private readonly assets: IndexedDbAssetStore

  constructor(
    database: AppDatabase,
    vault?: VaultService,
    assets = new IndexedDbAssetStore(database, vault),
  ) {
    this.database = database
    this.vault = vault
    this.assets = assets
  }

  async listRestoreVersionKeys(): Promise<string[]> {
    const keys: string[] = []
    for (const id of await this.database.resourceVersions.toCollection().primaryKeys()) {
      const record = await this.database.resourceVersions.get(id)
      if (!record) continue
      const stored = toStoredSummary(record)
      if (isEncryptedResource(record) && !this.vault)
        throw new Error('请先解锁保险箱再恢复历史版本')
      const summary = this.vault
        ? await this.vault.decodeResourceSummary(stored)
        : (stored as ResourceSummary)
      keys.push(restoreVersionKey(summary))
    }
    return keys
  }

  canRestoreNative(): boolean {
    return this.vault?.isEnabled() !== true
  }

  async restore(
    categories: Category[],
    resources: Resource[],
    versions: Resource[] = [],
    hydrate: (resource: Resource) => Promise<Resource> = async (resource) => resource,
  ): Promise<void> {
    await this.writeResources(categories, resources, versions, hydrate)
  }

  private async writeResources(
    categories: Category[],
    resources: Resource[],
    versions: Resource[],
    hydrate: (resource: Resource) => Promise<Resource>,
    replace = false,
  ): Promise<void> {
    await this.restoreStaged(
      categories,
      resources,
      versions,
      async (resource) => {
        const ready = await this.assets.externalizeResourceThumbnail(await hydrate(resource))
        const stored = this.vault ? await this.vault.encodeResource(ready) : ready
        const light = toResourceListSummary(ready)
        return {
          resource: stored,
          listSummary: this.vault ? await this.vault.encodeResourceSummary(light) : light,
        }
      },
      undefined,
      replace,
    )
  }

  async restoreNative(
    categories: Category[],
    resources: NativeBackedResourceRecord[],
    versions: NativeBackedResourceRecord[] = [],
    hydrate: (resource: NativeBackedResourceRecord) => Promise<NativeBackedResourceRecord> = async (
      resource,
    ) => resource,
  ): Promise<void> {
    if (!this.canRestoreNative()) {
      throw new Error('资源库保险箱开启时不能保存 Android 原生明文引用')
    }
    await this.restoreStaged(
      categories,
      resources,
      versions,
      async (resource) => {
        const record = await hydrate(resource)
        return {
          resource: record,
          listSummary: toNativeListSummary(record),
        }
      },
      () =>
        linkNativeResourceObjects([
          ...resources.map((resource) => nativeLinkRecord(resource, 'current')),
          ...versions.map((resource) => nativeLinkRecord(resource, 'versions')),
        ]),
    )
  }

  private async restoreStaged<T extends Resource | NativeBackedResourceRecord>(
    categories: Category[],
    resources: T[],
    versions: T[],
    prepare: (resource: T) => Promise<StagedArchiveRecord>,
    beforeCommit?: () => Promise<unknown>,
    replace = false,
  ): Promise<void> {
    const storedCategories = this.vault
      ? await Promise.all(categories.map((category) => this.vault!.encodeCategory(category)))
      : categories
    const jobId = crypto.randomUUID()
    try {
      // Release each hydrated body after IndexedDB has cloned it. The plan stays lightweight.
      for (const [scope, records] of [
        ['current', resources],
        ['versions', versions],
      ] as const) {
        for (let index = 0; index < records.length; index++) {
          const record = await prepare(records[index]!)
          await this.database.restoreStaging.put({
            jobId,
            path: `${scope}/${index}`,
            size: records[index]!.fileSize,
            sha256: records[index]!.contentHash,
            updatedAt: Date.now(),
            record,
          })
        }
      }
      await beforeCommit?.()
      await this.database.transaction(
        'rw',
        [
          this.database.categories,
          this.database.resources,
          this.database.resourceSummaries,
          this.database.resourceListSummaries,
          this.database.resourceVersions,
          this.database.resourceVersionSummaries,
          this.database.restoreStaging,
        ],
        async () => {
          if (replace) {
            await this.database.categories.clear()
            await this.database.resources.clear()
            await this.database.resourceSummaries.clear()
            await this.database.resourceListSummaries.clear()
            await this.database.resourceVersions.clear()
            await this.database.resourceVersionSummaries.clear()
          }
          if (storedCategories.length) await this.database.categories.bulkPut(storedCategories)
          // Keep the final indexes atomic, including detaching staged file backing below.
          for (const [scope, records] of [
            ['current', resources],
            ['versions', versions],
          ] as const) {
            for (let index = 0; index < records.length; index++) {
              const staged = await this.database.restoreStaging.get([jobId, `${scope}/${index}`])
              const record = staged?.record
              if (!record) throw new Error('恢复暂存记录缺失，已取消索引提交')
              if (
                !isEncryptedResource(record.resource) &&
                !isNativeBackedResource(record.resource)
              ) {
                // WebKit can keep the source IDB file path when cloning a stored Blob. Clearing
                // staging then breaks the final record. Read a fresh body without arrayBuffer.
                record.resource.originalBlob = await Dexie.waitFor(
                  detachStoredBlob(record.resource.originalBlob),
                )
              }
              if (scope === 'current') {
                await this.database.resources.put(record.resource)
                await this.database.resourceSummaries.put(toStoredSummary(record.resource))
                await this.database.resourceListSummaries.put(record.listSummary)
              } else {
                await this.database.resourceVersions.put(record.resource)
                await this.database.resourceVersionSummaries.put(toStoredSummary(record.resource))
              }
              await this.database.restoreStaging.delete([jobId, `${scope}/${index}`])
            }
          }
        },
      )
    } catch (error) {
      if (
        error &&
        typeof error === 'object' &&
        'name' in error &&
        (error.name === 'QuotaExceededError' ||
          ('message' in error &&
            typeof error.message === 'string' &&
            error.message.includes('QuotaExceededError')))
      ) {
        throw new Error('浏览器可用存储空间不足，导入未完成，原有资源未改变。请释放空间后重试。', {
          cause: error,
        })
      }
      throw error
    } finally {
      await this.database.restoreStaging.where('jobId').equals(jobId).delete()
    }
  }

  async replace(
    categories: Category[],
    resources: Resource[],
    versions: Resource[] = [],
    hydrate: (resource: Resource) => Promise<Resource> = async (resource) => resource,
  ): Promise<void> {
    await this.writeResources(categories, resources, versions, hydrate, true)
  }
}

function toStoredSummary(resource: StoredResource): StoredResourceSummary {
  if (isNativeBackedResource(resource)) {
    const { nativeOriginal: _nativeOriginal, ...summary } = resource
    return toResourceSummary(summary as Resource)
  }
  if (!isEncryptedResource(resource)) return toResourceSummary(resource)
  return {
    id: resource.id,
    contentHash: resource.contentHash,
    versionGroupId: resource.versionGroupId,
    updatedAt: resource.updatedAt,
    encrypted: true,
    payload: resource.payload,
  }
}

function toNativeListSummary(resource: NativeBackedResourceRecord): StoredResourceSummary {
  const { nativeOriginal: _nativeOriginal, ...summary } = resource
  return toResourceListSummary(summary as Resource)
}

function nativeLinkRecord(resource: NativeBackedResourceRecord, scope: 'current' | 'versions') {
  return {
    scope,
    id: resource.id,
    fileName: resource.fileName,
    mimeType: resource.mimeType,
    resourceType: resource.type,
    hiddenFromDocuments: isUserPersonaAvatarAttachment(resource),
    contentHash: resource.nativeOriginal.contentHash,
    size: resource.nativeOriginal.size,
    updatedAt: resource.updatedAt,
  } as const
}
