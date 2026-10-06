import { computed, ref, shallowRef, useTemplateRef } from 'vue'

// SRL-PUBLIC-SYNC: BEGIN REPLACE id=public-apk-platform-detection
import { isCapacitorApp as isAndroidApk } from '../utils/CapacitorDetection'
// SRL-PUBLIC-SYNC: END REPLACE id=public-apk-platform-detection

import { browserStorageService } from '../core/LibraryContainer'

import { getPerformanceMonitorVisible } from '../core/PerformanceMonitor'

import type { StorageHealth } from '../services/BrowserStorageService'

import type { ResourceVersionView } from '../services/ResourceService'

import { type NativeResourceStorageInfo } from '../storage/NativeResourceFileMirror'

import type { FilterValue, SortValue } from '../types/AppView'

import type { PreparedRestore, RestoreMode, RestoreReport } from '../types/Backup'

import type { ImportVersionCandidate, ImportVersionComparison } from '../types/Import'

import { type Category, type Resource, type ResourceSummary } from '../types/Resource'

import type { VaultStatus } from '../types/Vault'

export function useLibraryAppState() {
  const resourceNameCollator = new Intl.Collator('zh-CN')
  const DEFAULT_PAGE_SIZE = 24
  const LARGE_IMPORT_BYTES = 100 * 1024 * 1024
  const LARGE_ARCHIVE_BYTES = 256 * 1024 * 1024
  const BACKUP_REMINDER_INTERVAL = 14 * 24 * 60 * 60 * 1000
  const RESOURCE_LIST_COLUMNS = [
    '资源名称',
    '类型',
    '文件夹',
    '标签 / 关联',
    '大小',
    '更新时间',
    '操作',
  ]
  const WORKSPACE_RECOVERY_KEY = 'srl.android.workspace-recovery.v1'
  const resources = shallowRef<ResourceSummary[]>([])
  const categories = ref<Category[]>([])
  const activeFilter = ref<FilterValue>('all')
  const activeCategoryId = ref<string | null | undefined>(undefined)
  const activeTag = ref('')
  const activeResourceIds = shallowRef<Set<string>>()
  const sortValue = ref<SortValue>('newest')
  const currentPage = ref(1)
  const pageSize = ref(DEFAULT_PAGE_SIZE)
  const isBusy = ref(false)
  const batchBarHeight = ref(0)
  const linkImportText = ref('')
  const isLinkImportOpen = ref(false)
  const isImportChooserOpen = ref(false)
  const isSystemFileDropActive = ref(false)
  const fileImportInput = useTemplateRef<HTMLInputElement>('fileImportInput')
  const tavernBackupInput = useTemplateRef<HTMLInputElement>('tavernBackupInput')
  const resourceArchiveInput = useTemplateRef<HTMLInputElement>('resourceArchiveInput')
  const libraryBackupInput = useTemplateRef<HTMLInputElement>('libraryBackupInput')
  const pendingVersionImports = ref<ImportVersionCandidate[]>([])
  const pendingBackupImport = shallowRef<File>()
  const sharedAppImportFiles = shallowRef<File[]>([])
  const isVersionImportBusy = ref(false)
  const versionImportComparison = shallowRef<ImportVersionComparison>()
  const versionImportComparingId = ref('')
  const activeVersionImport = computed<ImportVersionCandidate | undefined>(
    () => pendingVersionImports.value[0],
  )
  const isOrganizing = ref(false)
  const notice = ref('')
  const isSettingsOpen = ref(false)
  const showPerformanceMonitor = ref(getPerformanceMonitorVisible())
  const isAiTaggingOpen = ref(false)
  const isFeatureHubOpen = ref(new URLSearchParams(window.location.search).has('srlBridge'))
  const isFeatureAppActive = ref(false)
  const selectedSplitResourceId = ref<string>()
  const isSplitWide = ref(false)
  const organizingResource = ref<Resource>()
  const organizingInitialTab = ref<'overview' | 'versions'>('overview')
  const organizingBoundResources = ref<Resource[]>([])
  const organizingVersions = ref<ResourceVersionView[]>([])
  const isCategoryManagerOpen = ref(false)
  const isFolderViewBusy = ref(false)
  const cabinetResourceIds = ref(browserStorageService.getCabinetResourceIds())
  const isExportPanelOpen = ref(false)
  const isRestorePanelOpen = ref(false)
  const isExporting = ref(false)
  const isRestoring = ref(false)
  const preparedRestore = shallowRef<PreparedRestore>()
  const restoreSourceFile = shallowRef<File>()
  const restoreReport = ref<RestoreReport>()
  const restoreEntry = ref<'import' | 'export'>('export')
  const completedRestoreMode = ref<RestoreMode>('merge')
  const storageHealth = ref<StorageHealth>({
    supported: false,
    persisted: false,
    usage: 0,
    quota: 0,
  })
  const nativeStorageInfo = ref<NativeResourceStorageInfo | null>(null)
  const isClearingNativeCache = ref(false)
  const isNativeApk = isAndroidApk()
  const isRequestingPersistence = ref(false)
  const isDataProtectionOpen = ref(false)
  const isDuplicateCleanerOpen = ref(false)
  const isSimilarNameGroupsOpen = ref(false)
  const isExtractedCleanerOpen = ref(false)
  const isParsedTagCleanerOpen = ref(false)
  const isVersionRecognitionOpen = ref(false)
  const isMobileFiltersOpen = ref(false)
  const isVaultPanelOpen = ref(false)
  const isVaultBusy = ref(false)
  const vaultStatus = ref<VaultStatus>({ enabled: false, locked: false })
  const lastFullBackupAt = ref(browserStorageService.getLastFullBackupAt())
  const backupRecommended = ref(false)
  return {
    resourceNameCollator,
    DEFAULT_PAGE_SIZE,
    LARGE_IMPORT_BYTES,
    LARGE_ARCHIVE_BYTES,
    BACKUP_REMINDER_INTERVAL,
    RESOURCE_LIST_COLUMNS,
    WORKSPACE_RECOVERY_KEY,
    resources,
    categories,
    activeFilter,
    activeCategoryId,
    activeTag,
    activeResourceIds,
    sortValue,
    currentPage,
    pageSize,
    isBusy,
    batchBarHeight,
    linkImportText,
    isLinkImportOpen,
    isImportChooserOpen,
    isSystemFileDropActive,
    fileImportInput,
    tavernBackupInput,
    resourceArchiveInput,
    libraryBackupInput,
    pendingVersionImports,
    pendingBackupImport,
    sharedAppImportFiles,
    isVersionImportBusy,
    versionImportComparison,
    versionImportComparingId,
    activeVersionImport,
    isOrganizing,
    notice,
    isSettingsOpen,
    showPerformanceMonitor,
    isAiTaggingOpen,
    isFeatureHubOpen,
    isFeatureAppActive,
    selectedSplitResourceId,
    isSplitWide,
    organizingResource,
    organizingInitialTab,
    organizingBoundResources,
    organizingVersions,
    isCategoryManagerOpen,
    isFolderViewBusy,
    cabinetResourceIds,
    isExportPanelOpen,
    isRestorePanelOpen,
    isExporting,
    isRestoring,
    preparedRestore,
    restoreSourceFile,
    restoreReport,
    restoreEntry,
    completedRestoreMode,
    storageHealth,
    nativeStorageInfo,
    isClearingNativeCache,
    isNativeApk,
    isRequestingPersistence,
    isDataProtectionOpen,
    isDuplicateCleanerOpen,
    isSimilarNameGroupsOpen,
    isExtractedCleanerOpen,
    isParsedTagCleanerOpen,
    isVersionRecognitionOpen,
    isMobileFiltersOpen,
    isVaultPanelOpen,
    isVaultBusy,
    vaultStatus,
    lastFullBackupAt,
    backupRecommended,
  }
}

