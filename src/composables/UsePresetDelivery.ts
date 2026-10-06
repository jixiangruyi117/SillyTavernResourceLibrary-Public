import type { ComputedRef, Ref } from 'vue'
import { browserStorageService, resourceService } from '../core/AppContainer'
import type { EditScope, Step } from '../types/PresetStitcherAppView'
import { type ResourceSummary } from '../types/Resource'
import type { PromptAuditIssue, StitchReviewItem } from '../utils/PresetStitcher'
import {
  serializeStitchedPreset,
  stitchPreset,
  type AssemblyEntry,
  type RegexGroupPick,
} from '../utils/PresetStitcher'

interface PresetDeliveryContext {
  productName: Ref<string, string>
  errorMessage: Ref<string, string>
  reviewItems: ComputedRef<StitchReviewItem[]>
  blockingPromptIssues: ComputedRef<PromptAuditIssue[]>
  editor: Ref<
    | {
        scope: EditScope
        key: string
        name: string
        role: string
        content: string
      }
    | undefined
  >
  step: Ref<Step>
  busy: Ref<boolean, boolean>
  baseSummary: Ref<ResourceSummary | undefined>
  baseJson: Ref<Record<string, unknown> | undefined>
  assembly: Ref<AssemblyEntry[]>
  regexPicks: Ref<RegexGroupPick[]>
  baseIsStitched: ComputedRef<boolean>
  saveAsVersion: Ref<boolean, boolean>
  versionNote: Ref<string, string>
  recentIds: Ref<string[]>
  successName: Ref<string, string>
  emit: ((event: 'back') => void) & ((event: 'library-changed') => void)
}

export function usePresetDelivery(getContext: () => PresetDeliveryContext) {
  function openReview(): void {
    const context = getContext()

    if (!context.productName.value.trim()) {
      context.errorMessage.value = '先给自缝版预设起个名字'
      return
    }
    if (!context.reviewItems.value.length) {
      context.errorMessage.value = '当前内容没有变化，不需要生成重复预设'
      return
    }
    if (context.blockingPromptIssues.value.length) {
      context.errorMessage.value = `先修复 ${context.blockingPromptIssues.value.length} 个宏语法问题`
      return
    }
    context.editor.value = undefined
    context.errorMessage.value = ''
    context.step.value = 'review'
  }

  async function generate(): Promise<void> {
    const context = getContext()

    if (context.busy.value || !context.baseSummary.value || !context.baseJson.value) return
    const name = context.productName.value.trim()
    context.busy.value = true
    context.errorMessage.value = ''
    try {
      const { preset, provenance } = stitchPreset(
        context.baseJson.value,
        context.assembly.value,
        context.regexPicks.value,
      )
      if (typeof preset.name === 'string' || preset.name === undefined) preset.name = name
      const fileName = `${name.replace(/[\\/:*?"<>|]/g, '_').slice(0, 120) || 'stitched-preset'}.json`
      const file = new File([serializeStitchedPreset(preset)], fileName, {
        type: 'application/json',
      })
      const sourceIds = Array.from(
        new Set([
          context.baseSummary.value.id,
          ...provenance.map((item) => item.resourceId).filter(Boolean),
        ]),
      )
      await resourceService.importStitchedPreset(file, {
        stitchedFrom: provenance,
        baseResourceId: context.baseSummary.value.id,
        relatedResourceIds: sourceIds,
        asVersionOf:
          context.baseIsStitched.value && context.saveAsVersion.value
            ? context.baseSummary.value.id
            : undefined,
        versionNote: context.versionNote.value.trim().slice(0, 240),
      })
      sourceIds.forEach((id) => browserStorageService.pushStitchRecentId(id))
      context.recentIds.value = browserStorageService.getStitchRecentIds()
      browserStorageService.clearPresetStitchDraft()
      context.successName.value = name
      context.step.value = 'done'
      context.emit('library-changed')
    } catch (error) {
      context.errorMessage.value = error instanceof Error ? error.message : '自缝版预设入库失败'
    } finally {
      context.busy.value = false
    }
  }
  return { openReview, generate }
}
