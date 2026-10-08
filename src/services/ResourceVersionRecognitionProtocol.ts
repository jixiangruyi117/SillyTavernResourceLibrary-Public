import {
  buildStoredVersionRecognitionReport,
  findStoredVersionGroups,
  type StoredVersionRecognitionGroup,
  type StoredVersionRecognitionReport,
  type VersionMatchOptions,
} from './ResourceVersionMatcher'
import type { ResourceSummary } from '../types/Resource'

export interface VersionRecognitionResult {
  groups: StoredVersionRecognitionGroup[]
  report: StoredVersionRecognitionReport
}
export interface VersionRecognitionWorkerResult {
  groups: (Omit<StoredVersionRecognitionGroup, 'resources'> & { resourceIds: string[] })[]
  report: StoredVersionRecognitionReport
}
export interface VersionRecognitionWorkerRequest {
  resources: ResourceSummary[]
  versions: ResourceSummary[]
  options: VersionMatchOptions
}

/** Transfer only matching fields. Card bodies, thumbnails and original Blobs stay out of the Worker. */
export function toVersionRecognitionSummary(resource: ResourceSummary): ResourceSummary {
  const identity = (value: unknown): Record<string, unknown> => {
    const output: Record<string, unknown> = {}
    if (!value || typeof value !== 'object' || Array.isArray(value)) return output
    const record = value as Record<string, unknown>
    for (const key of ['uuid', 'character_id', 'characterId', 'source_id', 'sourceId', 'source'])
      if (typeof record[key] === 'string') output[key] = record[key]
    return output
  }
  const card = resource.metadata.card as Record<string, unknown> | undefined
  return {
    id: resource.id,
    type: resource.type,
    name: resource.name,
    description: '',
    fileName: resource.fileName,
    mimeType: resource.mimeType,
    fileSize: resource.fileSize,
    contentHash: resource.contentHash,
    createdAt: resource.createdAt,
    updatedAt: resource.updatedAt,
    versionGroupId: resource.versionGroupId,
    favorite: false,
    categoryId: null,
    tags: [],
    metadata: {
      ...identity(resource.metadata),
      cardContentHash: resource.metadata.cardContentHash,
      cardCoreHash: resource.metadata.cardCoreHash,
      card: { ...identity(card), data: identity(card?.data) },
    },
  }
}

/** Both the Worker and the capability fallback execute the same matching owner. */
export function scanVersionRecognition(
  request: VersionRecognitionWorkerRequest,
): VersionRecognitionWorkerResult {
  const groups = findStoredVersionGroups(request.resources, request.versions, request.options)
  return {
    groups: groups.map(({ resources, ...group }) => ({
      ...group,
      resourceIds: resources.map((resource) => resource.id),
    })),
    report: buildStoredVersionRecognitionReport(request.resources, request.versions, groups),
  }
}
