import type { ComputedRef, Ref } from 'vue'
import { type ResourceSummary } from '../types/Resource'
import {
  applyEntryEdit,
  buildFavoriteEntry,
  buildPickEntry,
  type AssemblyEntry,
  type PresetFavoriteSnapshot,
  type PresetSegmentView,
  type RegexGroupPick,
} from '../utils/PresetStitcher'

interface PresetEntryInsertionContext {
  sourceSummary: Ref<ResourceSummary | undefined>
  assembly: Ref<AssemblyEntry[]>
  sourceJson: ComputedRef<Record<string, unknown> | undefined>
  sourceOverrides: Ref<Map<string, { name: string; role: string; content: string }>>
  insertionIndex: Ref<number, number>
  notice: Ref<string, string>
  targetPage: Ref<number, number>
  PAGE_SIZE: number
  regexPicks: Ref<RegexGroupPick[]>
  sourceRegexScripts: ComputedRef<Record<string, unknown>[]>
  expandedSourceKeys: Ref<Set<string>>
  expandedTargetKeys: Ref<Set<string>>
  favorites: Ref<PresetFavoriteSnapshot[]>
  consumeSuppressedSourceAction: () => boolean
}

export function usePresetEntryInsertion(getContext: () => PresetEntryInsertionContext) {
  function sourceKey(segment: Pick<PresetSegmentView, 'identifier'>): string {
    const context = getContext()

    return `${context.sourceSummary.value?.id ?? ''}:${segment.identifier}`
  }

  function findSourceEntry(identifier: string): AssemblyEntry | undefined {
    const context = getContext()

    const source = context.sourceSummary.value
    return source
      ? context.assembly.value.find((entry) => entry.key === `pick:${source.id}:${identifier}`)
      : undefined
  }

  function buildCurrentSourceEntry(identifier: string): AssemblyEntry | undefined {
    const context = getContext()

    const source = context.sourceSummary.value
    const json = context.sourceJson.value
    if (!source || !json) return undefined
    const entry = buildPickEntry(source.id, source.name, json, identifier)
    const override = context.sourceOverrides.value.get(`${source.id}:${identifier}`)
    if (entry && override) applyEntryEdit(entry, override)
    return entry
  }

  function insertEntry(
    entry: AssemblyEntry,
    requestedIndex = getContext().insertionIndex.value,
  ): void {
    const context = getContext()

    const duplicate = context.assembly.value.some(
      (item) =>
        item.origin === 'pick' &&
        ((entry.favoriteId && item.favoriteId === entry.favoriteId) || item.key === entry.key),
    )
    if (duplicate) {
      context.notice.value = `「${entry.name}」已经在主预设中`
      return
    }
    const target = Math.min(Math.max(requestedIndex, 0), context.assembly.value.length)
    context.assembly.value.splice(target, 0, entry)
    context.insertionIndex.value = target + 1
    context.targetPage.value = Math.floor(target / context.PAGE_SIZE) + 1
    context.notice.value = `已插入「${entry.name}」`
  }

  function toggleSegment(identifier: string): void {
    const existing = findSourceEntry(identifier)
    if (existing) {
      removePickByKey(existing.key)
      return
    }
    const entry = buildCurrentSourceEntry(identifier)
    if (entry) insertEntry(entry)
  }

  function insertFavorite(
    favorite: PresetFavoriteSnapshot,
    index = getContext().insertionIndex.value,
  ): void {
    insertEntry(buildFavoriteEntry(favorite), index)
  }

  function selectInsertionIndex(index: number): void {
    const context = getContext()

    context.insertionIndex.value = Math.min(Math.max(index, 0), context.assembly.value.length)
    context.notice.value = `插入位置：第 ${context.insertionIndex.value + 1} 位`
  }

  function toggleRegexGroup(): void {
    const context = getContext()

    const source = context.sourceSummary.value
    if (!source) return
    const index = context.regexPicks.value.findIndex((pick) => pick.sourceResourceId === source.id)
    if (index >= 0) context.regexPicks.value.splice(index, 1)
    else if (context.sourceRegexScripts.value.length) {
      context.regexPicks.value.push({
        sourceResourceId: source.id,
        sourceName: source.name,
        scripts: context.sourceRegexScripts.value,
      })
    }
  }

  function toggleExpanded(scope: 'source' | 'target', key: string): void {
    const context = getContext()

    if (context.consumeSuppressedSourceAction()) return
    const state = scope === 'source' ? context.expandedSourceKeys : context.expandedTargetKeys
    const next = new Set(state.value)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    state.value = next
  }

  function removePickByKey(key: string): void {
    const context = getContext()

    const index = context.assembly.value.findIndex(
      (entry) => entry.key === key && entry.origin === 'pick',
    )
    if (index < 0) return
    const [removed] = context.assembly.value.splice(index, 1)
    context.insertionIndex.value = Math.min(
      context.insertionIndex.value,
      context.assembly.value.length,
    )
    context.notice.value = `已从主预设移除「${removed.name}」`
  }

  function moveEntry(index: number, delta: number): void {
    const context = getContext()

    const target = index + delta
    if (target < 0 || target >= context.assembly.value.length) return
    const [entry] = context.assembly.value.splice(index, 1)
    context.assembly.value.splice(target, 0, entry)
    context.insertionIndex.value = target + 1
    context.targetPage.value = Math.floor(target / context.PAGE_SIZE) + 1
  }

  function commitSourceDrop(
    kind: 'segment' | 'favorite' | 'target',
    id: string,
    index: number,
  ): void {
    const context = getContext()

    if (kind === 'target') {
      const from = context.assembly.value.findIndex((entry) => entry.key === id)
      if (from < 0 || index === from || index === from + 1) return
      const [entry] = context.assembly.value.splice(from, 1)
      const target = Math.max(
        0,
        Math.min(index > from ? index - 1 : index, context.assembly.value.length),
      )
      context.assembly.value.splice(target, 0, entry)
      context.insertionIndex.value = target + 1
      context.targetPage.value = Math.floor(target / context.PAGE_SIZE) + 1
      context.notice.value = `已移动「${entry.name}」`
    } else if (kind === 'segment') {
      const entry = buildCurrentSourceEntry(id)
      if (entry) insertEntry(entry, index)
    } else {
      const favorite = context.favorites.value.find((item) => item.id === id)
      if (favorite) insertFavorite(favorite, index)
    }
  }

  function toggleSegmentFromAction(identifier: string): void {
    const context = getContext()

    if (context.consumeSuppressedSourceAction()) return
    toggleSegment(identifier)
  }

  function insertFavoriteFromAction(favorite: PresetFavoriteSnapshot): void {
    const context = getContext()

    if (context.consumeSuppressedSourceAction()) return
    insertFavorite(favorite)
  }
  return {
    sourceKey,
    findSourceEntry,
    buildCurrentSourceEntry,
    insertEntry,
    toggleSegment,
    insertFavorite,
    selectInsertionIndex,
    toggleRegexGroup,
    toggleExpanded,
    removePickByKey,
    moveEntry,
    commitSourceDrop,
    toggleSegmentFromAction,
    insertFavoriteFromAction,
  }
}
