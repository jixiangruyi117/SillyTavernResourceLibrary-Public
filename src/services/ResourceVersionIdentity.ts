import {
  RESOURCE_TYPE,
  type Resource,
  type ResourceReference,
  type ResourceType,
} from '../types/Resource'

export const LEGACY_VARIANT_TYPES: Record<string, ResourceType> = {
  sillyTavernPersonaBackup: RESOURCE_TYPE.USER_PERSONA,
  extensionManifest: RESOURCE_TYPE.PLUGIN,
  quickReplySet: RESOURCE_TYPE.QUICK_REPLY,
  regexScript: RESOURCE_TYPE.REGEX,
  regexPreset: RESOURCE_TYPE.REGEX,
  regexCollection: RESOURCE_TYPE.REGEX,
  theme: RESOURCE_TYPE.BEAUTIFICATION,
  worldBook: RESOURCE_TYPE.WORLD_BOOK,
  stscript: RESOURCE_TYPE.SCRIPT,
  generationPreset: RESOURCE_TYPE.PRESET,
  jsonObject: RESOURCE_TYPE.OTHER,
  jsonArray: RESOURCE_TYPE.OTHER,
}

export function readResourceType(value: unknown): ResourceType | undefined {
  return Object.values(RESOURCE_TYPE).includes(value as ResourceType)
    ? (value as ResourceType)
    : undefined
}

export function findManualTypeOverride(resource: Resource): ResourceType | undefined {
  const storedOverride = readResourceType(resource.metadata.manualTypeOverride)
  if (storedOverride) return storedOverride

  const variant =
    typeof resource.metadata.detectedVariant === 'string'
      ? resource.metadata.detectedVariant
      : undefined
  const formerDetectedType = variant ? LEGACY_VARIANT_TYPES[variant] : undefined
  return formerDetectedType && formerDetectedType !== resource.type ? resource.type : undefined
}

export function resourceLogicalVersionKey(resource: ResourceReference): string {
  const semanticHash =
    resource.type === RESOURCE_TYPE.CHARACTER_CARD &&
    typeof resource.metadata.cardContentHash === 'string'
      ? resource.metadata.cardContentHash
      : ''
  return semanticHash ? `card:${semanticHash}` : `file:${resource.id}`
}

export function countResourceLogicalVersions(resources: ResourceReference[]): number {
  return Math.max(1, new Set(resources.map(resourceLogicalVersionKey)).size)
}

export function resourceVersionLabel(resource: Resource): string {
  const explicit =
    typeof resource.metadata.characterVersion === 'string'
      ? resource.metadata.characterVersion.trim()
      : ''
  return explicit || resource.fileName.replace(/\.[^.]+$/u, '') || '未命名版本'
}
