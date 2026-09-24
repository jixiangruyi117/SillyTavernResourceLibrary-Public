import { computed, ref, shallowRef, useTemplateRef, watch } from 'vue'
import { useAppearanceSettings } from '../composables/UseAppearanceSettings'
import { useBatchOperations } from '../composables/UseBatchOperations'
import { useCategoryManagement } from '../composables/UseCategoryManagement'
import { useNativeResourceExport } from '../composables/UseNativeResourceExport'
import { useRecycleBin } from '../composables/UseRecycleBin'
import { useResourceVersions } from '../composables/UseResourceVersions'
import { useSearchIndex } from '../composables/UseSearchIndex'
import { isAndroidApk } from '../utils/CapacitorDetection'
import { browserStorageService } from '../core/AppContainer'
import { noticeCenter, type NoticeType } from '../core/NoticeCenter'
import { getPerformanceMonitorVisible } from '../core/PerformanceMonitor'
import type { StorageHealth } from '../services/BrowserStorageService'
import { DEFAULT_HISTORY_SNAPSHOT_LIMIT } from '../services/HistoryService'
import type { ResourceVersionView } from '../services/ResourceService'
import { type NativeResourceStorageInfo } from '../storage/NativeResourceFileMirror'
import type { FilterValue, SortValue } from '../types/AppView'
import type { PreparedRestore, RestoreMode, RestoreReport } from '../types/Backup'
import type { ImportVersionCandidate } from '../types/Import'
import type { BackupRecord } from '../types/Resource'
import {
  isExtractedCharacterAsset,
  type Category,
  type Resource,
  type ResourceSummary,
} from '../types/Resource'
import type { VaultStatus } from '../types/Vault'
import { listExtractedCleanupCandidates } from '../utils/ExtractedAssetCleanup'
import { formatBackupDate, formatBytes } from '../utils/LibraryFormatting'
import { useLibraryArchive } from './UseLibraryArchive'
import { useLibraryDisplayPreferences } from './UseLibraryDisplayPreferences'
import { useLibraryFolderOperations } from './UseLibraryFolderOperations'
import { useLibraryHealthRegistration } from './UseLibraryHealthRegistration'
import { useLibraryImport } from './UseLibraryImport'
import { useLibraryLifecycle } from './UseLibraryLifecycle'
import { useLibraryNavigation } from './UseLibraryNavigation'
import { useLibraryOverlayNavigation } from './UseLibraryOverlayNavigation'
import { useLibraryProtection } from './UseLibraryProtection'
import { useLibraryProtectionView } from './UseLibraryProtectionView'
import { useLibraryQueryView } from './UseLibraryQueryView'
import { useLibraryRefresh } from './UseLibraryRefresh'
import { useLibraryResourceActions } from './UseLibraryResourceActions'
import { useLibraryWorkspaceRecovery } from './UseLibraryWorkspaceRecovery'
export type { FilterValue, SortValue } from '../types/AppView'

