import type { ComputedRef, Ref } from 'vue'
import { nextTick } from 'vue'
import { loadConversation, loadDrafts, loadVersions } from '../services/LegacyWorkshopDraftStorage'
import type {
  TypographyPreset,
  WorkshopDraft,
  WorkshopPalette,
  WorkshopVersion,
} from '../types/FrontendWorkshopLegacyApp'
import {
  type WorkshopPromptInjectionEnabled,
  type WorkshopTargetSize,
} from '../utils/FrontendWorkshop'
import type { useWorkshopSessionState } from './UseWorkshopSessionState'

interface WorkshopDraftRecoveryContext extends Pick<
  ReturnType<typeof useWorkshopSessionState>,
  | 'versions'
  | 'conversation'
  | 'activeStep'
  | 'activeDesignPanel'
  | 'source'
  | 'style'
  | 'sample'
  | 'dataMode'
  | 'interactions'
  | 'refinement'
  | 'referenceGuidance'
  | 'referenceScopes'
  | 'titleTypography'
  | 'bodyTypography'
  | 'lockedAspects'
  | 'blocks'
  | 'imageUrls'
  | 'importedPalettes'
  | 'activePaletteId'
  | 'titleFontUrl'
  | 'bodyFontUrl'
  | 'customTextStyles'
  | 'layoutReference'
  | 'designTokens'
  | 'conditionRules'
  | 'promptCustomizations'
  | 'promptInjectionEnabled'
  | 'reviewSuggestions'
  | 'currentIndex'
  | 'fieldInputMode'
  | 'excludedConversationVersionIds'
  | 'draftName'
  | 'recoveryStatus'
  | 'drafts'
  | 'libraryStatus'
  | 'error'
  | 'targetSizePreset'
  | 'targetWidth'
  | 'targetHeight'
  | 'imageUrlDraft'
  | 'inspectedTargets'
  | 'referenceImages'
> {
  STORAGE_KEY: string
  DRAFT_STORAGE_KEY: string
  CONVERSATION_STORAGE_KEY: string
  selectedTargetSize: ComputedRef<WorkshopTargetSize | undefined>
  recoveryTimer: number | undefined
  RECOVERY_STORAGE_KEY: string
  hasUnsavedDraft: ComputedRef<boolean>
  savedDraftSignature: Ref<string, string>
  projectSignature: ComputedRef<string>
  typographyOptions: {
    value: TypographyPreset
    label: string
    description: string
    stack: string
  }[]
  paletteOptions: ComputedRef<WorkshopPalette[]>
  normalizePromptInjectionEnabled: (
    value?: Partial<WorkshopPromptInjectionEnabled>,
  ) => WorkshopPromptInjectionEnabled
  current: ComputedRef<WorkshopVersion | undefined>
}

