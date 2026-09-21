import type { FrontendWorkshopSourceDocument } from '../types/FrontendWorkshopSourceDocument'
import {
  prepareFrontendWorkshopSourcePatch,
  type FrontendWorkshopSourcePatch,
  type FrontendWorkshopSourcePatchChange,
} from '../utils/FrontendWorkshopSourcePatch'
import {
  FrontendWorkshopSourceDocumentService,
  FrontendWorkshopSourceRevisionConflictError,
  type FrontendWorkshopSourceRevisionSaveOptions,
} from './FrontendWorkshopSourceDocumentService'

export interface FrontendWorkshopSourcePatchReceipt {
  projectId: string
  fromRevision: number
  toRevision: number
  changes: readonly FrontendWorkshopSourcePatchChange[]
}

export interface FrontendWorkshopAppliedSourcePatch {
  document: FrontendWorkshopSourceDocument
  receipt: FrontendWorkshopSourcePatchReceipt
}

function assertPatchRequest(patch: FrontendWorkshopSourcePatch): void {
  if (!patch.projectId) throw new Error('Source Patch 缺少 projectId')
  if (!Number.isInteger(patch.sourceRevision) || patch.sourceRevision < 1) {
    throw new Error('Source Patch sourceRevision 必须是正整数')
  }
}

/**
 * S5 Patch transaction coordinator.
 *
 * Patch validation/composition is pure and happens against one current Source snapshot. Persistence
 * remains a single S4 revision-CAS write, so a multi-range Patch can only advance Source once and
 * can never partially commit individual edits. A race after the initial read is still rejected by
 * the authoritative storage CAS inside SourceDocumentService.
 */
export class FrontendWorkshopSourcePatchService {
  private readonly sourceDocumentService: FrontendWorkshopSourceDocumentService

  constructor(sourceDocumentService: FrontendWorkshopSourceDocumentService) {
    this.sourceDocumentService = sourceDocumentService
  }

  async applyWithReceiptAtRevision(
    patch: FrontendWorkshopSourcePatch,
    options: FrontendWorkshopSourceRevisionSaveOptions = {},
  ): Promise<FrontendWorkshopAppliedSourcePatch> {
    assertPatchRequest(patch)
    const current = await this.sourceDocumentService.get(patch.projectId)
    if (!current || current.revision !== patch.sourceRevision) {
      throw new FrontendWorkshopSourceRevisionConflictError(
        patch.projectId,
        patch.sourceRevision,
        current?.revision,
      )
    }

    const prepared = prepareFrontendWorkshopSourcePatch(current, patch)
    const document = await this.sourceDocumentService.saveAuthorSourceAtRevision(
      patch.projectId,
      patch.sourceRevision,
      prepared.authorSource,
      options,
    )
    return {
      document,
      receipt: {
        projectId: patch.projectId,
        fromRevision: patch.sourceRevision,
        toRevision: document.revision,
        changes: prepared.changes,
      },
    }
  }

  async applyAtRevision(
    patch: FrontendWorkshopSourcePatch,
    options: FrontendWorkshopSourceRevisionSaveOptions = {},
  ): Promise<FrontendWorkshopSourceDocument> {
    return (await this.applyWithReceiptAtRevision(patch, options)).document
  }
}
