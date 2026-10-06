// LEGACY-REQUIRED: status-only draft/history contracts; modern Source projects do not use these.
import type { MainApiTokenUsage, MainApiContentPart } from '../services/MainApiService'
import type {
  FrontendWorkshopArtifact,
  StatusField,
  WorkshopBlock,
  WorkshopDataMode,
  WorkshopDesignTokens,
  WorkshopConditionRule,
  WorkshopGenerationOptions,
  WorkshopInteraction,
  WorkshopLayoutReference,
  WorkshopPromptCustomizations,
  WorkshopPromptInjectionEnabled,
  WorkshopTargetSize,
} from '../utils/FrontendWorkshop'

export interface WorkshopVersion {
  id: string
  parentVersionId?: string
  createdAt: number
  source: string
  style: string
  refinement: string
  titleTypography?: TypographyPreset
  bodyTypography?: TypographyPreset
  referenceScopes?: ReferenceScope[]
  lockedAspects?: LockedAspect[]
  blocks?: WorkshopBlock[]
  imageUrls?: string[]
  palette?: WorkshopPalette
  titleFontUrl?: string
  bodyFontUrl?: string
  customTextStyles?: CustomTextStyle[]
  layoutReference?: WorkshopLayoutReference
  targetSize?: WorkshopTargetSize
  designTokens?: WorkshopDesignTokens
  conditionRules?: WorkshopConditionRule[]
  promptCustomizations?: WorkshopPromptCustomizations
  promptInjectionEnabled?: WorkshopPromptInjectionEnabled
  promptSnapshot?: WorkshopPromptSnapshot
  reviewPromptSnapshot?: WorkshopPromptSnapshot
  reviewSuggestions?: WorkshopReviewSuggestion[]
  tokenUsage?: WorkshopGenerationTokenUsage
  artifact: FrontendWorkshopArtifact
}

export interface WorkshopChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  createdAt: number
  versionId?: string
}

export interface WorkshopPromptSnapshot {
  createdAt: number
  messages: Array<{
    role: 'system' | 'user'
    content: string
    originalContent?: string
    label: string
  }>
  referenceImageNames?: string[]
}

export type WorkshopReviewCategory =
  'interaction' | 'motion' | 'layout' | 'color' | 'content' | 'accessibility' | 'other'

export interface WorkshopReviewSuggestion {
  id: string
  category: WorkshopReviewCategory
  title: string
  detail: string
  selected: boolean
}

export interface WorkshopGenerationTokenUsage extends MainApiTokenUsage {
  requests: number
}

export interface WorkshopGenerationFailure {
  title: string
  detail: string
  hint: string
  apiLabel: string
}

export interface WorkshopManualRepair {
  response: string
  issues: string
  generationOptions: WorkshopGenerationOptions
  isRefinement: boolean
  promptSnapshot: WorkshopPromptSnapshot
  tokenUsage: WorkshopGenerationTokenUsage
  error?: string
}

export interface WorkshopDraft {
  id: string
  name: string
  updatedAt: number
  activeStep?: WorkshopStep
  activeDesignPanel?: DesignPanel
  source: string
  style: string
  sample?: string
  dataMode: WorkshopDataMode
  interactions: WorkshopInteraction[]
  refinement: string
  referenceGuidance: string
  referenceScopes?: ReferenceScope[]
  titleTypography?: TypographyPreset
  bodyTypography?: TypographyPreset
  lockedAspects?: LockedAspect[]
  blocks?: WorkshopBlock[]
  imageUrls?: string[]
  importedPalettes?: WorkshopPalette[]
  activePaletteId?: string
  titleFontUrl?: string
  bodyFontUrl?: string
  customTextStyles?: CustomTextStyle[]
  layoutReference?: WorkshopLayoutReference
  targetSize?: WorkshopTargetSize
  designTokens?: WorkshopDesignTokens
  conditionRules?: WorkshopConditionRule[]
  promptCustomizations?: WorkshopPromptCustomizations
  promptInjectionEnabled?: WorkshopPromptInjectionEnabled
  reviewSuggestions?: WorkshopReviewSuggestion[]
  versions: WorkshopVersion[]
  currentIndex: number
  conversation: WorkshopChatMessage[]
  fieldInputMode?: FieldInputMode
  excludedConversationVersionIds?: string[]
}

export interface WorkshopReferenceImage {
  id: string
  name: string
  dataUrl: string
}

export interface WorkshopInspectTarget {
  id: string
  label: string
}

export interface WorkshopPalette {
  id: string
  name: string
  colors: string[]
  source: 'classic' | 'imported'
}

export interface CustomTextStyle {
  id: string
  label: string
  typography: TypographyPreset
  fontUrl: string
}

export type WorkshopStep = 'design' | 'proof' | 'delivery'

export type DesignPanel = 'content' | 'appearance' | 'generate'

export type FieldInputMode = 'text' | 'visual'

export type ReferenceScope =
  'color' | 'structure' | 'typography' | 'material' | 'spacing' | 'motion'

export type TypographyPreset = 'auto' | 'song' | 'hei' | 'kai' | 'rounded' | 'mono' | 'custom'

export type LockedAspect = 'layout' | 'colors' | 'typography' | 'field-order'

export type TargetSizePreset =
  'auto' | 'banner' | 'card' | 'wide-card' | 'long-panel' | 'desktop-wide' | 'custom'

export type WorkshopPreviewWidth = 'phone320' | 'phone390' | 'desktop' | 'fit'

export interface WorkshopGenerationRequest {
  fields: StatusField[]
  generationOptions: WorkshopGenerationOptions
  systemPrompt: string
  userPrompt: string
  userContent: string | MainApiContentPart[]
}
