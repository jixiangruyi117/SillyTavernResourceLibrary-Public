import type { Ref } from 'vue'
import { nextTick } from 'vue'
import { resourceService } from '../core/AppContainer'
import type { SourceMode, Step } from '../types/PresetStitcherAppView'
import { type ResourceSummary } from '../types/Resource'
import {
  buildBaseAssembly,
  defaultStitchName,
  parsePresetText,
  type AssemblyEntry,
  type RegexGroupPick,
} from '../utils/PresetStitcher'

interface PresetSelectionContext {
  presetJsonCache: Map<string, Record<string, unknown>>
  busy: Ref<boolean, boolean>
  errorMessage: Ref<string, string>
  baseSummary: Ref<ResourceSummary | undefined>
  baseJson: Ref<Record<string, unknown> | undefined>
  assembly: Ref<AssemblyEntry[]>
  insertionIndex: Ref<number, number>
  regexPicks: Ref<RegexGroupPick[]>
  sourceOverrides: Ref<Map<string, { name: string; role: string; content: string }>>
  productName: Ref<string, string>
  saveAsVersion: Ref<boolean, boolean>
  sourceSummary: Ref<ResourceSummary | undefined>
  sourcePickerOpen: Ref<boolean, boolean>
  presetSearch: Ref<string, string>
  presetPage: Ref<number, number>
  step: Ref<Step>
  resetWorkbenchHistory: () => void
  sourceMode: Ref<SourceMode>
  segmentSearch: Ref<string, string>
  roleFilter: Ref<string, string>
  roleFiltersOpen: Ref<boolean, boolean>
  sourcePage: Ref<number, number>
  favoritePage: Ref<number, number>
}

export function usePresetSelection(getContext: () => PresetSelectionContext) {
  async function loadPresetJson(resourceId: string): Promise<Record<string, unknown> | undefined> {
    const context = getContext()

    const cached = context.presetJsonCache.get(resourceId)
    if (cached) return cached
    const resource = await resourceService.get(resourceId)
    if (!resource) return undefined
    const parsed = parsePresetText(await resource.originalBlob.text())
    if (parsed) context.presetJsonCache.set(resourceId, parsed)
    return parsed
  }

  async function chooseBase(resource: ResourceSummary): Promise<void> {
    const context = getContext()

    if (context.busy.value) return
    context.busy.value = true
    context.errorMessage.value = ''
    try {
      const parsed = await loadPresetJson(resource.id)
      if (!parsed) {
        context.errorMessage.value = `「${resource.name}」不是可解析的预设 JSON`
        return
      }
      context.baseSummary.value = resource
      context.baseJson.value = parsed
      context.assembly.value = buildBaseAssembly(parsed)
      context.insertionIndex.value = context.assembly.value.length
      context.regexPicks.value = []
      context.sourceOverrides.value = new Map()
      context.productName.value = defaultStitchName(resource.name)
      context.saveAsVersion.value = true
      context.sourceSummary.value = undefined
      context.sourcePickerOpen.value = true
      context.presetSearch.value = ''
      context.presetPage.value = 1
      context.step.value = 'workbench'
      await nextTick()
      context.resetWorkbenchHistory()
    } finally {
      context.busy.value = false
    }
  }

  async function chooseSource(resource: ResourceSummary): Promise<void> {
    const context = getContext()

    if (context.busy.value) return
    context.busy.value = true
    context.errorMessage.value = ''
    try {
      const parsed = await loadPresetJson(resource.id)
      if (!parsed) {
        context.errorMessage.value = `「${resource.name}」不是可解析的预设 JSON`
        return
      }
      context.sourceSummary.value = resource
      context.sourceMode.value = 'preset'
      context.segmentSearch.value = ''
      context.roleFilter.value = ''
      context.roleFiltersOpen.value = false
      context.sourcePage.value = 1
      context.sourcePickerOpen.value = false
    } finally {
      context.busy.value = false
    }
  }

  function chooseFavoriteSource(): void {
    const context = getContext()

    context.sourceMode.value = 'favorites'
    context.sourceSummary.value = undefined
    context.sourcePickerOpen.value = false
    context.favoritePage.value = 1
  }
  return { loadPresetJson, chooseBase, chooseSource, chooseFavoriteSource }
}
