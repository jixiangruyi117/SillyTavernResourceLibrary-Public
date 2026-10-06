import type { FrontendWorkshopSourceDocument } from '../types/FrontendWorkshopSourceDocument'
import {
  applyFrontendWorkshopSourcePatch,
  type FrontendWorkshopSourcePatch,
  type FrontendWorkshopSourcePatchChange,
} from '../utils/FrontendWorkshopSourcePatch'
import {
  countFrontendWorkshopSourceHistoryTextUnits,
  createFrontendWorkshopSourceHistoryPatch,
} from '../utils/FrontendWorkshopSourceHistory'
import {
  FrontendWorkshopSourceDocumentService,
  FrontendWorkshopSourceRevisionConflictError,
  type FrontendWorkshopSourceRevisionSaveOptions,
} from './FrontendWorkshopSourceDocumentService'
import {
  FrontendWorkshopSourcePatchService,
  type FrontendWorkshopAppliedSourcePatch,
} from './FrontendWorkshopSourcePatchService'

export const FRONTEND_WORKSHOP_SOURCE_HISTORY_MAX_ENTRIES = 50
export const FRONTEND_WORKSHOP_SOURCE_HISTORY_MAX_TEXT_UNITS = 1_000_000

export interface FrontendWorkshopSourceHistoryEntry {
  id: string
  label: string
  changes: readonly FrontendWorkshopSourcePatchChange[]
  textUnits: number
}

export interface FrontendWorkshopSourceHistoryStatus {
  projectId: string
  expectedRevision?: number
  entryCount: number
  cursor: number
  canUndo: boolean
  canRedo: boolean
  textUnits: number
}

export interface FrontendWorkshopSourceHistoryApplyOptions {
  label?: string
  save?: FrontendWorkshopSourceRevisionSaveOptions
}

export interface FrontendWorkshopSourceHistoryServiceOptions {
  maxEntries?: number
  maxTextUnits?: number
  createEntryId?: () => string
}

interface SourceHistoryState {
  expectedRevision: number
  entries: FrontendWorkshopSourceHistoryEntry[]
  cursor: number
  textUnits: number
}

let sourceHistoryEntrySequence = 0

function defaultHistoryEntryId(): string {
  sourceHistoryEntrySequence += 1
  return `source-history-${Date.now()}-${sourceHistoryEntrySequence}`
}

function positiveInteger(value: number | undefined, fallback: number, name: string): number {
  const resolved = value ?? fallback
  if (!Number.isInteger(resolved) || resolved < 1) {
    throw new Error(`${name} 必须是正整数`)
  }
  return resolved
}

function normalizeLabel(label: string | undefined): string {
  const normalized = typeof label === 'string' ? label.trim() : ''
  return (normalized || '编辑 Source').slice(0, 120)
}

function cloneChanges(
  changes: readonly FrontendWorkshopSourcePatchChange[],
): readonly FrontendWorkshopSourcePatchChange[] {
  return Object.freeze(
    changes.map((change) =>
      Object.freeze({
        beforeRange: Object.freeze({ ...change.beforeRange }),
        beforeText: change.beforeText,
        afterRange: Object.freeze({ ...change.afterRange }),
        afterText: change.afterText,
      }),
    ),
  )
}

function patchTextUnits(patch: FrontendWorkshopSourcePatch): number {
  return patch.edits.reduce((total, edit) => {
    const before = typeof edit.expectedText === 'string' ? edit.expectedText.length : 0
    const after = typeof edit.replacement === 'string' ? edit.replacement.length : 0
    return total + before + after
  }, 0)
}

export class FrontendWorkshopSourceHistoryStaleError extends Error {
  readonly projectId: string
  readonly expectedRevision: number
  readonly actualRevision?: number

