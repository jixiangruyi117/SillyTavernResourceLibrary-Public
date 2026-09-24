import Dexie from 'dexie'
import type { AppDatabase } from '../database/AppDatabase'
import type { VaultService } from '../services/VaultService'
import {
  normalizeResource,
  toResourceListSummary,
  toResourceSummary,
  type Resource,
  type ResourceListSummary,
  type ResourceSummary,
} from '../types/Resource'
import {
  isEncryptedResource,
  isEncryptedResourceSummary,
  isNativeBackedResource,
  type NativeBackedResourceRecord,
  type StoredResource,
  type StoredResourceSummary,
} from '../types/Vault'
import type { ResourceStorageAdapter, ResourceMetadataPatch } from './ResourceStorageAdapter'
import { IndexedDbAssetStore } from './IndexedDbAssetStore'
import { readNativeResourceObject } from './NativeResourceFileMirror'
import {
  cloneResourceForStorage,
  hydrateResourceFromIndexedDb,
  materializeResourceForIndexedDb,
  stripStableResourceBinaryFields,
  stripStableSummaryBinaryFields,
} from './ResourceStorageClone'

const SUMMARY_READ_BATCH_SIZE = 250

const LIST_SUMMARY_INDEX_SETTING_ID = 'index.resourceListSummaries.v20'

const THUMBNAIL_ASSET_MIGRATION_SETTING_ID = 'migration.resourceThumbnails.asset.v23'

const THUMBNAIL_ASSET_REPAIR_SETTING_ID = 'repair.resourceThumbnails.asset.v24'

const THUMBNAIL_EMBEDDED_REPAIR_SETTING_ID = 'repair.resourceThumbnails.asset.v25'

const THUMBNAIL_MIGRATION_BATCH_SIZE = 25

interface ThumbnailAssetMigrationState {
  version: 23
  status: 'running' | 'complete'
  stage: 'resources' | 'resourceVersions' | 'complete'
  checkpoint?: string
  migrated: number
}

interface ThumbnailAssetRepairState {
  version: 24
  status: 'running' | 'complete'
  stage: 'resources' | 'resourceVersions' | 'complete'
  checkpoint?: string
  repaired: number
}

interface ThumbnailEmbeddedRepairState {
  version: 25
  status: 'running' | 'complete'
  stage: 'resources' | 'resourceVersions' | 'complete'
  checkpoint?: string
  repaired: number
}

function yieldMainThread(): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, 0))
}

export class IndexedDbResourceStorage implements ResourceStorageAdapter {
  private readonly database: AppDatabase
  private readonly vault?: VaultService
  private readonly assets: IndexedDbAssetStore
  private thumbnailMigrationPromise?: Promise<number>

  constructor(
    database: AppDatabase,
    vault?: VaultService,
    assets = new IndexedDbAssetStore(database, vault),
  ) {
    this.database = database
    this.vault = vault
    this.assets = assets
  }

  repairThumbnailAssets(): Promise<number> {
    if (this.thumbnailMigrationPromise) return this.thumbnailMigrationPromise
    const operation = (async () => {
      const [legacyState, unlinkedState, embeddedState] = await Promise.all([
        this.database.settings.get(THUMBNAIL_ASSET_MIGRATION_SETTING_ID),
        this.database.settings.get(THUMBNAIL_ASSET_REPAIR_SETTING_ID),
        this.database.settings.get(THUMBNAIL_EMBEDDED_REPAIR_SETTING_ID),
      ])
      const needsRefresh =
        (legacyState?.value as Partial<ThumbnailAssetMigrationState> | undefined)?.status !==
          'complete' ||
        (unlinkedState?.value as Partial<ThumbnailAssetRepairState> | undefined)?.status !==
          'complete' ||
        (embeddedState?.value as Partial<ThumbnailEmbeddedRepairState> | undefined)?.status !==
          'complete'
      await this.migrateLegacyThumbnails()
      await this.repairUnlinkedThumbnailAssets()
      await this.repairEmbeddedThumbnailAssets()
      return needsRefresh ? 1 : 0
    })()
    this.thumbnailMigrationPromise = operation
    void operation
      .finally(() => {
        if (this.thumbnailMigrationPromise === operation) this.thumbnailMigrationPromise = undefined
      })
      .catch(() => undefined)
    return operation
  }

