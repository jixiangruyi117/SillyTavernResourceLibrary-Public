import type { FrontendWorkshopSourceDocument } from '../types/FrontendWorkshopSourceDocument'
import type {
  FrontendWorkshopSourceAiContextBundle,
  FrontendWorkshopSourceAiConversationTurn,
  FrontendWorkshopSourceAiReferenceImage,
} from '../utils/FrontendWorkshopSourceAiContext'
import { validateFrontendWorkshopSourceAiReferenceImages } from '../utils/FrontendWorkshopSourceAiContext'
import type { FrontendWorkshopSourceAiProposal } from '../utils/FrontendWorkshopSourceAiProposal'
import type { FrontendWorkshopSourceAiHostReferenceBlockedReason } from './FrontendWorkshopSourceAiHostReferenceService'
import type { FrontendWorkshopAppliedSourcePatch } from './FrontendWorkshopSourcePatchService'
import type { FrontendWorkshopSourceHistoryApplyOptions } from './FrontendWorkshopSourceHistoryService'
import type {
  FrontendWorkshopSourceAiReceipt,
  FrontendWorkshopSourceAiLookup,
} from '../types/FrontendWorkshopSourceAiReceipt'
import type { StoredFrontendWorkshopSourceCheckpoint } from './FrontendWorkshopSourceCheckpointService'
import type { FrontendWorkshopSourceAiRecovery } from './FrontendWorkshopSourceAiRecovery'
import { getFrontendWorkshopSourceAiRepairReceipt } from '../utils/FrontendWorkshopSourceAiReplyRepair'

export type FrontendWorkshopSourceAiGenerationStatus =
  'pending' | 'ready' | 'needs-host-reference' | 'applied' | 'failed'

export interface FrontendWorkshopSourceAiThoughtDiagnostics {
  instruction: string
  target: string
  selection: string
  sourceContext: string
  writeScope: string
  contextTruncated: boolean
  hostReferenceRequired: boolean
  hostReferenceMissing: boolean
  plannedAreas: readonly string[]
  providerReasoning?: string
}

export interface FrontendWorkshopSourceAiGeneration {
  id: string
  turnId: string
  ordinal: number
  status: FrontendWorkshopSourceAiGenerationStatus
  assistantContent: string
  summary: string
  bundle: FrontendWorkshopSourceAiContextBundle | null
  proposal: FrontendWorkshopSourceAiProposal | null
  unresolvedHostReferenceRequests: readonly string[]
  blockedReason?: FrontendWorkshopSourceAiHostReferenceBlockedReason
  resultCheckpointId?: string
  resultRevision?: number
  diagnostics: FrontendWorkshopSourceAiThoughtDiagnostics | null
  createdAt: number
  receipts?: readonly FrontendWorkshopSourceAiReceipt[]
  lookups?: readonly FrontendWorkshopSourceAiLookup[]
  recoveryBlocked?: boolean
  repairedFromGenerationId?: string
}

export interface FrontendWorkshopSourceAiUserTurn {
  id: string
  content: string
  referenceImages: readonly FrontendWorkshopSourceAiReferenceImage[]
  parentGenerationId?: string
  baseCheckpointId: string
  generationIds: readonly string[]
  createdAt: number
}

export interface FrontendWorkshopSourceAiSessionSnapshot {
  projectId: string
  turns: readonly FrontendWorkshopSourceAiUserTurn[]
  generations: readonly FrontendWorkshopSourceAiGeneration[]
  activeGenerationId: string | null
  materializedGenerationId: string | null
  pending: boolean
  applying: boolean
  error: string | null
}

export interface FrontendWorkshopSourceAiSessionRequestOptions {
  kind?: 'new' | 'regenerate' | 'edit' | 'repair'
  generationId?: string
  turnId?: string
  referenceImages?: readonly FrontendWorkshopSourceAiReferenceImage[]
}

export interface FrontendWorkshopSourceAiSessionRequestHandle {
  requestId: string
  turnId: string
  generationId: string
  baseCheckpointId: string
  conversation: readonly FrontendWorkshopSourceAiConversationTurn[]
  referenceImages: readonly FrontendWorkshopSourceAiReferenceImage[]
  signal: AbortSignal
}

