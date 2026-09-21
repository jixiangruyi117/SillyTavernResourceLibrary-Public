import type { PersonalResourceKind } from '../types/PersonalResource'
import { secretPasswordRequest, resolveSecretPassword } from './UseSecretPasswordPrompt'
import { ref, type ComputedRef, type Ref, type ShallowRef } from 'vue'
import { useBackStack } from '../composables/UseBackStack'
import { useOverlayStack } from '../composables/UseOverlayStack'
import type { ImportVersionCandidate } from '../types/Import'
import { type Resource } from '../types/Resource'
import type { VaultStatus } from '../types/Vault'

interface LibraryOverlayNavigationContext {
  organizingResource: Ref<Resource | undefined>
  isOrganizing: Ref<boolean, boolean>
  isImportChooserOpen: Ref<boolean, boolean>
  isSettingsOpen: Ref<boolean, boolean>
  isDuplicateCleanerOpen: Ref<boolean, boolean>
  isExtractedCleanerOpen: Ref<boolean, boolean>
  isVersionRecognitionOpen: Ref<boolean, boolean>
  isVaultPanelOpen: Ref<boolean, boolean>
  vaultStatus: Ref<VaultStatus>
  isVaultBusy: Ref<boolean, boolean>
  isRestorePanelOpen: Ref<boolean, boolean>
  isRestoring: Ref<boolean, boolean>
  isExportPanelOpen: Ref<boolean, boolean>
  isExporting: Ref<boolean, boolean>
  isCategoryManagerOpen: Ref<boolean, boolean>
  isRecycleBinOpen: Ref<boolean, boolean>
  isRecycleBinBusy: Ref<boolean, boolean>
  isAiTaggingOpen: Ref<boolean, boolean>
  pendingNativeExport: ShallowRef<
    { blob: Blob; fileName: string; contentLabel: string; isImage: boolean } | undefined,
    { blob: Blob; fileName: string; contentLabel: string; isImage: boolean } | undefined
  >
  isNativeExportBusy: Ref<boolean, boolean>
  activeVersionImport: ComputedRef<ImportVersionCandidate | undefined>
  isVersionImportBusy: Ref<boolean, boolean>
  pendingVersionImports: Ref<ImportVersionCandidate[]>
  isBatchMode: Ref<boolean, boolean>
  isBatchBusy: Ref<boolean, boolean>
  toggleBatchMode: () => void
  isMobileFiltersOpen: Ref<boolean, boolean>
  isDataProtectionOpen: Ref<boolean, boolean>
  isLinkImportOpen: Ref<boolean, boolean>
  hasBrowsingState: ComputedRef<boolean>
  handleBrowseBack: () => void
  isFeatureHubOpen: Ref<boolean, boolean>
}

export function useLibraryOverlayNavigation(context: LibraryOverlayNavigationContext) {
  const newPersonalKind = ref<PersonalResourceKind>()
  const personalBackHandler = ref<() => void>()
  const overlayStack = useOverlayStack([
    {
      id: 'organizer',
      isOpen: () => Boolean(context.organizingResource.value),
      canClose: () => !context.isOrganizing.value,
      close: () => {
        if (personalBackHandler.value) personalBackHandler.value()
        else context.organizingResource.value = undefined
      },
    },
    {
      id: 'personal-create',
      isOpen: () => Boolean(newPersonalKind.value),
      canClose: () => !context.isOrganizing.value,
      close: () => {
        if (personalBackHandler.value) personalBackHandler.value()
        else newPersonalKind.value = undefined
      },
    },
    {
      id: 'secret-password',
      isOpen: () => Boolean(secretPasswordRequest.value),
      close: () => resolveSecretPassword(),
    },
    {
      id: 'import-chooser',
      isOpen: () => context.isImportChooserOpen.value,
      close: () => (context.isImportChooserOpen.value = false),
    },
    {
      id: 'settings',
      isOpen: () => context.isSettingsOpen.value,
      close: () => (context.isSettingsOpen.value = false),
    },
    {
      id: 'duplicate-cleaner',
      isOpen: () => context.isDuplicateCleanerOpen.value,
      close: () => (context.isDuplicateCleanerOpen.value = false),
    },
    {
      id: 'extracted-cleaner',
      isOpen: () => context.isExtractedCleanerOpen.value,
      close: () => (context.isExtractedCleanerOpen.value = false),
    },
    {
      id: 'version-recognition',
      isOpen: () => context.isVersionRecognitionOpen.value,
      close: () => (context.isVersionRecognitionOpen.value = false),
    },
    {
      id: 'vault',
      isOpen: () => context.isVaultPanelOpen.value,
      canClose: () => !context.vaultStatus.value.locked && !context.isVaultBusy.value,
      close: () => (context.isVaultPanelOpen.value = false),
    },
    {
      id: 'restore',
      isOpen: () => context.isRestorePanelOpen.value,
      canClose: () => !context.isRestoring.value,
      close: () => (context.isRestorePanelOpen.value = false),
    },
    {
      id: 'export',
      isOpen: () => context.isExportPanelOpen.value,
      canClose: () => !context.isExporting.value,
      close: () => (context.isExportPanelOpen.value = false),
    },
    {
      id: 'category-manager',
      isOpen: () => context.isCategoryManagerOpen.value,
      canClose: () => !context.isOrganizing.value,
      close: () => (context.isCategoryManagerOpen.value = false),
    },
    {
      id: 'recycle-bin',
      isOpen: () => context.isRecycleBinOpen.value,
      canClose: () => !context.isRecycleBinBusy.value,
      close: () => (context.isRecycleBinOpen.value = false),
    },
    {
      id: 'ai-tagging',
      isOpen: () => context.isAiTaggingOpen.value,
      canClose: () => false,
      close: () => undefined,
    },
    {
      id: 'native-export',
      isOpen: () => Boolean(context.pendingNativeExport.value),
      canClose: () => !context.isNativeExportBusy.value,
      close: () => (context.pendingNativeExport.value = undefined),
    },
    {
      id: 'version-import',
      isOpen: () => Boolean(context.activeVersionImport.value),
      canClose: () => !context.isVersionImportBusy.value,
      close: () => {
        context.pendingVersionImports.value.shift()
      },
    },
  ])

  const isOverlayOpen = overlayStack.isOpen

  const backStack = useBackStack([
    {
      id: 'overlay',
      isActive: () => overlayStack.isOpen.value,
      back: () => {
        overlayStack.closeTop()
      },
    },
    {
      id: 'batch',
      isActive: () => context.isBatchMode.value,
      canBack: () => !context.isBatchBusy.value,
      back: () => context.toggleBatchMode(),
    },
    {
      id: 'mobile-filters',
      isActive: () => context.isMobileFiltersOpen.value,
      back: () => (context.isMobileFiltersOpen.value = false),
    },
    {
      id: 'data-protection',
      isActive: () => context.isDataProtectionOpen.value,
      back: () => (context.isDataProtectionOpen.value = false),
    },
    {
      id: 'link-import',
      isActive: () => context.isLinkImportOpen.value,
      back: () => (context.isLinkImportOpen.value = false),
    },
    {
      id: 'browse',
      isActive: () => context.hasBrowsingState.value,
      back: () => context.handleBrowseBack(),
    },
    {
      id: 'feature-hub',
      isActive: () => context.isFeatureHubOpen.value,
      back: () => (context.isFeatureHubOpen.value = false),
    },
  ])
  return {
    overlayStack,
    isOverlayOpen,
    backStack,
    personalNavigation: { kind: newPersonalKind, back: personalBackHandler },
  }
}