export function useApp() {
  const {
    updatePerformanceMonitorVisibility,
    applyHideCharacterAssets,
    applyShowManuallyBoundResources,
    applyBlurThumbnails,
    handleManualUpdateCheck,
    updateSplitViewport,
    openAiTagging,
    openVersionRecognition,
    openVaultSettings,
  } = useLibraryDisplayPreferences(() => ({
    showPerformanceMonitor,
    hideCharacterAssets,
    showManuallyBoundResources,
    selectedSplitResource,
    selectedSplitResourceId,
    blurThumbnails,
    showNotice,
    isSplitWide,
    isAiTaggingOpen,
    isSettingsOpen,
    isVersionRecognitionOpen,
    openVaultPanel,
  }))

  const {
    loadResources,
    loadLibrary,
    handleLibraryChanged,
    refreshLibraryAndOpenVersions,
    handleAiTagsApplied,
  } = useLibraryRefresh(() => ({
    resources,
    categories,
    managedResources,
    loadRecycleBin,
    organizingResource,
    closeResourceDetail,
    organizingVersions,
    showNotice,
  }))

  const { restoreWorkspaceSnapshot, saveWorkspaceSnapshot } = useLibraryWorkspaceRecovery(() => ({
    isNativeApk,
    WORKSPACE_RECOVERY_KEY,
    activeFilter,
    activeCategoryId,
    activeTag,
    sortValue,
    currentPage,
    selectedSplitResourceId,
    isFeatureHubOpen,
  }))

  const {
    selectFilter,
    selectCategory,
    selectTag,
    clearBrowsingState,
    selectMobileDestination,
    openFeatureHub,
    handleNativeShortcut,
    handleNativeDeepLink,
    handleBrowseBack,
    handleGlobalKeydown,
    handleBackRequest,
    handleBrowserPopState,
    handleMobileFocus,
  } = useLibraryNavigation(() => ({
    isNativeApk,
    WORKSPACE_RECOVERY_KEY,
    activeFilter,
    activeCategoryId,
    activeTag,
    sortValue,
    currentPage,
    selectedSplitResourceId,
    isFeatureHubOpen,
    isMobileFiltersOpen,
    searchQuery,
    isSearchHistoryOpen,
    isSearchFocused,
    isSettingsOpen,
    isLinkImportOpen,
    isImportChooserOpen,
    isAiTaggingOpen,
    isCategoryManagerOpen,
    isExportPanelOpen,
    isRestorePanelOpen,
    isDataProtectionOpen,
    isRecycleBinOpen,
    isDuplicateCleanerOpen,
    isExtractedCleanerOpen,
    isVersionRecognitionOpen,
    isVaultPanelOpen,
    openImportChooser,
    resources,
    openResourceDetail,
    openRestorePanel,
    cancelSearchInput,
    saveCustomUiCss,
    backStack,
  }))

  const {
    openResourceDetail,
    copyResourceDeepLink,
    closeResourceDetail,
    openResourceFromLayout,
    handleFavorite,
    handleDelete,
    handleDetailSave,
    handleRelatedDownload,
  } = useLibraryResourceActions(() => ({
    showNotice,
    organizingResource,
    organizingInitialTab,
    organizingBoundResources,
    organizingVersions,
    layoutMode,
    isSplitWide,
    isBatchMode,
    selectedSplitResourceId,
    resources,
    moveResourcesToRecycleBin,
    isOrganizing,
    loadResources,
    categories,
  }))

  const {
    openFolderSettings,
    handleFolderAdd,
    handleFolderCover,
    handleCabinetPin,
    handleCabinetUnpin,
    handleFolderRename,
    handleFolderReorder,
    openFolderManagerFromFeatureHub,
  } = useLibraryFolderOperations(() => ({
    isSettingsOpen,
    isCategoryManagerOpen,
    isFolderViewBusy,
    loadResources,
    cabinetResourceIds,
    categories,
    showNotice,
    loadLibrary,
    resources,
  }))

  const {
    linkImportUrls,
    linkImportPreview,
    handleImport,
    handleTavernBackupImport,
    handleSystemFileDragOver,
    handleSystemFileDragLeave,
    handleSystemFileDrop,
    handleLinkImport,
    closeImportChooser,
    openLinkImportPanel,
    openImportChooser,
    openFileImportPicker,
    openTavernBackupPicker,
    importResourceFiles,
    handleVersionImportDecision,
  } = useLibraryImport(() => ({
    pendingBackupImport,
    showNotice,
    activeVersionImport,
    isNativeApk,
    isBusy,
    isSystemFileDropActive,
    linkImportUrls,
    loadResources,
    linkImportText,
    isLinkImportOpen,
    isImportChooserOpen,
    isFeatureHubOpen,
    fileImportInput,
    tavernBackupInput,
    openRestorePanel,
    handleRestoreInspect,
    extractCharacterAssets,
    pendingVersionImports,
    LARGE_IMPORT_BYTES,
    backupRecommended,
    hideCharacterAssets,
    showManuallyBoundResources,
    refreshStorageHealth,
    isVersionImportBusy,
  }))

  const {
    refreshStorageHealth,
    clearNativeTemporaryStorage,
    requestPersistentStorage,
    loadHistorySnapshots,
    handleHistorySnapshotLimit,
    captureHistory,
    openVaultPanel,
    handleVaultUnlock,
    handleVaultEnable,
    handleVaultDisable,
    handleVaultLock,
    handleCreateSnapshot,
    handleRestoreSnapshot,
    handleDeleteSnapshot,
  } = useLibraryProtection(() => ({
    storageHealth,
    nativeStorageInfo,
    isNativeApk,
    isClearingNativeCache,
    showNotice,
    isRequestingPersistence,
    historySnapshots,
    historySnapshotLimit,
    settingsPanelKey,
    categories,
    isDataProtectionOpen,
    isVaultPanelOpen,
    vaultStatus,
    isVaultBusy,
    loadLibrary,
    loadRecycleBin,
    scheduleLibraryMaintenance,
    clearSearchHistory,
    loadResources,
    resetSearchState,
    resources,
    recycleBinEntries,
    recycleUndoEntry,
    clearBrowsingState,
  }))

  const { handleExport, openRestorePanel, handleRestoreInspect, handleRestoreConfirm } =
    useLibraryArchive(() => ({
      isExporting,
      categories,
      showNotice,
      lastFullBackupAt,
      backupRecommended,
      isExportPanelOpen,
      refreshStorageHealth,
      historySnapshotLimit,
      reloadAppearanceSettings,
      searchHistory,
      cabinetResourceIds,
      syncCustomUiCss,
      preparedRestore,
      restoreSourceFile,
      restoreReport,
      restoreEntry,
      completedRestoreMode,
      isRestorePanelOpen,
      storageHealth,
      LARGE_ARCHIVE_BYTES,
      isRestoring,
      resources,
      captureHistory,
      loadLibrary,
    }))

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

  const pendingVersionImports = ref<ImportVersionCandidate[]>([])

  const pendingBackupImport = shallowRef<File>()

  const isVersionImportBusy = ref(false)

  const activeVersionImport = computed<ImportVersionCandidate | undefined>(
    () => pendingVersionImports.value[0],
  )

  const isOrganizing = ref(false)

  const notice = ref('')
  useLibraryHealthRegistration({
    resources,
  })

  const isSettingsOpen = ref(false)

  const showPerformanceMonitor = ref(getPerformanceMonitorVisible())

  const isAiTaggingOpen = ref(false)

  const isFeatureHubOpen = ref(new URLSearchParams(window.location.search).has('srlBridge'))

  const isFeatureAppActive = ref(false)

  watch(isFeatureHubOpen, (open) => {
    if (!open) isFeatureAppActive.value = false
  })

  const selectedSplitResourceId = ref<string>()

  const isSplitWide = ref(false)

  const organizingResource = ref<Resource>()

  const organizingInitialTab = ref<'overview' | 'versions'>('overview')

  const organizingBoundResources = ref<Resource[]>([])

  const organizingVersions = ref<ResourceVersionView[]>([])

  const {
    pendingNativeExport,
    isNativeExportBusy,
    handleResourceDownload,
    handleNativeExportSelection,
    sharePendingNativeExport,
  } = useNativeResourceExport({ showNotice })

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

  const isExtractedCleanerOpen = ref(false)

  const isVersionRecognitionOpen = ref(false)

  const isMobileFiltersOpen = ref(false)

  const isVaultPanelOpen = ref(false)

  const isVaultBusy = ref(false)

  const {
    isRecycleBinOpen,
    isRecycleBinBusy,
    recycleBinEntries,
    recycleUndoEntry,
    recycleBinSize,
    loadRecycleBin,
    moveResourcesToRecycleBin,
    openRecycleBin,
    handleRestoreRecycleBinEntry,
    handlePurgeRecycleBinEntry,
    handleEmptyRecycleBin,
  } = useRecycleBin({
    isDataProtectionOpen,
    loadResources,
    loadLibrary,
    refreshStorageHealth,
    showNotice,
  })

  const vaultStatus = ref<VaultStatus>({ enabled: false, locked: false })

  const historySnapshots = shallowRef<BackupRecord[]>([])

  restoreWorkspaceSnapshot()

  const historySnapshotLimit = ref(DEFAULT_HISTORY_SNAPSHOT_LIMIT)

  const lastFullBackupAt = ref(browserStorageService.getLastFullBackupAt())

  const backupRecommended = ref(false)

  const extractedCleanupCount = computed(
    () => listExtractedCleanupCandidates(resources.value).length,
  )

  const {
    theme,
    layoutMode,
    uiFontScale,
    previewPolicy,
    customUiCss,
    extractCharacterAssets,
    hideCharacterAssets,
    showManuallyBoundResources,
    blurThumbnails,
    settingsPanelKey,
    applyTheme,
    applyLayoutMode,
    applyUiFontScale,
    syncCustomUiCss,
    saveCustomUiCss,
    applyRemotePreviewPolicy,
    applyScriptPreviewPolicy,
    applyGreetingPreviewPreload,
    applyBeautificationPreviewPreload,
    applyExtractCharacterAssets,
    reloadAppearanceSettings,
  } = useAppearanceSettings(showNotice)

  const {
    searchQuery,
    searchScope,
    searchHistory,
    isSearchHistoryOpen,
    isSearchFocused,
    isSearchIndexing,
    nameSearchIndexById,
    searchIndexById,
    contentSearchMatchIds,
    contentSearchQuery,
    refreshSearchContentIndex,
    commitSearch,
    useSearchHistory,
    clearSearchHistory,
    handleSearchFocus,
    handleSearchBlur,
    cancelSearchInput,
    resetSearchState,
  } = useSearchIndex(resources, () => vaultStatus.value.enabled)
  const { isOverlayOpen, backStack, personalNavigation } = useLibraryOverlayNavigation({
    organizingResource,
    isOrganizing,
    isImportChooserOpen,
    isSettingsOpen,
    isDuplicateCleanerOpen,
    isExtractedCleanerOpen,
    isVersionRecognitionOpen,
    isVaultPanelOpen,
    vaultStatus,
    isVaultBusy,
    isRestorePanelOpen,
    isRestoring,
    isExportPanelOpen,
    isExporting,
    isCategoryManagerOpen,
    isRecycleBinOpen,
    isRecycleBinBusy,
    isAiTaggingOpen,
    pendingNativeExport,
    isNativeExportBusy,
    activeVersionImport,
    isVersionImportBusy,
    pendingVersionImports,
    get isBatchMode() {
      return isBatchMode
    },
    get isBatchBusy() {
      return isBatchBusy
    },
    get toggleBatchMode() {
      return toggleBatchMode
    },
    isMobileFiltersOpen,
    isDataProtectionOpen,
    isLinkImportOpen,
    get hasBrowsingState() {
      return hasBrowsingState
    },
    handleBrowseBack,
    isFeatureHubOpen,
  })

  const hiddenCharacterAssetCount = computed(
    () => resources.value.filter(isExtractedCharacterAsset).length,
  )
  const {
    countFilter,
    countCategory,
    statistics,
    visibleCategories,
    managedResources,
    duplicateGroupCounts,
    visibleLibraryResources,
    filters,
    matchesCategory,
    categoriesForResource,
    filteredResources,
    paginatedResources,
    totalPages,
    tagFilters,
    selectedSplitResource,
    selectedSplitCategories,
    selectedSplitRelations,
    activeFilterLabel,
    activeCategoryLabel,
    activeSecondaryFilterCount,
    activeScopeLabel,
  } = useLibraryQueryView({
    categories,
    resources,
    hideCharacterAssets,
    showManuallyBoundResources,
    activeCategoryId,
    searchQuery,
    activeFilter,
    activeTag,
    sortValue,
    resourceNameCollator,
    searchScope,
    nameSearchIndexById,
    searchIndexById,
    contentSearchQuery,
    contentSearchMatchIds,
    currentPage,
    pageSize,
    selectedSplitResourceId,
  })

  const {
    isBatchMode,
    isBatchBusy,
    selectedResourceIds,
    allVisibleSelected,
    batchSelectionScope,
    allBatchScopeSelected,
    batchSelectionScopeLabel,
    selectedCharacterCount,
    toggleBatchMode,
    toggleResourceSelection,
    toggleVisibleSelection,
    toggleBatchScopeSelection,
    handleBatchTag,
    handleBatchFavorite,
    handleBatchMove,
    handleBatchExtractCharacterAssets,
    handleBatchDelete,
  } = useBatchOperations({
    resources,
    paginatedResources,
    filteredResources,
    visibleLibraryResources,
    activeCategoryId,
    activeCategoryLabel,
    matchesCategory,
    showNotice,
    loadResources,
    moveToRecycleBin: moveResourcesToRecycleBin,
  })

  const {
    handleActivateVersion,
    handleDeleteResourceVersion,
    handleUpdateVersionNote,
    handleMergeExistingVersion,
    handleReplaceCharacterCardArtwork,
  } = useResourceVersions({
    organizingResource,
    organizingVersions,
    isOrganizing,
    resources,
    showNotice,
    loadResources,
    refreshStorageHealth,
  })

  const {
    categoryManagerKey,
    handleCategoryCreate,
    handleCategoryUpdate,
    handleCategoryVisibility,
    handleCategoryDelete,
  } = useCategoryManagement({
    activeCategoryId,
    isOrganizing,
    showNotice,
    loadLibrary,
    captureHistory,
  })
  const {
    backupOverdue,
    displayedStorageUsage,
    displayedStorageAvailable,
    storageUsagePercent,
    storageProtectionStatus,
  } = useLibraryProtectionView({
    resources,
    lastFullBackupAt,
    BACKUP_REMINDER_INTERVAL,
    nativeStorageInfo,
    storageHealth,
    backupRecommended,
  })

  const hasBrowsingState = computed(
    () =>
      Boolean(searchQuery.value) ||
      Boolean(activeTag.value) ||
      activeCategoryId.value !== undefined ||
      activeFilter.value !== 'all',
  )

  function showNotice(message: string, duration = 4000, preserveRecycleUndo = false): void {
    if (!preserveRecycleUndo) recycleUndoEntry.value = undefined
    if (!preserveRecycleUndo) {
      notice.value = ''
      const type: NoticeType = /失败|错误|损坏|无法|回滚/u.test(message) ? 'error' : 'info'
      noticeCenter.push({ id: 'app-main', type, message, durationMs: duration })
      return
    }
    notice.value = message
    window.setTimeout(() => {
      if (notice.value === message) notice.value = ''
    }, duration)
  }
  const { scheduleLibraryMaintenance } = useLibraryLifecycle({
    showNotice,
    importResourceFiles,
    loadResources,
    refreshStorageHealth,
    vaultStatus,
    searchQuery,
    searchHistory,
    isVaultPanelOpen,
    loadLibrary,
    loadHistorySnapshots,
    loadRecycleBin,
    handleNativeDeepLink,
    isOverlayOpen,
    searchScope,
    activeFilter,
    activeCategoryId,
    activeTag,
    sortValue,
    pageSize,
    currentPage,
    refreshSearchContentIndex,
    resources,
    selectedSplitResourceId,
    isFeatureHubOpen,
    saveWorkspaceSnapshot,
    totalPages,
    applyTheme,
    theme,
    applyUiFontScale,
    uiFontScale,
    handleGlobalKeydown,
    handleBackRequest,
    handleBrowserPopState,
    updateSplitViewport,
    handleNativeShortcut,
    handleMobileFocus,
    syncCustomUiCss,
  })
  return {
    layoutMode,
    isBatchMode,
    vaultStatus,
    isSystemFileDropActive,
    batchBarHeight,
    isFeatureAppActive,
    handleSystemFileDragOver,
    handleSystemFileDragLeave,
    handleSystemFileDrop,
    isFeatureHubOpen,
    isMobileFiltersOpen,
    theme,
    applyTheme,
    activeSecondaryFilterCount,
    filters,
    activeFilter,
    selectFilter,
    countFilter,
    isCategoryManagerOpen,
    activeCategoryId,
    selectCategory,
    countCategory,
    visibleCategories,
    activeTag,
    tagFilters,
    selectTag,
    openFeatureHub,
    isSettingsOpen,
    isExporting,
    isExportPanelOpen,
    isBusy,
    openImportChooser,
    handleImport,
    handleTavernBackupImport,
    isImportChooserOpen,
    personalNavigation,
    closeImportChooser,
    openLinkImportPanel,
    openFileImportPicker,
    openTavernBackupPicker,
    isLinkImportOpen,
    handleLinkImport,
    linkImportText,
    linkImportUrls,
    linkImportPreview,
    statistics,
    backupOverdue,
    backupRecommended,
    isDataProtectionOpen,
    storageProtectionStatus,
    openVaultPanel,
    recycleBinEntries,
    formatBytes,
    recycleBinSize,
    openRecycleBin,
    isNativeApk,
    storageHealth,
    isRequestingPersistence,
    requestPersistentStorage,
    displayedStorageUsage,
    displayedStorageAvailable,
    storageUsagePercent,
    isClearingNativeCache,
    clearNativeTemporaryStorage,
    formatBackupDate,
    lastFullBackupAt,
    duplicateGroupCounts,
    isDuplicateCleanerOpen,
    extractedCleanupCount,
    isExtractedCleanerOpen,
    hasBrowsingState,
    handleBrowseBack,
    activeFilterLabel,
    activeCategoryLabel,
    searchQuery,
    cancelSearchInput,
    clearBrowsingState,
    commitSearch,
    searchScope,
    isSearchIndexing,
    handleSearchFocus,
    handleSearchBlur,
    isSearchFocused,
    isSearchHistoryOpen,
    searchHistory,
    clearSearchHistory,
    useSearchHistory,
    sortValue,
    filteredResources,
    activeScopeLabel,
    toggleBatchMode,
    paginatedResources,
    categoriesForResource,
    selectedResourceIds,
    blurThumbnails,
    handleFavorite,
    openResourceFromLayout,
    toggleResourceSelection,
    handleDelete,
    RESOURCE_LIST_COLUMNS,
    selectedSplitResourceId,
    selectedSplitResource,
    selectedSplitCategories,
    selectedSplitRelations,
    openResourceDetail,
    handleResourceDownload,
    copyResourceDeepLink,
    pageSize,
    currentPage,
    totalPages,
    managedResources,
    duplicateResources: resources,
    visibleLibraryResources,
    organizingVersions,
    categories,
    uiFontScale,
    customUiCss,
    isFolderViewBusy,
    cabinetResourceIds,
    openFolderManagerFromFeatureHub,
    handleFolderAdd,
    handleFolderCover,
    handleFolderRename,
    handleFolderReorder,
    handleCabinetPin,
    handleCabinetUnpin,
    applyLayoutMode,
    applyUiFontScale,
    saveCustomUiCss,
    handleLibraryChanged,
    importResourceFiles,
    selectMobileDestination,
    notice,
    recycleUndoEntry,
    handleRestoreRecycleBinEntry,
    allVisibleSelected,
    batchSelectionScope,
    batchSelectionScopeLabel,
    allBatchScopeSelected,
    selectedCharacterCount,
    isBatchBusy,
    toggleVisibleSelection,
    toggleBatchScopeSelection,
    handleBatchExtractCharacterAssets,
    handleBatchFavorite,
    handleBatchMove,
    handleBatchTag,
    openAiTagging,
    handleBatchDelete,
    isAiTaggingOpen,
    handleAiTagsApplied,
    isRecycleBinOpen,
    isRecycleBinBusy,
    handlePurgeRecycleBinEntry,
    handleEmptyRecycleBin,
    organizingResource,
    organizingInitialTab,
    organizingBoundResources,
    isOrganizing,
    closeResourceDetail,
    handleRelatedDownload,
    handleActivateVersion,
    handleDeleteResourceVersion,
    handleUpdateVersionNote,
    handleMergeExistingVersion,
    handleReplaceCharacterCardArtwork,
    handleDetailSave,
    pendingNativeExport,
    isNativeExportBusy,
    handleNativeExportSelection,
    sharePendingNativeExport,
    activeVersionImport,
    pendingVersionImports,
    isVersionImportBusy,
    handleVersionImportDecision,
    settingsPanelKey,
    previewPolicy,
    extractCharacterAssets,
    hideCharacterAssets,
    showManuallyBoundResources,
    showPerformanceMonitor,
    hiddenCharacterAssetCount,
    historySnapshotLimit,
    historySnapshots,
    applyRemotePreviewPolicy,
    applyScriptPreviewPolicy,
    applyGreetingPreviewPreload,
    applyBeautificationPreviewPreload,
    applyExtractCharacterAssets,
    applyHideCharacterAssets,
    applyShowManuallyBoundResources,
    applyBlurThumbnails,
    updatePerformanceMonitorVisibility,
    handleHistorySnapshotLimit,
    openFolderSettings,
    openVaultSettings,
    openVersionRecognition,
    handleManualUpdateCheck,
    categoryManagerKey,
    handleCategoryCreate,
    handleCategoryUpdate,
    handleCategoryVisibility,
    handleCategoryDelete,
    openRestorePanel,
    handleExport,
    isRestorePanelOpen,
    preparedRestore,
    restoreReport,
    isRestoring,
    restoreEntry,
    completedRestoreMode,
    handleRestoreInspect,
    handleRestoreConfirm,
    isVaultPanelOpen,
    isVaultBusy,
    handleVaultUnlock,
    handleVaultEnable,
    handleVaultDisable,
    handleVaultLock,
    handleCreateSnapshot,
    handleRestoreSnapshot,
    handleDeleteSnapshot,
    isVersionRecognitionOpen,
    refreshLibraryAndOpenVersions,
  }
}