export interface FrontendWorkshopSourceAiGenerationPreview {
  before: FrontendWorkshopSourceDocument
  after: FrontendWorkshopSourceDocument
}

export type FrontendWorkshopSourceAiSessionListener = (
  snapshot: FrontendWorkshopSourceAiSessionSnapshot,
) => void

export interface FrontendWorkshopSourceAiProposalApplication {
  projectValidatedCandidate(
    base: FrontendWorkshopSourceDocument,
    bundle: FrontendWorkshopSourceAiContextBundle,
    proposal: FrontendWorkshopSourceAiProposal,
  ): FrontendWorkshopSourceDocument
  applyValidatedProposalFromBase(
    base: FrontendWorkshopSourceDocument,
    expectedCurrent: FrontendWorkshopSourceDocument,
    bundle: FrontendWorkshopSourceAiContextBundle,
    proposal: FrontendWorkshopSourceAiProposal,
    options?: FrontendWorkshopSourceHistoryApplyOptions,
  ): Promise<FrontendWorkshopAppliedSourcePatch | null>
}

export interface FrontendWorkshopSourceAiCheckpointOwner {
  exportAnchors?(
    projectId: string,
    ids: readonly string[],
  ): StoredFrontendWorkshopSourceCheckpoint[]
  importAnchors?(
    projectId: string,
    entries: readonly StoredFrontendWorkshopSourceCheckpoint[],
  ): Promise<void>
  create(
    projectId: string,
    options?: { label?: string; expectedRevision?: number; expectedSourceCreatedAt?: number },
  ): Promise<{ id: string }>
  read(projectId: string, checkpointId: string): FrontendWorkshopSourceDocument
  restore(
    projectId: string,
    checkpointId: string,
  ): Promise<{ document: FrontendWorkshopSourceDocument }>
  remove(projectId: string, checkpointId: string): boolean
}

interface ActiveRequest {
  id: string
  turnId: string
  generationId: string
  controller: AbortController
}

interface MutableTurn extends Omit<FrontendWorkshopSourceAiUserTurn, 'generationIds'> {
  generationIds: string[]
}

type MutableGeneration = FrontendWorkshopSourceAiGeneration

interface MutableSession {
  turns: MutableTurn[]
  generations: Map<string, MutableGeneration>
  activeGenerationId: string | null
  materializedGenerationId: string | null
  materializedSourceRevision: number | null
  request: ActiveRequest | null
  applying: boolean
  error: string | null
  ownedCheckpointIds: Set<string>
}

function requireProjectId(projectId: string): string {
  const value = projectId.trim()
  if (!value) throw new Error('Source AI Session 缺少 projectId')
  return value
}

function requireMessage(content: string, label: string): string {
  if (typeof content !== 'string' || !content.trim()) throw new Error(`${label} 不能为空`)
  return content.trim()
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim() ? error.message : 'AI 操作失败'
}

function emptySession(): MutableSession {
  return {
    turns: [],
    generations: new Map(),
    activeGenerationId: null,
    materializedGenerationId: null,
    materializedSourceRevision: null,
    request: null,
    applying: false,
    error: null,
    ownedCheckpointIds: new Set(),
  }
}

