import type { FrontendWorkshopSourceDocument } from '../types/FrontendWorkshopSourceDocument'
import { createFrontendWorkshopStaticSourceProvenance } from '../utils/FrontendWorkshopSourceAnalysis'
import type { FrontendWorkshopSourcePatch } from '../utils/FrontendWorkshopSourcePatch'
import {
  FrontendWorkshopSourceDocumentService,
  FrontendWorkshopSourceRevisionConflictError,
} from './FrontendWorkshopSourceDocumentService'
import {
  FRONTEND_WORKSHOP_SOURCE_HISTORY_MAX_TEXT_UNITS,
  FrontendWorkshopSourceHistoryService,
} from './FrontendWorkshopSourceHistoryService'

export const FRONTEND_WORKSHOP_SOURCE_CHECKPOINT_MAX_ENTRIES = 48
export const FRONTEND_WORKSHOP_SOURCE_CHECKPOINT_MAX_TEXT_UNITS = 12_000_000
export const FRONTEND_WORKSHOP_SOURCE_CHECKPOINT_MAX_SOURCE_TEXT_UNITS = 500_000

export interface FrontendWorkshopSourceCheckpoint {
  id: string
  projectId: string
  sourceCreatedAt: number
  sourceRevision: number
  sourceFingerprint: string
  label: string
  createdAt: number
  textUnits: number
}

export interface FrontendWorkshopSourceCheckpointStatus {
  projectId: string
  entryCount: number
  textUnits: number
  latestCheckpointId?: string
}

export interface FrontendWorkshopSourceCheckpointCreateOptions {
  label?: string
  now?: number
  expectedRevision?: number
  expectedSourceCreatedAt?: number
}

export interface FrontendWorkshopSourceCheckpointRestoreOptions {
  expectedRevision?: number
  expectedSourceCreatedAt?: number
}

export interface FrontendWorkshopSourceCheckpointRestoreResult {
  document: FrontendWorkshopSourceDocument
  checkpoint: FrontendWorkshopSourceCheckpoint
  changed: boolean
}

export interface FrontendWorkshopSourceCheckpointServiceOptions {
  maxEntries?: number
  maxTextUnits?: number
  maxSourceTextUnits?: number
  maxRestoreHistoryTextUnits?: number
  createCheckpointId?: () => string
}

export interface StoredFrontendWorkshopSourceCheckpoint extends FrontendWorkshopSourceCheckpoint {
  authorSource: string
}

interface SourceCheckpointState {
  sourceCreatedAt: number
  entries: StoredFrontendWorkshopSourceCheckpoint[]
  textUnits: number
  nextLabelSequence: number
}

let sourceCheckpointSequence = 0

function defaultCheckpointId(): string {
  sourceCheckpointSequence += 1
  return `source-checkpoint-${Date.now()}-${sourceCheckpointSequence}`
}

function positiveInteger(value: number | undefined, fallback: number, name: string): number {
  const resolved = value ?? fallback
  if (!Number.isInteger(resolved) || resolved < 1) {
    throw new Error(`${name} 必须是正整数`)
  }
  return resolved
}

function normalizeLabel(label: string | undefined, fallback: string): string {
  const normalized = typeof label === 'string' ? label.trim() : ''
  return (normalized || fallback).slice(0, 120)
}

function fingerprintAuthorSource(authorSource: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < authorSource.length; index += 1) {
    hash ^= authorSource.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return `utf16-${authorSource.length}-${(hash >>> 0).toString(16).padStart(8, '0')}`
}

function checkpointMetadata(
  checkpoint: StoredFrontendWorkshopSourceCheckpoint,
): FrontendWorkshopSourceCheckpoint {
  const { authorSource: _authorSource, ...metadata } = checkpoint
  return Object.freeze({ ...metadata })
}

function requireProjectId(projectId: string): void {
  if (!projectId) throw new Error('Source Checkpoint 缺少 projectId')
}

function assertExpectedSource(
  source: FrontendWorkshopSourceDocument,
  expectedRevision: number | undefined,
  expectedSourceCreatedAt: number | undefined,
  checkpointId: string,
): void {
  if (expectedRevision !== undefined && source.revision !== expectedRevision) {
    throw new FrontendWorkshopSourceRevisionConflictError(
      source.projectId,
      expectedRevision,
      source.revision,
    )
  }
  if (expectedSourceCreatedAt !== undefined && source.createdAt !== expectedSourceCreatedAt) {
    throw new FrontendWorkshopSourceCheckpointStaleError(
      source.projectId,
      checkpointId,
      expectedSourceCreatedAt,
      source.createdAt,
    )
  }
}

