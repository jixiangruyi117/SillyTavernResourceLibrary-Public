import type { FrontendWorkshopSourceAiRequestOptions } from '../types/FrontendWorkshopSourceAiReceipt'
import type { MainApiConfig } from './MainApiService'
import { getFrontendWorkshopSourceAiRepairReceipt } from '../utils/FrontendWorkshopSourceAiReplyRepair'
import type {
  FrontendWorkshopSourceAiContextBundle,
  FrontendWorkshopSourceAiContextInput,
  FrontendWorkshopSourceAiHostReference,
} from '../utils/FrontendWorkshopSourceAiContext'
import type { FrontendWorkshopSourceAiProposal } from '../utils/FrontendWorkshopSourceAiProposal'
import type { FrontendWorkshopSourceDocument } from '../types/FrontendWorkshopSourceDocument'
import type {
  FrontendWorkshopSourceAiHostReferenceBlockedReason,
  FrontendWorkshopSourceAiHostReferenceOrchestrationResult,
  FrontendWorkshopSourceAiHostReferenceResolutionOptions,
} from './FrontendWorkshopSourceAiHostReferenceService'
import type {
  FrontendWorkshopSourceAiSessionRequestHandle,
  FrontendWorkshopSourceAiSessionRequestOptions,
  FrontendWorkshopSourceAiSessionSnapshot,
} from './FrontendWorkshopSourceAiSessionService'

export type FrontendWorkshopSourceAiSharedRequestInput = Omit<
  FrontendWorkshopSourceAiContextInput,
  'source' | 'conversation' | 'replyRepair'
> & {
  projectId: string
  expectedSource?: { revision: number; createdAt: number }
  apiOverride?: Partial<MainApiConfig>
  timeoutMs?: number
  session?: FrontendWorkshopSourceAiSessionRequestOptions
}

export type FrontendWorkshopSourceAiSharedRequestResult =
  | {
      status: 'completed' | 'needs-host-reference'
      accepted: true
      orchestration: FrontendWorkshopSourceAiHostReferenceOrchestrationResult
      generationId: string
    }
  | {
      status: 'superseded'
      accepted: false
    }

export interface FrontendWorkshopSourceAiCurrentSourceReader {
  get(projectId: string): Promise<FrontendWorkshopSourceDocument | null | undefined>
}

export interface FrontendWorkshopSourceAiCheckpointReader {
  read(projectId: string, checkpointId: string): FrontendWorkshopSourceDocument
}

export interface FrontendWorkshopSourceAiSharedSession {
  beginRequest(
    projectId: string,
    userContent: string,
    options?: FrontendWorkshopSourceAiSessionRequestOptions,
  ): Promise<FrontendWorkshopSourceAiSessionRequestHandle>
  completeRequest(
    projectId: string,
    requestId: string,
    bundle: FrontendWorkshopSourceAiContextBundle,
    proposal: FrontendWorkshopSourceAiProposal,
    unresolvedHostReferenceRequests?: readonly string[],
    blockedReason?: FrontendWorkshopSourceAiHostReferenceBlockedReason,
    providerReasoning?: string,
  ): string | undefined
  recordReceipt?: (
    projectId: string,
    requestId: string,
    ...args: Parameters<NonNullable<FrontendWorkshopSourceAiRequestOptions['onReceipt']>>
  ) => void
  recordLookup?: (
    projectId: string,
    requestId: string,
    ...args: Parameters<NonNullable<FrontendWorkshopSourceAiRequestOptions['onLookup']>>
  ) => void
  failRequest(projectId: string, requestId: string, error: unknown): boolean
  snapshot(projectId: string): FrontendWorkshopSourceAiSessionSnapshot
}