function thoughtDiagnostics(
  instruction: string,
  bundle: FrontendWorkshopSourceAiContextBundle,
  proposal: FrontendWorkshopSourceAiProposal,
  unresolved: readonly string[],
  providerReasoning?: string,
): FrontendWorkshopSourceAiThoughtDiagnostics {
  const normalizedProviderReasoning = providerReasoning?.trim() || undefined
  return {
    instruction,
    target: proposal.summary,
    selection: bundle.diagnostics.selectionUsed
      ? `使用了 ${bundle.diagnostics.selectionCount} 个选中元素`
      : '未使用元素选择',
    sourceContext: `${
      bundle.sourceCoverage.complete
        ? `完整 Source（${bundle.sourceCoverage.coveredTextUnits} 字符）`
        : `局部 Source（覆盖 ${bundle.sourceCoverage.coveredTextUnits}，省略 ${bundle.sourceCoverage.omittedTextUnits}）`
    }${bundle.diagnostics.referenceImageCount ? ` · ${bundle.diagnostics.referenceImageCount} 张参考图` : ''}`,
    writeScope: `${bundle.writeScope.kind} · ${bundle.writeScope.allowedRanges.length} 个范围`,
    contextTruncated:
      !bundle.sourceCoverage.complete ||
      bundle.diagnostics.hostReferenceTruncated ||
      bundle.diagnostics.registryTruncated ||
      bundle.diagnostics.conversationTruncated,
    hostReferenceRequired: proposal.hostReferenceRequests.length > 0 || unresolved.length > 0,
    hostReferenceMissing: unresolved.length > 0,
    plannedAreas: proposal.edits.map((edit) => `${edit.start}–${edit.end}：${edit.reason}`),
    ...(normalizedProviderReasoning ? { providerReasoning: normalizedProviderReasoning } : {}),
  }
}

/**
 * S7R single conversation owner with an optional device-local recovery journal. Turns and generations
 * retain only ids for immutable anchors owned by the existing shared Checkpoint service.
 */
export class FrontendWorkshopSourceAiSessionService {
  private readonly application: FrontendWorkshopSourceAiProposalApplication
  private readonly checkpoints: FrontendWorkshopSourceAiCheckpointOwner
  private readonly sessions = new Map<string, MutableSession>()
  private readonly listeners = new Map<string, Set<FrontendWorkshopSourceAiSessionListener>>()
  private readonly restoring = new Map<string, Promise<void>>()
  private readonly recovery?: FrontendWorkshopSourceAiRecovery

  constructor(
    application: FrontendWorkshopSourceAiProposalApplication,
    checkpoints: FrontendWorkshopSourceAiCheckpointOwner,
    recovery?: FrontendWorkshopSourceAiRecovery,
  ) {
    this.application = application
    this.checkpoints = checkpoints
    this.recovery = recovery
  }

  async restore(projectId: string): Promise<void> {
    if (!this.recovery || this.sessions.has(projectId)) return
    const existing = this.restoring.get(projectId)
    if (existing) return existing
    const operation = (async () => {
      try {
        const record = await this.recovery!.read(projectId)
        if (!record || this.sessions.has(projectId)) return
        const state = emptySession()
        let blocked = false
        try {
          await this.checkpoints.importAnchors?.(projectId, record.anchors)
        } catch (error) {
          blocked = true
          state.error = errorMessage(error)
        }
        state.turns = record.snapshot.turns.map((turn) => ({
          ...turn,
          generationIds: [...turn.generationIds],
        }))
        state.generations = new Map(
          record.snapshot.generations.map((generation) => [
            generation.id,
            {
              ...generation,
              status: generation.status === 'pending' ? 'failed' : generation.status,
              ...(blocked ? { recoveryBlocked: true } : {}),
              receipts: generation.receipts?.map((receipt) =>
                receipt.status === 'receiving'
                  ? {
                      ...receipt,
                      status: 'interrupted' as const,
                      error: '页面关闭，回复未接收完毕',
                    }
                  : receipt,
              ),
            },
          ]),
        )
        state.activeGenerationId = record.snapshot.activeGenerationId
        state.materializedGenerationId = record.snapshot.materializedGenerationId
        state.materializedSourceRevision = record.materializedSourceRevision
        state.ownedCheckpointIds = new Set(record.anchors.map((anchor) => anchor.id))
        state.error ??= '已恢复本机对话；中断的请求不会自动重发，未应用的修改可检查后应用。'
        this.sessions.set(projectId, state)
        // Opening a conversation is a read: another tab may still own a live request.
        this.emit(projectId, false)
      } catch (error) {
        const state = this.ensureSession(projectId)
        state.error = errorMessage(error)
        this.emit(projectId, false)
      }
    })()
    this.restoring.set(projectId, operation)
    await operation
  }

