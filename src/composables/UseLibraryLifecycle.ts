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
import type { SharedFileBatch } from '../utils/ShareTargetIntake'
import type { SearchScope } from './UseSearchIndex'

interface LibraryLifecycleContext {
  showNotice: (message: string, duration?: number, preserveRecycleUndo?: boolean) => void
  receiveSharedFileBatch: (batch: SharedFileBatch) => void
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
}

export function useLibraryLifecycle(context: LibraryLifecycleContext) {
  let searchIndexTimer: number | undefined
  let cloudBackupTimer: number | undefined
  let libraryMaintenanceTimer: number | undefined
  let consumingSharedFiles = false
  let disposed = false
  let resumeMaintenance: (() => void) | undefined
  let maintenanceRun: Promise<void> | undefined
  let stopGreetingUpdates: (() => void) | undefined

  async function consumeSharedFiles(): Promise<void> {
    if (consumingSharedFiles) return
    consumingSharedFiles = true
    const arrivedViaShare = new URLSearchParams(window.location.search).has('share-target')
    try {
      clearShareTargetQuery()
      const batch = await takeSharedFileBatch()
      if (batch.files.length) {
        context.receiveSharedFileBatch(batch)
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

  async function maintenanceCheckpoint(wait = false): Promise<void> {
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0))
    while (
      !disposed &&
      !context.vaultStatus.value.locked &&
      (context.isOverlayOpen.value || context.isFeatureHubOpen.value)
    ) {
      // Do not retain a metadata snapshot across a foreground edit/import.
      // Restart the idempotent pass after the user finishes instead.
      if (!wait) throw new DOMException('Maintenance paused', 'AbortError')
      await new Promise<void>((resolve) => {
        resumeMaintenance = resolve
      })
    }
    if (disposed || context.vaultStatus.value.locked)
      throw new DOMException('Maintenance stopped', 'AbortError')
  }

  watch(
    [context.isOverlayOpen, context.isFeatureHubOpen, () => context.vaultStatus.value.locked],
    () => {
      resumeMaintenance?.()
      resumeMaintenance = undefined
    },
  )

  async function maintainLibrary(): Promise<void> {
    await maintenanceCheckpoint(true)
    const thumbnailRepairCount = await resourceService.repairThumbnailAssets()
    await maintenanceCheckpoint()
    const upgradedCount = await resourceService.upgradeLegacyJsonResources(maintenanceCheckpoint)
    const backfilledCount = await resourceService.backfillCardFingerprints(maintenanceCheckpoint)
    if (thumbnailRepairCount > 0 || upgradedCount > 0 || backfilledCount > 0) {
      await context.loadResources()
    }
  }

  function runLibraryMaintenance(): Promise<void> {
    if (!maintenanceRun)
      maintenanceRun = (async () => {
        while (!disposed && !context.vaultStatus.value.locked) {
          try {
            await maintainLibrary()
            return
          } catch (error) {
            if (!(error instanceof DOMException && error.name === 'AbortError')) throw error
          }
        }
      })().finally(() => {
        maintenanceRun = undefined
      })
    return maintenanceRun
  }

  function scheduleLibraryMaintenance(): void {
    if (libraryMaintenanceTimer !== undefined) window.clearTimeout(libraryMaintenanceTimer)
    libraryMaintenanceTimer = window.setTimeout(() => {
      libraryMaintenanceTimer = undefined
      void runLibraryMaintenance().catch((error) => {
        if (error instanceof DOMException && error.name === 'AbortError') return
        console.warn('存量资源后台维护失败:', error)
      })
    }, 0)
  }

  async function initializeLibrary(): Promise<void> {
    const status = await initializeVaultOnce()
    if (disposed) return
    context.vaultStatus.value = status
    if (context.vaultStatus.value.locked) {
      browserStorageService.clearSearchHistory()
      context.searchQuery.value = ''
      context.searchHistory.value = []
      context.isVaultPanelOpen.value = true
      return
    }
    await context.loadLibrary()
    if (disposed) return
    markStartupReady()
    // The usable library must not wait for backup history, recycle-bin contents or quota probes.
    void (async () => {
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0))
      if (disposed || context.vaultStatus.value.locked) return
      const results = await Promise.allSettled([
        context.refreshStorageHealth(),
        context.loadHistorySnapshots(),
        context.loadRecycleBin(),
      ])
      if (!disposed && results.some((result) => result.status === 'rejected'))
        context.showNotice('资源库已打开，部分存储或历史信息暂时读取失败，可在对应面板重试')
    })()
    await context.handleNativeDeepLink()
    await consumeSharedFiles()
    if (disposed) return
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
      document.documentElement.classList.toggle('modal-open', open)
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
    disposed = true
    resumeMaintenance?.()
    stopGreetingUpdates?.()
    if (searchIndexTimer !== undefined) window.clearTimeout(searchIndexTimer)
    if (libraryMaintenanceTimer !== undefined) window.clearTimeout(libraryMaintenanceTimer)
    if (cloudBackupTimer !== undefined) window.clearInterval(cloudBackupTimer)
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
    document.documentElement.classList.remove('modal-open')
  })
  return {
    consumeSharedFiles,
    runLibraryMaintenance,
    scheduleLibraryMaintenance,
    initializeLibrary,
  }
}
