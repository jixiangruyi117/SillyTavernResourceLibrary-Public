import { RESOURCE_TYPE, type Resource, type ResourceType } from '../types/Resource'

export type ResourceInspectorSection = 'overview' | 'content' | 'relations' | 'versions' | 'file'
export type ResourceInspectorAction =
  'download' | 'edit' | 'preview' | 'replaceArtwork' | 'compareVersions'
export type ResourcePreviewKind = 'character' | 'structured' | 'text' | 'archive'
export type ResourceDiffRenderer = 'character' | 'json' | 'text' | 'binary'

export interface ResourceInspectorDescriptor {
  type: ResourceType
  sections: readonly ResourceInspectorSection[]
  actions: readonly ResourceInspectorAction[]
  preview: ResourcePreviewKind
  diffRenderer: ResourceDiffRenderer
  validate(resource: Pick<Resource, 'name' | 'fileName' | 'mimeType' | 'originalBlob'>): string[]
}

const BASE_SECTIONS: readonly ResourceInspectorSection[] = [
  'overview',
  'content',
  'relations',
  'versions',
  'file',
]
const BASE_ACTIONS: readonly ResourceInspectorAction[] = ['download', 'edit', 'compareVersions']

function commonValidation(
  resource: Pick<Resource, 'name' | 'fileName' | 'mimeType' | 'originalBlob'>,
): string[] {
  const issues: string[] = []
  if (!resource.name.trim()) issues.push('资源名称不能为空')
  if (!resource.fileName.trim()) issues.push('原始文件名不能为空')
  if (!resource.mimeType.trim()) issues.push('资源缺少 MIME 类型')
  if (resource.originalBlob.size === 0) issues.push('原始文件为空')
  return issues
}

function descriptor(
  type: ResourceType,
  options: Pick<ResourceInspectorDescriptor, 'actions' | 'preview' | 'diffRenderer'>,
): ResourceInspectorDescriptor {
  return { type, sections: BASE_SECTIONS, validate: commonValidation, ...options }
}

const REGISTRY: Record<ResourceType, ResourceInspectorDescriptor> = {
  [RESOURCE_TYPE.CHAT]: descriptor(RESOURCE_TYPE.CHAT, {
    actions: BASE_ACTIONS,
    preview: 'text',
    diffRenderer: 'text',
  }),
  [RESOURCE_TYPE.GREETING]: descriptor(RESOURCE_TYPE.GREETING, {
    actions: BASE_ACTIONS,
    preview: 'structured',
    diffRenderer: 'json',
  }),
  [RESOURCE_TYPE.CHARACTER_CARD]: descriptor(RESOURCE_TYPE.CHARACTER_CARD, {
    actions: [...BASE_ACTIONS, 'preview', 'replaceArtwork'],
    preview: 'character',
    diffRenderer: 'character',
  }),
  [RESOURCE_TYPE.USER_PERSONA]: descriptor(RESOURCE_TYPE.USER_PERSONA, {
    actions: BASE_ACTIONS,
    preview: 'structured',
    diffRenderer: 'json',
  }),
  [RESOURCE_TYPE.WORLD_BOOK]: descriptor(RESOURCE_TYPE.WORLD_BOOK, {
    actions: [...BASE_ACTIONS, 'preview'],
    preview: 'structured',
    diffRenderer: 'json',
  }),
  [RESOURCE_TYPE.BEAUTIFICATION]: descriptor(RESOURCE_TYPE.BEAUTIFICATION, {
    actions: [...BASE_ACTIONS, 'preview'],
    preview: 'text',
    diffRenderer: 'text',
  }),
  [RESOURCE_TYPE.REGEX]: descriptor(RESOURCE_TYPE.REGEX, {
    actions: [...BASE_ACTIONS, 'preview'],
    preview: 'structured',
    diffRenderer: 'json',
  }),
  [RESOURCE_TYPE.PRESET]: descriptor(RESOURCE_TYPE.PRESET, {
    actions: BASE_ACTIONS,
    preview: 'structured',
    diffRenderer: 'json',
  }),
  [RESOURCE_TYPE.QUICK_REPLY]: descriptor(RESOURCE_TYPE.QUICK_REPLY, {
    actions: BASE_ACTIONS,
    preview: 'structured',
    diffRenderer: 'json',
  }),
  [RESOURCE_TYPE.SCRIPT]: descriptor(RESOURCE_TYPE.SCRIPT, {
    actions: BASE_ACTIONS,
    preview: 'text',
    diffRenderer: 'text',
  }),
  [RESOURCE_TYPE.PLUGIN]: descriptor(RESOURCE_TYPE.PLUGIN, {
    actions: BASE_ACTIONS,
    preview: 'archive',
    diffRenderer: 'json',
  }),
  [RESOURCE_TYPE.EXTRA_STORY]: descriptor(RESOURCE_TYPE.EXTRA_STORY, {
    actions: BASE_ACTIONS,
    preview: 'text',
    diffRenderer: 'json',
  }),
  [RESOURCE_TYPE.POCKET_PHONE]: descriptor(RESOURCE_TYPE.POCKET_PHONE, {
    actions: BASE_ACTIONS,
    preview: 'archive',
    diffRenderer: 'binary',
  }),
  [RESOURCE_TYPE.SECRET]: descriptor(RESOURCE_TYPE.SECRET, {
    actions: BASE_ACTIONS,
    preview: 'structured',
    diffRenderer: 'json',
  }),
  [RESOURCE_TYPE.OTHER]: descriptor(RESOURCE_TYPE.OTHER, {
    actions: BASE_ACTIONS,
    preview: 'archive',
    diffRenderer: 'binary',
  }),
}

export function getResourceInspector(type: ResourceType): ResourceInspectorDescriptor {
  return REGISTRY[type]
}

export function listResourceInspectors(): readonly ResourceInspectorDescriptor[] {
  return Object.values(REGISTRY)
}