export function libraryStateView(state: ReturnType<typeof useLibraryAppState>) {
  return {
    vaultStatus: state.vaultStatus,
    isSystemFileDropActive: state.isSystemFileDropActive,
    batchBarHeight: state.batchBarHeight,
    isFeatureAppActive: state.isFeatureAppActive,
    isFeatureHubOpen: state.isFeatureHubOpen,
    isMobileFiltersOpen: state.isMobileFiltersOpen,
    activeFilter: state.activeFilter,
    isCategoryManagerOpen: state.isCategoryManagerOpen,
    activeCategoryId: state.activeCategoryId,
    activeTag: state.activeTag,
    isSettingsOpen: state.isSettingsOpen,
    isExporting: state.isExporting,
    isExportPanelOpen: state.isExportPanelOpen,
    isBusy: state.isBusy,
    sharedAppImportFiles: state.sharedAppImportFiles,
    isImportChooserOpen: state.isImportChooserOpen,
    isLinkImportOpen: state.isLinkImportOpen,
    linkImportText: state.linkImportText,
    backupRecommended: state.backupRecommended,
    isDataProtectionOpen: state.isDataProtectionOpen,
    isNativeApk: state.isNativeApk,
    storageHealth: state.storageHealth,
    isRequestingPersistence: state.isRequestingPersistence,
    isClearingNativeCache: state.isClearingNativeCache,
    lastFullBackupAt: state.lastFullBackupAt,
    isDuplicateCleanerOpen: state.isDuplicateCleanerOpen,
    isSimilarNameGroupsOpen: state.isSimilarNameGroupsOpen,
    activeResourceIds: state.activeResourceIds,
    isExtractedCleanerOpen: state.isExtractedCleanerOpen,
    isParsedTagCleanerOpen: state.isParsedTagCleanerOpen,
    sortValue: state.sortValue,
    RESOURCE_LIST_COLUMNS: state.RESOURCE_LIST_COLUMNS,
    selectedSplitResourceId: state.selectedSplitResourceId,
    pageSize: state.pageSize,
    currentPage: state.currentPage,
    organizingVersions: state.organizingVersions,
    categories: state.categories,
    isFolderViewBusy: state.isFolderViewBusy,
    cabinetResourceIds: state.cabinetResourceIds,
    notice: state.notice,
    isAiTaggingOpen: state.isAiTaggingOpen,
    organizingResource: state.organizingResource,
    organizingInitialTab: state.organizingInitialTab,
    organizingBoundResources: state.organizingBoundResources,
    isOrganizing: state.isOrganizing,
    activeVersionImport: state.activeVersionImport,
    pendingVersionImports: state.pendingVersionImports,
    isVersionImportBusy: state.isVersionImportBusy,
    versionImportComparison: state.versionImportComparison,
    versionImportComparingId: state.versionImportComparingId,
    showPerformanceMonitor: state.showPerformanceMonitor,
    isRestorePanelOpen: state.isRestorePanelOpen,
    preparedRestore: state.preparedRestore,
    restoreReport: state.restoreReport,
    isRestoring: state.isRestoring,
    restoreEntry: state.restoreEntry,
    completedRestoreMode: state.completedRestoreMode,
    isVaultPanelOpen: state.isVaultPanelOpen,
    isVaultBusy: state.isVaultBusy,
    isVersionRecognitionOpen: state.isVersionRecognitionOpen,
  }
}
