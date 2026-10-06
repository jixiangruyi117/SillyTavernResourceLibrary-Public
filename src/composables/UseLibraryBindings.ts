import { useLibraryAppState } from './UseLibraryAppState'

import { type NoticeType } from '../core/NoticeCenter'

import { useLibraryArchive } from './UseLibraryArchive'

import { useLibraryDisplayPreferences } from './UseLibraryDisplayPreferences'

import { useLibraryFolderOperations } from './UseLibraryFolderOperations'

import { useLibraryImport } from './UseLibraryImport'

import { useLibraryNavigation } from './UseLibraryNavigation'

import { useLibraryProtection } from './UseLibraryProtection'

import { useLibraryRefresh } from './UseLibraryRefresh'

import { useLibraryResourceActions } from './UseLibraryResourceActions'

import { useLibraryWorkspaceRecovery } from './UseLibraryWorkspaceRecovery'

import { type SharedFileBatch } from '../utils/ShareTargetIntake'

export type LibraryBindingsContext = ReturnType<typeof useLibraryAppState> & {
  hideCharacterAssets: import('vue').Ref<boolean, boolean>
  hideChatDisplayRegex: import('vue').Ref<boolean, boolean>
  showManuallyBoundResources: import('vue').Ref<boolean, boolean>
  selectedSplitResource: import('vue').ComputedRef<
    import('../types/Resource').ResourceSummary | undefined
  >
  blurThumbnails: import('vue').Ref<boolean, boolean>
  showNotice: (
    message: string,
    duration?: number,
    preserveRecycleUndo?: boolean,
    explicitType?: NoticeType,
  ) => void
  managedResources: import('vue').ComputedRef<import('../types/Resource').ResourceSummary[]>
  loadRecycleBin: () => Promise<void>
  openSharedImport: (token: string) => Promise<void>
  isOverlayOpen: import('vue').ComputedRef<boolean>
  searchQuery: import('vue').Ref<string, string>
  isSearchHistoryOpen: import('vue').Ref<boolean, boolean>
  isSearchFocused: import('vue').Ref<boolean, boolean>
  isRecycleBinOpen: import('vue').Ref<boolean, boolean>
  cancelSearchInput: (event?: Event) => void
  saveCustomUiCss: (value: string) => void
  backStack: import('./UseBackStack').BackStackManager
  layoutMode: import('vue').Ref<'grid' | 'list' | 'split', 'grid' | 'list' | 'split'>
  isBatchMode: import('vue').Ref<boolean, boolean>
  moveResourcesToRecycleBin: (ids: string[]) => Promise<void>
  extractCharacterAssets: import('vue').Ref<boolean, boolean>
  persistResourceVersionMatchCache: import('vue').Ref<boolean, boolean>
  skipVersionComparisonOnImport: import('vue').Ref<boolean, boolean>
  sameNameVersionCandidates: import('vue').Ref<boolean, boolean>
  scheduleLibraryMaintenance: () => void
  clearSearchHistory: () => void
  resetSearchState: () => void
  recycleBinEntries: import('vue').ShallowRef<
    import('../types/Resource').BackupRecord[],
    import('../types/Resource').BackupRecord[]
  >
  recycleUndoEntry: import('vue').ShallowRef<
    import('../types/Resource').BackupRecord | undefined,
    import('../types/Resource').BackupRecord | undefined
  >
  reloadAppearanceSettings: () => void
  searchHistory: import('vue').Ref<string[], string[]>
  syncCustomUiCss: () => void
  pendingSharedBackupBatch: SharedFileBatch | undefined
  pendingSharedFileBatch: import('vue').ShallowRef<
    SharedFileBatch | undefined,
    SharedFileBatch | undefined
  >
  cancelPendingSharedBatch: (batch: SharedFileBatch) => Promise<void>
  acknowledgeSharedBackupAfterRestore: () => Promise<void>
}
export function useLibraryBindings(getContext: () => LibraryBindingsContext) {
  const {
    updatePerformanceMonitorVisibility,
    applyHideCharacterAssets,
    applyHideChatDisplayRegex,
    applyShowManuallyBoundResources,
    applyBlurThumbnails,
    handleManualUpdateCheck,
    updateSplitViewport,
    openAiTagging,
    openVersionRecognition,
    openVaultSettings,
  } = useLibraryDisplayPreferences(() => {
    const context = getContext()
    return {
      showPerformanceMonitor: context.showPerformanceMonitor,
      resources: context.resources,
      hideCharacterAssets: context.hideCharacterAssets,
      hideChatDisplayRegex: context.hideChatDisplayRegex,
      showManuallyBoundResources: context.showManuallyBoundResources,
      selectedSplitResource: context.selectedSplitResource,
      selectedSplitResourceId: context.selectedSplitResourceId,
      blurThumbnails: context.blurThumbnails,
      showNotice: context.showNotice,
      isSplitWide: context.isSplitWide,
      isAiTaggingOpen: context.isAiTaggingOpen,
      isSettingsOpen: context.isSettingsOpen,
      isVersionRecognitionOpen: context.isVersionRecognitionOpen,
      openVaultPanel,
    }
  })

  const {
    loadResources,
    loadLibrary,
    handleLibraryChanged,
    refreshLibraryAndOpenVersions,
    handleAiTagsApplied,
  } = useLibraryRefresh(() => {
    const context = getContext()
    return {
      resources: context.resources,
      categories: context.categories,
      managedResources: context.managedResources,
      loadRecycleBin: context.loadRecycleBin,
      organizingResource: context.organizingResource,
      closeResourceDetail,
      organizingVersions: context.organizingVersions,
      showNotice: context.showNotice,
    }
  })

  const { restoreWorkspaceSnapshot, saveWorkspaceSnapshot } = useLibraryWorkspaceRecovery(() => {
    const context = getContext()
    return {
      isNativeApk: context.isNativeApk,
      WORKSPACE_RECOVERY_KEY: context.WORKSPACE_RECOVERY_KEY,
      activeFilter: context.activeFilter,
      activeCategoryId: context.activeCategoryId,
      activeTag: context.activeTag,
      sortValue: context.sortValue,
      currentPage: context.currentPage,
      selectedSplitResourceId: context.selectedSplitResourceId,
      isFeatureHubOpen: context.isFeatureHubOpen,
    }
  })

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
  } = useLibraryNavigation(() => {
    const context = getContext()
    return {
      openSharedImport: context.openSharedImport,
      activeResourceIds: context.activeResourceIds,
      isNativeApk: context.isNativeApk,
      WORKSPACE_RECOVERY_KEY: context.WORKSPACE_RECOVERY_KEY,
      activeFilter: context.activeFilter,
      activeCategoryId: context.activeCategoryId,
      activeTag: context.activeTag,
      sortValue: context.sortValue,
      currentPage: context.currentPage,
      selectedSplitResourceId: context.selectedSplitResourceId,
      isFeatureHubOpen: context.isFeatureHubOpen,
      isOverlayOpen: context.isOverlayOpen,
      isMobileFiltersOpen: context.isMobileFiltersOpen,
      searchQuery: context.searchQuery,
      isSearchHistoryOpen: context.isSearchHistoryOpen,
      isSearchFocused: context.isSearchFocused,
      isSettingsOpen: context.isSettingsOpen,
      isLinkImportOpen: context.isLinkImportOpen,
      isImportChooserOpen: context.isImportChooserOpen,
      openLinkImportPanel,
      isBusy: context.isBusy,
      isAiTaggingOpen: context.isAiTaggingOpen,
      isCategoryManagerOpen: context.isCategoryManagerOpen,
      isExportPanelOpen: context.isExportPanelOpen,
      isRestorePanelOpen: context.isRestorePanelOpen,
      isDataProtectionOpen: context.isDataProtectionOpen,
      isRecycleBinOpen: context.isRecycleBinOpen,
      isDuplicateCleanerOpen: context.isDuplicateCleanerOpen,
      isSimilarNameGroupsOpen: context.isSimilarNameGroupsOpen,
      isExtractedCleanerOpen: context.isExtractedCleanerOpen,
      isParsedTagCleanerOpen: context.isParsedTagCleanerOpen,
      isVersionRecognitionOpen: context.isVersionRecognitionOpen,
      isVaultPanelOpen: context.isVaultPanelOpen,
      openImportChooser,
      resources: context.resources,
      openResourceDetail,
      openRestorePanel,
      cancelSearchInput: context.cancelSearchInput,
      saveCustomUiCss: context.saveCustomUiCss,
      backStack: context.backStack,
    }
  })

  const {
    openResourceDetail,
    copyResourceDeepLink,
    closeResourceDetail,
    openResourceFromLayout,
    handleFavorite,
    handleDelete,
    handleDetailSave,
    handleRelatedDownload,
  } = useLibraryResourceActions(() => {
    const context = getContext()
    return {
      showNotice: context.showNotice,
      organizingResource: context.organizingResource,
      organizingInitialTab: context.organizingInitialTab,
      organizingBoundResources: context.organizingBoundResources,
      organizingVersions: context.organizingVersions,
      layoutMode: context.layoutMode,
      isSplitWide: context.isSplitWide,
      isBatchMode: context.isBatchMode,
      selectedSplitResourceId: context.selectedSplitResourceId,
      resources: context.resources,
      moveResourcesToRecycleBin: context.moveResourcesToRecycleBin,
      isOrganizing: context.isOrganizing,
      loadResources,
      categories: context.categories,
    }
  })

  const {
    openFolderSettings,
    handleFolderAdd,
    handleFolderCover,
    handleCabinetPin,
    handleCabinetUnpin,
    handleFolderRename,
    handleFolderReorder,
    openFolderManagerFromFeatureHub,
  } = useLibraryFolderOperations(() => {
    const context = getContext()
    return {
      isSettingsOpen: context.isSettingsOpen,
      isCategoryManagerOpen: context.isCategoryManagerOpen,
      isFolderViewBusy: context.isFolderViewBusy,
      loadResources,
      cabinetResourceIds: context.cabinetResourceIds,
      categories: context.categories,
      showNotice: context.showNotice,
      loadLibrary,
      resources: context.resources,
    }
  })

  const {
    linkImportUrls,
    linkImportPreview,
    handleImport,
    handleTavernBackupImport,
    handleLibraryBackupImport,
    handleResourceArchiveImport,
    handleSystemFileDragOver,
    handleSystemFileDragLeave,
    handleSystemFileDrop,
    handleLinkImport,
    closeImportChooser: closeImportChooserBase,
    openLinkImportPanel,
    openImportChooser,
    openFileImportPicker,
    openResourceArchivePicker,
    openLibraryBackupPicker,
    openTavernBackupPicker,
    importResourceFiles,
    handleVersionImportDecision: handleVersionImportDecisionBase,
    handleSharedImportChoice,
  } = useLibraryImport(() => {
    const context = getContext()
    return {
      pendingBackupImport: context.pendingBackupImport,
      showNotice: context.showNotice,
      activeVersionImport: context.activeVersionImport,
      isNativeApk: context.isNativeApk,
      isBusy: context.isBusy,
      isSystemFileDropActive: context.isSystemFileDropActive,
      linkImportUrls,
      loadResources,
      linkImportText: context.linkImportText,
      isLinkImportOpen: context.isLinkImportOpen,
      isImportChooserOpen: context.isImportChooserOpen,
      isRestorePanelOpen: context.isRestorePanelOpen,
      isFeatureHubOpen: context.isFeatureHubOpen,
      fileImportInput: context.fileImportInput,
      tavernBackupInput: context.tavernBackupInput,
      resourceArchiveInput: context.resourceArchiveInput,
      libraryBackupInput: context.libraryBackupInput,
      openRestorePanel,
      handleRestoreInspect,
      extractCharacterAssets: context.extractCharacterAssets,
      pendingVersionImports: context.pendingVersionImports,
      LARGE_IMPORT_BYTES: context.LARGE_IMPORT_BYTES,
      backupRecommended: context.backupRecommended,
      hideCharacterAssets: context.hideCharacterAssets,
      persistResourceVersionMatchCache: context.persistResourceVersionMatchCache,
      skipVersionComparisonOnImport: context.skipVersionComparisonOnImport,
      sameNameVersionCandidates: context.sameNameVersionCandidates,
      showManuallyBoundResources: context.showManuallyBoundResources,
      refreshStorageHealth,
      isVersionImportBusy: context.isVersionImportBusy,
      sharedAppImportFiles: context.sharedAppImportFiles,
    }
  })

  const {
    refreshStorageHealth,
    clearNativeTemporaryStorage,
    legacyLibraryHistory,
    isClearingLegacyLibraryHistory,
    refreshLegacyLibraryHistory,
    clearLegacyLibraryHistory,
    requestPersistentStorage,
    openVaultPanel,
    handleVaultUnlock,
    handleVaultEnable,
    handleVaultDisable,
    handleVaultLock,
  } = useLibraryProtection(() => {
    const context = getContext()
    return {
      storageHealth: context.storageHealth,
      nativeStorageInfo: context.nativeStorageInfo,
      isNativeApk: context.isNativeApk,
      isClearingNativeCache: context.isClearingNativeCache,
      showNotice: context.showNotice,
      isRequestingPersistence: context.isRequestingPersistence,
      categories: context.categories,
      isDataProtectionOpen: context.isDataProtectionOpen,
      isVaultPanelOpen: context.isVaultPanelOpen,
      vaultStatus: context.vaultStatus,
      isVaultBusy: context.isVaultBusy,
      loadLibrary,
      loadRecycleBin: context.loadRecycleBin,
      scheduleLibraryMaintenance: context.scheduleLibraryMaintenance,
      clearSearchHistory: context.clearSearchHistory,
      loadResources,
      resetSearchState: context.resetSearchState,
      resources: context.resources,
      recycleBinEntries: context.recycleBinEntries,
      recycleUndoEntry: context.recycleUndoEntry,
    }
  })

  const {
    handleExport,
    openRestorePanel,
    handleRestoreInspect,
    handleRestoreConfirm,
    closeRestorePanel: closeRestorePanelBase,
    isRestorePreflighting,
    stopRestoreInspection,
  } = useLibraryArchive(() => {
    const context = getContext()
    return {
      isExporting: context.isExporting,
      categories: context.categories,
      showNotice: context.showNotice,
      lastFullBackupAt: context.lastFullBackupAt,
      backupRecommended: context.backupRecommended,
      isExportPanelOpen: context.isExportPanelOpen,
      refreshStorageHealth,
      reloadAppearanceSettings: context.reloadAppearanceSettings,
      searchHistory: context.searchHistory,
      cabinetResourceIds: context.cabinetResourceIds,
      syncCustomUiCss: context.syncCustomUiCss,
      preparedRestore: context.preparedRestore,
      restoreSourceFile: context.restoreSourceFile,
      restoreReport: context.restoreReport,
      restoreEntry: context.restoreEntry,
      completedRestoreMode: context.completedRestoreMode,
      isRestorePanelOpen: context.isRestorePanelOpen,
      storageHealth: context.storageHealth,
      LARGE_ARCHIVE_BYTES: context.LARGE_ARCHIVE_BYTES,
      isRestoring: context.isRestoring,
      isRestorePreflighting,
      stopRestoreInspection,
      resources: context.resources,
      loadLibrary,
      onRestoreImportCancelled: async () => {
        const batch = context.pendingSharedBackupBatch ?? context.pendingSharedFileBatch.value
        if (batch) await context.cancelPendingSharedBatch(batch)
      },
      onRestoreImportComplete: context.acknowledgeSharedBackupAfterRestore,
    }
  })
  return {
    api: {
      handleSystemFileDragOver,
      handleSystemFileDragLeave,
      handleSystemFileDrop,
      selectFilter,
      selectCategory,
      selectTag,
      openFeatureHub,
      openImportChooser,
      handleImport,
      handleTavernBackupImport,
      handleLibraryBackupImport,
      handleResourceArchiveImport,
      openLinkImportPanel,
      openFileImportPicker,
      openResourceArchivePicker,
      openLibraryBackupPicker,
      openTavernBackupPicker,
      handleLinkImport,
      linkImportUrls,
      linkImportPreview,
      openVaultPanel,
      requestPersistentStorage,
      clearNativeTemporaryStorage,
      legacyLibraryHistory,
      isClearingLegacyLibraryHistory,
      refreshLegacyLibraryHistory,
      clearLegacyLibraryHistory,
      handleBrowseBack,
      clearBrowsingState,
      handleFavorite,
      openResourceFromLayout,
      handleDelete,
      openResourceDetail,
      copyResourceDeepLink,
      openFolderManagerFromFeatureHub,
      handleFolderAdd,
      handleFolderCover,
      handleFolderRename,
      handleFolderReorder,
      handleCabinetPin,
      handleCabinetUnpin,
      handleLibraryChanged,
      importResourceFiles,
      selectMobileDestination,
      openAiTagging,
      handleAiTagsApplied,
      closeResourceDetail,
      handleRelatedDownload,
      handleDetailSave,
      applyHideCharacterAssets,
      applyHideChatDisplayRegex,
      applyShowManuallyBoundResources,
      applyBlurThumbnails,
      updatePerformanceMonitorVisibility,
      openFolderSettings,
      openVaultSettings,
      openVersionRecognition,
      handleManualUpdateCheck,
      openRestorePanel,
      handleExport,
      isRestorePreflighting,
      stopRestoreInspection,
      handleRestoreInspect,
      handleRestoreConfirm,
      handleVaultUnlock,
      handleVaultEnable,
      handleVaultDisable,
      handleVaultLock,
      refreshLibraryAndOpenVersions,
    },
    updateSplitViewport,
    loadResources,
    loadLibrary,
    restoreWorkspaceSnapshot,
    saveWorkspaceSnapshot,
    handleNativeShortcut,
    handleNativeDeepLink,
    handleGlobalKeydown,
    handleBackRequest,
    handleBrowserPopState,
    handleMobileFocus,
    closeImportChooserBase,
    handleVersionImportDecisionBase,
    handleSharedImportChoice,
    refreshStorageHealth,
    closeRestorePanelBase,
  }
}
