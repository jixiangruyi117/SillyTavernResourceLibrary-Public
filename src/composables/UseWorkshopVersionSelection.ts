import type { ComputedRef } from 'vue'
import { watch } from 'vue'
import type { WorkshopVersion } from '../types/FrontendWorkshopLegacyApp'
import { type WorkshopPromptInjectionEnabled } from '../utils/FrontendWorkshop'
import { typographyOptions } from '../utils/FrontendWorkshopLegacyOptions'
import type { useWorkshopSessionState } from './UseWorkshopSessionState'

interface WorkshopVersionSelectionContext extends Pick<
  ReturnType<typeof useWorkshopSessionState>,
  | 'sample'
  | 'source'
  | 'style'
  | 'titleTypography'
  | 'bodyTypography'
  | 'referenceScopes'
  | 'lockedAspects'
  | 'blocks'
  | 'imageUrls'
  | 'importedPalettes'
  | 'activePaletteId'
  | 'titleFontUrl'
  | 'bodyFontUrl'
  | 'customTextStyles'
  | 'layoutReference'
  | 'targetSizePreset'
  | 'targetWidth'
  | 'targetHeight'
  | 'designTokens'
  | 'conditionRules'
  | 'promptCustomizations'
  | 'promptInjectionEnabled'
  | 'reviewSuggestions'
  | 'reviewStatus'
  | 'conversationSelectionMode'
  | 'selectedConversationTurnIds'
  | 'activeMvuTurn'
  | 'inspectedTargets'
  | 'dataMode'
  | 'interactions'
> {
  current: ComputedRef<WorkshopVersion | undefined>
  normalizePromptInjectionEnabled: (
    value?: Partial<WorkshopPromptInjectionEnabled>,
  ) => WorkshopPromptInjectionEnabled
}

export function useWorkshopVersionSelection(context: WorkshopVersionSelectionContext) {
  watch(
    context.current,
    (value) => {
      if (!value) return
      context.sample.value = value.artifact.sampleOutput
      context.source.value = value.source
      context.style.value = value.style
      context.titleTypography.value = typographyOptions.some(
        (option) => option.value === value.titleTypography,
      )
        ? value.titleTypography!
        : 'auto'
      context.bodyTypography.value = typographyOptions.some(
        (option) => option.value === value.bodyTypography,
      )
        ? value.bodyTypography!
        : 'auto'
      context.referenceScopes.value = Array.isArray(value.referenceScopes)
        ? [...value.referenceScopes]
        : context.referenceScopes.value
      context.lockedAspects.value = Array.isArray(value.lockedAspects)
        ? [...value.lockedAspects]
        : context.lockedAspects.value
      context.blocks.value = Array.isArray(value.blocks)
        ? [...value.blocks]
        : Array.isArray(value.artifact.blocks)
          ? [...value.artifact.blocks]
          : []
      context.imageUrls.value = Array.isArray(value.imageUrls)
        ? [...value.imageUrls]
        : Array.isArray(value.artifact.imageUrls)
          ? [...value.artifact.imageUrls]
          : []
      if (
        value.palette?.source === 'imported' &&
        !context.importedPalettes.value.some((palette) => palette.id === value.palette!.id)
      ) {
        context.importedPalettes.value = [...context.importedPalettes.value, value.palette]
      }
      context.activePaletteId.value = value.palette?.id ?? ''
      context.titleFontUrl.value = value.titleFontUrl ?? ''
      context.bodyFontUrl.value = value.bodyFontUrl ?? ''
      context.customTextStyles.value = Array.isArray(value.customTextStyles)
        ? value.customTextStyles.map((textStyle) => ({ ...textStyle }))
        : []
      context.layoutReference.value = value.layoutReference ?? value.artifact.layoutReference
      const versionTargetSize = value.targetSize ?? value.artifact.targetSize
      context.targetSizePreset.value = versionTargetSize ? 'custom' : 'auto'
      if (versionTargetSize) {
        context.targetWidth.value = versionTargetSize.width
        context.targetHeight.value = versionTargetSize.height
      }
      Object.assign(
        context.designTokens,
        value.designTokens ??
          value.artifact.designTokens ?? {
            material: 'auto',
            shadow: 'soft',
            border: 'hairline',
            density: 'balanced',
          },
      )
      context.conditionRules.value = (
        value.conditionRules ??
        value.artifact.conditionRules ??
        []
      ).map((rule) => ({ ...rule }))
      Object.assign(context.promptCustomizations, {
        material: value.promptCustomizations?.material ?? '',
        conditions: value.promptCustomizations?.conditions ?? '',
        blocks: value.promptCustomizations?.blocks ?? '',
      })
      Object.assign(
        context.promptInjectionEnabled,
        context.normalizePromptInjectionEnabled(value.promptInjectionEnabled),
      )
      context.reviewSuggestions.value = (value.reviewSuggestions ?? []).map((suggestion) => ({
        ...suggestion,
      }))
      context.reviewStatus.value = ''
      context.conversationSelectionMode.value = false
      context.selectedConversationTurnIds.value = []
      context.activeMvuTurn.value = 0
      context.inspectedTargets.value = []
      context.dataMode.value = value.artifact.dataMode === 'mvu' ? 'mvu' : 'reply'
      context.interactions.value = Array.isArray(value.artifact.interactions)
        ? value.artifact.interactions
        : []
    },
    { immediate: true },
  )
  return {}
}