  private async migrateLegacyThumbnails(): Promise<void> {
    const saved = await this.database.settings.get(THUMBNAIL_ASSET_MIGRATION_SETTING_ID)
    const previous = saved?.value as Partial<ThumbnailAssetMigrationState> | undefined
    if (previous?.version === 23 && previous.status === 'complete') return

    let stage: ThumbnailAssetMigrationState['stage'] =
      previous?.version === 23 ? (previous.stage ?? 'resources') : 'resources'
    let checkpoint = previous?.version === 23 ? previous.checkpoint : undefined
    let migrated = previous?.version === 23 ? (previous.migrated ?? 0) : 0

    while (stage !== 'complete') {
      const sourceTable =
        stage === 'resources' ? this.database.resources : this.database.resourceVersions
      const summaryTable =
        stage === 'resources'
          ? this.database.resourceSummaries
          : this.database.resourceVersionSummaries
      const query = checkpoint
        ? sourceTable.where('id').above(checkpoint)
        : sourceTable.orderBy('id')
      const batch = await query.limit(THUMBNAIL_MIGRATION_BATCH_SIZE).toArray()
      if (!batch.length) {
        stage = stage === 'resources' ? 'resourceVersions' : 'complete'
        checkpoint = undefined
        continue
      }

      const patches: Array<{
        id: string
        thumbnailAssetId?: string
        encrypted: boolean
      }> = []
      for (const stored of batch) {
        if (isEncryptedResource(stored)) {
          patches.push({ id: stored.id, encrypted: true })
          continue
        }
        if (!(stored.thumbnailBlob instanceof Blob)) continue
        const asset = await this.assets.put(stored.thumbnailBlob, { source: 'thumbnail' })
        patches.push({ id: stored.id, thumbnailAssetId: asset.assetId, encrypted: false })
      }

      const nextCheckpoint = batch.at(-1)!.id
      migrated += patches.length
      await this.database.transaction(
        'rw',
        sourceTable,
        summaryTable,
        this.database.resourceListSummaries,
        this.database.settings,
        async () => {
          for (const patch of patches) {
            if (!patch.encrypted) {
              const updateResource = (record: StoredResource): void => {
                if (isEncryptedResource(record)) return
                record.thumbnailAssetId = patch.thumbnailAssetId
                record.thumbnailBlob = undefined
              }
              const updateSummary = (record: StoredResourceSummary): void => {
                if (isEncryptedResourceSummary(record)) return
                record.thumbnailAssetId = patch.thumbnailAssetId
                record.thumbnailBlob = undefined
              }
              if (stage === 'resources') {
                await this.database.resources.update(patch.id, updateResource)
                await this.database.resourceSummaries.update(patch.id, updateSummary)
              } else {
                await this.database.resourceVersions.update(patch.id, updateResource)
                await this.database.resourceVersionSummaries.update(patch.id, updateSummary)
              }
              if (stage === 'resources') {
                await this.database.resourceListSummaries.update(patch.id, (record) => {
                  if (isEncryptedResourceSummary(record)) return
                  record.thumbnailAssetId = patch.thumbnailAssetId
                  record.thumbnailBlob = undefined
                })
              }
            } else {
              const removeEncryptedThumbnail = (record: StoredResourceSummary): void => {
                if (isEncryptedResourceSummary(record)) record.thumbnail = undefined
              }
              if (stage === 'resources') {
                await this.database.resourceSummaries.update(patch.id, removeEncryptedThumbnail)
              } else {
                await this.database.resourceVersionSummaries.update(
                  patch.id,
                  removeEncryptedThumbnail,
                )
              }
              if (stage === 'resources') {
                await this.database.resourceListSummaries.update(patch.id, (record) => {
                  if (isEncryptedResourceSummary(record)) record.thumbnail = undefined
                })
              }
            }
          }
          await this.database.settings.put({
            id: THUMBNAIL_ASSET_MIGRATION_SETTING_ID,
            value: {
              version: 23,
              status: 'running',
              stage,
              checkpoint: nextCheckpoint,
              migrated,
            } satisfies ThumbnailAssetMigrationState,
            updatedAt: Date.now(),
          })
        },
      )
      checkpoint = nextCheckpoint
      if (batch.length === THUMBNAIL_MIGRATION_BATCH_SIZE) await yieldMainThread()
    }

    await this.database.settings.put({
      id: THUMBNAIL_ASSET_MIGRATION_SETTING_ID,
      value: {
        version: 23,
        status: 'complete',
        stage: 'complete',
        migrated,
      } satisfies ThumbnailAssetMigrationState,
      updatedAt: Date.now(),
    })
  }

