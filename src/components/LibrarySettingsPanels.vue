<script setup lang="ts">
import { toRef, type ShallowUnwrapRef } from 'vue'
import type { useApp } from '../composables/UseApp'
import { createAsyncPanel } from '../core/AsyncPanel'
const LayoutSettingsPanel = createAsyncPanel('设置', () => import('./LayoutSettingsPanel.vue'))
const CategoryManager = createAsyncPanel('分类管理', () => import('./CategoryManager.vue'))
const ExportPanel = createAsyncPanel('导出', () => import('./ExportPanel.vue'))
const RestorePanel = createAsyncPanel('恢复', () => import('./RestorePanel.vue'))
const DataVaultPanel = createAsyncPanel('保险库', () => import('./DataVaultPanel.vue'))
type PanelModel = Pick<
  ShallowUnwrapRef<ReturnType<typeof useApp>>,
  | 'isSettingsOpen'
  | 'settingsPanelKey'
  | 'vaultStatus'
  | 'previewPolicy'
  | 'extractCharacterAssets'
  | 'hideCharacterAssets'
  | 'hideChatDisplayRegex'
  | 'showManuallyBoundResources'
  | 'blurThumbnails'
  | 'autoDownloadDiscordShareLinks'
  | 'persistResourceVersionMatchCache'
  | 'skipVersionComparisonOnImport'
  | 'sameNameVersionCandidates'
  | 'showPerformanceMonitor'
  | 'hiddenCharacterAssetCount'
  | 'handleLibraryChanged'
  | 'applyRemotePreviewPolicy'
  | 'applyScriptPreviewPolicy'
  | 'applyGreetingPreviewPreload'
  | 'applyBeautificationPreviewPreload'
  | 'applyExtractCharacterAssets'
  | 'applyHideCharacterAssets'
  | 'applyHideChatDisplayRegex'
  | 'applyShowManuallyBoundResources'
  | 'applyBlurThumbnails'
  | 'applyAutoDownloadDiscordShareLinks'
  | 'applyPersistResourceVersionMatchCache'
  | 'applySameNameVersionCandidates'
  | 'applySkipVersionComparisonOnImport'
  | 'updatePerformanceMonitorVisibility'
  | 'openFolderSettings'
  | 'openVaultSettings'
  | 'openVersionRecognition'
  | 'handleManualUpdateCheck'
  | 'isCategoryManagerOpen'
  | 'categoryManagerKey'
  | 'categories'
  | 'isOrganizing'
  | 'handleCategoryCreate'
  | 'handleCategoryUpdate'
  | 'handleCategoryVisibility'
  | 'handleCategoryDelete'
  | 'isExportPanelOpen'
  | 'duplicateResources'
  | 'isExporting'
  | 'openRestorePanel'
  | 'handleExport'
  | 'isRestorePanelOpen'
  | 'preparedRestore'
  | 'restoreReport'
  | 'isRestoring'
  | 'isRestorePreflighting'
  | 'restoreEntry'
  | 'completedRestoreMode'
  | 'closeRestorePanel'
  | 'handleRestoreInspect'
  | 'handleRestoreConfirm'
  | 'stopRestoreInspection'
  | 'isVaultPanelOpen'
  | 'isVaultBusy'
  | 'handleVaultUnlock'
  | 'handleVaultEnable'
  | 'handleVaultDisable'
  | 'handleVaultLock'