export interface FrontendWorkshopSourceAiHostReferenceRequester {
  request(
    input: FrontendWorkshopSourceAiContextInput,
    override?: Partial<MainApiConfig>,
    options?: FrontendWorkshopSourceAiRequestOptions,
  ): Promise<FrontendWorkshopSourceAiHostReferenceOrchestrationResult>
  resolveRequestedReferences(
    requests: readonly string[],
    options?: FrontendWorkshopSourceAiHostReferenceResolutionOptions,
  ): Promise<{
    resolvedReferences: FrontendWorkshopSourceAiHostReference[]
    unresolvedRequests: string[]
  }>
}

function snapshotRequestData<T>(value: T, seen = new WeakMap<object, unknown>()): T {
  if (Array.isArray(value)) {
    const existing = seen.get(value)
    if (existing) return existing as T
    const clone: unknown[] = []
    seen.set(value, clone)
    for (const item of value) clone.push(snapshotRequestData(item, seen))
    return clone as T
  }
  if (value && typeof value === 'object') {
    const object = value as object
    const existing = seen.get(object)
    if (existing) return existing as T
    const clone: Record<string, unknown> = {}
    seen.set(object, clone)
    for (const [key, item] of Object.entries(value)) {
      clone[key] = snapshotRequestData(item, seen)
    }
    return clone as T
  }
  return value
}

function finalAttempt(result: FrontendWorkshopSourceAiHostReferenceOrchestrationResult) {
  const attempt = result.attempts[result.attempts.length - 1]
  if (!attempt) throw new Error('Source AI Host Reference orchestration 未返回 attempt')
  return attempt
}

function mergeHostReferences(
  current: readonly FrontendWorkshopSourceAiHostReference[] | undefined,
  additional: readonly FrontendWorkshopSourceAiHostReference[],
): FrontendWorkshopSourceAiHostReference[] {
  const result = new Map<string, FrontendWorkshopSourceAiHostReference>()
  for (const reference of [...(current ?? []), ...additional]) {
    const existing = result.get(reference.id)
    if (
      existing &&
      (existing.title !== reference.title || existing.content !== reference.content)
    ) {
      throw new Error(`Host Reference id 冲突：${reference.id}`)
    }
    result.set(reference.id, { ...reference })
  }
  return [...result.values()]
}

function explicitContinuationRequests(
  session: FrontendWorkshopSourceAiSessionSnapshot,
  options: FrontendWorkshopSourceAiSessionRequestOptions | undefined,
): readonly string[] {
  if (options?.kind !== 'regenerate' || !options.generationId) return []
  const generation = session.generations.find((candidate) => candidate.id === options.generationId)
  if (
    generation?.status !== 'needs-host-reference' ||
    generation.blockedReason !== 'additional-provider-consent-required'
  )
    return []
  return generation.unresolvedHostReferenceRequests
}

function blockedProposalForDisplay(
  proposal: FrontendWorkshopSourceAiProposal,
  requests: readonly string[],
  blockedReason: FrontendWorkshopSourceAiHostReferenceBlockedReason | undefined,
): FrontendWorkshopSourceAiProposal {
  const researchMessages: Partial<
    Record<FrontendWorkshopSourceAiHostReferenceBlockedReason, string>
  > = {
    'research-budget-exhausted':
      '已达到本次允许的额外 AI 调用次数。已有回复保留，当前作品未修改。可调整 AI 设置后重新生成。',
    'research-no-progress':
      '没有查到新增的可用接口资料，已停止重复查询。已有回复保留，当前作品未修改。请核对资料版本或补充更具体的接口线索。',
    'research-failed':
      '后续资料读取或 AI 请求未能完成。已有回复保留，当前作品未修改，可稍后重新生成。',
    'context-truncated':
      '新增资料超出本次上下文容量，已停止继续调用。已有回复保留，当前作品未修改。',
  }
  const message = blockedReason && researchMessages[blockedReason]
  if (message) return { ...proposal, summary: `${proposal.summary}\n\n${message}` }
  if (blockedReason !== 'additional-provider-consent-required' || !requests.length) return proposal
  const list = requests.join('、')
  return {
    ...proposal,
    summary: `${proposal.summary}\n\n这次修改还需要 Host Reference：${list}。当前结果未写入 Source。点击下方“补充资料并继续”会先补充这些本地资料，并额外使用 1 次 AI 请求。`,
  }
}

