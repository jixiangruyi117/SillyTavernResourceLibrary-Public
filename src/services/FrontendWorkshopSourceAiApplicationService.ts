import type { FrontendWorkshopSourceDocument } from '../types/FrontendWorkshopSourceDocument'
import { createFrontendWorkshopStaticSourceProvenance } from '../utils/FrontendWorkshopSourceAnalysis'
import type { FrontendWorkshopSourceAiContextBundle } from '../utils/FrontendWorkshopSourceAiContext'
import {
  assertFrontendWorkshopSourceAiContextCurrent,
  type FrontendWorkshopSourceAiProposal,
  type FrontendWorkshopSourceAiProposalEdit,
} from '../utils/FrontendWorkshopSourceAiProposal'
import type { FrontendWorkshopSourcePatch } from '../utils/FrontendWorkshopSourcePatch'
import { applyFrontendWorkshopSourcePatch } from '../utils/FrontendWorkshopSourcePatch'
import type { FrontendWorkshopAppliedSourcePatch } from './FrontendWorkshopSourcePatchService'
import { FrontendWorkshopSourceDocumentService } from './FrontendWorkshopSourceDocumentService'
import {
  FrontendWorkshopSourceHistoryService,
  type FrontendWorkshopSourceHistoryApplyOptions,
} from './FrontendWorkshopSourceHistoryService'

export class FrontendWorkshopSourceAiHostReferencePendingError extends Error {
  readonly requests: readonly string[]

  constructor(requests: readonly string[]) {
    super('AI proposal 仍需要 Host Reference 证据，不能应用 Source 修改')
    this.name = 'FrontendWorkshopSourceAiHostReferencePendingError'
    this.requests = Object.freeze([...requests])
  }
}

function rangeInsideWriteScope(
  bundle: FrontendWorkshopSourceAiContextBundle,
  edit: FrontendWorkshopSourceAiProposalEdit,
): boolean {
  return bundle.writeScope.allowedRanges.some(
    (range) => edit.start >= range.start && edit.end <= range.end,
  )
}

function assertProposalCurrentAndApplicable(
  source: FrontendWorkshopSourceDocument,
  bundle: FrontendWorkshopSourceAiContextBundle,
  proposal: FrontendWorkshopSourceAiProposal,
): void {
  assertFrontendWorkshopSourceAiContextCurrent(source, bundle)

  if (proposal.kind !== 'source-ai-proposal') throw new Error('AI proposal kind 不匹配')
  if (proposal.projectId !== source.projectId || proposal.projectId !== bundle.projectId) {
    throw new Error('AI proposal projectId 已失效')
  }
  if (
    !Number.isInteger(proposal.sourceRevision) ||
    proposal.sourceRevision !== source.revision ||
    proposal.sourceRevision !== bundle.sourceRevision
  ) {
    throw new Error('AI proposal sourceRevision 已失效')
  }
  if (!Array.isArray(proposal.hostReferenceRequests)) {
    throw new Error('AI proposal hostReferenceRequests 非法')
  }
  if (proposal.hostReferenceRequests.length > 0) {
    throw new FrontendWorkshopSourceAiHostReferencePendingError(proposal.hostReferenceRequests)
  }
  if (!Array.isArray(proposal.edits) || proposal.edits.length < 1) {
    throw new Error('AI proposal 没有可应用的 edits')
  }
  if (proposal.edits.length > bundle.writeScope.maxEdits) {
    throw new Error('AI proposal edits 超出当前 Write Scope 上限')
  }

  for (const [index, edit] of proposal.edits.entries()) {
    if (!Number.isInteger(edit.start) || !Number.isInteger(edit.end)) {
      throw new Error(`AI proposal edit ${index} range 必须使用整数 UTF-16 offset`)
    }
    if (edit.start < 0 || edit.end < edit.start || edit.end > source.authorSource.length) {
      throw new Error(`AI proposal edit ${index} range 超出当前 Author Source`)
    }
    if (!rangeInsideWriteScope(bundle, edit)) {
      throw new Error(`AI proposal edit ${index} 超出当前 Write Scope`)
    }
    if (typeof edit.expectedText !== 'string' || typeof edit.replacement !== 'string') {
      throw new Error(`AI proposal edit ${index} 文本字段非法`)
    }
    if (source.authorSource.slice(edit.start, edit.end) !== edit.expectedText) {
      throw new Error(`AI proposal edit ${index} expectedText 已失效`)
    }
  }
}

/**
 * Rebuild one exact Patch from a validated AI proposal after checking the current projection again.
 * Source persistence and component persistence both reuse this bridge; it owns no storage itself.
 */
