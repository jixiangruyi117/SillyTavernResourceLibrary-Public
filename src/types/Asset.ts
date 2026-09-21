export type AssetSource = 'import' | 'generated' | 'thumbnail' | 'workshop' | 'remote'
export type ThumbnailLevel = 'tiny' | 'card' | 'preview' | 'original'

export interface AssetRecord {
  assetId: string
  contentHash: string
  mimeType: string
  size: number
  source: AssetSource
  thumbnailRefs: Partial<Record<ThumbnailLevel, string>>
  webStorageRef?: string
  nativeRef?: string
  remoteUrl?: string
  /** This asset contains resource preview data and must follow local-vault encryption. */
  vaultProtected?: boolean
  encrypted?: boolean
  encryptionIv?: string
  createdAt: number
}

export interface AssetFileRecord {
  assetId: string
  blob: Blob
  updatedAt: number
}
