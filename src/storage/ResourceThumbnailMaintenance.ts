import type { AppDatabase } from '../database/AppDatabase'

import type { VaultService } from '../services/VaultService'

import { normalizeResource } from '../types/Resource'

import {
  isEncryptedResource,
  isEncryptedResourceSummary,
  type StoredResource,
  type StoredResourceSummary,
} from '../types/Vault'

import { IndexedDbAssetStore } from './IndexedDbAssetStore'

import { hydrateResourceFromIndexedDb } from './ResourceStorageClone'

export interface ResourceThumbnailMaintenanceContext {
  thumbnailMigrationPromise: Promise<number> | undefined
  database: AppDatabase
  assets: IndexedDbAssetStore
  vault: VaultService | undefined
  toStoredSummary: (resource: StoredResource) => StoredResourceSummary
  createStoredListSummariesFromSummaries: (
    summaries: StoredResourceSummary[],
  ) => Promise<StoredResourceSummary[]>
  repairResourceListSummaryIndex: (force?: boolean) => Promise<void>
}
export const THUMBNAIL_ASSET_MIGRATION_SETTING_ID = 'migration.resourceThumbnails.asset.v23'

export const THUMBNAIL_ASSET_REPAIR_SETTING_ID = 'repair.resourceThumbnails.asset.v24'

export const THUMBNAIL_EMBEDDED_REPAIR_SETTING_ID = 'repair.resourceThumbnails.asset.v25'

export const THUMBNAIL_MIGRATION_BATCH_SIZE = 25

export interface ThumbnailAssetMigrationState {
  version: 23
  status: 'running' | 'complete'
  stage: 'resources' | 'resourceVersions' | 'complete'
  checkpoint?: string
  migrated: number
}

export interface ThumbnailAssetRepairState {
  version: 24
  status: 'running' | 'complete'
  stage: 'resources' | 'resourceVersions' | 'complete'
  checkpoint?: string
  repaired: number
}

export interface ThumbnailEmbeddedRepairState {
  version: 25
  status: 'running' | 'complete'
  stage: 'resources' | 'resourceVersions' | 'complete'
  checkpoint?: string
  repaired: number
}

export function yieldMainThread(): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, 0))
}
export function repairThumbnailAssets(
  context: ResourceThumbnailMaintenanceContext,
): Promise<number> {
  if (context.thumbnailMigrationPromise) return context.thumbnailMigrationPromise
  const operation = (async () => {
    const [legacyState, unlinkedState, embeddedState] = await Promise.all([
      context.database.settings.get(THUMBNAIL_ASSET_MIGRATION_SETTING_ID),
      context.database.settings.get(THUMBNAIL_ASSET_REPAIR_SETTING_ID),
      context.database.settings.get(THUMBNAIL_EMBEDDED_REPAIR_SETTING_ID),
    ])
    const needsRefresh =
      (legacyState?.value as Partial<ThumbnailAssetMigrationState> | undefined)?.status !==
        'complete' ||
      (unlinkedState?.value as Partial<ThumbnailAssetRepairState> | undefined)?.status !==
        'complete' ||
      (embeddedState?.value as Partial<ThumbnailEmbeddedRepairState> | undefined)?.status !==
        'complete'
    await migrateLegacyThumbnails(context)
    await repairUnlinkedThumbnailAssets(context)
    await repairEmbeddedThumbnailAssets(context)
    return needsRefresh ? 1 : 0
  })()
  context.thumbnailMigrationPromise = operation
  void operation
    .finally(() => {
      if (context.thumbnailMigrationPromise === operation)
        context.thumbnailMigrationPromise = undefined
    })
    .catch(() => undefined)
  return operation
}