  recordReceipt(
    projectId: string,
    requestId: string,
    receipt: FrontendWorkshopSourceAiReceipt,
    bundle: FrontendWorkshopSourceAiContextBundle,
  ): void {
    const state = this.sessions.get(projectId)
    if (
      !state?.request ||
      state.request.id !== requestId ||
      state.request.controller.signal.aborted
    )
      return
    const generation = state.generations.get(state.request.generationId)!
    const receipts = [...(generation.receipts ?? [])]
    const index = receipts.findIndex((item) => item.id === receipt.id)
    const retained = { ...receipt }
    if (index < 0) receipts.push(retained)
    else receipts[index] = retained
    generation.receipts = receipts
    generation.bundle = bundle
    this.emit(projectId)
  }

  recordLookup(projectId: string, requestId: string, lookup: FrontendWorkshopSourceAiLookup): void {
    const state = this.sessions.get(projectId)
    if (
      !state?.request ||
      state.request.id !== requestId ||
      state.request.controller.signal.aborted
    )
      return
    const generation = state.generations.get(state.request.generationId)!
    generation.lookups = [...(generation.lookups ?? []), lookup]
    this.emit(projectId)
  }

  snapshot(projectId: string): FrontendWorkshopSourceAiSessionSnapshot {
    const key = requireProjectId(projectId)
    const state = this.sessions.get(key) ?? emptySession()
    return {
      projectId: key,
      turns: state.turns.map((turn) => ({
        ...turn,
        referenceImages: turn.referenceImages.map((image) => ({ ...image })),
        generationIds: [...turn.generationIds],
      })),
      generations: [...state.generations.values()].map((generation) => ({
        ...generation,
        unresolvedHostReferenceRequests: [...generation.unresolvedHostReferenceRequests],
      })),
      activeGenerationId: state.activeGenerationId,
      materializedGenerationId: state.materializedGenerationId,
      pending: state.request !== null,
      applying: state.applying,
      error: state.error,
    }
  }

  subscribe(projectId: string, listener: FrontendWorkshopSourceAiSessionListener): () => void {
    const key = requireProjectId(projectId)
    let owners = this.listeners.get(key)
    if (!owners) {
      owners = new Set()
      this.listeners.set(key, owners)
    }
    owners.add(listener)
    listener(this.snapshot(key))
    return () => {
      owners?.delete(listener)
      if (owners?.size === 0) this.listeners.delete(key)
    }
  }

