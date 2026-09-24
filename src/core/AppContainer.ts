import { PersonalResourceParser } from '../parser/PersonalResourceParser'
import { ResourceArchiveService } from '../services/ResourceArchiveService'
import { appDatabase as database } from './AppDatabaseInstance'
import { JsonResourceParser } from '../parser/JsonResourceParser'
import { PngResourceParser } from '../parser/PngResourceParser'
import { ResourceParserRegistry } from '../parser/ResourceParser'
import { TextBeautificationParser } from '../parser/TextBeautificationParser'
import { CategoryService } from '../services/CategoryService'
import { AiTaggingDraftService } from '../services/AiTaggingDraftService'
import { AiTaggingService } from '../services/AiTaggingService'
import { CloudBackupService } from '../services/CloudBackupService'
import { BrowserStorageService } from '../services/BrowserStorageService'
import { CharacterDrawService } from '../services/CharacterDrawService'
import {
  exportCommunitySourceLocalAttachments,
  restoreCommunitySourceLocalAttachments,
} from '../services/CommunitySourceAttachmentArchive'
import { CommunitySourceRestoreService } from '../services/CommunitySourceRestoreService'
import { CommunitySourceService } from '../services/CommunitySourceService'
import { ExportService } from '../services/ExportService'
import { HistoryService } from '../services/HistoryService'
import { MainApiService } from '../services/MainApiService'
import { NativeResourceRecoveryService } from '../services/NativeResourceRecoveryService'
import { ResourceService } from '../services/ResourceService'
import { GreetingResourceService } from '../services/GreetingResourceService'
import { RecycleBinService } from '../services/RecycleBinService'
import { VaultService } from '../services/VaultService'
import { UserPersonaService } from '../services/UserPersonaService'
import { IndexedDbArchiveStorage } from '../storage/IndexedDbArchiveStorage'
import { IndexedDbCategoryStorage } from '../storage/IndexedDbCategoryStorage'
import { IndexedDbCommunitySourceStorage } from '../storage/IndexedDbCommunitySourceStorage'
import { IndexedDbExternalAppStorage } from '../storage/IndexedDbExternalAppStorage'
import { IndexedDbResourceStorage } from '../storage/IndexedDbResourceStorage'
import { IndexedDbResourceHealthStorage } from '../storage/IndexedDbResourceHealthStorage'
import { IndexedDbRestoreStagingStore } from '../storage/IndexedDbRestoreStagingStore'
import { NativeMirroredResourceStorage } from '../storage/NativeMirroredResourceStorage'
import {
  getNativeResourceStorageInfo,
  mirrorNativeResourceFile,
} from '../storage/NativeResourceFileMirror'
import { ExternalAppService } from '../services/ExternalAppService'
import { ExternalAppSdkService } from '../services/ExternalAppSdkService'
import { hashBytes } from '../services/HashService'
import { IndexedDbAssetStore } from '../storage/IndexedDbAssetStore'
import { ThumbnailService } from '../services/ThumbnailService'
import { frontendWorkshopLegacyApiPreferenceService } from '../services/FrontendWorkshopLegacyApiPreferenceService'
import {
  initializeDiscordSourceCredentials,
  loadDiscordSourceConnectionSettings,
  saveDiscordSourceConnectionSettings,
} from '../services/DiscordSourceSettingsService'
import type { ArchivePortableData } from '../types/Backup'

export const vaultService = new VaultService(database)
let vaultInitializationPromise: ReturnType<VaultService['initialize']> | undefined
export function initializeVaultOnce(): ReturnType<VaultService['initialize']> {
  vaultInitializationPromise ??= vaultService.initialize()
  return vaultInitializationPromise
}
export const assetStore = new IndexedDbAssetStore(database, vaultService)
export const thumbnailService = new ThumbnailService(assetStore)
const indexedDbStorage = new IndexedDbResourceStorage(database, vaultService, assetStore)
export const resourceHealthStorage = new IndexedDbResourceHealthStorage(database, indexedDbStorage)
const storage = new NativeMirroredResourceStorage(indexedDbStorage, vaultService)
const categoryStorage = new IndexedDbCategoryStorage(database, vaultService)
const archiveStorage = new IndexedDbArchiveStorage(database, vaultService, assetStore)
const restoreStagingStore = new IndexedDbRestoreStagingStore(database)
export const resourceArchiveService = new ResourceArchiveService(restoreStagingStore)
const communitySourceStorageOwner = new IndexedDbCommunitySourceStorage(database, vaultService)
const externalAppStorage = new IndexedDbExternalAppStorage(database)
const parserRegistry = new ResourceParserRegistry([
  new PersonalResourceParser(restoreStagingStore),
  new PngResourceParser(),
  new JsonResourceParser(),
  new TextBeautificationParser(),
])

