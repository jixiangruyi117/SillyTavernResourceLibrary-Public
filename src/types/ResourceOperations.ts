import { type Resource } from './Resource'

export interface ImportOptions {
  extractCharacterAssets?: boolean
  detectVersions?: boolean
}

export interface PreparedFileImportOptions {
  allowContentDuplicate?: boolean
}

export interface ResourceVersionView {
  resource: Resource
  active: boolean
  /** 同一个语义版本下保存的 JSON、PNG 与自定义卡面封装。 */
  carriers?: Resource[]
}

export interface CharacterAssetExtractionReport {
  selectedCount: number
  characterCount: number
  presetCount: number
  assetCount: number
  createdCount: number
}

export interface ExternalAppResourceUpdate {
  resourceId: string
  name?: string
  description?: string
  tags?: string[]
  favorite?: boolean
  categoryIds?: string[]
}

export interface AiTagMutationEntry {
  resourceId: string
  resourceName: string
  tags: string[]
}

export interface AiTagMutationResult {
  resourceCount: number
  tagCount: number
  entries: AiTagMutationEntry[]
}
