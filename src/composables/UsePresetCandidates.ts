import type { Ref } from 'vue'
import { browserStorageService } from '../core/AppContainer'
import type { PresetStitchTemplate } from '../services/BrowserStorageService'
import {
  type AssemblyEntry,
  type PresetFavoriteSnapshot,
  type PresetSegmentView,
} from '../utils/PresetStitcher'

interface PresetCandidatesContext {
  candidates: Ref<PresetFavoriteSnapshot[]>
  buildCurrentSourceEntry: (identifier: string) => AssemblyEntry | undefined
  notice: Ref<string, string>
  compareCandidateId: Ref<string, string>
  assembly: Ref<AssemblyEntry[]>
  insertFavorite: (favorite: PresetFavoriteSnapshot, index?: number) => void
  insertionIndex: Ref<number, number>
  candidateSheetOpen: Ref<boolean, boolean>
  templateName: Ref<string, string>
  stitchTemplates: Ref<PresetStitchTemplate[]>
}

export function usePresetCandidates(getContext: () => PresetCandidatesContext) {
  function candidateIdentity(
    entry: Pick<PresetFavoriteSnapshot, 'sourceResourceId' | 'identifier' | 'name'>,
  ): string {
    return `${entry.sourceResourceId ?? 'favorite'}:${entry.identifier}:${entry.name}`
  }

  function isCandidate(
    entry: Pick<PresetFavoriteSnapshot, 'sourceResourceId' | 'identifier' | 'name'>,
  ): boolean {
    const context = getContext()

    const identity = candidateIdentity(entry)
    return context.candidates.value.some((candidate) => candidateIdentity(candidate) === identity)
  }

  function snapshotFromEntry(entry: AssemblyEntry): PresetFavoriteSnapshot {
    const now = Date.now()
    return {
      id: crypto.randomUUID(),
      sourceResourceId: entry.sourceResourceId,
      sourceName: entry.sourceName ?? '填充预设',
      identifier: entry.identifier,
      name: entry.name,
      role: entry.role,
      content: entry.content,
      prompt: JSON.parse(JSON.stringify(entry.prompt)) as Record<string, unknown>,
      createdAt: now,
      updatedAt: now,
    }
  }

  function toggleCandidateFromSource(segment: PresetSegmentView): void {
    const context = getContext()

    const entry = context.buildCurrentSourceEntry(segment.identifier)
    if (!entry) return
    const identity = candidateIdentity({
      sourceResourceId: entry.sourceResourceId,
      identifier: entry.identifier,
      name: entry.name,
    })
    const index = context.candidates.value.findIndex(
      (candidate) => candidateIdentity(candidate) === identity,
    )
    if (index >= 0) {
      context.candidates.value.splice(index, 1)
      context.notice.value = `已从本次候选移除「${entry.name}」`
      return
    }
    context.candidates.value.push(snapshotFromEntry(entry))
    context.notice.value = `已加入本次候选「${entry.name}」`
  }

  function toggleCandidateFromFavorite(favorite: PresetFavoriteSnapshot): void {
    const context = getContext()

    const identity = candidateIdentity(favorite)
    const index = context.candidates.value.findIndex(
      (candidate) => candidateIdentity(candidate) === identity,
    )
    if (index >= 0) {
      context.candidates.value.splice(index, 1)
      context.notice.value = `已从本次候选移除「${favorite.name}」`
      return
    }
    const now = Date.now()
    context.candidates.value.push({
      ...favorite,
      id: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
    })
    context.notice.value = `已加入本次候选「${favorite.name}」`
  }

  function removeCandidate(id: string): void {
    const context = getContext()

    context.candidates.value = context.candidates.value.filter((candidate) => candidate.id !== id)
    if (context.compareCandidateId.value === id)
      context.compareCandidateId.value = context.candidates.value[0]?.id ?? ''
  }

  function insertCandidate(candidate: PresetFavoriteSnapshot): void {
    const context = getContext()

    const previousLength = context.assembly.value.length
    context.insertFavorite(candidate)
    if (context.assembly.value.length !== previousLength) removeCandidate(candidate.id)
  }

  function insertAllCandidates(): void {
    const context = getContext()

    let index = context.insertionIndex.value
    let inserted = 0
    for (const candidate of context.candidates.value) {
      const previousLength = context.assembly.value.length
      context.insertFavorite(candidate, index)
      if (context.assembly.value.length > previousLength) {
        inserted += 1
        index += 1
      }
    }
    context.candidates.value = []
    context.candidateSheetOpen.value = false
    context.notice.value = inserted ? `已按候选顺序加入 ${inserted} 条` : '候选条目已在主预设中'
  }

  function saveCandidateTemplate(): void {
    const context = getContext()

    const name = context.templateName.value.trim().slice(0, 80)
    if (!name || !context.candidates.value.length) return
    const now = Date.now()
    context.stitchTemplates.value = browserStorageService.setStitchTemplates([
      {
        id: crypto.randomUUID(),
        name,
        entries: context.candidates.value.map((candidate) => ({ ...candidate })),
        createdAt: now,
        updatedAt: now,
      },
      ...context.stitchTemplates.value,
    ])
    context.templateName.value = ''
    context.notice.value = `已保存候选模板「${name}」`
  }

  function applyCandidateTemplate(template: PresetStitchTemplate): void {
    const context = getContext()

    const added = template.entries
      .filter((entry) => !isCandidate(entry))
      .map((entry) => {
        const now = Date.now()
        return { ...entry, id: crypto.randomUUID(), createdAt: now, updatedAt: now }
      })
    context.candidates.value.push(...added)
    context.notice.value = added.length
      ? `已加入模板「${template.name}」的 ${added.length} 条`
      : '模板条目已都在候选中'
  }

  function removeCandidateTemplate(id: string): void {
    const context = getContext()

    context.stitchTemplates.value = browserStorageService.setStitchTemplates(
      context.stitchTemplates.value.filter((template) => template.id !== id),
    )
  }
  return {
    candidateIdentity,
    isCandidate,
    snapshotFromEntry,
    toggleCandidateFromSource,
    toggleCandidateFromFavorite,
    removeCandidate,
    insertCandidate,
    insertAllCandidates,
    saveCandidateTemplate,
    applyCandidateTemplate,
    removeCandidateTemplate,
  }
}
