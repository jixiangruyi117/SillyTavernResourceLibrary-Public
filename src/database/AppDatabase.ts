import Dexie, { type EntityTable, type Table } from 'dexie'

import {
  toResourceSummary,
  type AppSetting,
  type BackupRecord,
  type ResourceListSummary,
} from '../types/Resource'
import type {
  StoredCommunitySource,
  StoredCommunitySourceMessage,
  StoredResourceSourceBinding,
} from '../types/CommunitySource'
import type {
  ExternalAppDataRecord,
  ExternalAppRuntimeRecord,
  InstalledExternalApp,
  InstalledExternalAppSummary,
} from '../types/ExternalApp'
import type {
  FrontendWorkshopProject,
  FrontendWorkshopProjectLastGoodRecord,
} from '../types/FrontendWorkshopProject'
import type {
  FrontendWorkshopSourceDocument,
  FrontendWorkshopSourceDocumentLastGoodRecord,
} from '../types/FrontendWorkshopSourceDocument'
import type { FrontendWorkshopSourceComponent } from '../types/FrontendWorkshopSourceComponent'
import type { GeneratedImageAlbumFile, GeneratedImageAlbumItem } from '../types/GeneratedImageAlbum'
import type { RestoreStagingMetadata, StoredRestoreStagingChunk } from '../types/RestoreStaging'
import type { AssetFileRecord, AssetRecord } from '../types/Asset'
import { BUILD_INFO } from '../core/BuildInfo'
import {
  isEncryptedResource,
  isNativeBackedResource,
  type StoredCategory,
  type StoredResource,
  type StoredResourceSummary,
} from '../types/Vault'

const DATABASE_NAME = 'SillyTavernResourceLibrary'
export const DATABASE_VERSION = BUILD_INFO.databaseVersion

const DATABASE_SCHEMA_V3 = {
  resources:
    'id, type, name, favorite, categoryId, *categoryIds, createdAt, updatedAt, contentHash, *tags',
  categories: 'id, name, createdAt, updatedAt',
  settings: 'id, updatedAt',
  backupRecords: 'id, adapter, createdAt',
}

const DATABASE_SCHEMA = {
  ...DATABASE_SCHEMA_V3,
  resourceSummaries:
    'id, type, name, favorite, categoryId, *categoryIds, createdAt, updatedAt, contentHash, *tags',
  resourceVersions: 'id, versionGroupId, contentHash, updatedAt',
  resourceVersionSummaries: 'id, versionGroupId, contentHash, updatedAt',
}

const DATABASE_SCHEMA_V7 = {
  ...DATABASE_SCHEMA,
  externalApps: 'id, enabled, updatedAt',
  externalAppData: 'id, appId, updatedAt',
}

const DATABASE_SCHEMA_V9 = {
  ...DATABASE_SCHEMA_V7,
  // Keep the retired table in the schema so browsers already upgraded to v9 remain compatible.
  externalAppDrafts: 'id, appId, status, updatedAt',
}

const DATABASE_SCHEMA_V10 = {
  ...DATABASE_SCHEMA_V9,
  externalAppRuntimes: 'id, updatedAt',
}

const DATABASE_SCHEMA_V12 = {
  ...DATABASE_SCHEMA_V10,
  frontendWorkshopProjects: 'id, kind, updatedAt',
}

const DATABASE_SCHEMA_V13 = {
  ...DATABASE_SCHEMA_V12,
  generatedImages: 'id, createdAt, updatedAt, mimeType, category, source, provider, hostedUrl',
  generatedImageFiles: 'id, updatedAt',
}