  constructor(projectId: string, expectedRevision: number, actualRevision?: number) {
    super(
      `Source History 已失效：${projectId} 期望 revision ${expectedRevision}，实际 ${actualRevision ?? 'missing'}`,
    )
    this.name = 'FrontendWorkshopSourceHistoryStaleError'
    this.projectId = projectId
    this.expectedRevision = expectedRevision
    this.actualRevision = actualRevision
  }
}

export class FrontendWorkshopSourceHistoryBudgetError extends Error {
  readonly textUnits: number
  readonly maximum: number

  constructor(textUnits: number, maximum: number) {
    super(`Source History 单次可逆文本超出预算：${textUnits} > ${maximum}`)
    this.name = 'FrontendWorkshopSourceHistoryBudgetError'
    this.textUnits = textUnits
    this.maximum = maximum
  }
}

/**
 * S5-B1 bounded in-memory Undo/Redo core.
 *
 * History stores only reversible change-sets from successful Patch receipts, never a parallel current
 * Author Source. Undo/Redo always create a new Source revision through the same Patch/CAS path.
 */
export class FrontendWorkshopSourceHistoryService {
  private readonly sourceDocumentService: FrontendWorkshopSourceDocumentService
  private readonly sourcePatchService: FrontendWorkshopSourcePatchService
  private readonly maxEntries: number
  private readonly maxTextUnits: number
  private readonly createEntryId: () => string
  private readonly states = new Map<string, SourceHistoryState>()

  constructor(
    sourceDocumentService: FrontendWorkshopSourceDocumentService,
    sourcePatchService = new FrontendWorkshopSourcePatchService(sourceDocumentService),
    options: FrontendWorkshopSourceHistoryServiceOptions = {},
  ) {
    this.sourceDocumentService = sourceDocumentService
    this.sourcePatchService = sourcePatchService
    this.maxEntries = positiveInteger(
      options.maxEntries,
      FRONTEND_WORKSHOP_SOURCE_HISTORY_MAX_ENTRIES,
      'Source History maxEntries',
    )
    this.maxTextUnits = positiveInteger(
      options.maxTextUnits,
      FRONTEND_WORKSHOP_SOURCE_HISTORY_MAX_TEXT_UNITS,
      'Source History maxTextUnits',
    )
    this.createEntryId = options.createEntryId ?? defaultHistoryEntryId
  }

  status(projectId: string): FrontendWorkshopSourceHistoryStatus {
    const state = this.states.get(projectId)
    if (!state) {
      return {
        projectId,
        entryCount: 0,
        cursor: 0,
        canUndo: false,
        canRedo: false,
        textUnits: 0,
      }
    }
    return {
      projectId,
      expectedRevision: state.expectedRevision,
      entryCount: state.entries.length,
      cursor: state.cursor,
      canUndo: state.cursor > 0,
      canRedo: state.cursor < state.entries.length,
      textUnits: state.textUnits,
    }
  }

  clearProject(projectId: string): void {
    this.states.delete(projectId)
  }

  clearAll(): void {
    this.states.clear()
  }

  async applyAndRecord(
    patch: FrontendWorkshopSourcePatch,
    options: FrontendWorkshopSourceHistoryApplyOptions = {},
  ): Promise<FrontendWorkshopAppliedSourcePatch> {
    const reversibleTextUnits = patchTextUnits(patch)
    if (reversibleTextUnits > this.maxTextUnits) {
      throw new FrontendWorkshopSourceHistoryBudgetError(reversibleTextUnits, this.maxTextUnits)
    }
    const entryId = this.createEntryId()
    const entryLabel = normalizeLabel(options.label)
    const previousState = this.states.get(patch.projectId)
    const historyWasStale =
      previousState !== undefined && previousState.expectedRevision !== patch.sourceRevision
    const applied = await this.sourcePatchService.applyWithReceiptAtRevision(patch, options.save)
    const entry: FrontendWorkshopSourceHistoryEntry = Object.freeze({
      id: entryId,
      label: entryLabel,
      changes: cloneChanges(applied.receipt.changes),
      textUnits: countFrontendWorkshopSourceHistoryTextUnits(applied.receipt.changes),
    })

    const state: SourceHistoryState =
      historyWasStale || !previousState
        ? {
            expectedRevision: patch.sourceRevision,
            entries: [],
            cursor: 0,
            textUnits: 0,
          }
        : previousState

    if (state.cursor < state.entries.length) {
      const removed = state.entries.splice(state.cursor)
      state.textUnits -= removed.reduce((total, item) => total + item.textUnits, 0)
    }

    state.entries.push(entry)
    state.cursor += 1
    state.textUnits += entry.textUnits
    state.expectedRevision = applied.document.revision
    this.pruneState(state)
    this.states.set(patch.projectId, state)
    return applied
  }

