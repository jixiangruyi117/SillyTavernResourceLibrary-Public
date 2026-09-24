import type { ComputedRef, Ref } from 'vue'
import { browserStorageService } from '../core/AppContainer'
import { setPerformanceMonitorVisible } from '../core/PerformanceMonitor'
import { manualCheckForUpdate } from '../core/ServiceWorkerUpdate'
import { isExtractedCharacterAsset, type ResourceSummary } from '../types/Resource'

interface LibraryDisplayPreferencesContext {
  showPerformanceMonitor: Ref<boolean, boolean>
  hideCharacterAssets: Ref<boolean, boolean>
  showManuallyBoundResources: Ref<boolean>
  selectedSplitResource: ComputedRef<ResourceSummary | undefined>
  selectedSplitResourceId: Ref<string | undefined>
  blurThumbnails: Ref<boolean, boolean>
  showNotice: (message: string, duration?: number, preserveRecycleUndo?: boolean) => void
  isSplitWide: Ref<boolean, boolean>
  isAiTaggingOpen: Ref<boolean, boolean>
  isSettingsOpen: Ref<boolean, boolean>
  isVersionRecognitionOpen: Ref<boolean, boolean>
  openVaultPanel: () => Promise<void>
}

export function useLibraryDisplayPreferences(getContext: () => LibraryDisplayPreferencesContext) {
  function updatePerformanceMonitorVisibility(value: boolean): void {
    const context = getContext()

    context.showPerformanceMonitor.value = value
    setPerformanceMonitorVisible(value)
  }

  function applyShowManuallyBoundResources(enabled: boolean): void {
    getContext().showManuallyBoundResources.value = enabled
    browserStorageService.setShowManuallyBoundResources(enabled)
  }

  function applyHideCharacterAssets(enabled: boolean): void {
    const context = getContext()

    context.hideCharacterAssets.value = enabled
    browserStorageService.setHideCharacterAssets(enabled)
    if (
      enabled &&
      context.selectedSplitResource.value &&
      isExtractedCharacterAsset(context.selectedSplitResource.value)
    ) {
      context.selectedSplitResourceId.value = undefined
    }
  }

  function applyBlurThumbnails(enabled: boolean): void {
    const context = getContext()

    context.blurThumbnails.value = enabled
    browserStorageService.setBlurThumbnails(enabled)
  }

  async function handleManualUpdateCheck(): Promise<void> {
    const context = getContext()

    const message = await manualCheckForUpdate()
    context.showNotice(message)
  }

  function updateSplitViewport(): void {
    const context = getContext()

    context.isSplitWide.value = window.innerWidth >= 1200
  }

  function openAiTagging(): void {
    const context = getContext()

    context.isAiTaggingOpen.value = true
  }

  function openVersionRecognition(): void {
    const context = getContext()

    context.isSettingsOpen.value = false
    context.isVersionRecognitionOpen.value = true
  }

  async function openVaultSettings(): Promise<void> {
    const context = getContext()

    context.isSettingsOpen.value = false
    await context.openVaultPanel()
  }
  return {
    updatePerformanceMonitorVisibility,
    applyHideCharacterAssets,
    applyShowManuallyBoundResources,
    applyBlurThumbnails,
    handleManualUpdateCheck,
    updateSplitViewport,
    openAiTagging,
    openVersionRecognition,
    openVaultSettings,
  }
}