export class FrontendWorkshopSourceCheckpointBudgetError extends Error {
  readonly textUnits: number
  readonly maximum: number

  constructor(message: string, textUnits: number, maximum: number) {
    super(`${message}：${textUnits} > ${maximum}`)
    this.name = 'FrontendWorkshopSourceCheckpointBudgetError'
    this.textUnits = textUnits
    this.maximum = maximum
  }
}

export class FrontendWorkshopSourceCheckpointNotFoundError extends Error {
  readonly projectId: string
  readonly checkpointId: string

  constructor(projectId: string, checkpointId: string) {
    super(`Source Checkpoint 不存在：${projectId}/${checkpointId}`)
    this.name = 'FrontendWorkshopSourceCheckpointNotFoundError'
    this.projectId = projectId
    this.checkpointId = checkpointId
  }
}

export class FrontendWorkshopSourceCheckpointStaleError extends Error {
  readonly projectId: string
  readonly checkpointId: string
  readonly expectedSourceCreatedAt: number
  readonly actualSourceCreatedAt?: number

  constructor(
    projectId: string,
    checkpointId: string,
    expectedSourceCreatedAt: number,
    actualSourceCreatedAt?: number,
  ) {
    super(
      `Source Checkpoint 已失效：${projectId}/${checkpointId} 属于 Source ${expectedSourceCreatedAt}，当前为 ${actualSourceCreatedAt ?? 'missing'}`,
    )
    this.name = 'FrontendWorkshopSourceCheckpointStaleError'
    this.projectId = projectId
    this.checkpointId = checkpointId
    this.expectedSourceCreatedAt = expectedSourceCreatedAt
    this.actualSourceCreatedAt = actualSourceCreatedAt
  }
}

/**
 * S5-B2B bounded session-local checkpoint owner.
 *
 * Checkpoints are immutable, bounded restoration anchors for one Source-document lineage. They are
 * may be serialized by the AI recovery journal, but are never read as current Source truth. Restore always reads the
 * authoritative current Source, replaces it through one exact whole-source Patch, and records that
 * Patch in the existing History service so the restore itself remains revision-monotonic and
 * undoable.
 */
export class FrontendWorkshopSourceCheckpointService {
  private readonly sourceDocumentService: FrontendWorkshopSourceDocumentService
  private readonly sourceHistoryService: FrontendWorkshopSourceHistoryService
  private readonly maxEntries: number
  private readonly maxTextUnits: number
  private readonly maxSourceTextUnits: number
  private readonly maxRestoreHistoryTextUnits: number
  private readonly createCheckpointId: () => string
  private readonly states = new Map<string, SourceCheckpointState>()

  constructor(
    sourceDocumentService: FrontendWorkshopSourceDocumentService,
    sourceHistoryService: FrontendWorkshopSourceHistoryService,
    options: FrontendWorkshopSourceCheckpointServiceOptions = {},
  ) {
    this.sourceDocumentService = sourceDocumentService
    this.sourceHistoryService = sourceHistoryService
    this.maxEntries = positiveInteger(
      options.maxEntries,
      FRONTEND_WORKSHOP_SOURCE_CHECKPOINT_MAX_ENTRIES,
      'Source Checkpoint maxEntries',
    )
    this.maxTextUnits = positiveInteger(
      options.maxTextUnits,
      FRONTEND_WORKSHOP_SOURCE_CHECKPOINT_MAX_TEXT_UNITS,
      'Source Checkpoint maxTextUnits',
    )
    this.maxSourceTextUnits = positiveInteger(
      options.maxSourceTextUnits,
      FRONTEND_WORKSHOP_SOURCE_CHECKPOINT_MAX_SOURCE_TEXT_UNITS,
      'Source Checkpoint maxSourceTextUnits',
    )
    this.maxRestoreHistoryTextUnits = positiveInteger(
      options.maxRestoreHistoryTextUnits,
      FRONTEND_WORKSHOP_SOURCE_HISTORY_MAX_TEXT_UNITS,
      'Source Checkpoint maxRestoreHistoryTextUnits',
    )
    this.createCheckpointId = options.createCheckpointId ?? defaultCheckpointId
  }

