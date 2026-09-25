<script setup lang="ts">
import './Styles.css'
import { onBeforeUnmount } from 'vue'
import { secretResourceService } from './services/SecretResourceService'
onBeforeUnmount(() => secretResourceService.lock())
import { secretPasswordRequest } from './composables/UseSecretPasswordPrompt'
const SecretPasswordDialog = createAsyncPanel(
  '密钥密码',
  () => import('./components/SecretPasswordDialog.vue'),
)
import LibraryLinkImportPanel from './components/LibraryLinkImportPanel.vue'
import CategoryManager from './components/CategoryManager.vue'
import DataVaultPanel from './components/DataVaultPanel.vue'
import { createAsyncPanel } from './core/AsyncPanel'
const AiTaggingPanel = createAsyncPanel(
  'AI 标签实验台',
  () => import('./components/AiTaggingPanel.vue'),
)
const ExportPanel = createAsyncPanel('导出', () => import('./components/ExportPanel.vue'))
const FeatureHub = createAsyncPanel('功能桌面', () => import('./components/FeatureHub.vue'))
const NativeExportDialog = createAsyncPanel(
  '保存文件',
  () => import('./components/NativeExportDialog.vue'),
)
const LayoutSettingsPanel = createAsyncPanel(
  '设置',
  () => import('./components/LayoutSettingsPanel.vue'),
)
const ResourceOrganizer = createAsyncPanel(
  '资源详情',
  () => import('./components/ResourceOrganizer.vue'),
)
const RestorePanel = createAsyncPanel('恢复', () => import('./components/RestorePanel.vue'))
const VersionImportDialog = createAsyncPanel(
  '版本导入',
  () => import('./components/VersionImportDialog.vue'),
)
const DuplicateCleaner = createAsyncPanel(
  '重复清理',
  () => import('./components/DuplicateCleaner.vue'),
)
const ExtractedAssetCleaner = createAsyncPanel(
  '清理拆分副本',
  () => import('./components/ExtractedAssetCleaner.vue'),
)
const RecycleBinPanel = createAsyncPanel('回收站', () => import('./components/RecycleBinPanel.vue'))
const VersionRecognitionPanel = createAsyncPanel(
  '历史版本重识别',
  () => import('./components/VersionRecognitionPanel.vue'),
)
import LibrarySidebar from './components/LibrarySidebar.vue'
import LibraryToolbar from './components/LibraryToolbar.vue'
import LibraryProtectionPanel from './components/LibraryProtectionPanel.vue'
import { proxyRefs, useTemplateRef } from 'vue'
import { usePersonalResourceNavigation } from './composables/UsePersonalResourceNavigation'
const PersonalResourceEditor = createAsyncPanel(
  '个人资源',
  () => import('./components/PersonalResourceEditor.vue'),
)
import BatchBar from './components/BatchBar.vue'
import ProjectActivityCenter from './components/ProjectActivityCenter.vue'
import ResourceCard from './components/ResourceCard.vue'
import ResourceInspector from './components/ResourceInspector.vue'
import ResourceListRow from './components/ResourceListRow.vue'
import { useApp } from './composables/UseApp'
const controller = useApp()
const panelModel = proxyRefs(controller)
const personalEditor = useTemplateRef<{ requestBack: () => void }>('personalEditor')
const personalOrganizer = useTemplateRef<{ requestClose: () => void }>('personalOrganizer')
const { newPersonalKind, personalSaved, createPersonal, closePersonal } =
  usePersonalResourceNavigation(controller, personalEditor, personalOrganizer)

const {
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
  theme,
  applyTheme,
  activeFilter,
  isCategoryManagerOpen,
  activeCategoryId,
  activeTag,
  openFeatureHub,
  isSettingsOpen,
  isExporting,
  isExportPanelOpen,
  isBusy,
  openImportChooser,
  handleImport,
  handleTavernBackupImport,
  isImportChooserOpen,
  isLinkImportOpen,
  closeImportChooser,
  openLinkImportPanel,
  openFileImportPicker,
  openTavernBackupPicker,
  statistics,
  backupOverdue,
  backupRecommended,
  isDataProtectionOpen,
  storageProtectionStatus,
  recycleBinEntries,
  isDuplicateCleanerOpen,
  isExtractedCleanerOpen,
  hasBrowsingState,
  handleBrowseBack,
  activeFilterLabel,
  activeCategoryLabel,
  searchQuery,
  cancelSearchInput,
  clearBrowsingState,
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
  duplicateResources,
  visibleLibraryResources,
  organizingVersions,
  organizingInitialTab,
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
  hideChatDisplayRegex,
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
  applyHideChatDisplayRegex,
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
} = controller
</script>

