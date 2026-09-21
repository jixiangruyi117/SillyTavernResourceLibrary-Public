import type { Ref } from 'vue'
import { computed } from 'vue'
import type { PresetStitchDraft } from '../services/BrowserStorageService'
import type { PresetStitcherAppProps } from '../types/PresetStitcherAppView'
import { type ResourceSummary } from '../types/Resource'
import {
  estimateCachedPromptSimilarity,
  PresetPromptAnalysisCache,
} from '../utils/PresetPromptAnalysisCache'
import {
  auditPresetAssembly,
  buildStitchReview,
  listPromptVariables,
  type AssemblyEntry,
  type PresetFavoriteSnapshot,
  type RegexGroupPick,
} from '../utils/PresetStitcher'

interface PresetAssemblyAnalysisContext {
  assembly: Ref<AssemblyEntry[]>
  candidates: Ref<PresetFavoriteSnapshot[]>
  promptAnalysisCache: PresetPromptAnalysisCache
  baseSummary: Ref<ResourceSummary | undefined>
  pendingDraft: Ref<PresetStitchDraft | undefined>
  props: Readonly<PresetStitcherAppProps>
  baseJson: Ref<Record<string, unknown> | undefined>
  regexPicks: Ref<RegexGroupPick[]>
  showVariableReadsOnly: Ref<boolean, boolean>
  showVariableWritesOnly: Ref<boolean, boolean>
  showEnabledOnly: Ref<boolean, boolean>
  showModifiedOnly: Ref<boolean, boolean>
  PAGE_SIZE: number
  targetPage: Ref<number, number>
}