  async beginRequest(
    projectId: string,
    userContent: string,
    options: FrontendWorkshopSourceAiSessionRequestOptions = {},
  ): Promise<FrontendWorkshopSourceAiSessionRequestHandle> {
    const key = requireProjectId(projectId)
    const content = requireMessage(userContent, 'Source AI Session 用户消息')
    await this.restore(key)
    const state = this.ensureSession(key)
    if (state.applying) throw new Error('Source AI generation 正在应用，请完成后再发送新请求')
    if (state.request) this.cancelRequest(key)

    const kind = options.kind ?? 'new'
    const editedTurn =
      kind === 'edit' ? state.turns.find((candidate) => candidate.id === options.turnId) : undefined
    let turn: MutableTurn
    if (kind === 'regenerate' || kind === 'repair') {
      const generation = options.generationId
        ? state.generations.get(options.generationId)
        : undefined
      if (!generation) throw new Error('要重新生成的 AI generation 不存在')
      if (kind === 'repair' && !getFrontendWorkshopSourceAiRepairReceipt(generation))
        throw new Error('这份回复没有可修复的失败原文，请重新生成')
      const owner = state.turns.find((candidate) => candidate.id === generation.turnId)
      if (!owner) throw new Error('AI generation 所属 turn 不存在')
      turn = owner
    } else if (kind === 'edit') {
      const owner = editedTurn
      if (!owner) throw new Error('要编辑的用户消息不存在')
      await this.removeTurnDescendants(key, state, owner, false)
      owner.content = content
      if (options.referenceImages) {
        owner.referenceImages = validateFrontendWorkshopSourceAiReferenceImages(
          options.referenceImages,
        )
      }
      turn = owner
    } else {
      const parent = state.activeGenerationId
        ? state.generations.get(state.activeGenerationId)
        : undefined
      // A normal continuation includes intervening manual edits. Only explicitly selecting a
      // different materialized result starts from that historical branch's checkpoint.
      const baseCheckpointId =
        parent?.resultCheckpointId && parent.id !== state.materializedGenerationId
          ? parent.resultCheckpointId
          : await this.createBaseCheckpoint(key, state)
      turn = {
        id: crypto.randomUUID(),
        content,
        referenceImages: validateFrontendWorkshopSourceAiReferenceImages(options.referenceImages),
        ...(parent ? { parentGenerationId: parent.id } : {}),
        baseCheckpointId,
        generationIds: [],
        createdAt: Date.now(),
      }
      state.turns.push(turn)
    }

    const conversation = this.conversationBeforeTurn(state, turn)
    const generationId = crypto.randomUUID()
    const generation: MutableGeneration = {
      id: generationId,
      turnId: turn.id,
      ordinal: turn.generationIds.length + 1,
      status: 'pending',
      ...(kind === 'repair' ? { repairedFromGenerationId: options.generationId } : {}),
      assistantContent: '',
      summary: '',
      bundle: null,
      proposal: null,
      unresolvedHostReferenceRequests: [],
      diagnostics: null,
      createdAt: Date.now(),
    }
    turn.generationIds.push(generationId)
    state.generations.set(generationId, generation)
    state.activeGenerationId = generationId
    const controller = new AbortController()
    const requestId = crypto.randomUUID()
    state.request = { id: requestId, turnId: turn.id, generationId, controller }
    state.error = null
    this.emit(key)
    return {
      requestId,
      turnId: turn.id,
      generationId,
      baseCheckpointId: turn.baseCheckpointId,
      conversation,
      referenceImages: turn.referenceImages.map((image) => ({ ...image })),
      signal: controller.signal,
    }
  }

  completeRequest(
    projectId: string,
    requestId: string,
    bundle: FrontendWorkshopSourceAiContextBundle,
    proposal: FrontendWorkshopSourceAiProposal,
    unresolvedHostReferenceRequests: readonly string[] = [],
    blockedReason?: FrontendWorkshopSourceAiHostReferenceBlockedReason,
    providerReasoning?: string,
  ): string | undefined {
    const key = requireProjectId(projectId)
    const state = this.sessions.get(key)
    const active = state?.request
    if (!state || !active || active.id !== requestId || active.controller.signal.aborted) {
      return undefined
    }
    if (bundle.projectId !== key || proposal.projectId !== key) {
      throw new Error('Source AI Session proposal projectId 不匹配')
    }
    if (bundle.sourceRevision !== proposal.sourceRevision) {
      throw new Error('Source AI Session proposal sourceRevision 不匹配')
    }
    const generation = state.generations.get(active.generationId)
    const turn = state.turns.find((candidate) => candidate.id === active.turnId)
    if (!generation || !turn) return undefined
    const unresolved = [...unresolvedHostReferenceRequests]
    if (unresolved.length > 0 && !blockedReason) {
      throw new Error('Source AI Session 缺少 Host Reference blockedReason')
    }
    generation.bundle = structuredClone(bundle)
    generation.proposal = structuredClone(proposal)
    generation.assistantContent = requireMessage(proposal.summary, 'Source AI assistant 回复')
    generation.summary = proposal.summary
    generation.unresolvedHostReferenceRequests = unresolved
    generation.blockedReason = blockedReason
    generation.status = unresolved.length > 0 ? 'needs-host-reference' : 'ready'
    generation.diagnostics = thoughtDiagnostics(
      turn.content,
      bundle,
      proposal,
      unresolved,
      providerReasoning,
    )
    state.request = null
    state.error = null
    this.emit(key)
    return generation.id
  }

  failRequest(projectId: string, requestId: string, error: unknown): boolean {
    const key = requireProjectId(projectId)
    const state = this.sessions.get(key)
    if (
      !state?.request ||
      state.request.id !== requestId ||
      state.request.controller.signal.aborted
    ) {
      return false
    }
    const generation = state.generations.get(state.request.generationId)
    if (generation) {
      generation.status = 'failed'
      generation.assistantContent = errorMessage(error) + '（已接收的原文可在回复详情中查看）'
    }
    state.request = null
    state.error = errorMessage(error)
    this.emit(key)
    return true
  }

