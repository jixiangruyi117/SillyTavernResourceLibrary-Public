import type { ComputedRef, Ref } from 'vue'
import { onMounted, onUnmounted, watch } from 'vue'
import { SRL_BACK_REQUEST_EVENT } from '../composables/UseBackStack'
import {
  browserStorageService,
  cloudBackupService,
  initializeVaultOnce,
  resourceService,
  greetingResourceService,
  syncNativeResourceFiles,
} from '../core/AppContainer'
import { markStartupReady } from '../core/SafeStartup'
import type { FilterValue, SortValue } from '../types/AppView'
import type { UiFontScale } from '../types/BrowserPreferences'
import { type ResourceSummary } from '../types/Resource'
import type { VaultStatus } from '../types/Vault'
import type { ThemeValue } from '../utils/LibraryFormatting'
import { clearShareTargetQuery, takeSharedFileBatch } from '../utils/ShareTargetIntake'
import type { SearchScope } from './UseSearchIndex'

interface LibraryLifecycleContext {
  showNotice: (message: string, duration?: number, preserveRecycleUndo?: boolean) => void
  importResourceFiles: (files: File[]) => Promise<boolean>
  loadResources: () => Promise<void>
  refreshStorageHealth: () => Promise<void>
  vaultStatus: Ref<VaultStatus>
  searchQuery: Ref<string, string>
  searchHistory: Ref<string[], string[]>
  isVaultPanelOpen: Ref<boolean, boolean>
  loadLibrary: () => Promise<void>
  loadHistorySnapshots: () => Promise<void>
  loadRecycleBin: () => Promise<void>
  handleNativeDeepLink: (event?: Event) => Promise<void>
  isOverlayOpen: ComputedRef<boolean>
  searchScope: Ref<SearchScope, SearchScope>
  activeFilter: Ref<FilterValue>
  activeCategoryId: Ref<string | null | undefined>
  activeTag: Ref<string, string>
  sortValue: Ref<SortValue>
  pageSize: Ref<number, number>
  currentPage: Ref<number, number>
  refreshSearchContentIndex: (items: ResourceSummary[]) => Promise<void>
  resources: Ref<ResourceSummary[]>
  selectedSplitResourceId: Ref<string | undefined>
  isFeatureHubOpen: Ref<boolean, boolean>
  saveWorkspaceSnapshot: () => void
  totalPages: ComputedRef<number>
  applyTheme: (value: ThemeValue) => void
  theme: Ref<ThemeValue, ThemeValue>
  applyUiFontScale: (value: UiFontScale) => void
  uiFontScale: Ref<'small' | 'standard' | 'large', 'small' | 'standard' | 'large'>
  handleGlobalKeydown: (event: KeyboardEvent) => void
  handleBackRequest: (event: Event) => void
  handleBrowserPopState: () => void
  updateSplitViewport: () => void
  handleNativeShortcut: (event?: Event) => void
  handleMobileFocus: (event: FocusEvent) => void
  syncCustomUiCss: () => void
  mobileInputRevealTimer: number | undefined
}