  private async repairUnlinkedThumbnailAssets(): Promise<void> {
    const saved = await this.database.settings.get(THUMBNAIL_ASSET_REPAIR_SETTING_ID)
    const previous = saved?.value as Partial<ThumbnailAssetRepairState> | undefined
    if (previous?.version === 24 && previous.status === 'complete') return

    let stage: ThumbnailAssetRepairState['stage'] =
      previous?.version === 24 ? (previous.stage ?? 'resources') : 'resources'
    let checkpoint = previous?.version === 24 ? previous.checkpoint : undefined
    let repaired = previous?.version === 24 ? (previous.repaired ?? 0) : 0

    while (stage !== 'complete') {
      const sourceTable =
        stage === 'resources' ? this.database.resources : this.database.resourceVersions
      const summaryTable =
        stage === 'resources'
          ? this.database.resourceSummaries
          : this.database.resourceVersionSummaries
      const query = checkpoint
        ? sourceTable.where('id').above(checkpoint)
        : sourceTable.orderBy('id')
      const batch = await query.limit(THUMBNAIL_MIGRATION_BATCH_SIZE).toArray()
      if (!batch.length) {
        stage = stage === 'resources' ? 'resourceVersions' : 'complete'
        checkpoint = undefined
        continue
      }

      const patches: Array<{ id: string; thumbnailAssetId: string }> = []
      for (const stored of batch) {
        if (
          isEncryptedResource(stored) ||
          stored.thumbnailAssetId ||
          !(stored.thumbnailBlob instanceof Blob)
        ) {
          continue
        }
        const asset = await this.assets.put(stored.thumbnailBlob, { source: 'thumbnail' })
        patches.push({ id: stored.id, thumbnailAssetId: asset.assetId })
      }

      const nextCheckpoint = batch.at(-1)!.id
      let applied = 0
      await this.database.transaction(
        'rw',
        sourceTable,
        summaryTable,
        this.database.resourceListSummaries,
        this.database.settings,
        async () => {
          for (const patch of patches) {
            const current =
              stage === 'resources'
                ? await this.database.resources.get(patch.id)
                : await this.database.resourceVersions.get(patch.id)
            if (
              !current ||
              isEncryptedResource(current) ||
              current.thumbnailAssetId ||
              !(current.thumbnailBlob instanceof Blob)
            ) {
              continue
            }

            const updateResource = (record: StoredResource): void => {
              if (isEncryptedResource(record) || record.thumbnailAssetId) return
              record.thumbnailAssetId = patch.thumbnailAssetId
              record.thumbnailBlob = undefined
            }
            const updateSummary = (record: StoredResourceSummary): void => {
              if (isEncryptedResourceSummary(record) || record.thumbnailAssetId) return
              record.thumbnailAssetId = patch.thumbnailAssetId
              record.thumbnailBlob = undefined
            }

            if (stage === 'resources') {
              await this.database.resources.update(patch.id, updateResource)
              await this.database.resourceSummaries.update(patch.id, updateSummary)
              await this.database.resourceListSummaries.update(patch.id, updateSummary)
            } else {
              await this.database.resourceVersions.update(patch.id, updateResource)
              await this.database.resourceVersionSummaries.update(patch.id, updateSummary)
            }
            applied += 1
          }

          await this.database.settings.put({
            id: THUMBNAIL_ASSET_REPAIR_SETTING_ID,
            value: {
              version: 24,
              status: 'running',
              stage,
              checkpoint: nextCheckpoint,
              repaired: repaired + applied,
            } satisfies ThumbnailAssetRepairState,
            updatedAt: Date.now(),
          })
        },
      )
      repaired += applied
      checkpoint = nextCheckpoint
      if (batch.length === THUMBNAIL_MIGRATION_BATCH_SIZE) await yieldMainThread()
    }

    await this.database.settings.put({
      id: THUMBNAIL_ASSET_REPAIR_SETTING_ID,
      value: {
        version: 24,
        status: 'complete',
        stage: 'complete',
        repaired,
      } satisfies ThumbnailAssetRepairState,
      updatedAt: Date.now(),
    })
  }

  private async repairEmbeddedThumbnailAssets(): Promise<void> {
    const saved = await this.database.settings.get(THUMBNAIL_EMBEDDED_REPAIR_SETTING_ID)
    const previous = saved?.value as Partial<ThumbnailEmbeddedRepairState> | undefined
    if (previous?.version === 25 && previous.status === 'complete') return

    let stage: ThumbnailEmbeddedRepairState['stage'] =
      previous?.version === 25 ? (previous.stage ?? 'resources') : 'resources'
    let checkpoint = previous?.version === 25 ? previous.checkpoint : undefined
    let repaired = previous?.version === 25 ? (previous.repaired ?? 0) : 0

    while (stage !== 'complete') {
      const sourceTable =
        stage === 'resources' ? this.database.resources : this.database.resourceVersions
      const summaryTable =
        stage === 'resources'
          ? this.database.resourceSummaries
          : this.database.resourceVersionSummaries
      const query = checkpoint
        ? sourceTable.where('id').above(checkpoint)
        : sourceTable.orderBy('id')
      const batch = await query.limit(THUMBNAIL_MIGRATION_BATCH_SIZE).toArray()
      if (!batch.length) {
        stage = stage === 'resources' ? 'resourceVersions' : 'complete'
        checkpoint = undefined
        continue
      }

      const replacements: Array<{
        id: string
        stored: StoredResource
        summary: StoredResourceSummary
        listSummary?: StoredResourceSummary
      }> = []
      for (const stored of batch) {
        const decoded = hydrateResourceFromIndexedDb(
          (this.vault ? await this.vault.decodeResource(stored) : stored) as StoredResource,
        )
        if (!(decoded.thumbnailBlob instanceof Blob)) continue
        const externalized = await this.assets.externalizeResourceThumbnail(
          normalizeResource(decoded),
        )
        const replacement = this.vault
          ? await this.vault.encodeResource(externalized)
          : externalized
        const summary = this.toStoredSummary(replacement)
        const listSummary =
          stage === 'resources'
            ? (await this.createStoredListSummariesFromSummaries([summary]))[0]
            : undefined
        replacements.push({
          id: stored.id,
          stored: replacement,
          summary,
          listSummary,
        })
      }

      const nextCheckpoint = batch.at(-1)!.id
      await this.database.transaction(
        'rw',
        sourceTable,
        summaryTable,
        this.database.resourceListSummaries,
        this.database.settings,
        async () => {
          for (const replacement of replacements) {
            await sourceTable.put(replacement.stored)
            await summaryTable.put(replacement.summary)
            if (replacement.listSummary) {
              await this.database.resourceListSummaries.put(replacement.listSummary)
            }
          }
          await this.database.settings.put({
            id: THUMBNAIL_EMBEDDED_REPAIR_SETTING_ID,
            value: {
              version: 25,
              status: 'running',
              stage,
              checkpoint: nextCheckpoint,
              repaired: repaired + replacements.length,
            } satisfies ThumbnailEmbeddedRepairState,
            updatedAt: Date.now(),
          })
        },
      )
      repaired += replacements.length
      checkpoint = nextCheckpoint
      if (batch.length === THUMBNAIL_MIGRATION_BATCH_SIZE) await yieldMainThread()
    }

    // Old ArchiveStorage writes could leave the one-shot v20 list index marked complete while
    // missing restored rows. Rebuild this derived index once as part of the v25 repair.
    await this.repairResourceListSummaryIndex(true)
    await this.database.settings.put({
      id: THUMBNAIL_EMBEDDED_REPAIR_SETTING_ID,
      value: {
        version: 25,
        status: 'complete',
        stage: 'complete',
        repaired,
      } satisfies ThumbnailEmbeddedRepairState,
      updatedAt: Date.now(),
    })
  }