  status(projectId: string): FrontendWorkshopSourceCheckpointStatus {
    requireProjectId(projectId)
    const state = this.states.get(projectId)
    if (!state) return { projectId, entryCount: 0, textUnits: 0 }
    return {
      projectId,
      entryCount: state.entries.length,
      textUnits: state.textUnits,
      latestCheckpointId: state.entries.at(-1)?.id,
    }
  }

  exportAnchors(
    projectId: string,
    ids: readonly string[],
  ): StoredFrontendWorkshopSourceCheckpoint[] {
    return (this.states.get(projectId)?.entries ?? [])
      .filter((entry) => ids.includes(entry.id))
      .map((entry) => ({ ...entry }))
  }

  async importAnchors(
    projectId: string,
    entries: readonly StoredFrontendWorkshopSourceCheckpoint[],
  ): Promise<void> {
    const current = await this.sourceDocumentService.get(projectId)
    if (!current) throw new Error('恢复记录对应的作品已不存在')
    const combined = new Map(
      (this.states.get(projectId)?.entries ?? []).map((entry) => [entry.id, entry]),
    )
    for (const entry of entries) {
      if (
        entry.projectId !== projectId ||
        entry.sourceCreatedAt !== current.createdAt ||
        typeof entry.authorSource !== 'string' ||
        entry.authorSource.length > this.maxSourceTextUnits ||
        entry.textUnits !== entry.authorSource.length ||
        entry.sourceFingerprint !== fingerprintAuthorSource(entry.authorSource) ||
        !Number.isInteger(entry.sourceRevision) ||
        entry.sourceRevision < 0
      )
        throw new Error('AI 恢复基线已失效或损坏，未更改作品')
      const existing = combined.get(entry.id)
      if (existing && JSON.stringify(existing) !== JSON.stringify(entry))
        throw new Error('AI 恢复基线编号冲突')
      combined.set(entry.id, Object.freeze({ ...entry }))
    }
    const restored = [...combined.values()]
    const textUnits = restored.reduce((sum, entry) => sum + entry.textUnits, 0)
    if (restored.length > this.maxEntries || textUnits > this.maxTextUnits)
      throw new Error('AI 恢复基线超过容量')
    this.states.set(projectId, {
      sourceCreatedAt: current.createdAt,
      entries: restored,
      textUnits,
      nextLabelSequence: restored.length + 1,
    })
  }

  list(projectId: string): readonly FrontendWorkshopSourceCheckpoint[] {
    requireProjectId(projectId)
    return Object.freeze(
      (this.states.get(projectId)?.entries ?? []).map((checkpoint) =>
        checkpointMetadata(checkpoint),
      ),
    )
  }

  /**
   * Read one immutable restoration anchor for derived preview or proposal validation.
   * This never changes the current Source and does not turn a checkpoint into Source truth.
   */
  read(projectId: string, checkpointId: string): FrontendWorkshopSourceDocument {
    requireProjectId(projectId)
    const checkpoint = this.states
      .get(projectId)
      ?.entries.find((candidate) => candidate.id === checkpointId)
    if (!checkpoint) {
      throw new FrontendWorkshopSourceCheckpointNotFoundError(projectId, checkpointId)
    }
    return Object.freeze({
      version: 1,
      projectId: checkpoint.projectId,
      hostProfile: 'tavern-helper-message',
      authorSource: checkpoint.authorSource,
      origin: 'ai',
      revision: checkpoint.sourceRevision,
      createdAt: checkpoint.sourceCreatedAt,
      updatedAt: checkpoint.createdAt,
    })
  }

  reconcileProject(projectId: string, sourceCreatedAt: number | undefined): void {
    requireProjectId(projectId)
    const state = this.states.get(projectId)
    if (!state) return
    if (sourceCreatedAt === undefined || state.sourceCreatedAt !== sourceCreatedAt) {
      this.states.delete(projectId)
    }
  }

  clearProject(projectId: string): void {
    requireProjectId(projectId)
    this.states.delete(projectId)
  }

  clearAll(): void {
    this.states.clear()
  }

  remove(projectId: string, checkpointId: string): boolean {
    requireProjectId(projectId)
    const state = this.states.get(projectId)
    if (!state) return false
    const index = state.entries.findIndex((checkpoint) => checkpoint.id === checkpointId)
    if (index < 0) return false
    const [removed] = state.entries.splice(index, 1)
    if (removed) state.textUnits -= removed.textUnits
    if (state.entries.length === 0) this.states.delete(projectId)
    return true
  }

