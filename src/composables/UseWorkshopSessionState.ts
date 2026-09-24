import { reactive, ref } from 'vue'
import { useLegacyWorkshopConversation } from '../composables/UseLegacyWorkshopConversation'
import { mainApiService } from '../core/AppContainer'
import {
  frontendWorkshopLegacyApiPreferenceService,
  type FrontendWorkshopLegacyApiMode,
} from '../services/FrontendWorkshopLegacyApiPreferenceService'
import type { MainApiConfig, MainApiModelOption } from '../services/MainApiService'
import type {
  CustomTextStyle,
  DesignPanel,
  FieldInputMode,
  LockedAspect,
  ReferenceScope,
  TargetSizePreset,
  TypographyPreset,
  WorkshopChatMessage,
  WorkshopDraft,
  WorkshopGenerationFailure,
  WorkshopInspectTarget,
  WorkshopManualRepair,
  WorkshopPalette,
  WorkshopPreviewWidth,
  WorkshopReferenceImage,
  WorkshopReviewSuggestion,
  WorkshopStep,
  WorkshopVersion,
} from '../types/FrontendWorkshopLegacyApp'
import {
  type WorkshopBlock,
  type WorkshopConditionOperator,
  type WorkshopConditionRule,
  type WorkshopDataMode,
  type WorkshopDesignTokens,
  type WorkshopInteraction,
  type WorkshopLayoutReference,
  type WorkshopPromptCustomizations,
  type WorkshopPromptInjectionEnabled,
} from '../utils/FrontendWorkshop'

interface WorkshopSessionStateContext {
  loadDrafts: () => WorkshopDraft[]
  loadConversation: () => WorkshopChatMessage[]
  loadVersions: () => WorkshopVersion[]
  saveVersions: () => void
}

export function useWorkshopSessionState(context: WorkshopSessionStateContext) {
  const initialApiPreference = frontendWorkshopLegacyApiPreferenceService.getPreference({
    mode: 'main',
    savedProfileId: mainApiService.getActiveProfile().id,
    custom: mainApiService.getConfig(),
    credentialPersistence: 'local',
  })

  const apiMode = ref<FrontendWorkshopLegacyApiMode>(initialApiPreference.mode)

  const savedProfileId = ref(initialApiPreference.savedProfileId)

  const customApi = reactive<MainApiConfig>(initialApiPreference.custom)

  const customApiCredentialPersistence = ref<'local' | 'session'>(
    initialApiPreference.credentialPersistence === 'session' ? 'session' : 'local',
  )

  const apiProfiles = ref(mainApiService.getProfiles())

  const apiStatus = ref('')

  const testingApi = ref(false)

  const loadingModels = ref(false)

  const customModelOptions = ref<MainApiModelOption[]>([])

  const source = ref('姓名：林言\n性别：女\n状态：正在探索\n地点：城南')

  const style = ref('温柔的东方幻想风，墨绿与米白，手机端紧凑，像精致的随身档案')

  const dataMode = ref<WorkshopDataMode>('reply')

  const interactions = ref<WorkshopInteraction[]>([])

  const refinement = ref('')

  const sample = ref('')

  const busy = ref(false)

  const error = ref('')

  const generationNotice = ref('')

  const generationFailure = ref<WorkshopGenerationFailure>()

  const manualRepair = ref<WorkshopManualRepair>()

  const manualRepairOpen = ref(false)

  const manualRepairGuideOpen = ref(false)

  const compare = ref(false)

  const copied = ref('')

  const savingBundle = ref(false)

  const libraryStatus = ref('')

  const activeStep = ref<WorkshopStep>('design')

  const conversationOpen = ref(false)

  const activeDesignPanel = ref<DesignPanel>('content')

  const draftName = ref('')

  const drafts = ref<WorkshopDraft[]>(context.loadDrafts())

  const recoveryStatus = ref('')

  const conversation = ref<WorkshopChatMessage[]>(context.loadConversation())

  const fieldInputMode = ref<FieldInputMode>('text')

  const excludedConversationVersionIds = ref<string[]>([])

  const referenceGuidance = ref('')

  const referenceScopes = ref<ReferenceScope[]>(['color', 'structure'])

  const titleTypography = ref<TypographyPreset>('auto')

  const bodyTypography = ref<TypographyPreset>('auto')

  const lockedAspects = ref<LockedAspect[]>(['field-order'])

  const blocks = ref<WorkshopBlock[]>([])

  const imageUrls = ref<string[]>([])

  const imageUrlDraft = ref('')

  const importedPalettes = ref<WorkshopPalette[]>([])

  const activePaletteId = ref('')

  const paletteStatus = ref('')

  const titleFontUrl = ref('')

  const bodyFontUrl = ref('')

  const customTextStyles = ref<CustomTextStyle[]>([])

  const customTextStyleName = ref('')

  const layoutReference = ref<WorkshopLayoutReference>()

  const targetSizePreset = ref<TargetSizePreset>('auto')

  const targetWidth = ref(390)

  const targetHeight = ref(260)

  const designTokens = reactive<WorkshopDesignTokens>({
    material: 'auto',
    shadow: 'soft',
    border: 'hairline',
    density: 'balanced',
  })

  const promptCustomizations = reactive<WorkshopPromptCustomizations>({
    material: '',
    conditions: '',
    blocks: '',
  })

  const promptInjectionEnabled = reactive<WorkshopPromptInjectionEnabled>({
    material: true,
    conditions: true,
    blocks: true,
  })

  const conditionRules = ref<WorkshopConditionRule[]>([])

  const conditionFieldPath = ref('')

  const conditionOperator = ref<WorkshopConditionOperator>('gt')

  const conditionValue = ref('80')

  const conditionColor = ref('#7a2f25')

  const conditionBackground = ref('#f8ded7')

  const activeMvuTurn = ref(0)

  const layoutStudioOpen = ref(false)

  const referenceImages = ref<WorkshopReferenceImage[]>([])

  const previewMode = ref<'effect' | 'source'>('effect')

  const previewShell = ref<'canvas' | 'message'>('message')

  const previewAvatarMode = ref<'visible' | 'hidden'>('visible')

  const previewWidth = ref<WorkshopPreviewWidth>('phone390')

  const previewFullscreen = ref(false)

  const inspectionMode = ref(false)

  const inspectedTargets = ref<WorkshopInspectTarget[]>([])

  const versions = ref<WorkshopVersion[]>(context.loadVersions())

  const currentIndex = ref(Math.max(0, versions.value.length - 1))

  const versionManageMode = ref(false)

  const selectedVersionIds = ref<string[]>([])

  const {
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
  } = useLegacyWorkshopConversation({
    conversation,
    excludedConversationVersionIds,
    saveVersions: context.saveVersions,
  })

  const reviewingPreview = ref(false)

  const reviewStatus = ref('')

  const reviewSuggestions = ref<WorkshopReviewSuggestion[]>([])

  return {
    initialApiPreference,
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
  }
}