<template>
  <div
    class="app-shell"
    :style="{
      '--batch-bar-reserved': `${batchBarHeight}px`,
      '--bottom-nav-reserved': isFeatureAppActive ? '0px' : undefined,
    }"
    :class="[
      `app-shell--layout-${layoutMode}`,
      {
        'app-shell--batch': isBatchMode,
        'app-shell--vault-locked': vaultStatus.locked,
        'app-shell--system-file-drop': isSystemFileDropActive,
      },
    ]"
    @dragover="handleSystemFileDragOver"
    @dragleave="handleSystemFileDragLeave"
    @drop="handleSystemFileDrop"
  >
    <div v-if="isSystemFileDropActive" class="app-shell__system-file-drop" role="status">
      松开以导入角色卡、世界书或 SRL ZIP
    </div>
    <LibrarySidebar :model="panelModel" />

    <main v-if="!isFeatureHubOpen" class="library">
      <header class="library__header">
        <div>
          <h1 class="library__title">你的私人资源档案</h1>
          <p class="library__subtitle">没有上传，没有追踪。资源只在你的设备中整理和流转。</p>
        </div>

        <div class="library__header-actions">
          <button
            class="feature-hub-trigger"
            type="button"
            title="打开功能桌面"
            @click="openFeatureHub"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 4h6v6H4V4Zm10 0h6v6h-6V4ZM4 14h6v6H4v-6Zm10 0h6v6h-6v-6Z" />
            </svg>
            <span>功能</span>
          </button>
          <button
            class="layout-settings-trigger"
            type="button"
            aria-label="打开设置"
            title="设置"
            @click="isSettingsOpen = true"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M12 8.5a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7Zm0-5 1 2.1 2.3.6 1.9-1.3 1.9 1.9-1.3 1.9.6 2.3 2.1 1v2.7l-2.1 1-.6 2.3 1.3 1.9-1.9 1.9-1.9-1.3-2.3.6-1 2.1H9l-1-2.1-2.3-.6-1.9 1.3-1.9-1.9 1.3-1.9-.6-2.3-2.1-1V11l2.1-1 .6-2.3-1.3-1.9 1.9-1.9 1.9 1.3L8 5.6l1-2.1h3Z"
              />
            </svg>
          </button>
          <button
            class="theme-toggle"
            type="button"
            :aria-label="theme === 'light' ? '切换为深色模式' : '切换为浅色模式'"
            @click="applyTheme(theme === 'light' ? 'dark' : 'light')"
          >
            <svg v-if="theme === 'light'" viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M12 3v2m0 14v2M3 12h2m14 0h2M5.64 5.64l1.42 1.42m9.88 9.88 1.42 1.42m0-12.72-1.42 1.42M7.06 16.94l-1.42 1.42M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z"
              />
            </svg>
            <svg v-else viewBox="0 0 24 24" aria-hidden="true">
              <path d="M20 15.1A8.2 8.2 0 0 1 8.9 4a8.2 8.2 0 1 0 11.1 11.1Z" />
            </svg>
          </button>

          <button
            class="export-button"
            type="button"
            :disabled="isExporting"
            @click="isExportPanelOpen = true"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 4v12m0 0 4-4m-4 4-4-4M5 19h14" />
            </svg>
            <span>导出</span>
          </button>

          <button
            class="import-button"
            :class="{ 'import-button--busy': isBusy }"
            type="button"
            :disabled="isBusy"
            @click="openImportChooser"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5M5 14v5h14v-5" />
            </svg>
            <span>
              {{ isBusy ? '正在导入' : '资源 / 备份' }}
              <small v-if="!isBusy">选择链接导入或本地导入</small>
            </span>
          </button>
        </div>
      </header>

      <input
        ref="fileImportInput"
        class="import-button__input"
        type="file"
        accept=".png,.json,.jsonl,.srlchat,.css,.txt,.zip,image/png,application/json,text/css,text/plain,application/zip"
        multiple
        :disabled="isBusy"
        aria-label="批量选择资源文件或备份包"
        @change="handleImport"
      />

      <input
        ref="tavernBackupInput"
        class="import-button__input"
        type="file"
        accept=".zip,application/zip"
        :disabled="isBusy"
        aria-label="选择 SillyTavern 备份 ZIP"
        @change="handleTavernBackupImport"
      />

      <div
        v-if="isImportChooserOpen"
        class="import-choice-overlay"
        role="presentation"
        @click.self="closeImportChooser"
      >
        <section
          class="import-choice-sheet"
          :class="{ 'import-choice-sheet--link': isLinkImportOpen }"
          role="dialog"
          aria-modal="true"
          :aria-label="isLinkImportOpen ? '链接导入' : '选择导入方式'"
        >
          <header>
            <button
              v-if="isLinkImportOpen"
              class="import-choice-sheet__back"
              type="button"
              aria-label="返回导入方式"
              @click="isLinkImportOpen = false"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="m14 6-6 6 6 6" />
              </svg>
            </button>
            <span class="import-choice-sheet__header-title">
              <small v-if="isLinkImportOpen">LINK IMPORT</small>
              <strong>
                {{ isLinkImportOpen ? '导入脚本 / 外部扩展链接' : '资源 / 备份' }}
              </strong>
            </span>
            <button
              class="import-choice-sheet__close"
              type="button"
              aria-label="关闭导入"
              @click="closeImportChooser"
            >
              ×
            </button>
          </header>

          <template v-if="!isLinkImportOpen">
            <div class="personal-create-actions">
              <button type="button" @click="createPersonal('extraStory')">添加番外指令</button>
              <button type="button" @click="createPersonal('pocketPhone')">收纳小手机</button>
              <button type="button" @click="createPersonal('secret')">保存密钥资料</button>
            </div>
            <button
              class="import-choice-card import-choice-card--link"
              type="button"
              @click="openLinkImportPanel"
            >
              <span class="import-choice-card__icon" aria-hidden="true">
                <svg viewBox="0 0 24 24">
                  <path d="M10 13a5 5 0 0 0 7.1 0l1.4-1.4a5 5 0 0 0-7.1-7.1l-.8.8" />
                  <path d="M14 11a5 5 0 0 0-7.1 0l-1.4 1.4a5 5 0 0 0 7.1 7.1l.8-.8" />
                </svg>
              </span>
              <span class="import-choice-card__copy">
                <small>LINK IMPORT</small>
                <strong>链接导入脚本 / 外部扩展</strong>
                <em>读取 GitHub 说明，或保存 Release、raw 文件与社区入口</em>
              </span>
            </button>
            <button
              class="import-choice-card"
              type="button"
              :disabled="isBusy"
              @click="openFileImportPicker"
            >
              <span class="import-choice-card__icon" aria-hidden="true">
                <svg viewBox="0 0 24 24">
                  <path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5M5 14v5h14v-5" />
                </svg>
              </span>
              <span class="import-choice-card__copy">
                <small>FILE IMPORT</small>
                <strong>{{ isBusy ? '正在导入资源' : '导入本地资源 / 备份' }}</strong>
                <em>角色卡、世界书、正则、CSS、TXT、ZIP，可多选</em>
              </span>
            </button>
            <button
              class="import-choice-card"
              type="button"
              :disabled="isBusy"
              @click="openTavernBackupPicker"
            >
              <span class="import-choice-card__icon" aria-hidden="true">
                <svg viewBox="0 0 24 24">
                  <path d="M4 7h16v12H4zM7 4h10v3M8 11h8M8 15h5" />
                </svg>
              </span>
              <span class="import-choice-card__copy">
                <small>TAVERN BACKUP</small>
                <strong>导入酒馆备份</strong>
                <em>仅接受 SillyTavern 备份 ZIP，提取角色卡、世界书、预设、美化等支持资源</em>
              </span>
            </button>
          </template>

          <LibraryLinkImportPanel v-else :model="panelModel" />
        </section>
      </div>

      <section class="archive-summary" aria-label="资源概况">
        <div class="archive-summary__counts">
          <p class="archive-summary__total">
            <strong>{{ statistics.total }}</strong>
            <span>项资源</span>
          </p>
          <span class="archive-summary__rule" aria-hidden="true"></span>
          <p>
            角色卡 <strong>{{ statistics.characterCards }}</strong>
          </p>
          <p>
            世界书 <strong>{{ statistics.worldBooks }}</strong>
          </p>
        </div>
        <button
          class="protection-trigger"
          :class="{ 'protection-trigger--warning': backupOverdue || backupRecommended }"
          type="button"
          :aria-expanded="isDataProtectionOpen"
          aria-controls="data-protection-panel"
          @click="isDataProtectionOpen = !isDataProtectionOpen"
        >
          <span class="protection-trigger__mark" aria-hidden="true"></span>
          <span class="protection-trigger__copy">
            <small>数据保护</small>
            <strong>{{ storageProtectionStatus }}</strong>
          </span>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path :d="isDataProtectionOpen ? 'm6 15 6-6 6 6' : 'm6 9 6 6 6-6'" />
          </svg>
        </button>
      </section>

      <Transition name="protection-reveal">
        <LibraryProtectionPanel :model="panelModel" />
      </Transition>

      <nav v-if="hasBrowsingState" class="browsing-context" aria-label="当前筛选条件">
        <button class="browsing-context__back" type="button" @click="handleBrowseBack">
          <span aria-hidden="true">←</span>
          返回上一层
        </button>
        <div class="browsing-context__trail">
          <button v-if="activeFilterLabel" type="button" @click="activeFilter = 'all'">
            类型 · {{ activeFilterLabel }} <span>×</span>
          </button>
          <button v-if="activeCategoryLabel" type="button" @click="activeCategoryId = undefined">
            文件夹 · {{ activeCategoryLabel }} <span>×</span>
          </button>
          <button v-if="activeTag" type="button" @click="activeTag = ''">
            标签 · #{{ activeTag }} <span>×</span>
          </button>
          <button v-if="searchQuery" type="button" @click="cancelSearchInput">
            搜索 · {{ searchQuery }} <span>×</span>
          </button>
        </div>
        <button class="browsing-context__clear" type="button" @click="clearBrowsingState">
          清除全部
        </button>
      </nav>

      <LibraryToolbar :model="panelModel" />

      <section
        v-if="filteredResources.length && layoutMode === 'grid'"
        class="resource-grid"
        aria-live="polite"
      >
        <ResourceCard
          v-for="resource in paginatedResources"
          :key="resource.id"
          :resource="resource"
          :categories="categoriesForResource(resource)"
          :selectable="isBatchMode"
          :selected="selectedResourceIds.has(resource.id)"
          :blur-thumbnails="blurThumbnails"
          @favorite="handleFavorite"
          @edit="openResourceFromLayout"
          @select="toggleResourceSelection"
          @delete="handleDelete"
        />
      </section>

      <section
        v-else-if="filteredResources.length && layoutMode === 'list'"
        class="resource-list"
        aria-live="polite"
      >
        <header class="resource-list__header" aria-hidden="true">
          <span v-for="column in RESOURCE_LIST_COLUMNS" :key="column">{{ column }}</span>
        </header>
        <ResourceListRow
          v-for="resource in paginatedResources"
          :key="resource.id"
          :resource="resource"
          :categories="categoriesForResource(resource)"
          :selectable="isBatchMode"
          :selected="selectedResourceIds.has(resource.id)"
          @favorite="handleFavorite"
          @open="openResourceFromLayout"
          @select="toggleResourceSelection"
          @delete="handleDelete"
        />
      </section>

      <section v-else-if="filteredResources.length" class="split-workspace" aria-live="polite">
        <div class="split-workspace__list">
          <header class="split-workspace__heading">
            <div>
              <small>ACTIVE ARCHIVE</small><strong>{{ activeScopeLabel }}</strong>
            </div>
            <span>{{ filteredResources.length }} 项</span>
          </header>
          <div class="resource-list resource-list--split">
            <ResourceListRow
              v-for="resource in paginatedResources"
              :key="resource.id"
              :resource="resource"
              :categories="categoriesForResource(resource)"
              :selectable="isBatchMode"
              :selected="selectedResourceIds.has(resource.id)"
              :active="selectedSplitResourceId === resource.id"
              compact
              @favorite="handleFavorite"
              @open="openResourceFromLayout"
              @select="toggleResourceSelection"
              @delete="handleDelete"
            />
          </div>
        </div>
        <ResourceInspector
          :resource="selectedSplitResource"
          :categories="selectedSplitCategories"
          :related-resources="selectedSplitRelations"
          @edit="openResourceDetail"
          @favorite="handleFavorite"
          @download="handleResourceDownload"
          @copy-link="copyResourceDeepLink"
        />
      </section>

      <nav v-if="filteredResources.length > pageSize" class="pagination" aria-label="资源分页">
        <button
          type="button"
          :disabled="currentPage <= 1"
          @click="currentPage = Math.max(1, currentPage - 1)"
        >
          上一页
        </button>
        <span>第 {{ currentPage }} / {{ totalPages }} 页</span>
        <label>
          每页
          <select v-model="pageSize" aria-label="每页资源数量">
            <option :value="24">24</option>
            <option :value="48">48</option>
            <option :value="96">96</option>
          </select>
        </label>
        <button
          type="button"
          :disabled="currentPage >= totalPages"
          @click="currentPage = Math.min(totalPages, currentPage + 1)"
        >
          下一页
        </button>
      </nav>

      <section v-if="!filteredResources.length" class="empty-state">
        <div class="empty-state__folio" aria-hidden="true">
          <span></span><span></span><span></span>
        </div>
        <h2>{{ managedResources.length ? '没有找到匹配资源' : '档案柜还是空的' }}</h2>
        <p>
          {{
            visibleLibraryResources.length
              ? '换一个关键词或筛选条件试试。'
              : '从角色卡、世界书、正则、预设或美化文件开始建立你的私人收藏。'
          }}
        </p>
        <button
          v-if="visibleLibraryResources.length"
          class="button button--quiet empty-state__reset"
          type="button"
          @click="clearBrowsingState"
        >
          清除搜索与筛选
        </button>
      </section>
    </main>

    <FeatureHub
      v-else
      :resources="managedResources"
      :versions="organizingVersions"
      :categories="categories"
      :theme="theme"
      :layout-mode="layoutMode"
      :ui-font-scale="uiFontScale"
      :custom-css="customUiCss"
      :folder-busy="isFolderViewBusy"
      :cabinet-resource-ids="cabinetResourceIds"
      @feature-app-active="isFeatureAppActive = $event"
      @close="isFeatureHubOpen = false"
      @open-resource="openResourceDetail"
      @open-persona-history="(resource) => openResourceDetail(resource, 'versions')"
      @manage-folders="openFolderManagerFromFeatureHub"
      @folder-add="handleFolderAdd"
      @folder-cover="handleFolderCover"
      @folder-rename="handleFolderRename"
      @folder-reorder="handleFolderReorder"
      @cabinet-pin="handleCabinetPin"
      @cabinet-unpin="handleCabinetUnpin"
      @update:theme="applyTheme"
      @update:layout-mode="applyLayoutMode"
      @update:ui-font-scale="applyUiFontScale"
      @save-css="saveCustomUiCss"
      @library-changed="handleLibraryChanged"
      @import-files="importResourceFiles"
    />

    <nav v-if="!isFeatureAppActive" class="mobile-bottom-nav" aria-label="移动端主要操作">
      <button
        type="button"
        :class="{
          'mobile-bottom-nav__item--active': !isFeatureHubOpen && activeFilter === 'all',
        }"
        @click="selectMobileDestination('all')"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 5h6v6H4V5Zm10 0h6v6h-6V5ZM4 15h6v4H4v-4Zm10 0h6v4h-6v-4Z" />
        </svg>
        <span>资源库</span>
      </button>
      <button
        type="button"
        :class="{ 'mobile-bottom-nav__item--active': isFeatureHubOpen }"
        @click="openFeatureHub"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 4h6v6H4V4Zm10 0h6v6h-6V4ZM4 14h6v6H4v-6Zm10 0h6v6h-6v-6Z" />
        </svg>
        <span>功能</span>
      </button>
      <button
        class="mobile-bottom-nav__import"
        :class="{ 'mobile-bottom-nav__import--busy': isBusy }"
        type="button"
        :disabled="isBusy"
        @click="openImportChooser"
      >
        <span aria-hidden="true">+</span>
        <small>{{ isBusy ? '导入中' : '资源 / 备份' }}</small>
      </button>
      <button type="button" @click="isExportPanelOpen = true">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 4v12m0 0 4-4m-4 4-4-4M5 19h14" />
        </svg>
        <span>导出</span>
      </button>
      <button type="button" @click="isSettingsOpen = true">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path
            d="M12 8.5a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7Zm0-5 1 2.1 2.3.6 1.9-1.3 1.9 1.9-1.3 1.9.6 2.3 2.1 1v2.7l-2.1 1-.6 2.3 1.3 1.9-1.9 1.9-1.9-1.3-2.3.6-1 2.1H9l-1-2.1-2.3-.6-1.9 1.3-1.9-1.9 1.3-1.9-.6-2.3-2.1-1V11l2.1-1 .6-2.3-1.3-1.9 1.9-1.9 1.9 1.3L8 5.6l1-2.1h3Z"
          />
        </svg>
        <span>设置</span>
      </button>
    </nav>

    <ProjectActivityCenter v-show="!secretPasswordRequest" />

    <div v-if="notice && recycleUndoEntry" class="notice">
      <span role="status">{{ notice }}</span>
      <button
        v-if="recycleUndoEntry"
        class="notice__undo"
        type="button"
        @click="handleRestoreRecycleBinEntry(recycleUndoEntry!.id)"
      >
        恢复刚删除
      </button>
      <button type="button" aria-label="关闭通知" @click="notice = ''">×</button>
    </div>

    <BatchBar
      v-if="isBatchMode"
      :count="selectedResourceIds.size"
      :visible-count="paginatedResources.length"
      :all-visible-selected="allVisibleSelected"
      :scope-count="batchSelectionScope.length"
      :scope-label="batchSelectionScopeLabel"
      :all-scope-selected="allBatchScopeSelected"
      :selected-character-count="selectedCharacterCount"
      :categories="categories"
      :busy="isBatchBusy"
      @resize="batchBarHeight = $event"
      @close="toggleBatchMode"
      @toggle-visible="toggleVisibleSelection"
      @toggle-scope="toggleBatchScopeSelection"
      @extract-character-assets="handleBatchExtractCharacterAssets"
      @favorite="handleBatchFavorite"
      @move="handleBatchMove"
      @manage-folders="isCategoryManagerOpen = true"
      @tag="handleBatchTag"
      @ai-tag="openAiTagging"
      @delete="handleBatchDelete"
    />

    <AiTaggingPanel
      v-if="isAiTaggingOpen"
      :resources="managedResources"
      :categories="categories"
      :initial-selected-ids="Array.from(selectedResourceIds)"
      @applied="handleAiTagsApplied"
      @close="isAiTaggingOpen = false"
    />

    <RecycleBinPanel
      v-if="isRecycleBinOpen"
      :records="recycleBinEntries"
      :busy="isRecycleBinBusy"
      @close="isRecycleBinOpen = false"
      @restore="handleRestoreRecycleBinEntry"
      @purge="handlePurgeRecycleBinEntry"
      @empty="handleEmptyRecycleBin"
    />

    <SecretPasswordDialog v-if="secretPasswordRequest" />
    <PersonalResourceEditor
      v-if="newPersonalKind"
      ref="personalEditor"
      :key="newPersonalKind"
      :kind="newPersonalKind"
      :settings-open="isSettingsOpen"
      @open-settings="isSettingsOpen = true"
      @close="closePersonal"
      @saved="personalSaved"
      @busy="isOrganizing = $event"
    />
    <ResourceOrganizer
      v-if="organizingResource"
      ref="personalOrganizer"
      :resource="organizingResource"
      :initial-tab="organizingInitialTab"
      :settings-open="isSettingsOpen"
      :resources="managedResources"
      :bound-resources="organizingBoundResources"
      :versions="organizingVersions"
      :categories="categories"
      :busy="isOrganizing"
      @open-secret-settings="isSettingsOpen = true"
      @close="closeResourceDetail"
      @personal-saved="personalSaved"
      @personal-busy="isOrganizing = $event"
      @download="handleResourceDownload"
      @download-related="handleRelatedDownload"
      @open="openResourceDetail"
      @activate-version="handleActivateVersion"
      @delete-version="handleDeleteResourceVersion"
      @update-version-note="handleUpdateVersionNote"
      @merge-version="handleMergeExistingVersion"
      @replace-artwork="handleReplaceCharacterCardArtwork"
      @save="handleDetailSave"
    />

    <NativeExportDialog
      v-if="pendingNativeExport"
      :file-name="pendingNativeExport.fileName"
      :is-image="pendingNativeExport.isImage"
      :busy="isNativeExportBusy"
      @close="pendingNativeExport = undefined"
      @save="handleNativeExportSelection"
      @share="sharePendingNativeExport"
    />

    <VersionImportDialog
      v-if="activeVersionImport"
      :candidate="activeVersionImport"
      :remaining="pendingVersionImports.length"
      :busy="isVersionImportBusy"
      @resolve="handleVersionImportDecision"
    />

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
      :show-performance-monitor="showPerformanceMonitor"
      :hidden-character-asset-count="hiddenCharacterAssetCount"
      :history-snapshot-limit="historySnapshotLimit"
      :history-snapshot-count="historySnapshots.length"
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
      @update:show-performance-monitor="updatePerformanceMonitorVisibility"
      @update:history-snapshot-limit="handleHistorySnapshotLimit"
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
      :entry="restoreEntry"
      :completed-mode="completedRestoreMode"
      @close="isRestorePanelOpen = false"
      @inspect="handleRestoreInspect"
      @confirm="handleRestoreConfirm"
    />

    <DataVaultPanel
      v-if="isVaultPanelOpen"
      :status="vaultStatus"
      :snapshots="historySnapshots"
      :busy="isVaultBusy"
      :required="vaultStatus.locked"
      @close="isVaultPanelOpen = false"
      @unlock="handleVaultUnlock"
      @enable="handleVaultEnable"
      @disable="handleVaultDisable"
      @lock="handleVaultLock"
      @snapshot="handleCreateSnapshot"
      @restore="handleRestoreSnapshot"
      @delete="handleDeleteSnapshot"
    />

    <div
      v-if="isDuplicateCleanerOpen"
      class="editor-overlay duplicate-cleaner-overlay"
      role="presentation"
      @click.self="isDuplicateCleanerOpen = false"
    >
      <div class="duplicate-cleaner-sheet" role="dialog" aria-modal="true" aria-label="重复清理">
        <DuplicateCleaner
          :resources="duplicateResources"
          @back="isDuplicateCleanerOpen = false"
          @open-resource="
            (resource) => {
              isDuplicateCleanerOpen = false
              void openResourceDetail(resource)
            }
          "
          @library-changed="handleLibraryChanged"
        />
      </div>
    </div>

    <div
      v-if="isExtractedCleanerOpen"
      class="editor-overlay duplicate-cleaner-overlay"
      role="presentation"
      @click.self="isExtractedCleanerOpen = false"
    >
      <div
        class="duplicate-cleaner-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="清理拆分副本"
      >
        <ExtractedAssetCleaner
          :resources="managedResources"
          @back="isExtractedCleanerOpen = false"
          @open-resource="
            (resource) => {
              isExtractedCleanerOpen = false
              void openResourceDetail(resource)
            }
          "
          @library-changed="handleLibraryChanged"
        />
      </div>
    </div>

    <div
      v-if="isVersionRecognitionOpen"
      class="editor-overlay duplicate-cleaner-overlay"
      role="presentation"
      @click.self="isVersionRecognitionOpen = false"
    >
      <div
        class="duplicate-cleaner-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="历史版本管理"
      >
        <VersionRecognitionPanel
          :resources="managedResources"
          @close="isVersionRecognitionOpen = false"
          @library-changed="refreshLibraryAndOpenVersions"
        />
      </div>
    </div>
  </div>
</template>
