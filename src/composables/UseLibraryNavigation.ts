import type { Ref } from 'vue'
import {
  SRL_BACK_REQUEST_EVENT,
  useBackStack,
  type SrlBackRequestDetail,
} from '../composables/UseBackStack'
import { type NativeDeepLink } from '../core/NativeRuntime'
import type { FilterValue, SortValue } from '../types/AppView'
import { type ResourceReference, type ResourceSummary } from '../types/Resource'
import { revealMobileInputIfOccluded } from '../utils/MobileInputFocus'

interface LibraryNavigationContext {
  isNativeApk: boolean
  WORKSPACE_RECOVERY_KEY: string
  activeFilter: Ref<FilterValue>
  activeCategoryId: Ref<string | null | undefined>
  activeTag: Ref<string, string>
  sortValue: Ref<SortValue>
  currentPage: Ref<number, number>
  selectedSplitResourceId: Ref<string | undefined>
  isFeatureHubOpen: Ref<boolean, boolean>
  isMobileFiltersOpen: Ref<boolean, boolean>
  searchQuery: Ref<string, string>
  isSearchHistoryOpen: Ref<boolean, boolean>
  isSearchFocused: Ref<boolean, boolean>
  isSettingsOpen: Ref<boolean, boolean>
  isLinkImportOpen: Ref<boolean, boolean>
  isImportChooserOpen: Ref<boolean, boolean>
  isAiTaggingOpen: Ref<boolean, boolean>
  isCategoryManagerOpen: Ref<boolean, boolean>
  isExportPanelOpen: Ref<boolean, boolean>
  isRestorePanelOpen: Ref<boolean, boolean>
  isDataProtectionOpen: Ref<boolean, boolean>
  isRecycleBinOpen: Ref<boolean, boolean>
  isDuplicateCleanerOpen: Ref<boolean, boolean>
  isExtractedCleanerOpen: Ref<boolean, boolean>
  isVersionRecognitionOpen: Ref<boolean, boolean>
  isVaultPanelOpen: Ref<boolean, boolean>
  openImportChooser: () => void
  resources: Ref<ResourceSummary[]>
  openResourceDetail: (resource: ResourceReference) => Promise<void>
  openRestorePanel: (entry?: 'import' | 'export') => void
  cancelSearchInput: (event?: Event) => void
  saveCustomUiCss: (value: string) => void
  backStack: ReturnType<typeof useBackStack>
  mobileInputRevealTimer: number | undefined
}