export const nativeResourceRecoveryService = new NativeResourceRecoveryService(
  resourceHealthStorage,
  parserRegistry,
  assetStore,
  () => vaultService.isEnabled(),
)
export const resourceService = new ResourceService(storage, parserRegistry)
export const greetingResourceService = new GreetingResourceService(resourceService)
export const communitySourceStorage = communitySourceStorageOwner
export const communitySourceService = new CommunitySourceService(
  communitySourceStorageOwner,
  assetStore,
)
export const userPersonaService = new UserPersonaService(resourceService)
export const categoryService = new CategoryService(categoryStorage)
export const browserStorageService = new BrowserStorageService()
export const externalAppService = new ExternalAppService(externalAppStorage)
export const externalAppSdkService = new ExternalAppSdkService(externalAppService, resourceService)
export const characterDrawService = new CharacterDrawService(database)
export const exportService = new ExportService(
  () => communitySourceService.exportAll(),
  () => exportCommunitySourceLocalAttachments(communitySourceService),
)
export const restoreService = new CommunitySourceRestoreService(
  archiveStorage,
  restoreStagingStore,
  communitySourceService,
  (entries) => restoreCommunitySourceLocalAttachments(assetStore, entries),
)
export const historyService = new HistoryService(
  database,
  exportService,
  restoreService,
  vaultService,
)
export const recycleBinService = new RecycleBinService(
  database,
  resourceService,
  categoryService,
  exportService,
  restoreService,
  vaultService,
)
export const mainApiService = new MainApiService()
export const aiTaggingService = new AiTaggingService(mainApiService, resourceService)
export const aiTaggingDraftService = new AiTaggingDraftService()
export const cloudBackupService = new CloudBackupService(
  resourceService,
  categoryService,
  exportService,
  restoreService,
  async (selection) => ({
    version: 1,
    ...(selection.appearance
      ? { appearance: browserStorageService.exportAppearanceSettings() }
      : {}),
    ...(selection.characterDraw
      ? {
          characterDraw: {
            state: await characterDrawService.load(),
            showNames: browserStorageService.getDrawShowNames(),
          },
        }
      : {}),
    ...(selection.generalPreferences
      ? {
          generalPreferences: {
            ...browserStorageService.exportGeneralPreferences(),
            historySnapshotLimit: await historyService.getSnapshotLimit(),
          },
        }
      : {}),
    ...(selection.aiTaggingState
      ? {
          aiTaggingState: {
            draft: aiTaggingDraftService.loadDraft(),
            undo: aiTaggingDraftService.loadUndo(),
          },
        }
      : {}),
    ...(selection.credentials
      ? {
          mainApiProfiles: mainApiService.getProfilesState(),
          credentials: await exportPortableCredentialBundle(),
        }
      : {}),
    ...(selection.externalApps
      ? { externalApps: await externalAppService.exportPortableState() }
      : {}),
    ...(selection.stitchWork ? { stitchWork: browserStorageService.exportStitchWork() } : {}),
  }),
  async (data) => {
    if (data.appearance) browserStorageService.importAppearanceSettings(data.appearance)
    if (data.cloudBackup) cloudBackupService.importPortableSettings(data.cloudBackup)
    if (data.characterDraw) {
      await characterDrawService.importState(data.characterDraw.state)
      browserStorageService.setDrawShowNames(data.characterDraw.showNames)
    }
    if (data.generalPreferences) {
      browserStorageService.importGeneralPreferences(data.generalPreferences)
      await historyService.setSnapshotLimit(data.generalPreferences.historySnapshotLimit)
    }
    if (data.mainApiProfiles) {
      mainApiService.importProfilesState(data.mainApiProfiles)
      await mainApiService.awaitCredentialWrites()
    }
    if (data.credentials) await importPortableCredentialBundle(data.credentials)
    if (data.aiTaggingState?.draft) aiTaggingDraftService.saveDraft(data.aiTaggingState.draft)
    if (data.aiTaggingState?.undo) aiTaggingDraftService.saveUndo(data.aiTaggingState.undo)
    if (data.externalApps) await externalAppService.importPortableState(data.externalApps)
    if (data.stitchWork) browserStorageService.importStitchWork(data.stitchWork)
    if (data.plaintextSecretCopies?.length) {
      const { restorePlainSecretCopies } = await import('./PersonalResourceContainer')
      await restorePlainSecretCopies(data.plaintextSecretCopies)
    }
  },
)

