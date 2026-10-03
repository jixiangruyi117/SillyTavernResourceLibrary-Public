import type { Resource, ResourceSummary, ResourceType } from './Resource'

export type VersionMatchKind =
  'contentDuplicate' | 'containerVariant' | 'version' | 'heuristic' | 'sameName'

export interface ParsedResource {
  type: ResourceType
  name: string
  description: string
  tags?: string[]
  metadata: Record<string, unknown>
  thumbnailBlob?: Blob
}

export interface ImportSuccess {
  sourceContentHash?: string
  status: 'imported'
  fileName: string
  resource: Resource
  extractedResources?: Resource[]
}

export interface ImportDuplicate {
  sourceContentHash?: string
  status: 'duplicate'
  fileName: string
  message: string
  resource: Resource
  reclassified: boolean
  extractedResources?: Resource[]
}

export interface ImportFailure {
  status: 'failed'
  fileName: string
  message: string
}

export interface ImportVersionCandidate {
  onResolved?: (committedHash?: string) => Promise<void>
  sourceContentHash?: string
  status: 'versionCandidate'
  fileName: string
  file: File
  shareRecoveryId?: string
  candidates: Array<{
    resource: ResourceSummary
    matchedResource: ResourceSummary
    matchedHistorical: boolean
    matchKind: VersionMatchKind
    score: number
    reasons: string[]
  }>
}

export interface ImportVersionComparison {
  incoming: Resource
  existing: Resource
  score: number
  reasons: string[]
  matchedHistorical: boolean
}

export type ImportResult = ImportSuccess | ImportDuplicate | ImportFailure | ImportVersionCandidate