  private async prepareResourceForStorage(resource: Resource): Promise<Resource> {
    return this.assets.externalizeResourceThumbnail(await cloneResourceForStorage(resource))
  }

  private hydrateResourceThumbnail(resource: Resource): Promise<Resource> {
    return this.assets.hydrateResourceThumbnail(resource)
  }

  private async decodeStoredResource(resource: StoredResource): Promise<Resource> {
    const decoded = isNativeBackedResource(resource)
      ? await (async () => {
          const { nativeOriginal, ...record } = resource
          return {
            ...record,
            originalBlob: await readNativeResourceObject(
              nativeOriginal.contentHash,
              nativeOriginal.size,
              resource.mimeType,
            ),
          }
        })()
      : this.vault
        ? await this.vault.decodeResource(resource)
        : hydrateResourceFromIndexedDb(resource)
    return this.hydrateResourceThumbnail(
      normalizeResource(hydrateResourceFromIndexedDb(decoded as StoredResource)),
    )
  }

  async list(): Promise<Resource[]> {
    const stored = await this.database.resources.toArray()
    const resources = await Promise.all(
      stored.map((resource) => this.decodeStoredResource(resource)),
    )
    return resources.sort((left, right) => right.updatedAt - left.updatedAt)
  }

  async listSummaries(): Promise<ResourceSummary[]> {
    const table = this.database.resourceSummaries
    const ids = await table.toCollection().primaryKeys()
    const resources: ResourceSummary[] = []
    for (let start = 0; start < ids.length; start += SUMMARY_READ_BATCH_SIZE) {
      const stored = (
        await table.bulkGet(ids.slice(start, start + SUMMARY_READ_BATCH_SIZE))
      ).filter((resource): resource is StoredResourceSummary => resource !== undefined)
      resources.push(
        ...(await Promise.all(
          stored.map((resource) =>
            this.vault ? this.vault.decodeResourceSummary(resource) : (resource as ResourceSummary),
          ),
        )),
      )
      if (start + SUMMARY_READ_BATCH_SIZE < ids.length) await yieldMainThread()
    }
    resources.sort((left, right) => right.updatedAt - left.updatedAt)
    return resources
  }

  async listResourceListSummaries(): Promise<ResourceListSummary[]> {
    await this.repairResourceListSummaryIndex()
    const table = this.database.resourceListSummaries
    const ids = await table.toCollection().primaryKeys()
    const resources: ResourceListSummary[] = []
    for (let start = 0; start < ids.length; start += SUMMARY_READ_BATCH_SIZE) {
      const stored = (
        await table.bulkGet(ids.slice(start, start + SUMMARY_READ_BATCH_SIZE))
      ).filter((resource): resource is StoredResourceSummary => resource !== undefined)
      const decoded = await Promise.all(
        stored.map((resource) =>
          this.vault ? this.vault.decodeResourceSummary(resource) : (resource as ResourceSummary),
        ),
      )
      resources.push(...decoded.map(toResourceListSummary))
      if (start + SUMMARY_READ_BATCH_SIZE < ids.length) await yieldMainThread()
    }
    resources.sort((left, right) => right.updatedAt - left.updatedAt)
    return resources
  }

