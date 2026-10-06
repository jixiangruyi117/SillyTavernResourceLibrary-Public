import type { AppDatabase } from '../database/AppDatabase'
import type { VaultService } from '../services/VaultService'
import { hashBlob } from '../services/HashService'
import type { AssetRecord, AssetSource, ThumbnailLevel } from '../types/Asset'
import type { Resource } from '../types/Resource'

type AssetVault = Pick<VaultService, 'isEnabled' | 'protectBlob' | 'revealBlob'>

export class IndexedDbAssetStore {
  private readonly database: AppDatabase
  private readonly vault?: AssetVault

  constructor(database: AppDatabase, vault?: AssetVault) {
    this.database = database
    this.vault = vault
  }

  async put(
    blob: Blob,
    options: {
      source: AssetSource
      remoteUrl?: string
      nativeRef?: string
      vaultProtected?: boolean
    },
  ): Promise<AssetRecord> {
    const contentHash = await hashBlob(blob)
    const existing = await this.database.assets.where('contentHash').equals(contentHash).first()
    if (existing) {
      return this.promoteExisting(
        existing,
        blob,
        options.source,
        options.vaultProtected === true,
        options.remoteUrl,
      )
    }

    const assetId = `asset-${contentHash}`
    const vaultProtected = options.vaultProtected === true || options.source === 'thumbnail'
    let storedBlob = blob
    let encrypted = false
    let encryptionIv: string | undefined
    if (vaultProtected && this.vault?.isEnabled()) {
      const protectedValue = await this.vault.protectBlob(blob)
      storedBlob = protectedValue.data
      encrypted = true
      encryptionIv = protectedValue.iv
    }
    const record: AssetRecord = {
      assetId,
      contentHash,
      mimeType: blob.type || 'application/octet-stream',
      size: blob.size,
      source: options.source,
      thumbnailRefs: {},
      webStorageRef: assetId,
      nativeRef: options.nativeRef,
      remoteUrl: options.remoteUrl,
      vaultProtected,
      encrypted,
      encryptionIv,
      createdAt: Date.now(),
    }
    await this.database.transaction(
      'rw',
      this.database.assets,
      this.database.assetFiles,
      async () => {
        await this.database.assets.put(record)
        await this.database.assetFiles.put({ assetId, blob: storedBlob, updatedAt: Date.now() })
      },
    )
    return record
  }

  get(assetId: string): Promise<AssetRecord | undefined> {
    return this.database.assets.get(assetId)
  }

  async getBlob(assetId: string): Promise<Blob | undefined> {
    const [asset, file] = await Promise.all([
      this.database.assets.get(assetId),
      this.database.assetFiles.get(assetId),
    ])
    if (!file) return undefined
    if (!asset?.encrypted) return file.blob
    if (!asset.encryptionIv || !this.vault) {
      throw new Error('加密素材缺少可用的本地保险库')
    }
    return this.vault.revealBlob(
      { iv: asset.encryptionIv, data: file.blob },
      asset.mimeType || 'application/octet-stream',
    )
  }

  async externalizeResourceThumbnail(resource: Resource): Promise<Resource> {
    if (!(resource.thumbnailBlob instanceof Blob)) return resource
    const asset = await this.put(resource.thumbnailBlob, { source: 'thumbnail' })
    return { ...resource, thumbnailAssetId: asset.assetId, thumbnailBlob: undefined }
  }

  async hydrateResourceThumbnail(resource: Resource): Promise<Resource> {
    if (resource.thumbnailBlob instanceof Blob || !resource.thumbnailAssetId) return resource
    const thumbnailBlob = await this.getBlob(resource.thumbnailAssetId)
    return thumbnailBlob ? { ...resource, thumbnailBlob } : resource
  }

  async setThumbnailRef(
    assetId: string,
    level: ThumbnailLevel,
    thumbnailAssetId: string,
  ): Promise<void> {
    const asset = await this.database.assets.get(assetId)
    if (!asset) throw new Error('原始素材已经不存在')
    await this.database.assets.update(assetId, {
      thumbnailRefs: { ...asset.thumbnailRefs, [level]: thumbnailAssetId },
    })
  }

  private async promoteExisting(
    existing: AssetRecord,
    plaintext: Blob,
    source: AssetSource,
    requestedVaultProtection: boolean,
    remoteUrl?: string,
  ): Promise<AssetRecord> {
    const vaultProtected =
      existing.vaultProtected === true || source === 'thumbnail' || requestedVaultProtection
    const nextRemoteUrl = existing.remoteUrl ?? remoteUrl

    if (!vaultProtected) {
      if (!existing.remoteUrl && nextRemoteUrl) {
        const updated = { ...existing, remoteUrl: nextRemoteUrl }
        await this.database.assets.put(updated)
        return updated
      }
      return existing
    }

    if (this.vault?.isEnabled() && existing.encrypted !== true) {
      const protectedValue = await this.vault.protectBlob(plaintext)
      const updated: AssetRecord = {
        ...existing,
        remoteUrl: nextRemoteUrl,
        vaultProtected: true,
        encrypted: true,
        encryptionIv: protectedValue.iv,
      }
      await this.database.transaction(
        'rw',
        this.database.assets,
        this.database.assetFiles,
        async () => {
          await this.database.assets.put(updated)
          await this.database.assetFiles.put({
            assetId: existing.assetId,
            blob: protectedValue.data,
            updatedAt: Date.now(),
          })
        },
      )
      return updated
    }

    if (existing.vaultProtected !== true || (!existing.remoteUrl && nextRemoteUrl)) {
      const updated = { ...existing, remoteUrl: nextRemoteUrl, vaultProtected: true }
      await this.database.assets.put(updated)
      return updated
    }
    return existing
  }
}