  async create(
    projectId: string,
    options: FrontendWorkshopSourceCheckpointCreateOptions = {},
  ): Promise<FrontendWorkshopSourceCheckpoint> {
    requireProjectId(projectId)
    const source = await this.sourceDocumentService.get(projectId)
    if (!source) throw new Error(`Source Checkpoint 无法创建：${projectId} 没有 Source Document`)
    assertExpectedSource(source, options.expectedRevision, options.expectedSourceCreatedAt, '(new)')
    const textUnits = source.authorSource.length
    if (textUnits > this.maxSourceTextUnits) {
      throw new FrontendWorkshopSourceCheckpointBudgetError(
        '单个 Source Checkpoint 超出文本预算',
        textUnits,
        this.maxSourceTextUnits,
      )
    }
    if (textUnits > this.maxTextUnits) {
      throw new FrontendWorkshopSourceCheckpointBudgetError(
        'Source Checkpoint 超出总文本预算',
        textUnits,
        this.maxTextUnits,
      )
    }

    let state = this.states.get(projectId)
    if (!state || state.sourceCreatedAt !== source.createdAt) {
      state = {
        sourceCreatedAt: source.createdAt,
        entries: [],
        textUnits: 0,
        nextLabelSequence: 1,
      }
    }

    const checkpoint: StoredFrontendWorkshopSourceCheckpoint = Object.freeze({
      id: this.createCheckpointId(),
      projectId,
      sourceCreatedAt: source.createdAt,
      sourceRevision: source.revision,
      sourceFingerprint: fingerprintAuthorSource(source.authorSource),
      label: normalizeLabel(options.label, `检查点 ${state.nextLabelSequence}`),
      createdAt: options.now ?? Date.now(),
      textUnits,
      authorSource: source.authorSource,
    })
    state.nextLabelSequence += 1
    state.entries.push(checkpoint)
    state.textUnits += checkpoint.textUnits
    this.pruneState(state)
    this.states.set(projectId, state)
    return checkpointMetadata(checkpoint)
  }

  async restore(
    projectId: string,
    checkpointId: string,
    options: FrontendWorkshopSourceCheckpointRestoreOptions = {},
  ): Promise<FrontendWorkshopSourceCheckpointRestoreResult> {
    requireProjectId(projectId)
    const state = this.states.get(projectId)
    const checkpoint = state?.entries.find((candidate) => candidate.id === checkpointId)
    if (!checkpoint)
      throw new FrontendWorkshopSourceCheckpointNotFoundError(projectId, checkpointId)

    const current = await this.sourceDocumentService.get(projectId)
    if (!current || current.createdAt !== checkpoint.sourceCreatedAt) {
      this.states.delete(projectId)
      throw new FrontendWorkshopSourceCheckpointStaleError(
        projectId,
        checkpointId,
        checkpoint.sourceCreatedAt,
        current?.createdAt,
      )
    }
    assertExpectedSource(
      current,
      options.expectedRevision,
      options.expectedSourceCreatedAt,
      checkpointId,
    )

    const metadata = checkpointMetadata(checkpoint)
    if (current.authorSource === checkpoint.authorSource) {
      return { document: current, checkpoint: metadata, changed: false }
    }

    const reversibleTextUnits = current.authorSource.length + checkpoint.authorSource.length
    if (reversibleTextUnits > this.maxRestoreHistoryTextUnits) {
      throw new FrontendWorkshopSourceCheckpointBudgetError(
        '检查点恢复超出可撤销历史预算',
        reversibleTextUnits,
        this.maxRestoreHistoryTextUnits,
      )
    }

    const patch: FrontendWorkshopSourcePatch = {
      projectId,
      sourceRevision: current.revision,
      edits: [
        {
          target: {
            confidence: 'exact',
            provenance: createFrontendWorkshopStaticSourceProvenance(current, {
              start: 0,
              end: current.authorSource.length,
            }),
          },
          expectedText: current.authorSource,
          replacement: checkpoint.authorSource,
        },
      ],
    }
    const applied = await this.sourceHistoryService.applyAndRecord(patch, {
      label: `恢复检查点：${checkpoint.label}`,
    })
    return { document: applied.document, checkpoint: metadata, changed: true }
  }

  private pruneState(state: SourceCheckpointState): void {
    while (state.entries.length > this.maxEntries || state.textUnits > this.maxTextUnits) {
      const removed = state.entries.shift()
      if (!removed) break
      state.textUnits -= removed.textUnits
    }
  }
}