  private async repairResourceListSummaryIndex(force = false): Promise<void> {
    await this.database.transaction(
      'rw',
      [
        this.database.resources,
        this.database.resourceSummaries,
        this.database.resourceListSummaries,
        this.database.settings,
      ],
      async () => {
        const ids = await this.database.resources.toCollection().primaryKeys()
        const listed = await this.database.resourceListSummaries.toCollection().primaryKeys()
        const indexed = new Set(listed)
        if (
          !force &&
          ids.length === listed.length &&
          ids.every((id) => indexed.has(id)) &&
          (await this.database.settings.get(LIST_SUMMARY_INDEX_SETTING_ID))?.value === true
        )
          return
        // A completed migration marker is not evidence that the derived index is intact.
        // Rebuild from authoritative records atomically; failure never publishes a partial/empty list.
        for (const id of ids) {
          const resource = await this.database.resources.get(id)
          if (!resource) throw new Error('资源索引修复期间原始记录缺失')
          const summary = this.toStoredSummary(resource)
          const light = await Dexie.waitFor(this.createStoredListSummariesFromSummaries([summary]))
          await this.database.resourceSummaries.put(summary)
          await this.database.resourceListSummaries.bulkPut(light)
        }
        const validIds = new Set(ids)
        const staleIds = listed.filter((id) => !validIds.has(id))
        if (staleIds.length) await this.database.resourceListSummaries.bulkDelete(staleIds)
        await this.database.settings.put({
          id: LIST_SUMMARY_INDEX_SETTING_ID,
          value: true,
          updatedAt: Date.now(),
        })
      },
    )
  }

  private async createStoredListSummariesFromSummaries(
    summaries: StoredResourceSummary[],
  ): Promise<StoredResourceSummary[]> {
    return Promise.all(
      summaries.map(async (summary) => {
        const decoded = this.vault
          ? await this.vault.decodeResourceSummary(summary)
          : (summary as ResourceSummary)
        const light = toResourceListSummary(decoded)
        return this.vault ? this.vault.encodeResourceSummary(light) : light
      }),
    )
  }

  async get(id: string): Promise<Resource | undefined> {
    const stored = await this.database.resources.get(id)
    if (!stored) return undefined
    return this.decodeStoredResource(stored)
  }

  async findByHash(contentHash: string): Promise<Resource | undefined> {
    const stored = await this.database.resources.where('contentHash').equals(contentHash).first()
    if (!stored) return undefined
    return this.decodeStoredResource(stored)
  }

  async findVersionByHash(contentHash: string): Promise<Resource | undefined> {
    const stored = await this.database.resourceVersions
      .where('contentHash')
      .equals(contentHash)
      .first()
    if (!stored) return undefined
    return this.decodeStoredResource(stored)
  }

  async getVersion(id: string): Promise<Resource | undefined> {
    const stored = await this.database.resourceVersions.get(id)
    if (!stored) return undefined
    return this.decodeStoredResource(stored)
  }

  async listVersions(resourceId: string): Promise<Resource[]> {
    const stored = await this.database.resourceVersions
      .where('versionGroupId')
      .equals(resourceId)
      .toArray()
    const resources = await Promise.all(
      stored.map((resource) => this.decodeStoredResource(resource)),
    )
    return resources.sort((left, right) => right.updatedAt - left.updatedAt)
  }

  async listAllVersions(): Promise<Resource[]> {
    const stored = await this.database.resourceVersions.toArray()
    const resources = await Promise.all(
      stored.map((resource) => this.decodeStoredResource(resource)),
    )
    return resources.sort((left, right) => right.updatedAt - left.updatedAt)
  }

  async listVersionListSummaries(): Promise<ResourceListSummary[]> {
    const summaries: ResourceListSummary[] = []
    // Read authoritative versions one at a time; no full metadata/body array or repair scan.
    for (const id of await this.database.resourceVersions.toCollection().primaryKeys()) {
      const record = await this.database.resourceVersions.get(id)
      if (!record) continue
      const stored = this.toStoredSummary(record)
      const summary = this.vault
        ? await this.vault.decodeResourceSummary(stored)
        : (stored as ResourceSummary)
      summaries.push(toResourceListSummary(summary))
    }
    return summaries.sort((a, b) => b.updatedAt - a.updatedAt)
  }

  async listVersionSummaries(): Promise<ResourceSummary[]> {
    await this.repairVersionSummaryIndex()
    const stored = await this.database.resourceVersionSummaries.toArray()
    const resources = await Promise.all(
      stored.map((resource) =>
        this.vault ? this.vault.decodeResourceSummary(resource) : (resource as ResourceSummary),
      ),
    )
    return resources.sort((left, right) => right.updatedAt - left.updatedAt)
  }