export function useWorkshopDraftRecovery(getContext: () => WorkshopDraftRecoveryContext) {
  const RECOVERY_SAVE_DELAY = 500

  function saveVersions(): void {
    const context = getContext()

    localStorage.setItem(context.STORAGE_KEY, JSON.stringify(context.versions.value.slice(-20)))
    localStorage.setItem(
      context.CONVERSATION_STORAGE_KEY,
      JSON.stringify(context.conversation.value.slice(-30)),
    )
  }

  function createDraft(id: string, name: string): WorkshopDraft {
    const context = getContext()

    return {
      id,
      name,
      updatedAt: Date.now(),
      activeStep: context.activeStep.value,
      activeDesignPanel: context.activeDesignPanel.value,
      source: context.source.value,
      style: context.style.value,
      sample: context.sample.value,
      dataMode: context.dataMode.value,
      interactions: [...context.interactions.value],
      refinement: context.refinement.value,
      referenceGuidance: context.referenceGuidance.value,
      referenceScopes: [...context.referenceScopes.value],
      titleTypography: context.titleTypography.value,
      bodyTypography: context.bodyTypography.value,
      lockedAspects: [...context.lockedAspects.value],
      blocks: [...context.blocks.value],
      imageUrls: [...context.imageUrls.value],
      importedPalettes: context.importedPalettes.value.map((palette) => ({
        ...palette,
        colors: [...palette.colors],
      })),
      activePaletteId: context.activePaletteId.value,
      titleFontUrl: context.titleFontUrl.value,
      bodyFontUrl: context.bodyFontUrl.value,
      customTextStyles: context.customTextStyles.value.map((textStyle) => ({ ...textStyle })),
      layoutReference: context.layoutReference.value,
      targetSize: context.selectedTargetSize.value,
      designTokens: { ...context.designTokens },
      conditionRules: context.conditionRules.value.map((rule) => ({ ...rule })),
      promptCustomizations: { ...context.promptCustomizations },
      promptInjectionEnabled: { ...context.promptInjectionEnabled },
      reviewSuggestions: context.reviewSuggestions.value.map((suggestion) => ({ ...suggestion })),
      versions: context.versions.value.slice(-20),
      currentIndex: context.currentIndex.value,
      conversation: context.conversation.value.slice(-30),
      fieldInputMode: context.fieldInputMode.value,
      excludedConversationVersionIds: [...context.excludedConversationVersionIds.value],
    }
  }

  function clearRecoveryDraft(): void {
    const context = getContext()

    if (context.recoveryTimer !== undefined) {
      window.clearTimeout(context.recoveryTimer)
      context.recoveryTimer = undefined
    }
    localStorage.removeItem(context.RECOVERY_STORAGE_KEY)
  }

  function persistRecoveryDraft(): boolean {
    const context = getContext()

    if (!context.hasUnsavedDraft.value) {
      clearRecoveryDraft()
      return true
    }
    const recoveryDraft = createDraft(
      'frontend-workshop-recovery',
      context.draftName.value.trim().slice(0, 40) || '未命名自动恢复',
    )
    try {
      localStorage.setItem(context.RECOVERY_STORAGE_KEY, JSON.stringify(recoveryDraft))
      context.recoveryStatus.value = '未保存修改已自动保留在当前设备'
      return true
    } catch {
      context.recoveryStatus.value = '自动保留失败，请立即保存为命名草稿'
      return false
    }
  }

  function scheduleRecoveryDraft(): void {
    const context = getContext()

    if (context.recoveryTimer !== undefined) window.clearTimeout(context.recoveryTimer)
    context.recoveryTimer = window.setTimeout(() => {
      context.recoveryTimer = undefined
      persistRecoveryDraft()
    }, RECOVERY_SAVE_DELAY)
  }

  function saveDraft(): boolean {
    const context = getContext()

    const name =
      context.draftName.value.trim().slice(0, 40) || `状态栏草稿 ${context.drafts.value.length + 1}`
    const existing = context.drafts.value.find((draft) => draft.name === name)
    const draft = createDraft(existing?.id ?? crypto.randomUUID(), name)
    const next = [draft, ...context.drafts.value.filter((item) => item.id !== draft.id)].slice(0, 8)
    try {
      localStorage.setItem(context.DRAFT_STORAGE_KEY, JSON.stringify(next))
      context.drafts.value = next
      context.draftName.value = name
      context.savedDraftSignature.value = context.projectSignature.value
      clearRecoveryDraft()
      context.recoveryStatus.value = '当前内容已保存为命名草稿'
      context.libraryStatus.value = `草稿「${name}」已保存；参考图因隐私与容量限制需下次重新选择`
      return true
    } catch (cause) {
      context.error.value =
        cause instanceof DOMException && cause.name === 'QuotaExceededError'
          ? '草稿空间已满，请删除旧草稿后再保存'
          : '草稿保存失败'
      context.recoveryStatus.value = '命名草稿保存失败，当前页面不会退出'
      return false
    }
  }

  function applyDraft(draft: WorkshopDraft, markAsSaved: boolean): void {
    const context = getContext()

    context.source.value = draft.source
    context.style.value = draft.style
    const hasRestoredSample = typeof draft.sample === 'string'
    const restoredSample = hasRestoredSample ? draft.sample! : ''
    context.dataMode.value = draft.dataMode === 'mvu' ? 'mvu' : 'reply'
    context.interactions.value = Array.isArray(draft.interactions) ? [...draft.interactions] : []
    context.refinement.value = draft.refinement ?? ''
    context.referenceGuidance.value = draft.referenceGuidance ?? ''
    context.referenceScopes.value = Array.isArray(draft.referenceScopes)
      ? [...draft.referenceScopes]
      : ['color', 'structure']
    context.titleTypography.value = context.typographyOptions.some(
      (option) => option.value === draft.titleTypography,
    )
      ? draft.titleTypography!
      : 'auto'
    context.bodyTypography.value = context.typographyOptions.some(
      (option) => option.value === draft.bodyTypography,
    )
      ? draft.bodyTypography!
      : 'auto'
    context.lockedAspects.value = Array.isArray(draft.lockedAspects)
      ? [...draft.lockedAspects]
      : ['field-order']
    context.blocks.value = Array.isArray(draft.blocks) ? [...draft.blocks] : []
    context.imageUrls.value = Array.isArray(draft.imageUrls) ? [...draft.imageUrls] : []
    context.importedPalettes.value = Array.isArray(draft.importedPalettes)
      ? draft.importedPalettes
          .filter((palette) => palette.source === 'imported' && Array.isArray(palette.colors))
          .slice(0, 4)
          .map((palette) => ({ ...palette, colors: [...palette.colors] }))
      : []
    context.activePaletteId.value = context.paletteOptions.value.some(
      (palette) => palette.id === draft.activePaletteId,
    )
      ? draft.activePaletteId!
      : ''
    context.titleFontUrl.value = draft.titleFontUrl ?? ''
    context.bodyFontUrl.value = draft.bodyFontUrl ?? ''
    context.customTextStyles.value = Array.isArray(draft.customTextStyles)
      ? draft.customTextStyles.slice(0, 6).map((textStyle) => ({ ...textStyle }))
      : []
    context.layoutReference.value = draft.layoutReference
    context.targetSizePreset.value = draft.targetSize ? 'custom' : 'auto'
    if (draft.targetSize) {
      context.targetWidth.value = draft.targetSize.width
      context.targetHeight.value = draft.targetSize.height
    }
    Object.assign(
      context.designTokens,
      draft.designTokens ?? {
        material: 'auto',
        shadow: 'soft',
        border: 'hairline',
        density: 'balanced',
      },
    )
    context.conditionRules.value = Array.isArray(draft.conditionRules)
      ? draft.conditionRules.slice(0, 8).map((rule) => ({ ...rule }))
      : []
    Object.assign(context.promptCustomizations, {
      material: draft.promptCustomizations?.material ?? '',
      conditions: draft.promptCustomizations?.conditions ?? '',
      blocks: draft.promptCustomizations?.blocks ?? '',
    })
    Object.assign(
      context.promptInjectionEnabled,
      context.normalizePromptInjectionEnabled(draft.promptInjectionEnabled),
    )
    context.reviewSuggestions.value = Array.isArray(draft.reviewSuggestions)
      ? draft.reviewSuggestions.slice(0, 8).map((suggestion) => ({ ...suggestion }))
      : []
    context.imageUrlDraft.value = ''
    context.inspectedTargets.value = []
    context.referenceImages.value = []
    context.versions.value = Array.isArray(draft.versions) ? draft.versions.slice(-20) : []
    context.currentIndex.value = Math.min(
      Math.max(0, Number(draft.currentIndex) || 0),
      Math.max(0, context.versions.value.length - 1),
    )
    context.conversation.value = Array.isArray(draft.conversation)
      ? draft.conversation.slice(-30)
      : []
    context.fieldInputMode.value = draft.fieldInputMode === 'visual' ? 'visual' : 'text'
    context.excludedConversationVersionIds.value = Array.isArray(
      draft.excludedConversationVersionIds,
    )
      ? draft.excludedConversationVersionIds.filter((id) => typeof id === 'string').slice(-20)
      : []
    context.draftName.value = draft.name
    saveVersions()
    const restoredStep =
      draft.activeStep === 'proof' || draft.activeStep === 'delivery' ? draft.activeStep : 'design'
    context.activeStep.value =
      restoredStep !== 'design' && !context.current.value ? 'design' : restoredStep
    context.activeDesignPanel.value =
      draft.activeDesignPanel === 'appearance' || draft.activeDesignPanel === 'generate'
        ? draft.activeDesignPanel
        : 'content'
    void nextTick(() => {
      if (hasRestoredSample) context.sample.value = restoredSample
      context.savedDraftSignature.value = markAsSaved
        ? context.projectSignature.value
        : '__recovered_unsaved__'
    })
  }

  function loadDraft(draft: WorkshopDraft): void {
    const context = getContext()

    applyDraft(draft, true)
    clearRecoveryDraft()
    context.recoveryStatus.value = `已打开命名草稿「${draft.name}」`
    context.libraryStatus.value = `草稿「${draft.name}」已恢复；参考图需重新选择`
  }

  function restoreRecoveryDraft(): void {
    const context = getContext()

    try {
      const stored = JSON.parse(
        localStorage.getItem(context.RECOVERY_STORAGE_KEY) ?? 'null',
      ) as WorkshopDraft | null
      if (!stored || typeof stored.source !== 'string' || typeof stored.style !== 'string') return
      applyDraft(stored, false)
      context.recoveryStatus.value = '已恢复上次未完成的内容；参考图需重新选择'
      context.libraryStatus.value = context.recoveryStatus.value
    } catch {
      localStorage.removeItem(context.RECOVERY_STORAGE_KEY)
    }
  }

  function deleteDraft(draftId: string): void {
    const context = getContext()

    context.drafts.value = context.drafts.value.filter((draft) => draft.id !== draftId)
    localStorage.setItem(context.DRAFT_STORAGE_KEY, JSON.stringify(context.drafts.value))
  }
  return {
    loadVersions,
    loadDrafts,
    loadConversation,
    saveVersions,
    createDraft,
    clearRecoveryDraft,
    persistRecoveryDraft,
    scheduleRecoveryDraft,
    saveDraft,
    applyDraft,
    loadDraft,
    restoreRecoveryDraft,
    deleteDraft,
  }
}