const DATABASE_SCHEMA_V14 = DATABASE_SCHEMA_V13
const DATABASE_SCHEMA_V15 = DATABASE_SCHEMA_V14
const DATABASE_SCHEMA_V16 = {
  ...DATABASE_SCHEMA_V15,
  frontendWorkshopProjectLastGood: 'id, projectId, savedAt',
}
const DATABASE_SCHEMA_V17 = DATABASE_SCHEMA_V16
const DATABASE_SCHEMA_V18 = {
  ...DATABASE_SCHEMA_V17,
  restoreStaging: '[jobId+path], jobId, path, updatedAt',
}
const DATABASE_SCHEMA_V19 = {
  ...DATABASE_SCHEMA_V18,
  restoreStagingChunks: '[jobId+path+chunkIndex], jobId, [jobId+path], updatedAt',
}
const DATABASE_SCHEMA_V20 = {
  ...DATABASE_SCHEMA_V19,
  resourceListSummaries:
    'id, type, name, favorite, categoryId, *categoryIds, createdAt, updatedAt, contentHash, *tags',
}
const DATABASE_SCHEMA_V21 = {
  ...DATABASE_SCHEMA_V20,
  generatedImages:
    'id, createdAt, updatedAt, mimeType, category, source, provider, hostedUrl, [category+createdAt], [mimeType+createdAt], [category+mimeType+createdAt]',
}
const DATABASE_SCHEMA_V22 = {
  ...DATABASE_SCHEMA_V21,
  assets: 'assetId, contentHash, mimeType, source, createdAt',
  assetFiles: 'assetId, updatedAt',
}
const DATABASE_SCHEMA_V23 = {
  ...DATABASE_SCHEMA_V22,
  frontendWorkshopSourceDocuments: 'projectId, updatedAt',
  frontendWorkshopSourceDocumentLastGood: 'projectId, savedAt',
}
const DATABASE_SCHEMA_V24 = {
  ...DATABASE_SCHEMA_V23,
  frontendWorkshopSourceComponents: 'id, updatedAt, createdAt, *tags',
}
const DATABASE_SCHEMA_V25 = {
  ...DATABASE_SCHEMA_V24,
  communitySources: 'id, platform, &sourceKeyHash, updatedAt',
  communitySourceMessages:
    'id, sourceId, messageKeyHash, kind, capturedAt, [sourceId+kind], &[sourceId+messageKeyHash]',
  resourceSourceBindings: 'id, resourceId, sourceId, createdAt, &[resourceId+sourceId]',
}

export class AppDatabase extends Dexie {
  resources!: EntityTable<StoredResource, 'id'>
  resourceSummaries!: EntityTable<StoredResourceSummary, 'id'>
  resourceListSummaries!: EntityTable<StoredResourceSummary | ResourceListSummary, 'id'>
  resourceVersions!: EntityTable<StoredResource, 'id'>
  resourceVersionSummaries!: EntityTable<StoredResourceSummary, 'id'>
  categories!: EntityTable<StoredCategory, 'id'>
  settings!: EntityTable<AppSetting, 'id'>
  backupRecords!: EntityTable<BackupRecord, 'id'>
  externalApps!: EntityTable<InstalledExternalAppSummary, 'id'>
  externalAppRuntimes!: EntityTable<ExternalAppRuntimeRecord, 'id'>
  externalAppData!: EntityTable<ExternalAppDataRecord, 'id'>
  frontendWorkshopProjects!: EntityTable<FrontendWorkshopProject, 'id'>
  frontendWorkshopProjectLastGood!: EntityTable<FrontendWorkshopProjectLastGoodRecord, 'id'>
  frontendWorkshopSourceDocuments!: EntityTable<FrontendWorkshopSourceDocument, 'projectId'>
  frontendWorkshopSourceDocumentLastGood!: EntityTable<
    FrontendWorkshopSourceDocumentLastGoodRecord,
    'projectId'
  >
  frontendWorkshopSourceComponents!: EntityTable<FrontendWorkshopSourceComponent, 'id'>
  generatedImages!: EntityTable<GeneratedImageAlbumItem, 'id'>
  generatedImageFiles!: EntityTable<GeneratedImageAlbumFile, 'id'>
  restoreStaging!: Table<RestoreStagingMetadata, [string, string]>
  restoreStagingChunks!: Table<StoredRestoreStagingChunk, [string, string, number]>
  assets!: EntityTable<AssetRecord, 'assetId'>
  assetFiles!: EntityTable<AssetFileRecord, 'assetId'>
  communitySources!: EntityTable<StoredCommunitySource, 'id'>
  communitySourceMessages!: EntityTable<StoredCommunitySourceMessage, 'id'>
  resourceSourceBindings!: EntityTable<StoredResourceSourceBinding, 'id'>