  /**
   * `resourceVersions` 是历史版本的权威记录，摘要表只是可重建索引。
   *
   * 旧版恢复流程曾只写真实历史表，导致详情可见但重识别扫描不到；整库覆盖还
   * 可能留下已经不存在的摘要。更早的写入路径还可能留下“ID 存在，但哈希、
   * 时间线或更新时间已经过期”的摘要。每次读取历史摘要前以真实记录校正这些
   * 关键字段，补齐缺失项并删除幽灵项，避免详情页和重识别看到两套事实。
   */
  private async repairVersionSummaryIndex(): Promise<void> {
    await this.database.transaction(
      'rw',
      this.database.resourceVersions,
      this.database.resourceVersionSummaries,
      async () => {
        const [versions, summaries] = await Promise.all([
          this.database.resourceVersions.toArray(),
          this.database.resourceVersionSummaries.toArray(),
        ])
        const versionsById = new Map(versions.map((version) => [version.id, version]))
        const summariesById = new Map(summaries.map((summary) => [summary.id, summary]))
        const staleIds = summaries
          .filter((summary) => !versionsById.has(summary.id))
          .map((summary) => summary.id)
        const repaired = versions
          .filter((version) => {
            const summary = summariesById.get(version.id)
            return (
              !summary ||
              summary.contentHash !== version.contentHash ||
              summary.versionGroupId !== version.versionGroupId ||
              summary.updatedAt !== version.updatedAt
            )
          })
          .map((version) => this.toStoredSummary(version))

        if (staleIds.length) await this.database.resourceVersionSummaries.bulkDelete(staleIds)
        if (repaired.length) await this.database.resourceVersionSummaries.bulkPut(repaired)
      },
    )
  }

  /**
   * 健康中心使用的显式安全修复：真实资源与历史版本表是唯一权威来源，这里只
   * 重建可以随时再生的摘要索引，不改动任何用户原件、版本或附件。
   */
  async repairDerivedIndexes(): Promise<void> {
    await this.database.transaction(
      'rw',
      [
        this.database.resources,
        this.database.resourceSummaries,
        this.database.resourceListSummaries,
        this.database.resourceVersions,
        this.database.resourceVersionSummaries,
        this.database.settings,
      ],
      async () => {
        const [resources, versions] = await Promise.all([
          this.database.resources.toArray(),
          this.database.resourceVersions.toArray(),
        ])
        const summaries = resources.map((resource) => this.toStoredSummary(resource))
        const listSummaries = await this.createStoredListSummariesFromSummaries(summaries)
        const versionSummaries = versions.map((resource) => this.toStoredSummary(resource))

        await Promise.all([
          this.database.resourceSummaries.clear(),
          this.database.resourceListSummaries.clear(),
          this.database.resourceVersionSummaries.clear(),
        ])
        if (summaries.length) await this.database.resourceSummaries.bulkPut(summaries)
        if (listSummaries.length) await this.database.resourceListSummaries.bulkPut(listSummaries)
        if (versionSummaries.length) {
          await this.database.resourceVersionSummaries.bulkPut(versionSummaries)
        }
        await this.database.settings.put({
          id: LIST_SUMMARY_INDEX_SETTING_ID,
          value: true,
          updatedAt: Date.now(),
        })
      },
    )
  }

  async saveVersionSummary(summary: ResourceSummary): Promise<void> {
    if (!summary.versionGroupId) throw new Error('历史版本摘要缺少资源组 ID')
    const withoutBinary = toResourceListSummary(summary)
    const stored = this.vault
      ? await this.vault.encodeResourceSummary(withoutBinary)
      : withoutBinary
    await this.database.resourceVersionSummaries.put(stored)
  }

  /**
   * Replace only a verified duplicate IndexedDB Blob with an Android native-object reference.
   * The caller must have checked the native entry and object SHA-256 immediately beforehand.
   */
  async convertToNativeReference(
    id: string,
    scope: 'current' | 'versions',
    contentHash: string,
    size: number,
  ): Promise<boolean> {
    const normalizedHash = contentHash.toLowerCase()
    if (!/^[a-f0-9]{64}$/.test(normalizedHash) || !Number.isSafeInteger(size) || size < 0)
      throw new Error('原生引用哈希或大小无效')
    const table = scope === 'current' ? this.database.resources : this.database.resourceVersions
    return this.database.transaction('rw', table, async () => {
      const record = await table.get(id)
      if (
        !record ||
        isEncryptedResource(record) ||
        isNativeBackedResource(record) ||
        record.contentHash.toLowerCase() !== normalizedHash ||
        record.fileSize !== size ||
        hydrateResourceFromIndexedDb(record).originalBlob.size !== size
      )
        return false
      const { originalBlob: _originalBlob, ...metadata } = record
      const nativeRecord = {
        ...metadata,
        nativeOriginal: { version: 1, contentHash: normalizedHash, size },
      } as NativeBackedResourceRecord
      await table.put(nativeRecord)
      return true
    })
  }

  async saveVersion(version: Resource): Promise<void> {
    if (!version.versionGroupId) throw new Error('历史版本缺少资源组 ID')
    const normalized = await this.prepareResourceForStorage(version)
    const encoded = this.vault ? await this.vault.encodeResource(normalized) : normalized
    const stored = await materializeResourceForIndexedDb(encoded)
    await this.database.transaction(
      'rw',
      this.database.resourceVersions,
      this.database.resourceVersionSummaries,
      async () => {
        await this.database.resourceVersions.put(stored)
        await this.database.resourceVersionSummaries.put(this.toStoredSummary(stored))
      },
    )
  }