export async function initializeCredentialServices(): Promise<void> {
  await mainApiService.initializeCredentials()
  await Promise.all([
    cloudBackupService.initializeCredentials(),
    frontendWorkshopLegacyApiPreferenceService.initializeCredentials({
      mode: 'main',
      savedProfileId: mainApiService.getActiveProfile().id,
      custom: mainApiService.getConfig(),
      credentialPersistence: 'local',
    }),
    initializeDiscordSourceCredentials(),
  ])
}

export async function exportPortableCredentialBundle(): Promise<
  NonNullable<ArchivePortableData['credentials']>
> {
  const { frontendWorkshopImageHostingService } = await import('./ImageAlbumContainer')
  await frontendWorkshopImageHostingService.initializeCredentials()
  return {
    version: 1,
    // 生图 API Key 仅保存在当前设备，不参与便携凭据、云备份或模板导出。
    imageHosting: frontendWorkshopImageHostingService.exportSelfHostedConfiguration(),
    legacyFrontendWorkshopApi:
      frontendWorkshopLegacyApiPreferenceService.exportCustomConfiguration(),
    discordSource: loadDiscordSourceConnectionSettings().botToken
      ? loadDiscordSourceConnectionSettings()
      : undefined,
    cloudBackup: await cloudBackupService.exportPortableCredentials(),
  }
}

export async function importPortableCredentialBundle(
  value: NonNullable<ArchivePortableData['credentials']>,
): Promise<void> {
  // 继续兼容旧备份中的 imageGeneration 字段，但新备份不再写出该字段。
  if (value.imageGeneration) {
    const { frontendWorkshopImageGenerationService } = await import('./ImageGenerationContainer')
    await frontendWorkshopImageGenerationService.initializeCredentials()
    await frontendWorkshopImageGenerationService.importConfigurations(value.imageGeneration)
  }
  if (value.imageHosting) {
    const { frontendWorkshopImageHostingService } = await import('./ImageAlbumContainer')
    await frontendWorkshopImageHostingService.initializeCredentials()
    await frontendWorkshopImageHostingService.saveSelfHostedConfiguration({
      ...value.imageHosting,
      remember: true,
    })
  }
  if (value.legacyFrontendWorkshopApi) {
    await frontendWorkshopLegacyApiPreferenceService.importCustomConfiguration(
      value.legacyFrontendWorkshopApi,
    )
  }
  if (value.discordSource?.botToken) {
    await saveDiscordSourceConnectionSettings({
      ...value.discordSource,
      credentialPersistence: 'local',
    })
  }
  if (value.cloudBackup) await cloudBackupService.importPortableCredentials(value.cloudBackup)
}