export function useLibraryLifecycle(context: LibraryLifecycleContext) {
  let searchIndexTimer: number | undefined
  let cloudBackupTimer: number | undefined
  let libraryMaintenanceTimer: number | undefined
  let consumingSharedFiles = false
  let stopGreetingUpdates: (() => void) | undefined

  async function consumeSharedFiles(): Promise<void> {
    if (consumingSharedFiles) return
    consumingSharedFiles = true
    const arrivedViaShare = new URLSearchParams(window.location.search).has('share-target')
    try {
      clearShareTargetQuery()
      const batch = await takeSharedFileBatch()
      if (batch.files.length) {
        context.showNotice(`收到系统分享的 ${batch.files.length} 个文件，开始导入…`)
        if (await context.importResourceFiles(batch.files)) await batch.acknowledge()
      } else if (arrivedViaShare) {
        context.showNotice('分享跳转已到达，但没有收到文件；请重新分享或使用“导入资源”。')
      }
    } catch (error) {
      context.showNotice(
        error instanceof Error ? error.message : '读取系统分享文件失败；文件已保留，可稍后重试',
      )
    } finally {
      consumingSharedFiles = false
    }
  }

  async function runLibraryMaintenance(): Promise<void> {
    const thumbnailRepairCount = await resourceService.repairThumbnailAssets()
    const upgradedCount = await resourceService.upgradeLegacyJsonResources()
    const backfilledCount = await resourceService.backfillCardFingerprints()
    if (thumbnailRepairCount > 0 || upgradedCount > 0 || backfilledCount > 0) {
      await context.loadResources()
    }
  }

  function scheduleLibraryMaintenance(): void {
    if (libraryMaintenanceTimer !== undefined) window.clearTimeout(libraryMaintenanceTimer)
    libraryMaintenanceTimer = window.setTimeout(() => {
      libraryMaintenanceTimer = undefined
      void runLibraryMaintenance().catch((error) => {
        console.warn('存量资源后台维护失败:', error)
      })
    }, 0)
  }

  async function initializeLibrary(): Promise<void> {
    const [status] = await Promise.all([initializeVaultOnce(), context.refreshStorageHealth()])
    context.vaultStatus.value = status
    if (context.vaultStatus.value.locked) {
      browserStorageService.clearSearchHistory()
      context.searchQuery.value = ''
      context.searchHistory.value = []
      context.isVaultPanelOpen.value = true
      return
    }
    await Promise.all([
      context.loadLibrary(),
      context.loadHistorySnapshots(),
      context.loadRecycleBin(),
    ])
    await context.handleNativeDeepLink()
    await consumeSharedFiles()
    scheduleLibraryMaintenance()
    void syncNativeResourceFiles().catch((error) => {
      context.showNotice(
        error instanceof Error
          ? `Android 本地文件同步失败：${error.message}`
          : 'Android 本地文件同步失败',
      )
    })
    void cloudBackupService
      .reconcileNativeJob()
      .then(() => cloudBackupService.runDueBackup())
      .catch(() => undefined)
  }

  watch(
    context.isOverlayOpen,
    (open) => {
      document.body.classList.toggle('modal-open', open)
    },
    { immediate: true },
  )

  watch(
    [
      context.searchQuery,
      context.searchScope,
      context.activeFilter,
      context.activeCategoryId,
      context.activeTag,
      context.sortValue,
      context.pageSize,
    ],
    () => {
      context.currentPage.value = 1
    },
  )

  watch([context.searchQuery, context.searchScope], ([query, scope]) => {
    if (searchIndexTimer !== undefined) window.clearTimeout(searchIndexTimer)
    if (scope !== 'content' || !query.trim()) return
    searchIndexTimer = window.setTimeout(() => {
      void context.refreshSearchContentIndex(context.resources.value)
    }, 220)
  })

  watch(
    [
      context.activeFilter,
      context.activeCategoryId,
      context.activeTag,
      context.sortValue,
      context.currentPage,
      context.selectedSplitResourceId,
      context.isFeatureHubOpen,
    ],
    context.saveWorkspaceSnapshot,
  )

  watch(context.totalPages, (value) => {
    if (context.currentPage.value > value) context.currentPage.value = value
  })

  context.applyTheme(context.theme.value)

  context.applyUiFontScale(context.uiFontScale.value)

  onMounted(() => {
    stopGreetingUpdates = greetingResourceService.onSaved(() => {
      void context
        .loadResources()
        .catch(() => context.showNotice('开场白已保存，资源列表暂时刷新失败'))
    })
    window.addEventListener('keydown', context.handleGlobalKeydown)
    window.addEventListener(SRL_BACK_REQUEST_EVENT, context.handleBackRequest)
    window.addEventListener('popstate', context.handleBrowserPopState)
    window.history.pushState({ ...(window.history.state ?? {}), srlBackGuard: true }, '')
    window.addEventListener('resize', context.updateSplitViewport)
    window.addEventListener('srl:native-share', consumeSharedFiles)
    window.addEventListener('srl:native-shortcut', context.handleNativeShortcut)
    window.addEventListener('srl:native-deep-link', context.handleNativeDeepLink)
    window.addEventListener('pagehide', context.saveWorkspaceSnapshot)
    context.handleNativeShortcut()
    document.addEventListener('focusin', context.handleMobileFocus)
    context.updateSplitViewport()
    context.syncCustomUiCss()
    cloudBackupTimer = window.setInterval(
      () => void cloudBackupService.runDueBackup().catch(() => undefined),
      60 * 1000,
    )
    void initializeLibrary()
      .then(markStartupReady)
      .catch(() => context.showNotice('无法读取本地数据库，请刷新后重试'))
  })

  onUnmounted(() => {
    stopGreetingUpdates?.()
    if (searchIndexTimer !== undefined) window.clearTimeout(searchIndexTimer)
    if (libraryMaintenanceTimer !== undefined) window.clearTimeout(libraryMaintenanceTimer)
    if (cloudBackupTimer !== undefined) window.clearInterval(cloudBackupTimer)
    if (context.mobileInputRevealTimer !== undefined)
      window.clearTimeout(context.mobileInputRevealTimer)
    window.removeEventListener('keydown', context.handleGlobalKeydown)
    window.removeEventListener(SRL_BACK_REQUEST_EVENT, context.handleBackRequest)
    window.removeEventListener('popstate', context.handleBrowserPopState)
    window.removeEventListener('resize', context.updateSplitViewport)
    window.removeEventListener('srl:native-share', consumeSharedFiles)
    window.removeEventListener('srl:native-shortcut', context.handleNativeShortcut)
    window.removeEventListener('srl:native-deep-link', context.handleNativeDeepLink)
    window.removeEventListener('pagehide', context.saveWorkspaceSnapshot)
    context.saveWorkspaceSnapshot()
    document.removeEventListener('focusin', context.handleMobileFocus)
    document.body.classList.remove('modal-open')
  })
  return {
    consumeSharedFiles,
    runLibraryMaintenance,
    scheduleLibraryMaintenance,
    initializeLibrary,
  }
}
