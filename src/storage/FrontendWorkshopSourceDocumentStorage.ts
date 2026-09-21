import type {
  FrontendWorkshopSourceDocument,
  FrontendWorkshopSourceDocumentLastGoodRecord,
} from '../types/FrontendWorkshopSourceDocument'

export interface FrontendWorkshopSourceDocumentStorage {
  get(projectId: string): Promise<FrontendWorkshopSourceDocument | undefined>
  put(document: FrontendWorkshopSourceDocument): Promise<void>
  putAtomic(
    document: FrontendWorkshopSourceDocument,
    lastGood?: FrontendWorkshopSourceDocument,
  ): Promise<void>
  /**
   * Authoritative Source compare-and-swap. `expectedRevision === 0` is the create-if-absent contract:
   * the write succeeds only when no current Source exists. Positive revisions require the exact
   * current revision inside the same transaction that stores last_good + next current Source.
   */
  putAtomicIfRevision(
    document: FrontendWorkshopSourceDocument,
    expectedRevision: number,
  ): Promise<boolean>
  getLastGood(projectId: string): Promise<FrontendWorkshopSourceDocumentLastGoodRecord | undefined>
  delete(projectId: string): Promise<void>
}