export function createFrontendWorkshopValidatedSourceAiPatch(
  source: FrontendWorkshopSourceDocument,
  bundle: FrontendWorkshopSourceAiContextBundle,
  proposal: FrontendWorkshopSourceAiProposal,
): FrontendWorkshopSourcePatch {
  assertProposalCurrentAndApplicable(source, bundle, proposal)
  return {
    projectId: source.projectId,
    sourceRevision: source.revision,
    edits: proposal.edits.map((edit) => ({
      target: {
        confidence: 'exact',
        provenance: createFrontendWorkshopStaticSourceProvenance(source, {
          start: edit.start,
          end: edit.end,
        }),
      },
      expectedText: edit.expectedText,
      replacement: edit.replacement,
    })),
  }
}

/**
 * S7-A1 application bridge.
 *
 * The AI transport remains proposal-only. Application always re-reads the authoritative current
 * Source, revalidates Source lineage / revision / Write Scope / expectedText, rebuilds exact
 * static-source targets, then delegates the single atomic mutation to the existing S5
 * History -> Patch -> SourceDocument CAS chain. It owns no parallel Source, History or Undo state.
 */
export class FrontendWorkshopSourceAiApplicationService {
  private readonly sourceDocumentService: FrontendWorkshopSourceDocumentService
  private readonly sourceHistoryService: FrontendWorkshopSourceHistoryService

  constructor(
    sourceDocumentService: FrontendWorkshopSourceDocumentService,
    sourceHistoryService: FrontendWorkshopSourceHistoryService,
  ) {
    this.sourceDocumentService = sourceDocumentService
    this.sourceHistoryService = sourceHistoryService
  }

  async applyValidatedProposal(
    bundle: FrontendWorkshopSourceAiContextBundle,
    proposal: FrontendWorkshopSourceAiProposal,
    options: FrontendWorkshopSourceHistoryApplyOptions = {},
  ): Promise<FrontendWorkshopAppliedSourcePatch> {
    const current = await this.sourceDocumentService.get(bundle.projectId)
    if (!current) throw new Error(`AI proposal Source 不存在：${bundle.projectId}`)

    return this.sourceHistoryService.applyAndRecord(
      createFrontendWorkshopValidatedSourceAiPatch(current, bundle, proposal),
      {
        ...options,
        label: options.label ?? `AI：${proposal.summary}`,
      },
    )
  }

  projectValidatedCandidate(
    base: FrontendWorkshopSourceDocument,
    bundle: FrontendWorkshopSourceAiContextBundle,
    proposal: FrontendWorkshopSourceAiProposal,
  ): FrontendWorkshopSourceDocument {
    const patch = createFrontendWorkshopValidatedSourceAiPatch(base, bundle, proposal)
    return Object.freeze({
      ...base,
      authorSource: applyFrontendWorkshopSourcePatch(base, patch),
      origin: 'ai',
    })
  }

  /**
   * Materialize a validated branch candidate through one current-revision whole-source Patch.
   * The proposal is first revalidated against its immutable shared checkpoint base; the resulting
   * candidate is then compared with current authoritative Source and committed by History/CAS.
   */
  async applyValidatedProposalFromBase(
    base: FrontendWorkshopSourceDocument,
    expectedCurrent: FrontendWorkshopSourceDocument,
    bundle: FrontendWorkshopSourceAiContextBundle,
    proposal: FrontendWorkshopSourceAiProposal,
    options: FrontendWorkshopSourceHistoryApplyOptions = {},
  ): Promise<FrontendWorkshopAppliedSourcePatch | null> {
    const candidate = this.projectValidatedCandidate(base, bundle, proposal)
    const current = await this.sourceDocumentService.get(bundle.projectId)
    if (!current) throw new Error(`AI proposal Source 不存在：${bundle.projectId}`)
    if (current.createdAt !== base.createdAt) throw new Error('AI proposal Source lineage 已失效')
    if (
      current.createdAt !== expectedCurrent.createdAt ||
      current.revision !== expectedCurrent.revision ||
      current.authorSource !== expectedCurrent.authorSource
    ) {
      throw new Error('AI proposal 当前 Source 已变化，请重新生成后再写入')
    }
    if (current.authorSource === candidate.authorSource) {
      return null
    }

    const patch: FrontendWorkshopSourcePatch = {
      projectId: current.projectId,
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
          replacement: candidate.authorSource,
        },
      ],
    }
    return this.sourceHistoryService.applyAndRecord(patch, {
      ...options,
      label: options.label ?? `AI：${proposal.summary}`,
    })
  }
}