  constructor(databaseName = DATABASE_NAME) {
    super(databaseName)

    this.version(2).stores({
      resources: 'id, type, name, favorite, categoryId, createdAt, updatedAt, contentHash, *tags',
      categories: 'id, name, createdAt, updatedAt',
      settings: 'id, updatedAt',
      backupRecords: 'id, adapter, createdAt',
    })

    this.version(3)
      .stores(DATABASE_SCHEMA_V3)
      .upgrade((transaction) =>
        transaction
          .table('resources')
          .toCollection()
          .modify((resource) => {
            if (resource.encrypted === true) return
            const categoryIds = Array.isArray(resource.categoryIds)
              ? resource.categoryIds
              : typeof resource.categoryId === 'string'
                ? [resource.categoryId]
                : []
            resource.categoryIds = Array.from(new Set(categoryIds.filter(Boolean)))
            resource.categoryId = resource.categoryIds[0] ?? null
            resource.relatedResourceIds = Array.isArray(resource.relatedResourceIds)
              ? Array.from(new Set(resource.relatedResourceIds.filter(Boolean)))
              : []
          }),
      )

    this.version(7)
      .stores(DATABASE_SCHEMA_V7)
      .upgrade(async (transaction) => {
        const resources = (await transaction.table('resources').toArray()) as StoredResource[]
        const versions = (await transaction.table('resourceVersions').toArray()) as StoredResource[]
        const toStoredSummary = (resource: StoredResource): StoredResourceSummary => {
          if (isEncryptedResource(resource)) {
            return {
              id: resource.id,
              contentHash: resource.contentHash,
              versionGroupId: resource.versionGroupId,
              updatedAt: resource.updatedAt,
              encrypted: true,
              payload: resource.payload,
              thumbnail: resource.thumbnail,
            }
          }
          if (isNativeBackedResource(resource)) {
            const { nativeOriginal: _nativeOriginal, ...summary } = resource
            return summary
          }
          return toResourceSummary(resource)
        }
        const summaries = resources.map(toStoredSummary)
        const versionSummaries = versions.map(toStoredSummary)
        if (summaries.length) await transaction.table('resourceSummaries').bulkPut(summaries)
        if (versionSummaries.length) {
          await transaction.table('resourceVersionSummaries').bulkPut(versionSummaries)
        }
      })

    this.version(8)
      .stores(DATABASE_SCHEMA_V7)
      .upgrade((transaction) =>
        transaction
          .table('externalApps')
          .toCollection()
          .modify((app: InstalledExternalApp) => {
            if (!Array.isArray(app.grantedPermissions)) {
              app.grantedPermissions = Array.isArray(app.manifest.permissions)
                ? [...app.manifest.permissions]
                : []
            }
          }),
      )

    this.version(9).stores(DATABASE_SCHEMA_V9)

    this.version(10)
      .stores(DATABASE_SCHEMA_V10)
      .upgrade(async (transaction) => {
        const apps = transaction.table('externalApps')
        const runtimes = transaction.table('externalAppRuntimes')
        const legacyApps = (await apps.toArray()) as InstalledExternalApp[]
        const runtimeRecords = legacyApps
          .filter((record) => Boolean(record.runtimeHtml))
          .map((record) => ({
            id: record.id,
            runtimeHtml: record.runtimeHtml,
            updatedAt: record.updatedAt,
          }))
        if (runtimeRecords.length) await runtimes.bulkPut(runtimeRecords)
        await apps.toCollection().modify((record: InstalledExternalApp) => {
          delete (record as Partial<InstalledExternalApp>).runtimeHtml
        })
      })

    this.version(12).stores(DATABASE_SCHEMA_V12)

    this.version(13).stores(DATABASE_SCHEMA_V13)

    // Historical v14/v16 payload conversions were intentionally removed. They loaded every
    // image into memory and expanded binary data into Base64 during an IndexedDB upgrade.
    // IndexedDbGeneratedImageAlbumStorage now performs a bounded, checkpointed v17 migration.
    this.version(14).stores(DATABASE_SCHEMA_V14)
    this.version(16).stores(DATABASE_SCHEMA_V16)
    this.version(17).stores(DATABASE_SCHEMA_V17)
    this.version(18).stores(DATABASE_SCHEMA_V18)
    this.version(19).stores(DATABASE_SCHEMA_V19)
    this.version(20).stores(DATABASE_SCHEMA_V20)
    this.version(21).stores(DATABASE_SCHEMA_V21)
    this.version(22).stores(DATABASE_SCHEMA_V22)
    this.version(23).stores(DATABASE_SCHEMA_V23)
    this.version(24).stores(DATABASE_SCHEMA_V24)
    this.version(DATABASE_VERSION).stores(DATABASE_SCHEMA_V25)
  }
}
