import type { EmitFn } from 'vue'
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { confirmAction } from '../composables/UseConfirmDialog'
import { mainApiService } from '../core/AppContainer'
import {
  CONVERSATION_STORAGE_KEY,
  DRAFT_STORAGE_KEY,
  RECOVERY_STORAGE_KEY,
  STORAGE_KEY,
} from '../services/LegacyWorkshopDraftStorage'
import type { FrontendWorkshopAppEvents } from '../types/FrontendWorkshopAppView'
import type {
  LockedAspect,
  ReferenceScope,
  WorkshopVersion,
} from '../types/FrontendWorkshopLegacyApp'
import {
  describeWorkshopMaterialRecipe,
  parseStatusFields,
  type WorkshopDesignTokens,
  type WorkshopInteraction,
  type WorkshopPromptInjectionEnabled,
  type WorkshopTargetSize,
} from '../utils/FrontendWorkshop'
import {
  blockOptions,
  blockSceneOptions,
  CLASSIC_PALETTES,
  conditionOperatorOptions,
  dataModeOptions,
  designPanels,
  designTokenKeys,
  designTokenOptions,
  fieldKindOptions,
  interactionOptions,
  lockedAspectOptions,
  referenceScopeOptions,
  REVIEW_REQUIREMENT_END,
  REVIEW_REQUIREMENT_START,
  reviewCategoryLabels,
  targetSizePresets,
  typographyOptions,
  workshopPresets,
  workshopSteps,
  type DesignTokenKey,
} from '../utils/FrontendWorkshopLegacyOptions'
import { useWorkshopApiPreferences } from './UseWorkshopApiPreferences'
import { useWorkshopDelivery } from './UseWorkshopDelivery'
import { useWorkshopDesignInputs } from './UseWorkshopDesignInputs'
import { useWorkshopDesignSummary } from './UseWorkshopDesignSummary'
import { useWorkshopDraftRecovery } from './UseWorkshopDraftRecovery'
import { useWorkshopGeneration } from './UseWorkshopGeneration'
import { useWorkshopManualRepair } from './UseWorkshopManualRepair'
import { useWorkshopPreviewReview } from './UseWorkshopPreviewReview'
import { useWorkshopPreviewView } from './UseWorkshopPreviewView'
import { useWorkshopPromptPreview } from './UseWorkshopPromptPreview'
import { useWorkshopSessionState } from './UseWorkshopSessionState'
import { useWorkshopTypographyView } from './UseWorkshopTypographyView'
import { useWorkshopVersionSelection } from './UseWorkshopVersionSelection'
export type { FrontendWorkshopAppEvents } from '../types/FrontendWorkshopAppView'

