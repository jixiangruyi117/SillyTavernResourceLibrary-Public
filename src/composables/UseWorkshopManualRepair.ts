import { computed } from 'vue'
import type {
  WorkshopGenerationTokenUsage,
  WorkshopPromptSnapshot,
} from '../types/FrontendWorkshopLegacyApp'
import type { WorkshopGenerationOptions } from '../utils/FrontendWorkshop'
import {
  compileWorkshopArtifact,
  extractWorkshopDesign,
  formatWorkshopValidationIssues,
  WorkshopValidationError,
  type FrontendWorkshopArtifact,
} from '../utils/FrontendWorkshop'
import type { useWorkshopSessionState } from './UseWorkshopSessionState'

interface WorkshopManualRepairContext extends Pick<
  ReturnType<typeof useWorkshopSessionState>,
  'manualRepair' | 'manualRepairOpen' | 'manualRepairGuideOpen' | 'source' | 'generationNotice'
> {
  acceptGeneratedArtifact: (
    artifact: FrontendWorkshopArtifact,
    options: {
      isRefinement: boolean
      promptSnapshot: WorkshopPromptSnapshot
      tokenUsage: WorkshopGenerationTokenUsage
      generationOptions: WorkshopGenerationOptions
      repairReason?: string
      manualRepair?: boolean
    },
  ) => void
}

export function useWorkshopManualRepair(getContext: () => WorkshopManualRepairContext) {
  const manualRepairIssues = computed(
    () =>
      getContext()
        .manualRepair.value?.issues.split(/\n|；/)
        .map((issue) => issue.trim())
        .filter(Boolean) ?? [],
  )
  const manualRepairLines = computed(() => {
    const repair = getContext().manualRepair.value
    if (!repair) return []
    const needles = repair.issues.match(/\{\{field_\d+\}\}|[.#][\w-]+|<[^>]+>/g) ?? []
    return repair.response.split('\n').map((text, index) => ({
      index: index + 1,
      text,
      hasError: needles.some((needle) => text.includes(needle)),
    }))
  })

  function templateWithPlaceholders(artifact: FrontendWorkshopArtifact): string {
    if (artifact.htmlTemplate) return artifact.htmlTemplate
    return artifact.fields.reduce(
      (result, _field, index) => result.replaceAll(`$${index + 1}`, `{{field_${index + 1}}}`),
      artifact.regex.replaceString,
    )
  }

  function describeWorkshopGenerationError(cause: unknown): string {
    if (cause instanceof WorkshopValidationError)
      return formatWorkshopValidationIssues(cause.issues)
    return cause instanceof Error ? cause.message : '本地完整校验没有返回具体错误'
  }

  function openManualRepair(): void {
    const context = getContext()

    if (context.manualRepair.value) context.manualRepairOpen.value = true
  }

  function openManualRepairGuide(): void {
    const context = getContext()

    if (context.manualRepair.value) context.manualRepairGuideOpen.value = true
  }

  function applyManualRepair(): void {
    const context = getContext()

    const repair = context.manualRepair.value
    if (!repair) return
    try {
      const artifact = compileWorkshopArtifact(
        context.source.value,
        extractWorkshopDesign(repair.response),
        repair.generationOptions,
      )
      context.acceptGeneratedArtifact(artifact, { ...repair, manualRepair: true })
      context.manualRepair.value = undefined
      context.manualRepairOpen.value = false
      context.manualRepairGuideOpen.value = false
      context.generationNotice.value = '已采用手动修复代码，并重新通过全部本地结构与安全校验。'
    } catch (cause) {
      repair.error = describeWorkshopGenerationError(cause)
    }
  }
  return {
    manualRepairIssues,
    manualRepairLines,
    templateWithPlaceholders,
    describeWorkshopGenerationError,
    openManualRepair,
    openManualRepairGuide,
    applyManualRepair,
  }
}
