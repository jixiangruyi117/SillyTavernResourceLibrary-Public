import type { Resource, ResourceSummary, ResourceType } from './Resource'

export type VersionMatchKind = 'contentDuplicate' | 'containerVariant' | 'version' | 'heuristic'

export interface ParsedResource {
  type: ResourceType
  name: string
  description: string
  tags?: string[]
  metadata: Record<string, unknown>
  thumbnailBlob?: Blob
}

export interface ImportSuccess {
  status: 'imported'
  fileName: string
  resource: Resource
  extractedResources?: Resource[]
}

export interface ImportDuplicate {
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
  status: 'versionCandidate'
  fileName: string
  file: File
  candidates: Array<{
    resource: ResourceSummary
    matchedResource: ResourceSummary
    matchedHistorical: boolean
    matchKind: VersionMatchKind
    score: number
    reasons: string[]
  }>
}

export type ImportResult = ImportSuccess | ImportDuplicate | ImportFailure | ImportVersionCandidate
