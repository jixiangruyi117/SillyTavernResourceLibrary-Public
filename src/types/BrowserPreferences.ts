import type { UserPersonaTemplate } from './UserPersona'
import type { PresetFavoriteSnapshot } from '../utils/PresetStitcher'
export const LAYOUT_MODES = ['grid', 'list', 'split'] as const

export const UI_FONT_SCALES = ['small', 'standard', 'large'] as const

export const CABINET_COLUMN_OPTIONS = [2, 3, 4] as const

export interface PresetStitchTemplate {
  id: string
  name: string
  entries: PresetFavoriteSnapshot[]
  createdAt: number
  updatedAt: number
}

export interface ChatLoadout {
  id: string
  name: string
  primaryResourceId: string
  resourceIds: string[]
  createdAt: number
  updatedAt: number
}

export type ResourceBundleTemplate = ChatLoadout

export interface StorageHealth {
  supported: boolean
  persisted: boolean
  usage: number
  quota: number
}

export type LayoutMode = (typeof LAYOUT_MODES)[number]

export type UiFontScale = (typeof UI_FONT_SCALES)[number]

export type CabinetColumns = (typeof CABINET_COLUMN_OPTIONS)[number]

export interface PreviewPolicy {
  allowRemoteResources: boolean
  allowScripts: boolean
  preloadGreetingResources?: boolean
  preloadBeautificationResources?: boolean
}

export type CustomCssScope =
  | `app:${string}`
  | 'library'
  | 'details'
  | 'features'
  | 'draw'
  | 'cabinet'
  | 'appearance'
  | 'cloud'
  | 'bridge'
  | 'stitch'
  | 'frontend'
  | 'persona'
  | 'settings'

export interface CustomCssPreset {
  id: string
  name: string
  globalCss: string
  scopedCss: Partial<Record<CustomCssScope, string>>
  createdAt: string
  updatedAt: string
}

export interface PortableAppearanceSettings {
  theme: 'light' | 'dark'
  layoutMode: LayoutMode
  fontScale?: UiFontScale
  customCss: string
  presets: CustomCssPreset[]
  activePresetId: string
}

export interface PortableGeneralPreferences {
  previewPolicy: PreviewPolicy
  extractCharacterAssets: boolean
  hideCharacterAssets: boolean
  showManuallyBoundResources?: boolean
  searchHistory: string[]
  blurThumbnails?: boolean
  historySnapshotLimit?: number
  cabinetResourceIds?: string[]
  cabinetLayout?: CabinetLayoutEntry[]
  cabinetColumns?: CabinetColumns
  userPersonaTemplates?: UserPersonaTemplate[]
  stitchFavorites?: PresetFavoriteSnapshot[]
  stitchTemplates?: PresetStitchTemplate[]
  stitchMainSide?: 'left' | 'right'
  frontendWorkshopRecentColors?: string[]
  chatLoadouts?: ChatLoadout[]
  /** @deprecated 旧版导出字段，导入时迁移为 chatLoadouts。 */
  resourceBundles?: ResourceBundleTemplate[]
}

export interface CabinetLayoutEntry {
  kind: 'folder' | 'resource'
  id: string
  slot: number
  columnSpan: 1 | 2 | 4
  rowSpan: 1 | 2
}

export interface PresetStitchDraftEntry {
  origin: 'base' | 'pick'
  identifier: string
  enabled: boolean
  sourceResourceId?: string
  sourceName?: string
  favoriteId?: string
  name?: string
  role?: string
  content?: string
  prompt?: Record<string, unknown>
}

export interface PresetStitchDraft {
  baseId: string
  name: string
  savedAt: number
  entries: PresetStitchDraftEntry[]
  regexPickIds: string[]
  mainSide?: 'left' | 'right'
  sourceEdits?: Array<{
    sourceResourceId: string
    identifier: string
    name: string
    role: string
    content: string
  }>
  saveAsVersion?: boolean
  versionNote?: string
  candidates?: PresetFavoriteSnapshot[]
}

export interface ProjectNoticeStoragePlugin {
  getAcknowledgedVersion(): Promise<{ version?: string }>
  setAcknowledgedVersion(options: { version: string }): Promise<unknown>
}