/**
 * S7-B2 shared request owner. It coordinates the already-owned S6 request path with the S7-B1
 * session, but does not build prompts, validate proposals, persist Source, or apply edits itself.
 * Additional provider calls require an explicit continuation or the user-selected research budget.
 */
export class FrontendWorkshopSourceAiRequestService {
  private readonly sourceReader: FrontendWorkshopSourceAiCurrentSourceReader
  private readonly session: FrontendWorkshopSourceAiSharedSession
  private readonly hostReferenceService: FrontendWorkshopSourceAiHostReferenceRequester
  private readonly checkpoints: FrontendWorkshopSourceAiCheckpointReader

  constructor(
    sourceReader: FrontendWorkshopSourceAiCurrentSourceReader,
    session: FrontendWorkshopSourceAiSharedSession,
    hostReferenceService: FrontendWorkshopSourceAiHostReferenceRequester,
    checkpoints: FrontendWorkshopSourceAiCheckpointReader,
  ) {
    this.sourceReader = sourceReader
    this.session = session
    this.hostReferenceService = hostReferenceService
    this.checkpoints = checkpoints
  }

  async request(
    input: FrontendWorkshopSourceAiSharedRequestInput,
  ): Promise<FrontendWorkshopSourceAiSharedRequestResult> {
    const request = snapshotRequestData(input)
    const {
      projectId: rawProjectId,
      expectedSource,
      apiOverride,
      timeoutMs,
      session: sessionOptions,
      ...contextInput
    } = request
    const projectId = rawProjectId.trim()
    if (!projectId) throw new Error('Source AI request 缺少 projectId')

    const previousSnapshot = this.session.snapshot(projectId)
    const repairGeneration =
      sessionOptions?.kind === 'repair'
        ? previousSnapshot.generations.find((item) => item.id === sessionOptions.generationId)
        : undefined
    const repairReceipt = getFrontendWorkshopSourceAiRepairReceipt(repairGeneration)
    const repairBundle = repairGeneration?.bundle
    if (sessionOptions?.kind === 'repair' && (!repairReceipt || !repairBundle))
      throw new Error('这份回复没有可修复的失败原文，请重新生成')
    if (repairBundle) {
      const turn = previousSnapshot.turns.find((item) => item.id === repairGeneration?.turnId)
      if (!turn) throw new Error('原回复所属对话不存在，无法修复')
      contextInput.instruction = turn.content
      contextInput.mode = repairBundle.mode
      contextInput.writeScope =
        repairBundle.writeScope.kind === 'ranges'
          ? { kind: 'ranges', ranges: repairBundle.writeScope.allowedRanges }
          : { kind: repairBundle.writeScope.kind }
      contextInput.runtimeError = repairBundle.runtimeError
      contextInput.runtimeDiagnostics = repairBundle.runtimeDiagnostics
      // Use the original reference target; changed UI settings cannot silently switch versions.
      contextInput.hostResearch = undefined
      const referenceSection = repairBundle.sections.find((item) => item.kind === 'host-reference')
      if (referenceSection) {
        const stored = JSON.parse(referenceSection.content) as {
          provided?: FrontendWorkshopSourceAiHostReference[]
          research?: FrontendWorkshopSourceAiContextInput['hostResearch']
        }
        contextInput.hostReferences = stored.provided ?? []
        if (stored.research?.tavernHelperVersion && stored.research.sillyTavernVersion)
          contextInput.hostResearch = { ...stored.research, maxAdditionalRequests: 0 }
      }
    }
    const approvedContinuationRequests = explicitContinuationRequests(
      previousSnapshot,
      sessionOptions,
    )
    const handle = await this.session.beginRequest(projectId, contextInput.instruction, {
      ...sessionOptions,
      referenceImages: contextInput.referenceImages,
    })

    try {
      const current = await this.sourceReader.get(projectId)
      if (handle.signal.aborted) return { status: 'superseded', accepted: false }
      if (!current) throw new Error('当前 FrontendWorkshop Source 不存在')
      const source = this.checkpoints.read(projectId, handle.baseCheckpointId)
      if (
        repairBundle &&
        (current.revision !== source.revision ||
          current.createdAt !== source.createdAt ||
          current.authorSource !== source.authorSource ||
          source.revision !== repairBundle.sourceRevision ||
          source.createdAt !== repairBundle.sourceCreatedAt)
      )
        throw new Error('作品已变化，未调用 AI 修复旧回复；原文仍保留，请基于当前作品重新发起修改')
      if (
        expectedSource &&
        (current.revision !== expectedSource.revision ||
          current.createdAt !== expectedSource.createdAt ||
          source.revision !== expectedSource.revision ||
          source.createdAt !== expectedSource.createdAt)
      ) {
        throw new Error('Source 已变化，请重新选择修改范围')
      }
      if (source.createdAt !== current.createdAt) {
        throw new Error('AI 对话基线 Source lineage 已失效')
      }

      let approvedReferences: readonly FrontendWorkshopSourceAiHostReference[] = []
      if (approvedContinuationRequests.length) {
        const resolution = await this.hostReferenceService.resolveRequestedReferences(
          approvedContinuationRequests,
          {
            signal: handle.signal,
            ...(contextInput.hostResearch ? { online: contextInput.hostResearch } : {}),
          },
        )
        if (resolution.unresolvedRequests.length) {
          throw new Error(`以下接口资料尚未查到：${resolution.unresolvedRequests.join('、')}`)
        }
        approvedReferences = resolution.resolvedReferences
      }

      const orchestration = await this.hostReferenceService.request(
        {
          ...contextInput,
          ...(repairReceipt
            ? {
                replyRepair: {
                  rawText: repairReceipt.rawText,
                  error:
                    repairReceipt.error ?? repairGeneration?.assistantContent ?? '回复未能完成',
                  finishReason: repairReceipt.finishReason,
                },
              }
            : {}),
          source,
          conversation: handle.conversation,
          referenceImages: handle.referenceImages,
          hostReferences: mergeHostReferences(contextInput.hostReferences, approvedReferences),
        },
        apiOverride,
        {
          timeoutMs,
          signal: handle.signal,
          onReceipt: (receipt, bundle) =>
            this.session.recordReceipt?.(projectId, handle.requestId, receipt, bundle),
          onLookup: (lookup) => this.session.recordLookup?.(projectId, handle.requestId, lookup),
        },
      )
      if (handle.signal.aborted) return { status: 'superseded', accepted: false }

      const attempt = finalAttempt(orchestration)
      const unresolvedRequests =
        orchestration.status === 'needs-host-reference' ? orchestration.unresolvedRequests : []
      const blockedReason =
        orchestration.status === 'needs-host-reference' ? orchestration.blockedReason : undefined
      const proposal = blockedProposalForDisplay(
        attempt.result.proposal,
        unresolvedRequests,
        blockedReason,
      )
      const generationId = this.session.completeRequest(
        projectId,
        handle.requestId,
        attempt.bundle,
        proposal,
        unresolvedRequests,
        blockedReason,
        attempt.result.providerReasoning,
      )
      if (!generationId) return { status: 'superseded', accepted: false }

      return {
        status: orchestration.status,
        accepted: true,
        orchestration,
        generationId,
      }
    } catch (error) {
      if (handle.signal.aborted) return { status: 'superseded', accepted: false }
      this.session.failRequest(projectId, handle.requestId, error)
      throw error
    }
  }
}
