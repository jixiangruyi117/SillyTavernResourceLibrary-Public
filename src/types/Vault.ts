import type { Category, Resource, ResourceSummary } from './Resource'

export interface EncryptedValue {
  iv: string
  data: Blob
}

export interface VaultConfig {
  version: 1
  iterations: number
  salt: string
  verifier: EncryptedValue
}

export interface VaultStatus {
  enabled: boolean
  locked: boolean
}

export interface EncryptedResourceRecord {
  id: string
  contentHash: string
  updatedAt: number
  versionGroupId?: string
  encrypted: true
  payload: EncryptedValue
  original: EncryptedValue
  thumbnail?: EncryptedValue
}

export interface EncryptedResourceSummaryRecord {
  id: string
  contentHash: string
  versionGroupId?: string
  updatedAt: number
  encrypted: true
  payload: EncryptedValue
  thumbnail?: EncryptedValue
}

export interface EncryptedCategoryRecord {
  id: string
  updatedAt: number
  encrypted: true
  payload: EncryptedValue
}

/**
 * Android 资源原件已经由 NativeLibrary 按 SHA-256 校验落盘时，IndexedDB 只保存
 * 可事务提交的元数据引用。真正需要打开/导出该资源时再从应用私有文件读取 Blob，
 * 云恢复过程本身不会把大型资源重新搬进 WebView。
 */
export interface NativeBackedResourceRecord extends Omit<Resource, 'originalBlob'> {
  nativeOriginal: {
    version: 1
    contentHash: string
    size: number
  }
}

export type StoredResource = Resource | NativeBackedResourceRecord | EncryptedResourceRecord
export type StoredResourceSummary = ResourceSummary | EncryptedResourceSummaryRecord
export type StoredCategory = Category | EncryptedCategoryRecord

export function isEncryptedResource(value: StoredResource): value is EncryptedResourceRecord {
  return 'encrypted' in value && value.encrypted === true
}

export function isNativeBackedResource(value: StoredResource): value is NativeBackedResourceRecord {
  return 'nativeOriginal' in value && value.nativeOriginal?.version === 1
}

export function isEncryptedResourceSummary(
  value: StoredResourceSummary,
): value is EncryptedResourceSummaryRecord {
  return 'encrypted' in value && value.encrypted === true
}

export function isEncryptedCategory(value: StoredCategory): value is EncryptedCategoryRecord {
  return 'encrypted' in value && value.encrypted === true
}
