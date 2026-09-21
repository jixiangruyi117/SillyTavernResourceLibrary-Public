export const FRONTEND_WORKSHOP_SOURCE_DOCUMENT_VERSION = 1 as const

export type FrontendWorkshopSourceHostProfile = 'tavern-helper-message'

export type FrontendWorkshopSourceOrigin = 'new' | 'imported' | 'ai'

/**
 * FrontendWorkshop Author Source truth.
 *
 * `authorSource` must be persisted verbatim: no trim, slice, formatting or parse/rebuild pass.
 * TavernHelper generated iframe / html / head / body scaffolding is runtime materialization, not truth.
 */
export interface FrontendWorkshopSourceDocument {
  version: typeof FRONTEND_WORKSHOP_SOURCE_DOCUMENT_VERSION
  projectId: string
  hostProfile: FrontendWorkshopSourceHostProfile
  authorSource: string
  origin: FrontendWorkshopSourceOrigin
  revision: number
  createdAt: number
  updatedAt: number
}

/** Last verbatim snapshot kept before overwriting current Source. */
export interface FrontendWorkshopSourceDocumentLastGoodRecord {
  projectId: string
  document: FrontendWorkshopSourceDocument
  savedAt: number
}

export function createFrontendWorkshopSourceDocument(
  projectId: string,
  authorSource = '',
  now = Date.now(),
  origin: FrontendWorkshopSourceOrigin = 'new',
  hostProfile: FrontendWorkshopSourceHostProfile = 'tavern-helper-message',
): FrontendWorkshopSourceDocument {
  return {
    version: FRONTEND_WORKSHOP_SOURCE_DOCUMENT_VERSION,
    projectId,
    hostProfile,
    authorSource,
    origin,
    revision: 1,
    createdAt: now,
    updatedAt: now,
  }
}
