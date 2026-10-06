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

/** IndexedDB stores byte buffers instead of Blob handles for WebKit reliability. */
export interface StoredRestoreStagingChunk {
  jobId: string
  path: string
  chunkIndex: number
  data?: ArrayBuffer
  /** Legacy temporary records from interrupted imports before byte-buffer staging. */
  blob?: Blob
  updatedAt: number
}
