import type { StoredResource, StoredResourceSummary } from './Vault'

export interface StagedArchiveRecord {
  resource: StoredResource
  listSummary: StoredResourceSummary
}

export interface RestoreStagingEntry {
  jobId: string
  path: string
  blob: Blob
  size: number
  sha256: string
  updatedAt: number
  /** Web and Native restore stage one protected record before the index transaction. */
  record?: StagedArchiveRecord
}

export type RestoreStagingMetadata = Omit<RestoreStagingEntry, 'blob'>

export interface RestoreStagingChunk {
  jobId: string
  path: string
  chunkIndex: number
  blob: Blob
  updatedAt: number
}
