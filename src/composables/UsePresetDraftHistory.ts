import type { ComputedRef, Ref } from 'vue'
import { nextTick } from 'vue'
import { browserStorageService } from '../core/AppContainer'
import type { PresetStitchDraft } from '../services/BrowserStorageService'
import type {
  PresetStitcherAppProps,
  Step,
  WorkbenchSnapshot,
} from '../types/PresetStitcherAppView'
import { type ResourceSummary } from '../types/Resource'
import {
  applyEntryEdit,
  buildBaseAssembly,
  buildFavoriteEntry,
  buildPickEntry,
  defaultStitchName,
  listPresetRegexScripts,
  type AssemblyEntry,
  type PresetFavoriteSnapshot,
  type RegexGroupPick,
} from '../utils/PresetStitcher'

interface PresetDraftHistoryContext {
  assembly: Ref<AssemblyEntry[]>
  regexPicks: Ref<RegexGroupPick[]>
  candidates: Ref<PresetFavoriteSnapshot[]>
  sourceOverrides: Ref<Map<string, { name: string; role: string; content: string }>>
  workbenchHistory: Ref<WorkbenchSnapshot[]>
  workbenchHistoryIndex: Ref<number, number>
  baseSummary: Ref<ResourceSummary | undefined>
  step: Ref<Step>
  insertionIndex: Ref<number, number>
  canUndo: ComputedRef<boolean>
  canRedo: ComputedRef<boolean>
  productName: Ref<string, string>
  mainSide: Ref<'left' | 'right'>
  saveAsVersion: Ref<boolean, boolean>
  versionNote: Ref<string, string>
  hasDraftChanges: ComputedRef<boolean>
  checkpoint: Ref<PresetStitchDraft | undefined>
  notice: Ref<string, string>
  draftTimer: number
  pendingDraft: Ref<PresetStitchDraft | undefined>
  busy: Ref<boolean, boolean>
  props: Readonly<PresetStitcherAppProps>
  loadPresetJson: (resourceId: string) => Promise<Record<string, unknown> | undefined>
  baseJson: Ref<Record<string, unknown> | undefined>
  favorites: Ref<PresetFavoriteSnapshot[]>
  errorMessage: Ref<string, string>
}