  cancelRequest(projectId: string): boolean {
    const key = requireProjectId(projectId)
    const state = this.sessions.get(key)
    if (!state?.request) return false
    state.request.controller.abort()
    const generation = state.generations.get(state.request.generationId)
    if (generation?.receipts?.some((receipt) => receipt.rawText)) {
      generation.status = 'failed'
      generation.assistantContent = '已停止，收到的原文已保留。'
      generation.receipts = generation.receipts.map((receipt) =>
        receipt.status === 'receiving' ? { ...receipt, status: 'interrupted' as const } : receipt,
      )
    } else if (generation) this.removeGenerationRecord(state, generation.id)
    state.request = null
    state.error = null
    this.emit(key)
    return true
  }

  selectGeneration(projectId: string, generationId: string): void {
    const key = requireProjectId(projectId)
    const state = this.ensureSession(key)
    if (!state.generations.has(generationId)) throw new Error('AI generation 不存在')
    state.activeGenerationId = generationId
    state.error = null
    this.emit(key)
  }

  async previewGeneration(
    projectId: string,
    generationId: string,
  ): Promise<FrontendWorkshopSourceAiGenerationPreview> {
    const key = requireProjectId(projectId)
    const state = this.sessions.get(key)
    const generation = state?.generations.get(generationId)
    const turn = generation
      ? state?.turns.find((candidate) => candidate.id === generation.turnId)
      : undefined
    if (!generation || !turn) throw new Error('AI generation 不存在')
    const before = this.checkpoints.read(key, turn.baseCheckpointId)
    let after = before
    if (generation.resultCheckpointId) {
      after = this.checkpoints.read(key, generation.resultCheckpointId)
    } else if (generation.bundle && generation.proposal && generation.proposal.edits.length > 0) {
      after = this.application.projectValidatedCandidate(
        before,
        generation.bundle,
        generation.proposal,
      )
    }
    return { before, after }
  }

  async applyGeneration(
    projectId: string,
    generationId: string,
    options: FrontendWorkshopSourceHistoryApplyOptions = {},
  ): Promise<FrontendWorkshopAppliedSourcePatch | null> {
    const key = requireProjectId(projectId)
    const state = this.sessions.get(key)
    const generation = state?.generations.get(generationId)
    const turn = generation
      ? state?.turns.find((candidate) => candidate.id === generation.turnId)
      : undefined
    if (!state || !generation || !turn) throw new Error('AI generation 不存在')
    if (generation.recoveryBlocked)
      throw new Error('恢复基线已失效，请基于当前作品重新生成；原文仍可查看')
    if (generation.status === 'needs-host-reference') {
      throw new Error('当前 generation 缺少 Host Reference 证据')
    }
    if (!generation.bundle || !generation.proposal) throw new Error('当前 generation 没有 proposal')
    if (generation.proposal.edits.length === 0) {
      generation.status = 'applied'
      generation.resultCheckpointId = turn.baseCheckpointId
      this.emit(key)
      return null
    }
    if (state.applying) throw new Error('Source AI generation 正在应用')
    state.applying = true
    state.error = null
    this.emit(key)
    try {
      const base = this.checkpoints.read(key, turn.baseCheckpointId)
      const materialized = state.materializedGenerationId
        ? state.generations.get(state.materializedGenerationId)
        : undefined
      const materializedSource = this.checkpoints.read(
        key,
        materialized?.resultCheckpointId ?? turn.baseCheckpointId,
      )
      const materializedRevision = state.materializedSourceRevision ?? materializedSource.revision
      // A freshly captured request base can be newer than the last AI result (manual editing).
      // Still compare the exact captured document/revision at apply time; never adopt live changes.
      const expectedCurrent =
        base.revision >= materializedRevision
          ? base
          : { ...materializedSource, revision: materializedRevision }
      const applied = await this.application.applyValidatedProposalFromBase(
        base,
        expectedCurrent,
        generation.bundle,
        generation.proposal,
        options,
      )
      const appliedDocument = applied?.document ?? expectedCurrent
      const result = await this.checkpoints.create(key, {
        label: `AI 结果：${generation.ordinal}`,
        expectedRevision: appliedDocument.revision,
        expectedSourceCreatedAt: appliedDocument.createdAt,
      })
      state.ownedCheckpointIds.add(result.id)
      generation.status = 'applied'
      generation.resultCheckpointId = result.id
      generation.resultRevision = appliedDocument.revision
      state.activeGenerationId = generation.id
      state.materializedGenerationId = generation.id
      state.materializedSourceRevision = appliedDocument.revision
      state.applying = false
      this.emit(key)
      return applied
    } catch (error) {
      state.applying = false
      state.error = errorMessage(error)
      this.emit(key)
      throw error
    }
  }