  async updateVersion(versionId: string, changes: Partial<Resource>): Promise<void> {
    const stored = await this.database.resourceVersions.get(versionId)
    if (!stored) return
    const current = hydrateResourceFromIndexedDb(
      (this.vault ? await this.vault.decodeResource(stored) : stored) as StoredResource,
    )
    const merged = { ...current, ...changes }
    if (
      Object.prototype.hasOwnProperty.call(changes, 'thumbnailBlob') &&
      !(changes.thumbnailBlob instanceof Blob)
    ) {
      merged.thumbnailAssetId = undefined
    }
    const normalized = await this.prepareResourceForStorage(merged)
    const encoded = this.vault ? await this.vault.encodeResource(normalized) : normalized
    const updated = await materializeResourceForIndexedDb(encoded)
    await this.database.transaction(
      'rw',
      this.database.resourceVersions,
      this.database.resourceVersionSummaries,
      async () => {
        await this.database.resourceVersions.put(updated)
        await this.database.resourceVersionSummaries.put(this.toStoredSummary(updated))
      },
    )
  }

  async deleteVersion(versionId: string): Promise<void> {
    await this.database.transaction(
      'rw',
      this.database.resourceVersions,
      this.database.resourceVersionSummaries,
      async () => {
        await this.database.resourceVersions.delete(versionId)
        await this.database.resourceVersionSummaries.delete(versionId)
      },
    )
  }

  async save(resource: Resource): Promise<void> {
    const normalized = await this.prepareResourceForStorage(resource)
    const stored = this.vault ? await this.vault.encodeResource(normalized) : normalized
    await this.putStoredResources([stored])
  }

  async saveMany(resources: Resource[]): Promise<void> {
    const normalized: Resource[] = []
    for (const resource of resources)
      normalized.push(await this.prepareResourceForStorage(resource))
    const stored = this.vault
      ? await Promise.all(normalized.map((resource) => this.vault!.encodeResource(resource)))
      : normalized
    await this.putStoredResources(stored)
  }

  async updateMetadata(
    id: string,
    changes: ResourceMetadataPatch,
    expectedPersonalDocument?: string,
  ): Promise<ResourceSummary> {
    if (changes.thumbnailBlob) {
      const asset = await this.assets.put(changes.thumbnailBlob, { source: 'thumbnail' })
      changes = { ...changes, thumbnailBlob: undefined, thumbnailAssetId: asset.assetId }
    }
    return this.database.transaction(
      'rw',
      [
        this.database.resources,
        this.database.resourceSummaries,
        this.database.resourceListSummaries,
      ],
      async () => {
        const stored = await this.database.resourceSummaries.get(id)
        if (!stored) throw new Error('资源摘要不存在，未修改资源')
        const current = this.vault
          ? await Dexie.waitFor(this.vault.decodeResourceSummary(stored))
          : (stored as ResourceSummary)
        if (
          expectedPersonalDocument !== undefined &&
          JSON.stringify(current.metadata.personalDocument ?? null) !== expectedPersonalDocument
        )
          throw new Error('小手机内容已被其他操作修改，请重新打开后编辑')
        // Clone only the metadata. The original file never enters decryption, hashing or mirroring.
        const normalized = await cloneResourceForStorage({
          ...current,
          ...changes,
          metadata: { ...current.metadata, ...changes.metadata },
          originalBlob: new Blob(),
        })
        if ('thumbnailBlob' in changes) {
          normalized.thumbnailAssetId = changes.thumbnailAssetId
          normalized.thumbnailBlob = undefined
        }
        const summary = { ...toResourceSummary(normalized), thumbnailBlob: undefined }
        const encoded = this.vault
          ? await Dexie.waitFor(this.vault.encodeResourceSummary(summary))
          : summary
        const light = (
          await Dexie.waitFor(this.createStoredListSummariesFromSummaries([encoded]))
        )[0]!
        if (!(await this.database.resources.update(id, encoded))) throw new Error('资源已经不存在')
        await this.database.resourceSummaries.put(encoded)
        await this.database.resourceListSummaries.put(light)
        return summary
      },
    )
  }

  async update(id: string, changes: Partial<Resource>): Promise<void> {
    if (
      !['originalBlob', 'contentHash', 'fileSize', 'fileName', 'mimeType', 'id', 'createdAt'].some(
        (key) => key in changes,
      )
    ) {
      await this.updateMetadata(id, changes)
      return
    }
    const stored = await this.database.resources.get(id)
    if (!stored) return
    const resource = hydrateResourceFromIndexedDb(
      (this.vault ? await this.vault.decodeResource(stored) : stored) as StoredResource,
    )
    const merged = { ...resource, ...changes }
    if (
      Object.prototype.hasOwnProperty.call(changes, 'thumbnailBlob') &&
      !(changes.thumbnailBlob instanceof Blob)
    ) {
      merged.thumbnailAssetId = undefined
    }
    const updated = await this.prepareResourceForStorage(merged)
    const encoded = this.vault ? await this.vault.encodeResource(updated) : updated
    const replaceStableBinaryIds = Object.prototype.hasOwnProperty.call(changes, 'thumbnailBlob')
      ? new Set([id])
      : undefined
    await this.putStoredResources([encoded], replaceStableBinaryIds)
  }