export function useFrontendWorkshopApp(emit: EmitFn<FrontendWorkshopAppEvents>) {
  const {
    manualRepairIssues,
    manualRepairLines,
    templateWithPlaceholders,
    describeWorkshopGenerationError,
    openManualRepair,
    openManualRepairGuide,
    applyManualRepair,
  } = useWorkshopManualRepair(() => ({
    manualRepair,
    manualRepairOpen,
    manualRepairGuideOpen,
    source,
    acceptGeneratedArtifact,
    generationNotice,
  }))

  const { resolveWorkshopApi, saveApiPreference, testWorkshopApi, loadCustomModels } =
    useWorkshopApiPreferences(() => ({
      apiMode,
      apiProfiles,
      savedProfileId,
      customApi,
      customApiCredentialPersistence,
      apiStatus,
      activeApiLabel,
      testingApi,
      loadingModels,
      customModelOptions,
    }))

  const {
    copy,
    downloadWorkshopJson,
    saveBundleToLibrary,
    move,
    toggleVersionManagement,
    toggleVersionSelection,
    selectAllVersions,
    deleteSelectedVersions,
  } = useWorkshopDelivery(() => ({
    copied,
    current,
    blockingSampleIssue,
    worldbookJson,
    regexJson,
    savingBundle,
    libraryStatus,
    emit,
    currentIndex,
    versions,
    versionManageMode,
    selectedVersionIds,
    sample,
    activeStep,
    saveVersions,
  }))

  const { reviewCurrentPreview, applySelectedReviewSuggestions, clearRepeatedReviewRequirements } =
    useWorkshopPreviewReview(() => ({
      current,
      templateWithPlaceholders,
      renderedSource,
      reviewingPreview,
      reviewStatus,
      error,
      saveApiPreference,
      resolveWorkshopApi,
      workshopRequestOptions,
      reviewSuggestions,
      saveVersions,
      selectedReviewSuggestions,
      buildSelectedReviewRequirement,
      selectedReviewRequirementApplied,
      refinement,
      versions,
      drafts,
      DRAFT_STORAGE_KEY,
      RECOVERY_STORAGE_KEY,
    }))

  const { createGenerationRequest, acceptGeneratedArtifact, generate } = useWorkshopGeneration(
    () => ({
      typographyStack,
      titleTypography,
      titleFontUrl,
      bodyTypography,
      bodyFontUrl,
      customTextStyles,
      selectedTitleTypography,
      selectedBodyTypography,
      excludedConversationVersionIds,
      versions,
      current,
      currentIndex,
      source,
      promptInjectionEnabled,
      promptCustomizations,
      dataMode,
      interactions,
      blocks,
      imageUrls,
      activePalette,
      layoutReference,
      selectedTargetSize,
      designTokens,
      conditionRules,
      style,
      refinement,
      lockedAspects,
      lockedAspectOptions,
      inspectedTargets,
      templateWithPlaceholders,
      referenceImages,
      referenceScopes,
      referenceScopeOptions,
      referenceGuidance,
      activeApiLabel,
      sample,
      conversation,
      inspectionMode,
      activeStep,
      generationFailure,
      saveVersions,
      error,
      activeDesignPanel,
      busy,
      generationNotice,
      manualRepair,
      manualRepairGuideOpen,
      saveApiPreference,
      resolveWorkshopApi,
      workshopRequestOptions,
      describeWorkshopGenerationError,
    }),
  )

  const {
    loadVersions,
    loadDrafts,
    loadConversation,
    saveVersions,
    clearRecoveryDraft,
    persistRecoveryDraft,
    scheduleRecoveryDraft,
    saveDraft,
    loadDraft,
    restoreRecoveryDraft,
    deleteDraft,
  } = useWorkshopDraftRecovery(() => ({
    STORAGE_KEY,
    DRAFT_STORAGE_KEY,
    CONVERSATION_STORAGE_KEY,
    versions,
    conversation,
    activeStep,
    activeDesignPanel,
    source,
    style,
    sample,
    dataMode,
    interactions,
    refinement,
    referenceGuidance,
    referenceScopes,
    titleTypography,
    bodyTypography,
    lockedAspects,
    blocks,
    imageUrls,
    importedPalettes,
    activePaletteId,
    titleFontUrl,
    bodyFontUrl,
    customTextStyles,
    layoutReference,
    selectedTargetSize,
    designTokens,
    conditionRules,
    promptCustomizations,
    promptInjectionEnabled,
    reviewSuggestions,
    currentIndex,
    fieldInputMode,
    excludedConversationVersionIds,
    get recoveryTimer() {
      return recoveryTimer
    },
    set recoveryTimer(value: typeof recoveryTimer) {
      recoveryTimer = value
    },
    RECOVERY_STORAGE_KEY,
    hasUnsavedDraft,
    draftName,
    recoveryStatus,
    drafts,
    savedDraftSignature,
    projectSignature,
    libraryStatus,
    error,
    typographyOptions,
    paletteOptions,
    targetSizePreset,
    targetWidth,
    targetHeight,
    normalizePromptInjectionEnabled,
    imageUrlDraft,
    inspectedTargets,
    referenceImages,
    current,
  }))

  const {
    addReferenceImages,
    removeReferenceImage,
    addImageUrl,
    removeImageUrl,
    applyTargetSizePreset,
    applyCustomTargetSize,
    openLayoutStudio,
    applyLayoutReference,
    clearLayoutReference,
    choosePalette,
    removeImportedPalette,
    importPalette,
    addCustomTextStyle,
    removeCustomTextStyle,
    switchFieldInputMode,
    updateVisualField,
    addVisualField,
    removeVisualField,
    moveVisualField,
    applyBlockScene,
    toggleBlock,
    addConditionRule,
    removeConditionRule,
    applyMvuTurn,
    handleInspectTarget,
    clearInspectedTargets,
    applyStressCase,
  } = useWorkshopDesignInputs(() => ({
    error,
    referenceImages,
    imageUrls,
    imageUrlDraft,
    targetSizePreset,
    targetWidth,
    targetHeight,
    layoutReference,
    selectedTargetSize,
    source,
    activeDesignPanel,
    layoutStudioOpen,
    paletteStatus,
    activePaletteId,
    importedPalettes,
    customTextStyleName,
    customTextStyles,
    parsedFields,
    fieldInputMode,
    interactions,
    blocks,
    dataMode,
    conditionFieldPath,
    conditionValue,
    conditionRules,
    conditionOperator,
    conditionColor,
    conditionBackground,
    mvuTurns,
    activeMvuTurn,
    sample,
    inspectedTargets,
    stressCases,
  }))

  const WORKSHOP_GENERATION_TIMEOUT_MS = 600_000

  const workshopRequestOptions = { timeoutMs: WORKSHOP_GENERATION_TIMEOUT_MS }
  const {
    apiMode,
    savedProfileId,
    customApi,
    customApiCredentialPersistence,
    apiProfiles,
    apiStatus,
    testingApi,
    loadingModels,
    customModelOptions,
    source,
    style,
    dataMode,
    interactions,
    refinement,
    sample,
    busy,
    error,
    generationNotice,
    generationFailure,
    manualRepair,
    manualRepairOpen,
    manualRepairGuideOpen,
    compare,
    copied,
    savingBundle,
    libraryStatus,
    activeStep,
    conversationOpen,
    activeDesignPanel,
    draftName,
    drafts,
    recoveryStatus,
    conversation,
    fieldInputMode,
    excludedConversationVersionIds,
    referenceGuidance,
    referenceScopes,
    titleTypography,
    bodyTypography,
    lockedAspects,
    blocks,
    imageUrls,
    imageUrlDraft,
    importedPalettes,
    activePaletteId,
    paletteStatus,
    titleFontUrl,
    bodyFontUrl,
    customTextStyles,
    customTextStyleName,
    layoutReference,
    targetSizePreset,
    targetWidth,
    targetHeight,
    designTokens,
    promptCustomizations,
    promptInjectionEnabled,
    conditionRules,
    conditionFieldPath,
    conditionOperator,
    conditionValue,
    conditionColor,
    conditionBackground,
    activeMvuTurn,
    layoutStudioOpen,
    referenceImages,
    previewMode,
    previewShell,
    previewAvatarMode,
    previewWidth,
    previewFullscreen,
    inspectionMode,
    inspectedTargets,
    versions,
    currentIndex,
    versionManageMode,
    selectedVersionIds,
    conversationSelectionMode,
    selectedConversationTurnIds,
    selectedConversationMessageCount,
    cancelConversationPress,
    conversationTurnId,
    toggleConversationTurn,
    handleConversationClick,
    enterConversationSelection,
    cancelConversationSelection,
    selectAllConversationTurns,
    startConversationPress,
    moveConversationPress,
    deleteSelectedConversationTurns,
    reviewingPreview,
    reviewStatus,
    reviewSuggestions,
  } = useWorkshopSessionState({
    loadDrafts,
    loadConversation,
    loadVersions,
    saveVersions,
  })

  let recoveryTimer: number | undefined

  let skipRecoveryOnUnmount = false

  const current = computed<WorkshopVersion | undefined>(() => versions.value[currentIndex.value])

  function normalizePromptInjectionEnabled(
    value?: Partial<WorkshopPromptInjectionEnabled>,
  ): WorkshopPromptInjectionEnabled {
    return {
      material: value?.material !== false,
      conditions: value?.conditions !== false,
      blocks: value?.blocks !== false,
    }
  }

  const selectedReviewSuggestions = computed(() =>
    reviewSuggestions.value.filter((suggestion) => suggestion.selected && suggestion.detail.trim()),
  )

  function buildSelectedReviewRequirement(): string {
    if (!selectedReviewSuggestions.value.length) return ''
    return `${REVIEW_REQUIREMENT_START}\n请在保持未提及区域不变的前提下，执行以下已选审美建议：\n${selectedReviewSuggestions.value
      .map(
        (suggestion, index) =>
          `${index + 1}. [${reviewCategoryLabels[suggestion.category]}] ${suggestion.title}：${suggestion.detail.trim()}`,
      )
      .join('\n')}\n${REVIEW_REQUIREMENT_END}`
  }

  const selectedReviewRequirementApplied = computed(() => {
    const requirement = buildSelectedReviewRequirement()
    return Boolean(requirement && refinement.value.includes(requirement))
  })

  const reviewApplyLabel = computed(() => {
    const count = selectedReviewSuggestions.value.length
    if (!count) return '先勾选建议'
    return selectedReviewRequirementApplied.value
      ? `已写入 ${count} 条建议`
      : `写入下一轮（已选 ${count} 条）`
  })

  const selectedTargetSize = computed<WorkshopTargetSize | undefined>(() =>
    targetSizePreset.value === 'auto'
      ? undefined
      : {
          width: Math.min(1_200, Math.max(160, Math.round(Number(targetWidth.value) || 390))),
          height: Math.min(1_800, Math.max(100, Math.round(Number(targetHeight.value) || 260))),
        },
  )

  const selectedMaterialRecipe = computed(() =>
    describeWorkshopMaterialRecipe(designTokens.material),
  )

  const paletteOptions = computed(() => [...CLASSIC_PALETTES, ...importedPalettes.value])

  const activePalette = computed(() =>
    paletteOptions.value.find((palette) => palette.id === activePaletteId.value),
  )

  const parsedFields = computed(() => parseStatusFields(source.value))
  const {
    previous,
    previewResult,
    renderedSource,
    sampleIssues,
    blockingSampleIssue,
    stressCases,
    mvuTurns,
    previewWidthNote,
    previewStageStyle,
    regexJson,
    worldbookJson,
    currentDataMode,
  } = useWorkshopPreviewView({
    currentIndex,
    versions,
    current,
    inspectionMode,
    sample,
    previewWidth,
    previewAvatarMode,
    previewShell,
  })
  const {
    selectedTitleTypography,
    selectedBodyTypography,
    typographyStack,
    selectedTitleStack,
    selectedBodyStack,
    currentCompatibility,
  } = useWorkshopTypographyView({
    typographyOptions,
    titleTypography,
    bodyTypography,
    current,
  })

  const projectSignature = computed(() =>
    JSON.stringify({
      source: source.value,
      style: style.value,
      sample: sample.value,
      dataMode: dataMode.value,
      interactions: interactions.value,
      refinement: refinement.value,
      referenceGuidance: referenceGuidance.value,
      referenceScopes: referenceScopes.value,
      titleTypography: titleTypography.value,
      bodyTypography: bodyTypography.value,
      lockedAspects: lockedAspects.value,
      blocks: blocks.value,
      imageUrls: imageUrls.value,
      importedPalettes: importedPalettes.value,
      activePaletteId: activePaletteId.value,
      titleFontUrl: titleFontUrl.value,
      bodyFontUrl: bodyFontUrl.value,
      customTextStyles: customTextStyles.value,
      layoutReference: layoutReference.value,
      targetSizePreset: targetSizePreset.value,
      targetWidth: targetWidth.value,
      targetHeight: targetHeight.value,
      designTokens,
      promptCustomizations,
      promptInjectionEnabled,
      conditionRules: conditionRules.value,
      versions: versions.value,
      currentIndex: currentIndex.value,
      conversation: conversation.value,
      fieldInputMode: fieldInputMode.value,
      excludedConversationVersionIds: excludedConversationVersionIds.value,
    }),
  )

  const savedDraftSignature = ref('')

  const hasUnsavedDraft = computed(() => projectSignature.value !== savedDraftSignature.value)

  const activeApiLabel = computed(() => {
    if (apiMode.value === 'main') return `跟随主 API：${mainApiService.getActiveProfile().name}`
    if (apiMode.value === 'saved')
      return (
        apiProfiles.value.find((profile) => profile.id === savedProfileId.value)?.name ??
        '未找到已保存配置'
      )
    return customApi.model || '本工具专用 API'
  })
  useWorkshopVersionSelection({
    current,
    sample,
    source,
    style,
    titleTypography,
    bodyTypography,
    referenceScopes,
    lockedAspects,
    blocks,
    imageUrls,
    importedPalettes,
    activePaletteId,
    titleFontUrl,
    bodyFontUrl,
    customTextStyles,
    layoutReference,
    targetSizePreset,
    targetWidth,
    targetHeight,
    designTokens,
    conditionRules,
    promptCustomizations,
    promptInjectionEnabled,
    normalizePromptInjectionEnabled,
    reviewSuggestions,
    reviewStatus,
    conversationSelectionMode,
    selectedConversationTurnIds,
    activeMvuTurn,
    inspectedTargets,
    dataMode,
    interactions,
  })

  watch(
    reviewSuggestions,
    (value) => {
      if (!current.value) return
      current.value.reviewSuggestions = value.map((suggestion) => ({ ...suggestion }))
    },
    { deep: true },
  )

  savedDraftSignature.value = projectSignature.value

  restoreRecoveryDraft()

  const stopRecoveryWatch = watch(projectSignature, scheduleRecoveryDraft)

  async function handleBack(): Promise<void> {
    if (!hasUnsavedDraft.value) {
      clearRecoveryDraft()
      emit('back')
      return
    }
    persistRecoveryDraft()
    if (
      await confirmAction({
        title: '退出前保存草稿？',
        message:
          '当前填写内容还没有保存为命名草稿。\n选择保存可下次从草稿列表继续；参考图需要重新选择。',
        confirmLabel: '保存并退出',
        cancelLabel: '其他选择',
      })
    ) {
      if (saveDraft()) emit('back')
      return
    }
    if (
      await confirmAction({
        title: '不保存命名草稿？',
        message:
          '继续编辑会留在当前页面；不保存退出会清除这份自动恢复内容。已经生成的校样版本仍会保留。',
        confirmLabel: '不保存并退出',
        cancelLabel: '继续编辑',
        danger: true,
      })
    ) {
      skipRecoveryOnUnmount = true
      clearRecoveryDraft()
      emit('back')
    }
  }

  function warnBeforeUnload(event: BeforeUnloadEvent): void {
    if (!hasUnsavedDraft.value) return
    persistRecoveryDraft()
    event.preventDefault()
    event.returnValue = ''
  }

  function preserveRecoveryWhenHidden(): void {
    if (document.visibilityState === 'hidden') persistRecoveryDraft()
  }

  window.addEventListener('beforeunload', warnBeforeUnload)

  window.addEventListener('pagehide', persistRecoveryDraft)

  document.addEventListener('visibilitychange', preserveRecoveryWhenHidden)

  onBeforeUnmount(() => {
    stopRecoveryWatch()
    cancelConversationPress()
    window.removeEventListener('beforeunload', warnBeforeUnload)
    window.removeEventListener('pagehide', persistRecoveryDraft)
    document.removeEventListener('visibilitychange', preserveRecoveryWhenHidden)
    if (!skipRecoveryOnUnmount) persistRecoveryDraft()
    else if (recoveryTimer !== undefined) window.clearTimeout(recoveryTimer)
  })

  function openConversation(): void {
    if (!current.value) return
    conversationOpen.value = true
  }
  const {
    initialPromptPreview,
    refinementPromptPreview,
    modulePromptPreviews,
    estimatedGenerationUsage,
  } = useWorkshopPromptPreview({
    createGenerationRequest,
    current,
    templateWithPlaceholders,
    source,
    style,
    blocks,
    resolveWorkshopApi,
  })

  function applyPreset(preset: (typeof workshopPresets)[number]): void {
    source.value = preset.source
    style.value = preset.style
    dataMode.value = preset.dataMode
    interactions.value = [...preset.interactions]
    blocks.value = [...preset.blocks]
  }

  function selectDesignToken<Key extends DesignTokenKey>(
    key: Key,
    value: WorkshopDesignTokens[Key],
    event: MouseEvent,
  ): void {
    const windowX = window.scrollX
    const windowY = window.scrollY
    designTokens[key] = value
    const button = event.currentTarget instanceof HTMLElement ? event.currentTarget : undefined
    void nextTick().then(() => {
      const restore = () => window.scrollTo(windowX, windowY)
      restore()
      requestAnimationFrame(restore)
      if (event.detail > 0) button?.blur()
    })
  }
  const { activeBlockSceneId, mobileComplexity, blockSkeleton } = useWorkshopDesignSummary({
    blocks,
    parsedFields,
    interactions,
    imageUrls,
  })

  function toggleInteraction(value: WorkshopInteraction): void {
    interactions.value = interactions.value.includes(value)
      ? interactions.value.filter((item) => item !== value)
      : [...interactions.value, value]
  }

  function toggleReferenceScope(value: ReferenceScope): void {
    referenceScopes.value = referenceScopes.value.includes(value)
      ? referenceScopes.value.filter((item) => item !== value)
      : [...referenceScopes.value, value]
  }

  function toggleLockedAspect(value: LockedAspect): void {
    lockedAspects.value = lockedAspects.value.includes(value)
      ? lockedAspects.value.filter((item) => item !== value)
      : [...lockedAspects.value, value]
  }
  return {
    activeStep,
    handleBack,
    workshopSteps,
    current,
    designPanels,
    activeDesignPanel,
    drafts,
    draftName,
    saveDraft,
    hasUnsavedDraft,
    recoveryStatus,
    loadDraft,
    deleteDraft,
    workshopPresets,
    applyPreset,
    dataModeOptions,
    dataMode,
    fieldInputMode,
    switchFieldInputMode,
    source,
    parsedFields,
    moveVisualField,
    removeVisualField,
    updateVisualField,
    fieldKindOptions,
    addVisualField,
    interactionOptions,
    interactions,
    toggleInteraction,
    style,
    designTokenKeys,
    designTokenOptions,
    designTokens,
    selectDesignToken,
    selectedMaterialRecipe,
    promptInjectionEnabled,
    modulePromptPreviews,
    promptCustomizations,
    conditionRules,
    conditionFieldPath,
    conditionOperator,
    conditionOperatorOptions,
    conditionValue,
    conditionColor,
    conditionBackground,
    addConditionRule,
    removeConditionRule,
    blocks,
    blockSceneOptions,
    activeBlockSceneId,
    applyBlockScene,
    blockOptions,
    toggleBlock,
    mobileComplexity,
    blockSkeleton,
    imageUrlDraft,
    addImageUrl,
    imageUrls,
    removeImageUrl,
    selectedTargetSize,
    targetSizePresets,
    targetSizePreset,
    applyTargetSizePreset,
    targetWidth,
    applyCustomTargetSize,
    targetHeight,
    openLayoutStudio,
    layoutReference,
    clearLayoutReference,
    importPalette,
    activePaletteId,
    paletteOptions,
    choosePalette,
    removeImportedPalette,
    paletteStatus,
    titleTypography,
    typographyOptions,
    titleFontUrl,
    bodyTypography,
    bodyFontUrl,
    selectedTitleStack,
    selectedBodyStack,
    customTextStyles,
    customTextStyleName,
    addCustomTextStyle,
    removeCustomTextStyle,
    typographyStack,
    addReferenceImages,
    referenceScopeOptions,
    referenceScopes,
    toggleReferenceScope,
    referenceGuidance,
    referenceImages,
    removeReferenceImage,
    lockedAspectOptions,
    lockedAspects,
    toggleLockedAspect,
    activeApiLabel,
    apiMode,
    savedProfileId,
    apiProfiles,
    customApi,
    customModelOptions,
    loadingModels,
    loadCustomModels,
    customApiCredentialPersistence,
    saveApiPreference,
    testingApi,
    testWorkshopApi,
    apiStatus,
    estimatedGenerationUsage,
    initialPromptPreview,
    busy,
    generate,
    generationNotice,
    error,
    generationFailure,
    manualRepair,
    openManualRepair,
    versions,
    currentIndex,
    move,
    versionManageMode,
    toggleVersionManagement,
    selectAllVersions,
    selectedVersionIds,
    toggleVersionSelection,
    deleteSelectedVersions,
    currentCompatibility,
    currentDataMode,
    sample,
    stressCases,
    applyStressCase,
    mvuTurns,
    activeMvuTurn,
    applyMvuTurn,
    sampleIssues,
    previewResult,
    previewMode,
    previewWidth,
    previewShell,
    previewAvatarMode,
    inspectionMode,
    previewFullscreen,
    previewWidthNote,
    inspectedTargets,
    handleInspectTarget,
    clearInspectedTargets,
    previewStageStyle,
    renderedSource,
    reviewingPreview,
    reviewCurrentPreview,
    reviewSuggestions,
    reviewStatus,
    reviewCategoryLabels,
    selectedReviewRequirementApplied,
    selectedReviewSuggestions,
    applySelectedReviewSuggestions,
    reviewApplyLabel,
    clearRepeatedReviewRequirements,
    refinementPromptPreview,
    conversation,
    conversationSelectionMode,
    selectedConversationTurnIds,
    selectedConversationMessageCount,
    selectAllConversationTurns,
    cancelConversationSelection,
    deleteSelectedConversationTurns,
    conversationTurnId,
    startConversationPress,
    moveConversationPress,
    cancelConversationPress,
    handleConversationClick,
    enterConversationSelection,
    toggleConversationTurn,
    refinement,
    openConversation,
    conversationOpen,
    previous,
    compare,
    savingBundle,
    blockingSampleIssue,
    saveBundleToLibrary,
    libraryStatus,
    copy,
    copied,
    worldbookJson,
    downloadWorkshopJson,
    regexJson,
    manualRepairOpen,
    openManualRepairGuide,
    manualRepairIssues,
    manualRepairLines,
    applyManualRepair,
    manualRepairGuideOpen,
    layoutStudioOpen,
    applyLayoutReference,
  }
}