  async deleteGeneration(projectId: string, generationId: string): Promise<void> {
    const key = requireProjectId(projectId)
    const state = this.ensureSession(key)
    const generation = state.generations.get(generationId)
    if (!generation) return
    const turn = state.turns.find((candidate) => candidate.id === generation.turnId)
    if (!turn) return
    const removedGenerationIds = new Set<string>([generationId])
    const descendantTurns = this.descendantTurnIds(state, removedGenerationIds)
    if (
      state.materializedGenerationId &&
      removedGenerationIds.has(state.materializedGenerationId)
    ) {
      const fallbackGeneration = turn.generationIds
        .filter((id) => !removedGenerationIds.has(id))
        .map((id) => state.generations.get(id))
        .filter((candidate): candidate is MutableGeneration =>
          Boolean(candidate?.resultCheckpointId),
        )
        .at(-1)
      const restored = await this.checkpoints.restore(
        key,
        fallbackGeneration?.resultCheckpointId ?? turn.baseCheckpointId,
      )
      state.materializedGenerationId = fallbackGeneration?.id ?? turn.parentGenerationId ?? null
      state.materializedSourceRevision = restored.document.revision
    }
    state.turns = state.turns.filter((candidate) => !descendantTurns.has(candidate.id))
    removedGenerationIds.forEach((id) => state.generations.delete(id))
    turn.generationIds = turn.generationIds.filter((id) => id !== generationId)
    state.activeGenerationId = turn.generationIds.at(-1) ?? turn.parentGenerationId ?? null
    this.cleanupCheckpoints(key, state)
    this.emit(key)
  }

  async deleteTurn(projectId: string, turnId: string): Promise<void> {
    const key = requireProjectId(projectId)
    const state = this.ensureSession(key)
    const turn = state.turns.find((candidate) => candidate.id === turnId)
    if (!turn) return
    await this.removeTurnDescendants(key, state, turn, true)
    this.emit(key)
  }

  clear(projectId: string): void {
    const key = requireProjectId(projectId)
    const state = this.sessions.get(key)
    if (!state) return
    if (state.applying) throw new Error('Source AI generation 正在应用，不能清空 Session')
    state.request?.controller.abort()
    state.ownedCheckpointIds.forEach((id) => this.checkpoints.remove(key, id))
    this.sessions.delete(key)
    this.emit(key)
  }

  private async createBaseCheckpoint(projectId: string, state: MutableSession): Promise<string> {
    const checkpoint = await this.checkpoints.create(projectId, { label: 'AI 对话基线' })
    state.ownedCheckpointIds.add(checkpoint.id)
    return checkpoint.id
  }