  async updateMany(ids: string[], changes: Partial<Resource>): Promise<void> {
    if (
      !['originalBlob', 'contentHash', 'fileSize', 'fileName', 'mimeType', 'id', 'createdAt'].some(
        (key) => key in changes,
      )
    ) {
      if (changes.thumbnailBlob) {
        const asset = await this.assets.put(changes.thumbnailBlob, { source: 'thumbnail' })
        changes = { ...changes, thumbnailBlob: undefined, thumbnailAssetId: asset.assetId }
      }
      // Keep all related indexes and the entire batch in one transaction.
      await this.database.transaction(
        'rw',
        [
          this.database.resources,
          this.database.resourceSummaries,
          this.database.resourceListSummaries,
          this.database.assets,
          this.database.assetFiles,
        ],
        async () => {
          for (const id of ids) await this.updateMetadata(id, changes)
        },
      )
      return
    }
    const stored = await this.database.resources.bulkGet(ids)
    const updated = await Promise.all(
      stored
        .flatMap((item) => (item ? [item] : []))
        .map(async (item) => {
          const resource = hydrateResourceFromIndexedDb(
            (this.vault ? await this.vault.decodeResource(item) : item) as StoredResource,
          )
          const merged = { ...resource, ...changes }
          if (
            Object.prototype.hasOwnProperty.call(changes, 'thumbnailBlob') &&
            !(changes.thumbnailBlob instanceof Blob)
          ) {
            merged.thumbnailAssetId = undefined
          }
          const normalized = await this.prepareResourceForStorage(merged)
          return this.vault ? this.vault.encodeResource(normalized) : normalized
        }),
    )
    if (updated.length) await this.putStoredResources(updated)
  }

  async delete(id: string): Promise<void> {
    await this.database.transaction(
      'rw',
      this.database.resources,
      this.database.resourceSummaries,
      this.database.resourceListSummaries,
      this.database.resourceVersions,
      this.database.resourceVersionSummaries,
      async () => {
        const versions = await this.database.resourceVersions
          .where('versionGroupId')
          .equals(id)
          .primaryKeys()
        if (versions.length) {
          await this.database.resourceVersions.bulkDelete(versions)
          await this.database.resourceVersionSummaries.bulkDelete(versions)
        }
        await this.database.resources.delete(id)
        await this.database.resourceSummaries.delete(id)
        await this.database.resourceListSummaries.delete(id)
      },
    )
  }

  async deleteMany(ids: string[]): Promise<void> {
    await this.database.transaction(
      'rw',
      this.database.resources,
      this.database.resourceSummaries,
      this.database.resourceListSummaries,
      this.database.resourceVersions,
      this.database.resourceVersionSummaries,
      async () => {
        const versions = await this.database.resourceVersions
          .where('versionGroupId')
          .anyOf(ids)
          .primaryKeys()
        if (versions.length) {
          await this.database.resourceVersions.bulkDelete(versions)
          await this.database.resourceVersionSummaries.bulkDelete(versions)
        }
        await this.database.resources.bulkDelete(ids)
        await this.database.resourceSummaries.bulkDelete(ids)
        await this.database.resourceListSummaries.bulkDelete(ids)
      },
    )
  }

  private toStoredSummary(resource: StoredResource): StoredResourceSummary {
    if (isNativeBackedResource(resource)) {
      const { nativeOriginal: _nativeOriginal, ...summary } = resource
      return summary
    }
    if (!isEncryptedResource(resource))
      return { ...toResourceSummary(resource as Resource), thumbnailBlob: undefined }
    return {
      id: resource.id,
      contentHash: resource.contentHash,
      versionGroupId: resource.versionGroupId,
      updatedAt: resource.updatedAt,
      encrypted: true,
      payload: resource.payload,
    }
  }

  private async putStoredResources(
    resources: StoredResource[],
    replaceStableBinaryIds = new Set<string>(),
  ): Promise<void> {
    if (!resources.length) return
    const storedResources = await Promise.all(resources.map(materializeResourceForIndexedDb))
    const summaries = storedResources.map((resource) => this.toStoredSummary(resource))
    const listSummaries = await this.createStoredListSummariesFromSummaries(summaries)
    await this.database.transaction(
      'rw',
      this.database.resources,
      this.database.resourceSummaries,
      this.database.resourceListSummaries,
      async () => {
        for (const resource of storedResources) {
          const existing = await this.database.resources.get(resource.id)
          if (
            existing?.contentHash === resource.contentHash &&
            !replaceStableBinaryIds.has(resource.id)
          ) {
            await this.database.resources.update(
              resource.id,
              stripStableResourceBinaryFields(resource),
            )
          } else {
            await this.database.resources.put(resource)
          }
        }

        for (const summary of summaries) {
          const existing = await this.database.resourceSummaries.get(summary.id)
          if (
            existing?.contentHash === summary.contentHash &&
            !replaceStableBinaryIds.has(summary.id)
          ) {
            await this.database.resourceSummaries.update(
              summary.id,
              stripStableSummaryBinaryFields(summary),
            )
          } else {
            await this.database.resourceSummaries.put(summary)
          }
        }
        await this.database.resourceListSummaries.bulkPut(listSummaries)
      },
    )
  }
}
