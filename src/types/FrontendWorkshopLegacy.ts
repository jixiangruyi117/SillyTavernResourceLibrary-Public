export interface StatusField {
  label: string
  example: string
  group: string
  kind: 'text' | 'number' | 'percent' | 'tags' | 'longText'
  path: string
}

export type WorkshopDataMode = 'reply' | 'mvu'

export type WorkshopInteraction = 'collapsible' | 'motion' | 'theme-toggle' | 'tabs'

export type WorkshopMaterial =
  | 'auto'
  | 'solid'
  | 'glass'
  | 'acrylic'
  | 'paper'
  | 'enamel'
  | 'metal'
  | 'embossed-metal'
  | 'holographic'

export type WorkshopShadow = 'none' | 'soft' | 'layered' | 'dramatic'

export type WorkshopBorder = 'none' | 'hairline' | 'double' | 'glow'

export type WorkshopDensity = 'compact' | 'balanced' | 'airy'

export type WorkshopBlock =
  | 'character-header'
  | 'attribute-grid'
  | 'relationship-card'
  | 'inventory'
  | 'quest-timeline'
  | 'character-tabs'
  | 'long-collapse'
  | 'image-banner'

export interface WorkshopTextStyleRequirement {
  id: string
  label: string
}

export interface WorkshopDesignTokens {
  material: WorkshopMaterial
  shadow: WorkshopShadow
  border: WorkshopBorder
  density: WorkshopDensity
}

export interface WorkshopPromptCustomizations {
  material: string
  conditions: string
  blocks: string
}

export interface WorkshopPromptInjectionEnabled {
  material: boolean
  conditions: boolean
  blocks: boolean
}

export type WorkshopConditionOperator = 'gt' | 'gte' | 'lt' | 'lte' | 'eq' | 'neq' | 'contains'

export interface WorkshopConditionRule {
  id: string
  fieldPath: string
  fieldLabel: string
  operator: WorkshopConditionOperator
  value: string
  color: string
  background: string
}

export interface WorkshopLayoutItem {
  id: string
  kind: 'field' | 'image'
  source: string
  label: string
  x: number
  y: number
  width: number
  height: number
  zIndex: number
  locked?: boolean
  groupId?: string
}

export interface WorkshopLayoutViewport {
  canvasWidth: number
  canvasHeight: number
  items: WorkshopLayoutItem[]
}

export interface WorkshopLayoutReference extends WorkshopLayoutViewport {
  desktop?: WorkshopLayoutViewport
}

export interface WorkshopTargetSize {
  width: number
  height: number
}

export interface WorkshopGenerationOptions {
  dataMode: WorkshopDataMode
  interactions: WorkshopInteraction[]
  blocks?: WorkshopBlock[]
  imageUrls?: string[]
  fontUrls?: string[]
  textStyles?: WorkshopTextStyleRequirement[]
  paletteName?: string
  paletteColors?: string[]
  layoutReference?: WorkshopLayoutReference
  targetSize?: WorkshopTargetSize
  designTokens?: Partial<WorkshopDesignTokens>
  conditionRules?: WorkshopConditionRule[]
  promptCustomizations?: Partial<WorkshopPromptCustomizations>
  promptInjectionEnabled?: Partial<WorkshopPromptInjectionEnabled>
  textureRequired?: boolean
}

export interface TavernRegexArtifact {
  id: string
  scriptName: string
  findRegex: string
  replaceString: string
  trimStrings: string[]
  placement: number[]
  disabled: boolean
  markdownOnly: boolean
  promptOnly: boolean
  runOnEdit: boolean
  substituteRegex: number
  minDepth: null
  maxDepth: null
}

export interface FrontendWorkshopArtifact {
  title: string
  fields: StatusField[]
  prompt: string
  sampleOutput: string
  regex: TavernRegexArtifact
  styleNote: string
  dataMode: WorkshopDataMode
  interactions: WorkshopInteraction[]
  blocks: WorkshopBlock[]
  imageUrls: string[]
  fontUrls?: string[]
  textStyles?: WorkshopTextStyleRequirement[]
  palette?: {
    name: string
    colors: string[]
  }
  layoutReference?: WorkshopLayoutReference
  targetSize?: WorkshopTargetSize
  designTokens?: WorkshopDesignTokens
  conditionRules?: WorkshopConditionRule[]
  htmlTemplate: string
  compatibility: {
    levelLabel: string
    dataLabel: string
    persistenceLabel: string
    dependencies: string[]
    verificationNote: string
  }
}

export interface WorkshopWorldbookArtifact {
  entries: Record<string, Record<string, unknown>>
}

export type NormalizedWorkshopGenerationOptions = Omit<
  Required<WorkshopGenerationOptions>,
  'targetSize' | 'designTokens' | 'promptCustomizations'
> & {
  targetSize?: WorkshopTargetSize
  designTokens: WorkshopDesignTokens
  promptCustomizations: WorkshopPromptCustomizations
  promptInjectionEnabled: WorkshopPromptInjectionEnabled
}

export interface WorkshopCssNode {
  type?: string
  selectors?: string[]
  rules?: WorkshopCssNode[]
  stylesheet?: {
    rules?: WorkshopCssNode[]
  }
}

export interface WorkshopSampleIssue {
  severity: 'warning' | 'error'
  message: string
}

export interface WorkshopStressCase {
  id: 'long-values' | 'missing-field' | 'type-error'
  label: string
  sample: string
}

export interface WorkshopMvuTurn {
  turn: number
  label: string
  changedFields: string[]
  sample: string
}
