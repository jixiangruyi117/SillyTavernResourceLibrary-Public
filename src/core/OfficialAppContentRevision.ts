import type { OfficialAppId } from '../types/OfficialApp.js'

/**
 * Increment only the APPs whose user-facing behavior or APP-owned resources changed.
 * Shell rebuilds and generated file hashes do not change these revisions.
 */
export const OFFICIAL_APP_CONTENT_REVISIONS: Record<OfficialAppId, number> = {
  chatReader: 1,
  draw: 1,
  stitch: 12,
  frontendWorkshop: 5,
  imageGeneration: 3,
  imageAlbum: 1,
  userPersona: 5,
  resourceBundle: 1,
  tavernBridge: 1,
}

/** Existing installed records predate explicit revisions and start at the migration baseline. */
export const LEGACY_OFFICIAL_APP_CONTENT_REVISION = 1
