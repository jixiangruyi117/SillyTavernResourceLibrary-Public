export const EXTERNAL_APP_SCHEMA_VERSION = 2
export const EXTERNAL_APP_SDK_VERSION = 'srl-app-api@1'

export const EXTERNAL_APP_PERMISSION = {
  STORAGE: 'app.storage',
  RESOURCES_SELECTED_READ: 'resources.selected.read',
  RESOURCES_LIBRARY_READ: 'resources.library.read',
  RESOURCES_CONTENT_READ: 'resources.content.read',
  RESOURCES_WRITE: 'resources.write',
  RESOURCES_DELETE: 'resources.delete',
  NETWORK_HTTPS: 'network.https',
  FILES_IMPORT_EXPORT: 'files.importExport',
  DEVICE_HAPTICS: 'device.haptics',
  TAVERN_TRANSFER: 'tavern.transfer',
} as const

export type ExternalAppPermission =
  (typeof EXTERNAL_APP_PERMISSION)[keyof typeof EXTERNAL_APP_PERMISSION]

export const EXTERNAL_APP_RUNTIME_MODE = {
  ISOLATED: 'isolated',
  TRUSTED_COMPATIBLE: 'trustedCompatible',
} as const

export type ExternalAppRuntimeMode =
  (typeof EXTERNAL_APP_RUNTIME_MODE)[keyof typeof EXTERNAL_APP_RUNTIME_MODE]

export const EXTERNAL_APP_ORIENTATION = {
  AUTO: 'auto',
  PORTRAIT: 'portrait',
  LANDSCAPE: 'landscape',
} as const

export type ExternalAppOrientation =
  (typeof EXTERNAL_APP_ORIENTATION)[keyof typeof EXTERNAL_APP_ORIENTATION]

export const EXTERNAL_APP_PERMISSION_LABELS: Record<ExternalAppPermission, string> = {
  [EXTERNAL_APP_PERMISSION.STORAGE]: '保存此 APP 自己的本地数据',
  [EXTERNAL_APP_PERMISSION.RESOURCES_SELECTED_READ]: '读取你当次选择的资源',
  [EXTERNAL_APP_PERMISSION.RESOURCES_LIBRARY_READ]: '查看资源库的资源摘要',
  [EXTERNAL_APP_PERMISSION.RESOURCES_CONTENT_READ]: '读取已授权资源的结构化内容',
  [EXTERNAL_APP_PERMISSION.RESOURCES_WRITE]: '修改普通资源字段',
  [EXTERNAL_APP_PERMISSION.RESOURCES_DELETE]: '请求删除资源（必须再次确认）',
  [EXTERNAL_APP_PERMISSION.NETWORK_HTTPS]: '通过 HTTPS 访问网络',
  [EXTERNAL_APP_PERMISSION.FILES_IMPORT_EXPORT]: '请求导入或导出文件',
  [EXTERNAL_APP_PERMISSION.DEVICE_HAPTICS]: '触发短震动反馈',
  [EXTERNAL_APP_PERMISSION.TAVERN_TRANSFER]: '请求与酒馆或酒馆助手交换资源',
}

export const EXTERNAL_APP_PERMISSION_LEVEL = {
  ISOLATED: 'isolated',
  SELECTED_READ: 'selectedRead',
  RESOURCE_ASSISTANT: 'resourceAssistant',
  FULL_CONTROL: 'fullControl',
} as const

export type ExternalAppPermissionLevel =
  (typeof EXTERNAL_APP_PERMISSION_LEVEL)[keyof typeof EXTERNAL_APP_PERMISSION_LEVEL]

export interface ExternalAppPermissionLevelInfo {
  label: string
  risk: 'low' | 'medium' | 'high' | 'critical'
  summary: string
}

export const EXTERNAL_APP_PERMISSION_LEVEL_INFO: Record<
  ExternalAppPermissionLevel,
  ExternalAppPermissionLevelInfo
> = {
  [EXTERNAL_APP_PERMISSION_LEVEL.ISOLATED]: {
    label: 'L0 隔离工具',
    risk: 'low',
    summary: '只能保存 APP 自己的数据，不读取资源库或联网。',
  },
  [EXTERNAL_APP_PERMISSION_LEVEL.SELECTED_READ]: {
    label: 'L1 已选资源',
    risk: 'medium',
    summary: '只能在你亲自选择后读取资源，不可直接改写。',
  },
  [EXTERNAL_APP_PERMISSION_LEVEL.RESOURCE_ASSISTANT]: {
    label: 'L2 资源助手',
    risk: 'high',
    summary: '可读取资源库并修改普通字段；删除、批量改写和正文结构仍不开放。',
  },
  [EXTERNAL_APP_PERMISSION_LEVEL.FULL_CONTROL]: {
    label: 'L3 完整管理',
    risk: 'critical',
    summary: '可管理整个资源库；删除、批量改写和外发仍需 SRL 的可见确认。',
  },
}