  private conversationBeforeTurn(
    state: MutableSession,
    turn: MutableTurn,
  ): readonly FrontendWorkshopSourceAiConversationTurn[] {
    const chain: Array<{ turn: MutableTurn; generation: MutableGeneration }> = []
    let parentId = turn.parentGenerationId
    while (parentId) {
      const generation = state.generations.get(parentId)
      const owner = generation
        ? state.turns.find((candidate) => candidate.id === generation.turnId)
        : undefined
      if (!generation || !owner) break
      chain.unshift({ turn: owner, generation })
      parentId = owner.parentGenerationId
    }
    return chain.flatMap(({ turn: owner, generation }) => [
      { role: 'user' as const, content: owner.content },
      {
        role: 'assistant' as const,
        content:
          generation.assistantContent +
          (generation.proposal?.componentDraft
            ? '\n组件草稿（尚不代表已保存）：\n' +
              JSON.stringify(generation.proposal.componentDraft)
            : generation.proposal?.rejectedComponentDraft !== undefined
              ? '\n未通过校验的组件草稿原文（仅供修正，未保存或执行）：\n' +
                JSON.stringify(generation.proposal.rejectedComponentDraft)
              : ''),
      },
    ])
  }

  private descendantTurnIds(state: MutableSession, generationIds: Set<string>): Set<string> {
    const result = new Set<string>()
    let changed = true
    while (changed) {
      changed = false
      for (const turn of state.turns) {
        if (
          turn.parentGenerationId &&
          generationIds.has(turn.parentGenerationId) &&
          !result.has(turn.id)
        ) {
          result.add(turn.id)
          turn.generationIds.forEach((id) => generationIds.add(id))
          changed = true
        }
      }
    }
    return result
  }

  private async removeTurnDescendants(
    projectId: string,
    state: MutableSession,
    turn: MutableTurn,
    includeTurn: boolean,
  ): Promise<void> {
    const removedGenerationIds = new Set(turn.generationIds)
    const descendantTurns = this.descendantTurnIds(state, removedGenerationIds)
    if (
      state.materializedGenerationId &&
      removedGenerationIds.has(state.materializedGenerationId)
    ) {
      const restored = await this.checkpoints.restore(projectId, turn.baseCheckpointId)
      state.materializedGenerationId = turn.parentGenerationId ?? null
      state.materializedSourceRevision = restored.document.revision
    }
    removedGenerationIds.forEach((id) => state.generations.delete(id))
    state.turns = state.turns.filter((candidate) => {
      if (descendantTurns.has(candidate.id)) return false
      return includeTurn ? candidate.id !== turn.id : true
    })
    turn.generationIds = []
    state.activeGenerationId = turn.parentGenerationId ?? null
    this.cleanupCheckpoints(projectId, state)
  }

  private removeGenerationRecord(state: MutableSession, generationId: string): void {
    const generation = state.generations.get(generationId)
    if (!generation) return
    state.generations.delete(generationId)
    const turn = state.turns.find((candidate) => candidate.id === generation.turnId)
    if (turn) turn.generationIds = turn.generationIds.filter((id) => id !== generationId)
    if (state.activeGenerationId === generationId) {
      state.activeGenerationId = turn?.parentGenerationId ?? null
    }
  }

  private cleanupCheckpoints(projectId: string, state: MutableSession): void {
    const referenced = new Set(state.turns.map((turn) => turn.baseCheckpointId))
    state.generations.forEach((generation) => {
      if (generation.resultCheckpointId) referenced.add(generation.resultCheckpointId)
    })
    state.ownedCheckpointIds.forEach((id) => {
      if (referenced.has(id)) return
      this.checkpoints.remove(projectId, id)
      state.ownedCheckpointIds.delete(id)
    })
  }

  private ensureSession(projectId: string): MutableSession {
    let state = this.sessions.get(projectId)
    if (!state) {
      state = emptySession()
      this.sessions.set(projectId, state)
    }
    return state
  }

  private emit(projectId: string, persist = true): void {
    const owners = this.listeners.get(projectId)
    const snapshot = this.snapshot(projectId)
    const state = this.sessions.get(projectId)
    if (persist)
      this.recovery?.save(
        projectId,
        state
          ? {
              version: 1,
              snapshot,
              anchors:
                this.checkpoints.exportAnchors?.(projectId, [...state.ownedCheckpointIds]) ?? [],
              materializedSourceRevision: state.materializedSourceRevision,
            }
          : null,
        (error) => {
          const current = this.sessions.get(projectId)
          if (current) {
            current.error = errorMessage(error)
            this.emit(projectId, false)
          }
        },
      )
    owners?.forEach((listener) => listener(snapshot))
  }
}