export async function migrateLegacyThumbnails(
  context: ResourceThumbnailMaintenanceContext,
): Promise<void> {
  const saved = await context.database.settings.get(THUMBNAIL_ASSET_MIGRATION_SETTING_ID)
  const previous = saved?.value as Partial<ThumbnailAssetMigrationState> | undefined
  if (previous?.version === 23 && previous.status === 'complete') return

  let stage: ThumbnailAssetMigrationState['stage'] =
    previous?.version === 23 ? (previous.stage ?? 'resources') : 'resources'
  let checkpoint = previous?.version === 23 ? previous.checkpoint : undefined
  let migrated = previous?.version === 23 ? (previous.migrated ?? 0) : 0

  while (stage !== 'complete') {
    const sourceTable =
      stage === 'resources' ? context.database.resources : context.database.resourceVersions
    const summaryTable =
      stage === 'resources'
        ? context.database.resourceSummaries
        : context.database.resourceVersionSummaries
    const query = checkpoint ? sourceTable.where('id').above(checkpoint) : sourceTable.orderBy('id')
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
      const asset = await context.assets.put(stored.thumbnailBlob, { source: 'thumbnail' })
      patches.push({ id: stored.id, thumbnailAssetId: asset.assetId, encrypted: false })
    }

    const nextCheckpoint = batch.at(-1)!.id
    migrated += patches.length
    await context.database.transaction(
      'rw',
      sourceTable,
      summaryTable,
      context.database.resourceListSummaries,
      context.database.settings,
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
              await context.database.resources.update(patch.id, updateResource)
              await context.database.resourceSummaries.update(patch.id, updateSummary)
            } else {
              await context.database.resourceVersions.update(patch.id, updateResource)
              await context.database.resourceVersionSummaries.update(patch.id, updateSummary)
            }
            if (stage === 'resources') {
              await context.database.resourceListSummaries.update(patch.id, (record) => {
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
              await context.database.resourceSummaries.update(patch.id, removeEncryptedThumbnail)
            } else {
              await context.database.resourceVersionSummaries.update(
                patch.id,
                removeEncryptedThumbnail,
              )
            }
            if (stage === 'resources') {
              await context.database.resourceListSummaries.update(patch.id, (record) => {
                if (isEncryptedResourceSummary(record)) record.thumbnail = undefined
              })
            }
          }
        }
        await context.database.settings.put({
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

  await context.database.settings.put({
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

export async function repairUnlinkedThumbnailAssets(
  context: ResourceThumbnailMaintenanceContext,
): Promise<void> {
  const saved = await context.database.settings.get(THUMBNAIL_ASSET_REPAIR_SETTING_ID)
  const previous = saved?.value as Partial<ThumbnailAssetRepairState> | undefined
  if (previous?.version === 24 && previous.status === 'complete') return

  let stage: ThumbnailAssetRepairState['stage'] =
    previous?.version === 24 ? (previous.stage ?? 'resources') : 'resources'
  let checkpoint = previous?.version === 24 ? previous.checkpoint : undefined
  let repaired = previous?.version === 24 ? (previous.repaired ?? 0) : 0

  while (stage !== 'complete') {
    const sourceTable =
      stage === 'resources' ? context.database.resources : context.database.resourceVersions
    const summaryTable =
      stage === 'resources'
        ? context.database.resourceSummaries
        : context.database.resourceVersionSummaries
    const query = checkpoint ? sourceTable.where('id').above(checkpoint) : sourceTable.orderBy('id')
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
      const asset = await context.assets.put(stored.thumbnailBlob, { source: 'thumbnail' })
      patches.push({ id: stored.id, thumbnailAssetId: asset.assetId })
    }

    const nextCheckpoint = batch.at(-1)!.id
    let applied = 0
    await context.database.transaction(
      'rw',
      sourceTable,
      summaryTable,
      context.database.resourceListSummaries,
      context.database.settings,
      async () => {
        for (const patch of patches) {
          const current =
            stage === 'resources'
              ? await context.database.resources.get(patch.id)
              : await context.database.resourceVersions.get(patch.id)
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
            await context.database.resources.update(patch.id, updateResource)
            await context.database.resourceSummaries.update(patch.id, updateSummary)
            await context.database.resourceListSummaries.update(patch.id, updateSummary)
          } else {
            await context.database.resourceVersions.update(patch.id, updateResource)
            await context.database.resourceVersionSummaries.update(patch.id, updateSummary)
          }
          applied += 1
        }

        await context.database.settings.put({
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

  await context.database.settings.put({
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

export async function repairEmbeddedThumbnailAssets(
  context: ResourceThumbnailMaintenanceContext,
): Promise<void> {
  const saved = await context.database.settings.get(THUMBNAIL_EMBEDDED_REPAIR_SETTING_ID)
  const previous = saved?.value as Partial<ThumbnailEmbeddedRepairState> | undefined
  if (previous?.version === 25 && previous.status === 'complete') return

  let stage: ThumbnailEmbeddedRepairState['stage'] =
    previous?.version === 25 ? (previous.stage ?? 'resources') : 'resources'
  let checkpoint = previous?.version === 25 ? previous.checkpoint : undefined
  let repaired = previous?.version === 25 ? (previous.repaired ?? 0) : 0

  while (stage !== 'complete') {
    const sourceTable =
      stage === 'resources' ? context.database.resources : context.database.resourceVersions
    const summaryTable =
      stage === 'resources'
        ? context.database.resourceSummaries
        : context.database.resourceVersionSummaries
    const query = checkpoint ? sourceTable.where('id').above(checkpoint) : sourceTable.orderBy('id')
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
        (context.vault ? await context.vault.decodeResource(stored) : stored) as StoredResource,
      )
      if (!(decoded.thumbnailBlob instanceof Blob)) continue
      const externalized = await context.assets.externalizeResourceThumbnail(
        normalizeResource(decoded),
      )
      const replacement = context.vault
        ? await context.vault.encodeResource(externalized)
        : externalized
      const summary = context.toStoredSummary(replacement)
      const listSummary =
        stage === 'resources'
          ? (await context.createStoredListSummariesFromSummaries([summary]))[0]
          : undefined
      replacements.push({
        id: stored.id,
        stored: replacement,
        summary,
        listSummary,
      })
    }

    const nextCheckpoint = batch.at(-1)!.id
    await context.database.transaction(
      'rw',
      sourceTable,
      summaryTable,
      context.database.resourceListSummaries,
      context.database.settings,
      async () => {
        for (const replacement of replacements) {
          await sourceTable.put(replacement.stored)
          await summaryTable.put(replacement.summary)
          if (replacement.listSummary) {
            await context.database.resourceListSummaries.put(replacement.listSummary)
          }
        }
        await context.database.settings.put({
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
  await context.repairResourceListSummaryIndex(true)
  await context.database.settings.put({
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
