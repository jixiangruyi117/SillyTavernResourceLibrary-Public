export const FRONTEND_WORKSHOP_SOURCE_COMPONENT_SCHEMA_VERSION = 1 as const

export type FrontendWorkshopSourceComponentOrigin =
  'project-selection' | 'imported' | 'ai' | 'manual' | 'derived'

export interface FrontendWorkshopSourceComponentSource {
  /** 原样保存，不做 trim、格式化或 parse/rebuild。 */
  html: string
  /** 原样保存；空字符串表示该组件没有独立样式片段。 */
  css: string
  /** 原样保存；空字符串表示该组件没有独立脚本片段。 */
  javascript: string
}

export interface FrontendWorkshopSourceComponentRoot {
  tagName: string
  selector?: string
}

export interface FrontendWorkshopSourceComponentDependency {
  kind: 'external-resource' | 'host-api' | 'component'
  specifier: string
  optional?: boolean
}

export interface FrontendWorkshopSourceComponentRuntimeRequirements {
  hostProfile: 'tavern-helper-message'
  requiresJavaScript: boolean
  requiresNetwork: boolean
  hostApis: string[]
}

export interface FrontendWorkshopSourceComponentProvenance {
  origin: FrontendWorkshopSourceComponentOrigin
  sourceComponentId?: string
  projectId?: string
  sourceRevision?: number
  sourceRange?: { start: number; end: number }
}

export interface FrontendWorkshopSourceComponentSharePolicy {
  license: 'unspecified' | 'private' | 'cc0' | 'cc-by-4.0' | 'mit' | 'custom'
  allowShare: boolean
  allowDerivatives: boolean
  notice?: string
}

export interface FrontendWorkshopSourceComponentPreview {
  viewportWidth: number
  colorScheme: 'auto' | 'light' | 'dark'
}

/**
 * Source Component 真源。HTML/CSS/JavaScript 原样保存；项目收录关系使用 projectIds 单独维护。
 * 组件资源只允许通过 dependencies 中的 HTTPS external-resource 声明，不再保存本地 blob/AssetStore 引用。
 */
export interface FrontendWorkshopSourceComponent {
  schemaVersion: typeof FRONTEND_WORKSHOP_SOURCE_COMPONENT_SCHEMA_VERSION
  id: string
  revision: number
  name: string
  description: string
  tags: string[]
  source: FrontendWorkshopSourceComponentSource
  root: FrontendWorkshopSourceComponentRoot
  dependencies: FrontendWorkshopSourceComponentDependency[]
  runtimeRequirements: FrontendWorkshopSourceComponentRuntimeRequirements
  provenance: FrontendWorkshopSourceComponentProvenance
  sharePolicy: FrontendWorkshopSourceComponentSharePolicy
  preview: FrontendWorkshopSourceComponentPreview
  /** 本地项目收录关系；只用于“当前组件”和快速添加，不属于可移植 Source 内容。 */
  projectIds: string[]
  createdAt: number
  updatedAt: number
}

export interface FrontendWorkshopSourceComponentDraft {
  name: string
  description?: string
  tags?: string[]
  source: FrontendWorkshopSourceComponentSource
  root: FrontendWorkshopSourceComponentRoot
  dependencies?: FrontendWorkshopSourceComponentDependency[]
  runtimeRequirements?: Partial<FrontendWorkshopSourceComponentRuntimeRequirements>
  provenance: FrontendWorkshopSourceComponentProvenance
  sharePolicy?: Partial<FrontendWorkshopSourceComponentSharePolicy>
  preview?: Partial<FrontendWorkshopSourceComponentPreview>
  projectIds?: string[]
}

export function createFrontendWorkshopSourceComponent(
  draft: FrontendWorkshopSourceComponentDraft,
  id: string = crypto.randomUUID(),
  now = Date.now(),
): FrontendWorkshopSourceComponent {
  return {
    schemaVersion: FRONTEND_WORKSHOP_SOURCE_COMPONENT_SCHEMA_VERSION,
    id,
    revision: 1,
    name: draft.name,
    description: draft.description ?? '',
    tags: [...(draft.tags ?? [])],
    source: { ...draft.source },
    root: { ...draft.root },
    dependencies: (draft.dependencies ?? []).map((item) => ({ ...item })),
    runtimeRequirements: {
      hostProfile: draft.runtimeRequirements?.hostProfile ?? 'tavern-helper-message',
      requiresJavaScript:
        draft.runtimeRequirements?.requiresJavaScript ?? Boolean(draft.source.javascript),
      requiresNetwork: draft.runtimeRequirements?.requiresNetwork ?? false,
      hostApis: [...(draft.runtimeRequirements?.hostApis ?? [])],
    },
    provenance: {
      ...draft.provenance,
      ...(draft.provenance.sourceRange ? { sourceRange: { ...draft.provenance.sourceRange } } : {}),
    },
    sharePolicy: {
      license: draft.sharePolicy?.license ?? 'private',
      allowShare: draft.sharePolicy?.allowShare ?? false,
      allowDerivatives: draft.sharePolicy?.allowDerivatives ?? true,
      ...(draft.sharePolicy?.notice ? { notice: draft.sharePolicy.notice } : {}),
    },
    preview: {
      viewportWidth: draft.preview?.viewportWidth ?? 390,
      colorScheme: draft.preview?.colorScheme ?? 'auto',
    },
    projectIds: Array.from(new Set(draft.projectIds ?? [])).filter(Boolean),
    createdAt: now,
    updatedAt: now,
  }
}