export function usePresetDraftHistory(getContext: () => PresetDraftHistoryContext) {
  let restoring = false
  let restoringHistory = false

  function clonePlain<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T
  }

  function captureWorkbenchSnapshot(): WorkbenchSnapshot {
    const context = getContext()

    return {
      assembly: clonePlain(context.assembly.value),
      regexPicks: clonePlain(context.regexPicks.value),
      candidates: clonePlain(context.candidates.value),
      sourceOverrides: clonePlain(Array.from(context.sourceOverrides.value.entries())),
    }
  }

  function resetWorkbenchHistory(): void {
    const context = getContext()

    const snapshot = captureWorkbenchSnapshot()
    context.workbenchHistory.value = [snapshot]
    context.workbenchHistoryIndex.value = 0
  }

  function recordWorkbenchHistory(): void {
    const context = getContext()

    if (
      restoring ||
      restoringHistory ||
      !context.baseSummary.value ||
      context.step.value !== 'workbench'
    )
      return
    const snapshot = captureWorkbenchSnapshot()
    const current = context.workbenchHistory.value[context.workbenchHistoryIndex.value]
    if (current && JSON.stringify(current) === JSON.stringify(snapshot)) return
    context.workbenchHistory.value = [
      ...context.workbenchHistory.value.slice(0, context.workbenchHistoryIndex.value + 1),
      snapshot,
    ].slice(-30)
    context.workbenchHistoryIndex.value = context.workbenchHistory.value.length - 1
  }

  async function applyWorkbenchHistory(index: number): Promise<void> {
    const context = getContext()

    const snapshot = context.workbenchHistory.value[index]
    if (!snapshot) return
    restoringHistory = true
    context.workbenchHistoryIndex.value = index
    context.assembly.value = clonePlain(snapshot.assembly)
    context.regexPicks.value = clonePlain(snapshot.regexPicks)
    context.candidates.value = clonePlain(snapshot.candidates)
    context.sourceOverrides.value = new Map(clonePlain(snapshot.sourceOverrides))
    context.insertionIndex.value = Math.min(
      context.insertionIndex.value,
      context.assembly.value.length,
    )
    await nextTick()
    restoringHistory = false
  }

  function undoWorkbench(): void {
    const context = getContext()

    if (context.canUndo.value) void applyWorkbenchHistory(context.workbenchHistoryIndex.value - 1)
  }

  function redoWorkbench(): void {
    const context = getContext()

    if (context.canRedo.value) void applyWorkbenchHistory(context.workbenchHistoryIndex.value + 1)
  }

  function buildDraftSnapshot(): PresetStitchDraft | undefined {
    const context = getContext()

    if (!context.baseSummary.value) return undefined
    return {
      baseId: context.baseSummary.value.id,
      name: context.productName.value,
      savedAt: Date.now(),
      entries: context.assembly.value.map((entry) => ({
        origin: entry.origin,
        identifier: entry.identifier,
        enabled: entry.enabled,
        sourceResourceId: entry.sourceResourceId,
        sourceName: entry.sourceName,
        favoriteId: entry.favoriteId,
        name: entry.name,
        role: entry.role,
        content: entry.content,
        ...(entry.favoriteId ? { prompt: entry.prompt } : {}),
      })),
      regexPickIds: context.regexPicks.value.map((pick) => pick.sourceResourceId),
      mainSide: context.mainSide.value,
      sourceEdits: Array.from(context.sourceOverrides.value.entries()).map(([key, value]) => {
        const [sourceResourceId, ...identifier] = key.split(':')
        return { sourceResourceId, identifier: identifier.join(':'), ...value }
      }),
      saveAsVersion: context.saveAsVersion.value,
      versionNote: context.versionNote.value,
      candidates: context.candidates.value.map((candidate) => ({ ...candidate })),
    }
  }

  function saveDraftNow(): void {
    const context = getContext()

    if (restoring || !context.baseSummary.value || context.step.value === 'done') return
    if (!context.hasDraftChanges.value) {
      browserStorageService.clearPresetStitchDraft()
      return
    }
    const draft = buildDraftSnapshot()
    if (draft) browserStorageService.setPresetStitchDraft(draft)
  }

  function saveCheckpoint(): void {
    const context = getContext()

    const value = buildDraftSnapshot()
    if (!value) return
    browserStorageService.setPresetStitchCheckpoint(value)
    context.checkpoint.value = value
    context.notice.value = '工作台检查点已保存'
  }

  function restoreCheckpoint(): void {
    const context = getContext()

    if (context.checkpoint.value) void restoreDraft(context.checkpoint.value, '检查点')
  }

  function queueDraftSave(): void {
    const context = getContext()

    if (context.draftTimer) window.clearTimeout(context.draftTimer)
    context.draftTimer = window.setTimeout(saveDraftNow, 250)
  }

  async function restoreDraft(
    draftOverride?: PresetStitchDraft,
    restoredLabel = '草稿',
  ): Promise<void> {
    const context = getContext()

    const draft = draftOverride ?? context.pendingDraft.value
    if (!draft || context.busy.value) return
    const base = context.props.resources.find((resource) => resource.id === draft.baseId)
    if (!base) return
    context.busy.value = true
    restoring = true
    let skipped = 0
    try {
      const parsed = await context.loadPresetJson(base.id)
      if (!parsed) throw new Error('草稿的主预设已无法解析')
      context.baseSummary.value = base
      context.baseJson.value = parsed
      context.productName.value = draft.name || defaultStitchName(base.name)
      context.mainSide.value = draft.mainSide === 'left' ? 'left' : 'right'
      context.saveAsVersion.value = draft.saveAsVersion !== false
      context.versionNote.value = draft.versionNote ?? ''
      context.sourceOverrides.value = new Map(
        (draft.sourceEdits ?? []).map((item) => [
          `${item.sourceResourceId}:${item.identifier}`,
          { name: item.name, role: item.role, content: item.content },
        ]),
      )
      context.candidates.value = (draft.candidates ?? [])
        .filter(
          (candidate) =>
            candidate &&
            typeof candidate.id === 'string' &&
            typeof candidate.name === 'string' &&
            typeof candidate.content === 'string' &&
            candidate.prompt &&
            typeof candidate.prompt === 'object',
        )
        .map((candidate) => ({ ...candidate }))
      const baseEntries = new Map(
        buildBaseAssembly(parsed).map((entry) => [entry.identifier, entry]),
      )
      const rebuilt: AssemblyEntry[] = []
      for (const item of draft.entries) {
        if (item.origin === 'base') {
          const entry = baseEntries.get(item.identifier)
          if (!entry) continue
          entry.enabled = item.enabled
          if (item.name !== undefined && item.role !== undefined && item.content !== undefined) {
            applyEntryEdit(entry, { name: item.name, role: item.role, content: item.content })
          }
          rebuilt.push(entry)
          baseEntries.delete(item.identifier)
          continue
        }
        let entry: AssemblyEntry | undefined
        if (item.favoriteId) {
          const favorite = context.favorites.value.find((value) => value.id === item.favoriteId)
          if (favorite) entry = buildFavoriteEntry(favorite)
        } else if (item.sourceResourceId) {
          const source = context.props.resources.find(
            (resource) => resource.id === item.sourceResourceId,
          )
          const sourceParsed = source ? await context.loadPresetJson(source.id) : undefined
          if (source && sourceParsed) {
            entry = buildPickEntry(source.id, source.name, sourceParsed, item.identifier)
          }
        }
        if (!entry) {
          skipped += 1
          continue
        }
        entry.enabled = item.enabled
        if (item.name !== undefined && item.role !== undefined && item.content !== undefined) {
          applyEntryEdit(entry, { name: item.name, role: item.role, content: item.content })
        }
        rebuilt.push(entry)
      }
      rebuilt.push(...baseEntries.values())
      context.assembly.value = rebuilt
      context.insertionIndex.value = rebuilt.length
      context.regexPicks.value = []
      for (const sourceId of draft.regexPickIds) {
        const source = context.props.resources.find((resource) => resource.id === sourceId)
        const sourceParsed = source ? await context.loadPresetJson(source.id) : undefined
        const scripts = sourceParsed ? listPresetRegexScripts(sourceParsed) : []
        if (source && scripts.length) {
          context.regexPicks.value.push({
            sourceResourceId: source.id,
            sourceName: source.name,
            scripts,
          })
        } else skipped += 1
      }
      if (!draftOverride) context.pendingDraft.value = undefined
      context.step.value = 'workbench'
      context.notice.value = skipped
        ? `${restoredLabel}已恢复；${skipped} 个已删除来源已跳过`
        : `${restoredLabel}已恢复`
      await nextTick()
      resetWorkbenchHistory()
    } catch (error) {
      context.errorMessage.value = error instanceof Error ? error.message : '草稿恢复失败'
    } finally {
      restoring = false
      context.busy.value = false
    }
  }

  function discardDraft(): void {
    const context = getContext()

    context.pendingDraft.value = undefined
    browserStorageService.clearPresetStitchDraft()
  }
  return {
    clonePlain,
    captureWorkbenchSnapshot,
    resetWorkbenchHistory,
    recordWorkbenchHistory,
    applyWorkbenchHistory,
    undoWorkbench,
    redoWorkbench,
    buildDraftSnapshot,
    saveDraftNow,
    saveCheckpoint,
    restoreCheckpoint,
    queueDraftSave,
    restoreDraft,
    discardDraft,
  }
}