>
const input = defineProps<{ model: PanelModel }>()
const isSettingsOpen = toRef(input.model, 'isSettingsOpen')
const settingsPanelKey = toRef(input.model, 'settingsPanelKey')
const vaultStatus = toRef(input.model, 'vaultStatus')
const previewPolicy = toRef(input.model, 'previewPolicy')
const extractCharacterAssets = toRef(input.model, 'extractCharacterAssets')
const hideCharacterAssets = toRef(input.model, 'hideCharacterAssets')
const hideChatDisplayRegex = toRef(input.model, 'hideChatDisplayRegex')
const showManuallyBoundResources = toRef(input.model, 'showManuallyBoundResources')
const blurThumbnails = toRef(input.model, 'blurThumbnails')
const autoDownloadDiscordShareLinks = toRef(input.model, 'autoDownloadDiscordShareLinks')
const persistResourceVersionMatchCache = toRef(input.model, 'persistResourceVersionMatchCache')
const skipVersionComparisonOnImport = toRef(input.model, 'skipVersionComparisonOnImport')
const sameNameVersionCandidates = toRef(input.model, 'sameNameVersionCandidates')
const showPerformanceMonitor = toRef(input.model, 'showPerformanceMonitor')
const hiddenCharacterAssetCount = toRef(input.model, 'hiddenCharacterAssetCount')
const handleLibraryChanged = toRef(input.model, 'handleLibraryChanged')
const applyRemotePreviewPolicy = toRef(input.model, 'applyRemotePreviewPolicy')
const applyScriptPreviewPolicy = toRef(input.model, 'applyScriptPreviewPolicy')
const applyGreetingPreviewPreload = toRef(input.model, 'applyGreetingPreviewPreload')
const applyBeautificationPreviewPreload = toRef(input.model, 'applyBeautificationPreviewPreload')
const applyExtractCharacterAssets = toRef(input.model, 'applyExtractCharacterAssets')
const applyHideCharacterAssets = toRef(input.model, 'applyHideCharacterAssets')
const applyHideChatDisplayRegex = toRef(input.model, 'applyHideChatDisplayRegex')
const applyShowManuallyBoundResources = toRef(input.model, 'applyShowManuallyBoundResources')
const applyBlurThumbnails = toRef(input.model, 'applyBlurThumbnails')
const applyAutoDownloadDiscordShareLinks = toRef(input.model, 'applyAutoDownloadDiscordShareLinks')
const applyPersistResourceVersionMatchCache = toRef(
  input.model,
  'applyPersistResourceVersionMatchCache',
)
const applySameNameVersionCandidates = toRef(input.model, 'applySameNameVersionCandidates')
const applySkipVersionComparisonOnImport = toRef(input.model, 'applySkipVersionComparisonOnImport')
const updatePerformanceMonitorVisibility = toRef(input.model, 'updatePerformanceMonitorVisibility')
const openFolderSettings = toRef(input.model, 'openFolderSettings')
const openVaultSettings = toRef(input.model, 'openVaultSettings')
const openVersionRecognition = toRef(input.model, 'openVersionRecognition')
const handleManualUpdateCheck = toRef(input.model, 'handleManualUpdateCheck')
const isCategoryManagerOpen = toRef(input.model, 'isCategoryManagerOpen')
const categoryManagerKey = toRef(input.model, 'categoryManagerKey')
const categories = toRef(input.model, 'categories')
const isOrganizing = toRef(input.model, 'isOrganizing')
const handleCategoryCreate = toRef(input.model, 'handleCategoryCreate')
const handleCategoryUpdate = toRef(input.model, 'handleCategoryUpdate')
const handleCategoryVisibility = toRef(input.model, 'handleCategoryVisibility')
const handleCategoryDelete = toRef(input.model, 'handleCategoryDelete')
const isExportPanelOpen = toRef(input.model, 'isExportPanelOpen')
const duplicateResources = toRef(input.model, 'duplicateResources')
const isExporting = toRef(input.model, 'isExporting')
const openRestorePanel = toRef(input.model, 'openRestorePanel')
const handleExport = toRef(input.model, 'handleExport')
const isRestorePanelOpen = toRef(input.model, 'isRestorePanelOpen')
const preparedRestore = toRef(input.model, 'preparedRestore')
const restoreReport = toRef(input.model, 'restoreReport')
const isRestoring = toRef(input.model, 'isRestoring')
const isRestorePreflighting = toRef(input.model, 'isRestorePreflighting')
const restoreEntry = toRef(input.model, 'restoreEntry')
const completedRestoreMode = toRef(input.model, 'completedRestoreMode')
const closeRestorePanel = toRef(input.model, 'closeRestorePanel')
const handleRestoreInspect = toRef(input.model, 'handleRestoreInspect')
const handleRestoreConfirm = toRef(input.model, 'handleRestoreConfirm')
const stopRestoreInspection = toRef(input.model, 'stopRestoreInspection')
const isVaultPanelOpen = toRef(input.model, 'isVaultPanelOpen')
const isVaultBusy = toRef(input.model, 'isVaultBusy')
const handleVaultUnlock = toRef(input.model, 'handleVaultUnlock')
const handleVaultEnable = toRef(input.model, 'handleVaultEnable')
const handleVaultDisable = toRef(input.model, 'handleVaultDisable')
const handleVaultLock = toRef(input.model, 'handleVaultLock')
</script>
<template>
  <LayoutSettingsPanel
    v-if="isSettingsOpen"
    :key="settingsPanelKey"
    :vault-enabled="vaultStatus.enabled"
    :allow-remote-previews="previewPolicy.allowRemoteResources"
    :allow-script-previews="previewPolicy.allowScripts"
    :preload-greeting-previews="previewPolicy.preloadGreetingResources === true"
    :preload-beautification-previews="previewPolicy.preloadBeautificationResources === true"
    :extract-character-assets="extractCharacterAssets"
    :hide-character-assets="hideCharacterAssets"
    :hide-chat-display-regex="hideChatDisplayRegex"
    :show-manually-bound-resources="showManuallyBoundResources"
    :blur-thumbnails="blurThumbnails"
    :auto-download-discord-share-links="autoDownloadDiscordShareLinks"
    :persist-resource-version-match-cache="persistResourceVersionMatchCache"
    :skip-version-comparison-on-import="skipVersionComparisonOnImport"
    :same-name-version-candidates="sameNameVersionCandidates"
    :show-performance-monitor="showPerformanceMonitor"
    :hidden-character-asset-count="hiddenCharacterAssetCount"
    @library-changed="handleLibraryChanged"
    @update:allow-remote-previews="applyRemotePreviewPolicy"
    @update:allow-script-previews="applyScriptPreviewPolicy"
    @update:preload-greeting-previews="applyGreetingPreviewPreload"
    @update:preload-beautification-previews="applyBeautificationPreviewPreload"
    @update:extract-character-assets="applyExtractCharacterAssets"
    @update:hide-character-assets="applyHideCharacterAssets"
    @update:hide-chat-display-regex="applyHideChatDisplayRegex"
    @update:show-manually-bound-resources="applyShowManuallyBoundResources"
    @update:blur-thumbnails="applyBlurThumbnails"
    @update:auto-download-discord-share-links="applyAutoDownloadDiscordShareLinks"
    @update:persist-resource-version-match-cache="applyPersistResourceVersionMatchCache"
    @update:same-name-version-candidates="applySameNameVersionCandidates"
    @update:skip-version-comparison-on-import="applySkipVersionComparisonOnImport"
    @update:show-performance-monitor="updatePerformanceMonitorVisibility"
    @manage-folders="openFolderSettings"
    @open-vault="openVaultSettings"
    @open-version-recognition="openVersionRecognition"
    @manual-check-update="handleManualUpdateCheck"
    @close="isSettingsOpen = false"
  />

  <CategoryManager
    v-if="isCategoryManagerOpen"
    :key="categoryManagerKey"
    :categories="categories"
    :busy="isOrganizing"
    @close="isCategoryManagerOpen = false"
    @create="handleCategoryCreate"
    @update="handleCategoryUpdate"
    @visibility="handleCategoryVisibility"
    @delete="handleCategoryDelete"
  />

  <ExportPanel
    v-if="isExportPanelOpen"
    :resources="duplicateResources"
    :categories="categories"
    :busy="isExporting"
    @close="isExportPanelOpen = false"
    @restore="openRestorePanel"
    @full="handleExport({ mode: 'full', ...$event })"
    @partial="handleExport({ mode: 'partial', ...$event })"
  />

  <RestorePanel
    v-if="isRestorePanelOpen"
    :prepared="preparedRestore"
    :report="restoreReport"
    :busy="isRestoring"
    :preflight-busy="isRestorePreflighting"
    :entry="restoreEntry"
    :completed-mode="completedRestoreMode"
    @close="closeRestorePanel"
    @inspect="handleRestoreInspect"
    @confirm="handleRestoreConfirm"
    @stop="stopRestoreInspection"
  />

  <DataVaultPanel
    v-if="isVaultPanelOpen"
    :status="vaultStatus"
    :busy="isVaultBusy"
    :required="vaultStatus.locked"
    @close="isVaultPanelOpen = false"
    @unlock="handleVaultUnlock"
    @enable="handleVaultEnable"
    @disable="handleVaultDisable"
    @lock="handleVaultLock"
  />
</template>
