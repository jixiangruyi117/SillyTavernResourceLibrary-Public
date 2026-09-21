import type { PersonalResourceSelection } from '../services/PersonalResourceBackup'
export type CloudBackupProvider = 'github'

export type CloudBackupIntervalUnit = 'minutes' | 'hours' | 'days'

export type CloudBackupSchedule =
  | { mode: 'interval'; value: number; unit: CloudBackupIntervalUnit }
  | { mode: 'daily'; time: string }

export interface CloudBackupProtection {
  wifiOnly: boolean
  chargingOnly: boolean
}

export interface CloudBackupContentSelection {
  personalResources?: PersonalResourceSelection
  /** 未定义表示所有可备份资源；定义后仅备份这些资源 ID。 */
  resourceIds?: string[]
  plaintextSecretCopy?: boolean
  credentials?: boolean
  aiTaggingState?: boolean
  externalApps?: boolean
  stitchWork?: boolean
  communitySources?: boolean
  appearance?: boolean
  cloudBackup?: boolean
  characterDraw?: boolean
  generalPreferences?: boolean
}

export interface GitHubBackupConfig {
  provider: 'github'
  owner: string
  repository: string
  retention: number
  autoBackup: boolean
  schedule?: CloudBackupSchedule
  protection?: CloudBackupProtection
  contentSelection?: CloudBackupContentSelection
}

export type CloudBackupConfig = GitHubBackupConfig

export interface CloudBackupMetrics {
  startedAt: number
  completedAt?: number
  totalMs: number
  prepareMs: number
  hashMs: number
  objectBuildMs: number
  bridgeEncodeMs: number
  bridgeTransferMs: number
  nativeDiskMs: number
  networkMs: number
  verifyMs: number
  maintenanceMs: number
  localReadBytes: number
  hashedBytes: number
  bridgeBytes: number
  uploadedBytes: number
  httpRequestCount: number
  retryCount: number
}

export interface CloudBackupStatus {
  provider?: CloudBackupProvider
  lastAttemptAt?: number
  lastSuccessAt?: number
  lastError?: string
  lastWarning?: string
  lastObjectKey?: string
  lastSize?: number
  lastContentFingerprint?: string
  lastResourceCount?: number
  lastHealthyObjectKey?: string
  lastHealthyResourceCount?: number
  lastMetrics?: CloudBackupMetrics
}

export interface CloudBackupItem {
  id: string
  objectKey: string
  size: number
  createdAt: number
  kind?: 'single' | 'githubBundle' | 'githubSnapshot'
  partCount?: number
  archiveName?: string
  maintenanceWarning?: string
  unchanged?: boolean
  metrics?: CloudBackupMetrics
}

export interface CloudBackupSnapshot {
  activeProvider?: CloudBackupProvider
  github?: GitHubBackupConfig
  status: CloudBackupStatus
  credentials: Record<CloudBackupProvider, 'missing' | 'valid' | 'invalid'>
}