/** 首次切换到内置 Vue APK 时，把旧 IndexedDB 原件逐项补入 Android 文件目录。 */
export async function syncNativeResourceFiles(): Promise<void> {
  const nativeStorage = await getNativeResourceStorageInfo()
  if (!nativeStorage) return
  // A partially migrated vault can still reference native-only originals. Only
  // VaultService may remove them after encryption has durably committed.
  if (vaultService.isEnabled()) return
  const current = await indexedDbStorage.listSummaries()
  const versions = await indexedDbStorage.listVersionSummaries()
  const manifestHash = (items: Array<{ id: string; contentHash: string }>) =>
    hashBytes(
      new TextEncoder().encode(
        [...items]
          .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))
          .map((item) => `${item.id}\0${item.contentHash.toLowerCase()}\n`)
          .join(''),
      ),
    )
  const [currentManifestHash, versionManifestHash] = await Promise.all([
    manifestHash(current),
    manifestHash(versions),
  ])
  if (
    nativeStorage.storageVersion >= 4 &&
    nativeStorage.currentCount === current.length &&
    nativeStorage.versionCount === versions.length &&
    nativeStorage.currentManifestHash === currentManifestHash &&
    nativeStorage.versionManifestHash === versionManifestHash
  ) {
    return
  }
  if (nativeStorage.currentCount > current.length || nativeStorage.versionCount > versions.length) {
    throw new Error(
      `Android 端仍有未被数据库登记的索引（数据库 ${current.length}/${versions.length}，Android ${nativeStorage.currentCount}/${nativeStorage.versionCount}）；已停止自动对账并保留这些记录，请在“资源库健康与修复”中找回。`,
    )
  }
  for (const summary of current) {
    const resource = await indexedDbStorage.get(summary.id)
    if (resource) await mirrorNativeResourceFile(resource, 'current')
  }
  for (const summary of versions) {
    const version = await indexedDbStorage.getVersion(summary.id)
    if (version) await mirrorNativeResourceFile(version, 'versions')
  }

  // Do not delete surplus native metadata here. A missing IndexedDB row can be the crash
  // symptom we are trying to recover from; explicit resource deletion already owns native GC.
  const repaired = await getNativeResourceStorageInfo()
  if (repaired) {
    const missingExpectedEntries =
      repaired.currentCount < current.length || repaired.versionCount < versions.length
    const exactCardinality =
      repaired.currentCount === current.length && repaired.versionCount === versions.length
    const exactManifestMismatch =
      exactCardinality &&
      (repaired.currentManifestHash !== currentManifestHash ||
        repaired.versionManifestHash !== versionManifestHash)
    if (missingExpectedEntries || exactManifestMismatch) {
      throw new Error(
        `Android 镜像修复未收敛：IndexedDB ${current.length}/${versions.length}，Android ${repaired.currentCount}/${repaired.versionCount}`,
      )
    }
  }
}

export interface NativeMirrorHealth {
  mismatch: boolean
  details: string
  safeRepair: boolean
}

export async function getNativeMirrorHealth(): Promise<NativeMirrorHealth | null> {
  const nativeStorage = await getNativeResourceStorageInfo()
  if (!nativeStorage) return null
  if (vaultService.isEnabled()) {
    const mismatch = nativeStorage.currentCount > 0 || nativeStorage.versionCount > 0
    return {
      mismatch,
      details: mismatch
        ? '资源库保险箱已启用，但 Android 明文镜像仍有残留；不会由普通镜像同步自动删除。'
        : '保险箱模式下未保留 Android 明文镜像。',
      safeRepair: false,
    }
  }
  const [current, versions] = await Promise.all([
    indexedDbStorage.listSummaries(),
    indexedDbStorage.listVersionSummaries(),
  ])
  const manifestHash = (items: Array<{ id: string; contentHash: string }>) =>
    hashBytes(
      new TextEncoder().encode(
        [...items]
          .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))
          .map((item) => `${item.id}\0${item.contentHash.toLowerCase()}\n`)
          .join(''),
      ),
    )
  const [currentManifestHash, versionManifestHash] = await Promise.all([
    manifestHash(current),
    manifestHash(versions),
  ])
  const mismatch =
    nativeStorage.storageVersion < 4 ||
    nativeStorage.currentCount !== current.length ||
    nativeStorage.versionCount !== versions.length ||
    nativeStorage.currentManifestHash !== currentManifestHash ||
    nativeStorage.versionManifestHash !== versionManifestHash
  const hasSurplusNativeEntries =
    nativeStorage.currentCount > current.length || nativeStorage.versionCount > versions.length
  return {
    mismatch,
    details: mismatch
      ? hasSurplusNativeEntries
        ? `IndexedDB 为 ${current.length} 个当前资源、${versions.length} 个历史版本；Android 镜像为 ${nativeStorage.currentCount} / ${nativeStorage.versionCount}。多出的原生索引会保留并进入找回检查，不会自动删除。`
        : `IndexedDB 为 ${current.length} 个当前资源、${versions.length} 个历史版本；Android 镜像为 ${nativeStorage.currentCount} / ${nativeStorage.versionCount}。`
      : `Android 镜像与 ${current.length} 个当前资源、${versions.length} 个历史版本一致。`,
    safeRepair: mismatch && !hasSurplusNativeEntries,
  }
}