export function useLibraryNavigation(getContext: () => LibraryNavigationContext) {
  function selectFilter(filter: FilterValue): void {
    const context = getContext()

    context.activeFilter.value =
      context.activeFilter.value === filter && filter !== 'all' ? 'all' : filter
  }

  function selectCategory(categoryId: string | null | undefined): void {
    const context = getContext()

    context.activeCategoryId.value =
      context.activeCategoryId.value === categoryId ? undefined : categoryId
    context.isMobileFiltersOpen.value = false
  }

  function selectTag(tag: string): void {
    const context = getContext()

    context.activeTag.value = context.activeTag.value === tag ? '' : tag
    context.isMobileFiltersOpen.value = false
  }

  function clearBrowsingState(): void {
    const context = getContext()

    context.searchQuery.value = ''
    context.activeFilter.value = 'all'
    context.activeCategoryId.value = undefined
    context.activeTag.value = ''
    context.isMobileFiltersOpen.value = false
  }

  function selectMobileDestination(filter: 'all' | 'favorites'): void {
    const context = getContext()

    context.isFeatureHubOpen.value = false
    context.searchQuery.value = ''
    context.activeFilter.value = filter
    context.activeCategoryId.value = undefined
    context.activeTag.value = ''
    context.isMobileFiltersOpen.value = false
    context.isSearchHistoryOpen.value = false
    context.isSearchFocused.value = false
    const active = document.activeElement
    if (active instanceof HTMLInputElement) active.blur()
  }

  function openFeatureHub(): void {
    const context = getContext()

    context.isFeatureHubOpen.value = true
    context.isMobileFiltersOpen.value = false
    context.isSearchHistoryOpen.value = false
    context.isSearchFocused.value = false
    const active = document.activeElement
    if (active instanceof HTMLInputElement) active.blur()
  }

  function handleNativeShortcut(event?: Event): void {
    const context = getContext()

    const detail = event instanceof CustomEvent ? String(event.detail ?? '') : ''
    const action = detail || sessionStorage.getItem('srl.native.shortcut') || ''
    if (!action) return
    context.isSettingsOpen.value = false
    context.isLinkImportOpen.value = false
    context.isImportChooserOpen.value = false
    context.isAiTaggingOpen.value = false
    context.isCategoryManagerOpen.value = false
    context.isExportPanelOpen.value = false
    context.isRestorePanelOpen.value = false
    context.isDataProtectionOpen.value = false
    context.isRecycleBinOpen.value = false
    context.isDuplicateCleanerOpen.value = false
    context.isExtractedCleanerOpen.value = false
    context.isVersionRecognitionOpen.value = false
    context.isMobileFiltersOpen.value = false
    context.isVaultPanelOpen.value = false
    if (action === 'import') {
      sessionStorage.removeItem('srl.native.shortcut')
      context.isFeatureHubOpen.value = false
      context.openImportChooser()
    } else if (action === 'favorites') {
      sessionStorage.removeItem('srl.native.shortcut')
      selectMobileDestination('favorites')
    } else if (action === 'cloud') {
      context.isFeatureHubOpen.value = true
    }
  }

  async function handleNativeDeepLink(event?: Event): Promise<void> {
    const context = getContext()

    let link: NativeDeepLink | undefined
    if (event instanceof CustomEvent && event.detail && typeof event.detail === 'object') {
      link = event.detail as NativeDeepLink
    } else {
      try {
        const stored = sessionStorage.getItem('srl.native.deep-link')
        link = stored ? (JSON.parse(stored) as NativeDeepLink) : undefined
      } catch {
        link = undefined
      }
    }
    if (!link) return
    if (link.kind === 'resource') {
      const resource = context.resources.value.find((item) => item.id === link.resourceId)
      if (!resource) return
      sessionStorage.removeItem('srl.native.deep-link')
      await context.openResourceDetail(resource)
      return
    }
    sessionStorage.removeItem('srl.native.deep-link')
    if (link.kind === 'backup') {
      context.isFeatureHubOpen.value = false
      context.openRestorePanel('export')
    } else if (link.kind === 'favorites') {
      selectMobileDestination('favorites')
    } else if (link.kind === 'import') {
      context.openImportChooser()
    }
  }

  function handleBrowseBack(): void {
    const context = getContext()

    if (context.searchQuery.value) context.cancelSearchInput()
    else if (context.activeTag.value) context.activeTag.value = ''
    else if (context.activeCategoryId.value !== undefined)
      context.activeCategoryId.value = undefined
    else if (context.activeFilter.value !== 'all') context.activeFilter.value = 'all'
  }

  function handleGlobalKeydown(event: KeyboardEvent): void {
    const context = getContext()

    if (event.altKey && event.shiftKey && event.key === '0') {
      context.saveCustomUiCss('')
      event.preventDefault()
      return
    }
    if (event.key !== 'Escape') return

    const result = context.backStack.back()
    if (result !== 'none') event.preventDefault()
  }

  function handleBackRequest(event: Event): void {
    const context = getContext()

    if (!(event instanceof CustomEvent)) return
    const detail = event.detail as SrlBackRequestDetail | undefined
    if (!detail || detail.handled) return
    const result = context.backStack.back()
    if (result === 'none') return
    detail.handled = true
    detail.blocked = result === 'blocked'
    event.stopImmediatePropagation()
  }

  function dispatchBackRequest(): SrlBackRequestDetail {
    const detail: SrlBackRequestDetail = { handled: false }
    window.dispatchEvent(new CustomEvent(SRL_BACK_REQUEST_EVENT, { detail }))
    return detail
  }

  function handleBrowserPopState(): void {
    const result = dispatchBackRequest()
    if (result.handled) {
      window.history.pushState({ ...(window.history.state ?? {}), srlBackGuard: true }, '')
    } else if (window.history.length > 1) {
      window.history.back()
    }
  }

  function handleMobileFocus(event: FocusEvent): void {
    const context = getContext()

    if (window.innerWidth > 860) return
    const target = event.target
    if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) return
    if (target.closest('[role="dialog"], [role="alertdialog"]')) return

    if (context.mobileInputRevealTimer !== undefined)
      window.clearTimeout(context.mobileInputRevealTimer)
    context.mobileInputRevealTimer = window.setTimeout(() => {
      context.mobileInputRevealTimer = undefined
      const viewport = window.visualViewport
      if (window.innerWidth > 860 || document.activeElement !== target || !viewport) return
      revealMobileInputIfOccluded(target, viewport)
    }, 320)
  }
  return {
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
    dispatchBackRequest,
    handleBrowserPopState,
    handleMobileFocus,
  }
}