export function usePresetAssemblyAnalysis(context: PresetAssemblyAnalysisContext) {
  const candidateConflicts = computed(() => {
    const entries = [
      ...context.assembly.value.map((entry) => ({
        id: entry.key,
        content: entry.content,
        name: entry.name,
      })),
      ...context.candidates.value.map((entry) => ({
        id: entry.id,
        content: entry.content,
        name: entry.name,
      })),
    ]
    context.promptAnalysisCache.retain(entries.map((entry) => entry.content))
    const analyzedEntries = entries.map((entry) => ({
      entry,
      analysis: context.promptAnalysisCache.get(entry.content),
    }))
    return new Map(
      context.candidates.value.map((candidate) => {
        const candidateAnalysis = context.promptAnalysisCache.get(candidate.content)
        const similar = analyzedEntries
          .filter(({ entry }) => entry.id !== candidate.id)
          .map(({ entry, analysis }) => ({
            entry,
            score: estimateCachedPromptSimilarity(candidateAnalysis, analysis),
          }))
          .filter((item) => item.score >= 0.72)
          .sort((left, right) => right.score - left.score)[0]
        const candidateVariables = candidateAnalysis.setVariables
        const repeatedVariables = candidateVariables.filter((variable) =>
          context.assembly.value.some((entry) =>
            context.promptAnalysisCache.get(entry.content).setVariables.includes(variable),
          ),
        )
        return [candidate.id, { similar, repeatedVariables }]
      }),
    )
  })

  const baseIsStitched = computed(() =>
    Boolean(
      context.baseSummary.value && Array.isArray(context.baseSummary.value.metadata.stitchedFrom),
    ),
  )

  const draftBaseName = computed(() =>
    context.pendingDraft.value
      ? (context.props.resources.find(
          (resource) => resource.id === context.pendingDraft.value?.baseId,
        )?.name ?? '')
      : '',
  )

  const reviewItems = computed(() =>
    context.baseJson.value
      ? buildStitchReview(context.baseJson.value, context.assembly.value, context.regexPicks.value)
      : [],
  )

  const reviewGroups = computed(() => ({
    added: reviewItems.value.filter((item) => item.kind === 'add' || item.kind === 'regex'),
    changed: reviewItems.value.filter((item) => item.kind === 'edit' || item.kind === 'toggle'),
    moved: reviewItems.value.filter((item) => item.kind === 'move'),
  }))

  const modifiedEntryKeys = computed(
    () =>
      new Set(
        reviewItems.value
          .filter((item) => item.kind !== 'regex')
          .map((item) => item.key.slice(item.key.indexOf(':') + 1)),
      ),
  )

  function getEntryChangeKind(entry: AssemblyEntry): 'inserted' | 'modified' | undefined {
    if (entry.origin === 'pick') return 'inserted'
    return modifiedEntryKeys.value.has(entry.key) ? 'modified' : undefined
  }

  function matchesVariableFilters(content: string): boolean {
    const references = listPromptVariables(content)
    return (
      (!context.showVariableReadsOnly.value ||
        references.some((reference) => reference.operation === 'read')) &&
      (!context.showVariableWritesOnly.value ||
        references.some((reference) => reference.operation === 'write'))
    )
  }

  const unreadWrittenVariables = computed(() => {
    const written = new Map<string, { scope: 'chat' | 'global'; name: string; label: string }>()
    const readKeys = new Set<string>()
    for (const entry of context.assembly.value.filter((item) => item.enabled && !item.marker)) {
      for (const reference of listPromptVariables(entry.content)) {
        const key = `${reference.scope}:${reference.name}`
        if (reference.operation === 'read') readKeys.add(key)
        else {
          written.set(key, {
            scope: reference.scope,
            name: reference.name,
            label: `${reference.scope === 'global' ? '全局' : '聊天'}变量：${reference.name}`,
          })
        }
      }
    }
    return [...written].filter(([key]) => !readKeys.has(key)).map(([, variable]) => variable)
  })

  const targetEntryRows = computed(() =>
    context.assembly.value
      .map((entry, index) => ({ entry, index }))
      .filter(
        ({ entry }) =>
          (!context.showEnabledOnly.value || entry.enabled) &&
          (!context.showModifiedOnly.value || modifiedEntryKeys.value.has(entry.key)) &&
          matchesVariableFilters(entry.content),
      ),
  )

  const activeTargetFilterCount = computed(
    () =>
      [
        context.showEnabledOnly.value,
        context.showModifiedOnly.value,
        context.showVariableReadsOnly.value,
        context.showVariableWritesOnly.value,
      ].filter(Boolean).length,
  )

  const targetPageCount = computed(() =>
    Math.max(1, Math.ceil(targetEntryRows.value.length / context.PAGE_SIZE)),
  )

  const targetPageItems = computed(() =>
    targetEntryRows.value.slice(
      (context.targetPage.value - 1) * context.PAGE_SIZE,
      context.targetPage.value * context.PAGE_SIZE,
    ),
  )

  const promptAudit = computed(() => auditPresetAssembly(context.assembly.value))

  const blockingPromptIssues = computed(() =>
    promptAudit.value.issues.filter((issue) => issue.severity === 'error'),
  )

  const reviewAddedLines = computed(() => [
    ...new Set(reviewItems.value.flatMap((item) => item.addedLines ?? [])),
  ])

  const reviewRemovedLines = computed(() => [
    ...new Set(reviewItems.value.flatMap((item) => item.removedLines ?? [])),
  ])

  const reviewAddedMacros = computed(() => [
    ...new Set(reviewItems.value.flatMap((item) => item.addedMacros ?? [])),
  ])

  const reviewRemovedMacros = computed(() => [
    ...new Set(reviewItems.value.flatMap((item) => item.removedMacros ?? [])),
  ])

  const reviewVariableReads = computed(() => [
    ...new Set(reviewItems.value.flatMap((item) => item.addedVariableReads ?? [])),
  ])

  const reviewVariableWrites = computed(() => [
    ...new Set(reviewItems.value.flatMap((item) => item.addedVariableWrites ?? [])),
  ])
  return {
    candidateConflicts,
    baseIsStitched,
    draftBaseName,
    reviewItems,
    reviewGroups,
    modifiedEntryKeys,
    getEntryChangeKind,
    matchesVariableFilters,
    unreadWrittenVariables,
    targetEntryRows,
    activeTargetFilterCount,
    targetPageCount,
    targetPageItems,
    promptAudit,
    blockingPromptIssues,
    reviewAddedLines,
    reviewRemovedLines,
    reviewAddedMacros,
    reviewRemovedMacros,
    reviewVariableReads,
    reviewVariableWrites,
  }
}