  async undo(
    projectId: string,
    save: FrontendWorkshopSourceRevisionSaveOptions = {},
  ): Promise<FrontendWorkshopSourceDocument | undefined> {
    const state = this.states.get(projectId)
    if (!state || state.cursor < 1) return undefined
    const current = await this.requireCurrentHistorySource(projectId, state)
    const entry = state.entries[state.cursor - 1]!
    const patch = createFrontendWorkshopSourceHistoryPatch(current, entry.changes, 'undo')
    this.assertHistoryPatchCurrent(projectId, current, patch)
    try {
      const document = await this.sourcePatchService.applyAtRevision(patch, save)
      state.cursor -= 1
      state.expectedRevision = document.revision
      return document
    } catch (error) {
      this.handleHistoryMutationFailure(projectId, state, error)
      throw error
    }
  }

  async redo(
    projectId: string,
    save: FrontendWorkshopSourceRevisionSaveOptions = {},
  ): Promise<FrontendWorkshopSourceDocument | undefined> {
    const state = this.states.get(projectId)
    if (!state || state.cursor >= state.entries.length) return undefined
    const current = await this.requireCurrentHistorySource(projectId, state)
    const entry = state.entries[state.cursor]!
    const patch = createFrontendWorkshopSourceHistoryPatch(current, entry.changes, 'redo')
    this.assertHistoryPatchCurrent(projectId, current, patch)
    try {
      const document = await this.sourcePatchService.applyAtRevision(patch, save)
      state.cursor += 1
      state.expectedRevision = document.revision
      return document
    } catch (error) {
      this.handleHistoryMutationFailure(projectId, state, error)
      throw error
    }
  }

  private async requireCurrentHistorySource(
    projectId: string,
    state: SourceHistoryState,
  ): Promise<FrontendWorkshopSourceDocument> {
    const current = await this.sourceDocumentService.get(projectId)
    if (!current || current.revision !== state.expectedRevision) {
      this.states.delete(projectId)
      throw new FrontendWorkshopSourceHistoryStaleError(
        projectId,
        state.expectedRevision,
        current?.revision,
      )
    }
    return current
  }

  private assertHistoryPatchCurrent(
    projectId: string,
    current: FrontendWorkshopSourceDocument,
    patch: FrontendWorkshopSourcePatch,
  ): void {
    try {
      applyFrontendWorkshopSourcePatch(current, patch)
    } catch (error) {
      this.states.delete(projectId)
      throw error
    }
  }

  private handleHistoryMutationFailure(
    projectId: string,
    state: SourceHistoryState,
    error: unknown,
  ): void {
    if (error instanceof FrontendWorkshopSourceRevisionConflictError) {
      this.states.delete(projectId)
      throw new FrontendWorkshopSourceHistoryStaleError(
        projectId,
        state.expectedRevision,
        error.actualRevision,
      )
    }
  }

  private pruneState(state: SourceHistoryState): void {
    while (state.entries.length > this.maxEntries || state.textUnits > this.maxTextUnits) {
      const removed = state.entries.shift()
      if (!removed) break
      state.textUnits -= removed.textUnits
      state.cursor = Math.max(0, state.cursor - 1)
    }
  }
}