export interface ExternalAppManifest {
  schemaVersion: 1 | typeof EXTERNAL_APP_SCHEMA_VERSION
  apiVersion?: typeof EXTERNAL_APP_SDK_VERSION
  permissionLevel?: ExternalAppPermissionLevel
  id: string
  name: string
  version: string
  entry: string
  author?: string
  description?: string
  /** 安装包内图标的相对路径，显示在功能桌面和启动遮罩。 */
  icon?: string
  /** 仅用于启动遮罩的纯色；不允许从 APP 注入宿主样式。 */
  splashColor?: string
  orientation?: ExternalAppOrientation
  immersive?: boolean
  permissions?: ExternalAppPermission[]
}

export interface InstalledExternalApp {
  id: string
  manifest: ExternalAppManifest
  runtimeHtml: string
  /** 经用户导入的原始静态文件；仅在导出或启动时读取。 */
  packageFiles?: Record<string, Uint8Array>
  iconDataUrl?: string
  /** 用户在安装时允许的权限上限；作者声明仍保留在 manifest.permissions。 */
  allowedPermissions?: ExternalAppPermission[]
  /** 旧版安装时授权记录；保留用于旧数据迁移。 */
  grantedPermissions?: ExternalAppPermission[]
  packageFingerprint?: string
  runtimeMode?: ExternalAppRuntimeMode
  persistentPermissionGrants?: ExternalAppPermission[]
  permissionAudit?: ExternalAppPermissionAuditEntry[]
  health?: ExternalAppHealth
  enabled: boolean
  installedAt: number
  updatedAt: number
}

/** 功能桌面和管理页使用的轻量记录；运行时 HTML 仅在启动 APP 时读取。 */
export type InstalledExternalAppSummary = Omit<InstalledExternalApp, 'runtimeHtml' | 'packageFiles'>

export interface ExternalAppRuntimeRecord {
  id: string
  runtimeHtml: string
  packageFiles?: Record<string, Uint8Array>
  updatedAt: number
}

export interface ExternalAppHealth {
  packageBytes: number
  dataBytes: number
  dataLimitBytes: number
  dataEntries: number
  lastLaunchedAt?: number
  lastErrorAt?: number
  lastError?: string
  consecutiveFailures: number
  disabledByWatchdog?: boolean
}

export interface ExternalAppCompatibilityNotice {
  level: 'info' | 'warning'
  code: string
  message: string
  blocking?: boolean
}

export interface ExternalAppPermissionAuditEntry {
  permission: ExternalAppPermission
  method: string
  decision: 'once' | 'always' | 'denied'
  summary: string
  createdAt: number
}

/** 已通过安装包校验、但尚未写入本机的第三方 APP 预览。 */
export interface ExternalAppPreview {
  manifest: ExternalAppManifest
  runtimeHtml: string
  compatibleRuntimeHtml: string
  sourceKind: 'srlapp' | 'zip' | 'html' | 'folder'
  packageFingerprint: string
  requestedPermissions: ExternalAppPermission[]
  /** 安装确认页最终勾选的权限；未设置时默认等于 requestedPermissions。 */
  allowedPermissions?: ExternalAppPermission[]
  permissionLevel: ExternalAppPermissionLevel
  requiresReauthorization: boolean
  compatibility: ExternalAppCompatibilityNotice[]
  packageBytes: number
  packageFiles: Record<string, Uint8Array>
  iconDataUrl?: string
}

export interface ExternalAppDataRecord {
  id: string
  appId: string
  key: string
  value: unknown
  updatedAt: number
}

export function externalAppDataId(appId: string, key: string): string {
  return `${appId}\u0000${key}`
}

export function getExternalAppPermissionLevel(
  permissions: readonly ExternalAppPermission[],
): ExternalAppPermissionLevel {
  const requested = new Set<ExternalAppPermission>(permissions)
  if (
    [
      EXTERNAL_APP_PERMISSION.RESOURCES_DELETE,
      EXTERNAL_APP_PERMISSION.NETWORK_HTTPS,
      EXTERNAL_APP_PERMISSION.FILES_IMPORT_EXPORT,
      EXTERNAL_APP_PERMISSION.TAVERN_TRANSFER,
    ].some((permission) => requested.has(permission))
  ) {
    return EXTERNAL_APP_PERMISSION_LEVEL.FULL_CONTROL
  }
  if (
    [EXTERNAL_APP_PERMISSION.RESOURCES_LIBRARY_READ, EXTERNAL_APP_PERMISSION.RESOURCES_WRITE].some(
      (permission) => requested.has(permission),
    )
  ) {
    return EXTERNAL_APP_PERMISSION_LEVEL.RESOURCE_ASSISTANT
  }
  if (
    [
      EXTERNAL_APP_PERMISSION.RESOURCES_SELECTED_READ,
      EXTERNAL_APP_PERMISSION.RESOURCES_CONTENT_READ,
    ].some((permission) => requested.has(permission))
  ) {
    return EXTERNAL_APP_PERMISSION_LEVEL.SELECTED_READ
  }
  return EXTERNAL_APP_PERMISSION_LEVEL.ISOLATED
}

export function getGrantedExternalAppPermissions(
  app: InstalledExternalAppSummary,
): ExternalAppPermission[] {
  return Array.from(
    new Set(app.allowedPermissions ?? app.grantedPermissions ?? app.manifest.permissions ?? []),
  )
}
