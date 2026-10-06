import 'fake-indexeddb/auto'

import { describe, expect, it } from 'vitest'

import { AppDatabase } from '../database/AppDatabase'
import { VaultService } from '../services/VaultService'
import { RESOURCE_TYPE, toResourceSummary, type Resource } from '../types/Resource'
import { isEncryptedResource } from '../types/Vault'
import { IndexedDbArchiveStorage } from './IndexedDbArchiveStorage'
import { IndexedDbAssetStore } from './IndexedDbAssetStore'
import { IndexedDbResourceStorage } from './IndexedDbResourceStorage'

function createPngResource(id: string, thumbnail = 'thumb'): Resource {
  return {
    id,
    type: RESOURCE_TYPE.CHARACTER_CARD,
    name: `角色 ${id}`,
    description: '',
    fileName: `${id}.png`,
    mimeType: 'image/png',
    fileSize: 8,
    contentHash: id.slice(0, 1).repeat(64),
    favorite: false,
    categoryId: null,
    categoryIds: [],
    relatedResourceIds: [],
    tags: [],
    metadata: {},
    thumbnailBlob: new Blob([thumbnail], { type: 'image/webp' }),
    originalBlob: new Blob([`png-${id}`], { type: 'image/png' }),
    createdAt: 1,
    updatedAt: 1,
  }
}

describe('thumbnail asset lifecycle', () => {
  it('encrypts protected thumbnail assets with the vault and decrypts them again on disable', async () => {
    const database = new AppDatabase(`thumbnail-vault-assets-${crypto.randomUUID()}`)
    const vault = new VaultService(database)
    await vault.initialize()
    const assets = new IndexedDbAssetStore(database, vault)
    const stored = await assets.put(new Blob(['secret-thumb'], { type: 'image/webp' }), {
      source: 'thumbnail',
    })

    expect((await database.assets.get(stored.assetId))?.encrypted).not.toBe(true)
    await vault.enable('correct-password')
    expect(await database.assets.get(stored.assetId)).toMatchObject({
      vaultProtected: true,
      encrypted: true,
    })
    expect(await (await assets.getBlob(stored.assetId))?.text()).toBe('secret-thumb')

    vault.lock()
    await expect(assets.getBlob(stored.assetId)).rejects.toThrow('已锁定')
    await vault.unlock('correct-password')
    await vault.disable()

    expect((await database.assets.get(stored.assetId))?.encrypted).toBe(false)
    expect(await (await assets.getBlob(stored.assetId))?.text()).toBe('secret-thumb')
    database.close()
    await database.delete()
  })

  it('keeps list summaries lightweight and thumbnail-resolvable across vault transitions', async () => {
    const database = new AppDatabase(`thumbnail-vault-resource-${crypto.randomUUID()}`)
    const vault = new VaultService(database)
    await vault.initialize()
    const assets = new IndexedDbAssetStore(database, vault)
    const storage = new IndexedDbResourceStorage(database, vault, assets)
    await storage.save(createPngResource('a'))

    const plain = (await storage.listResourceListSummaries())[0]!
    expect(plain.thumbnailAssetId).toMatch(/^asset-/u)
    expect(plain.thumbnailBlob).toBeUndefined()

    await vault.enable('correct-password')
    const encrypted = (await storage.listResourceListSummaries())[0]!
    expect(encrypted.thumbnailAssetId).toBe(plain.thumbnailAssetId)
    expect(encrypted.thumbnailBlob).toBeUndefined()
    expect(await (await storage.get('a'))?.thumbnailBlob?.text()).toBe('thumb')

    await vault.disable()
    const decrypted = (await storage.listResourceListSummaries())[0]!
    expect(decrypted.thumbnailAssetId).toBe(plain.thumbnailAssetId)
    expect(await (await storage.get('a'))?.thumbnailBlob?.text()).toBe('thumb')
    database.close()
    await database.delete()
  })

  it('moves legacy encrypted embedded thumbnails into encrypted AssetStore records in background repair', async () => {
    const database = new AppDatabase(`thumbnail-v25-encrypted-${crypto.randomUUID()}`)
    const legacy = createPngResource('b', 'legacy-secret')
    await database.resources.put(legacy)
    await database.resourceSummaries.put(toResourceSummary(legacy))
    const vault = new VaultService(database)
    await vault.initialize()
    await vault.enable('correct-password')

    const before = await database.resources.get(legacy.id)
    expect(before && isEncryptedResource(before) ? before.thumbnail : undefined).toBeDefined()

    const assets = new IndexedDbAssetStore(database, vault)
    const storage = new IndexedDbResourceStorage(database, vault, assets)
    await storage.repairThumbnailAssets()

    const after = await database.resources.get(legacy.id)
    expect(after && isEncryptedResource(after) ? after.thumbnail : undefined).toBeUndefined()
    const list = (await storage.listResourceListSummaries())[0]!
    expect(list.thumbnailAssetId).toMatch(/^asset-/u)
    expect((await database.assets.get(list.thumbnailAssetId!))?.encrypted).toBe(true)
    expect(await (await assets.getBlob(list.thumbnailAssetId!))?.text()).toBe('legacy-secret')
    database.close()
    await database.delete()
  })

  it('restores thumbnail assets and list summaries directly instead of relying on a later migration', async () => {
    const database = new AppDatabase(`thumbnail-archive-${crypto.randomUUID()}`)
    const vault = new VaultService(database)
    await vault.initialize()
    const assets = new IndexedDbAssetStore(database, vault)
    const archive = new IndexedDbArchiveStorage(database, vault, assets)
    const resource = createPngResource('c', 'archive-thumb')

    await archive.restore([], [resource])

    const raw = await database.resources.get(resource.id)
    expect(raw && !isEncryptedResource(raw) ? raw.thumbnailBlob : undefined).toBeUndefined()
    const assetId = raw && !isEncryptedResource(raw) ? raw.thumbnailAssetId : undefined
    expect(assetId).toMatch(/^asset-/u)
    expect(await database.resourceListSummaries.get(resource.id)).toMatchObject({
      thumbnailAssetId: assetId,
    })
    expect(await (await assets.getBlob(assetId!))?.text()).toBe('archive-thumb')
    database.close()
    await database.delete()
  })

  it('does not block the first list read on legacy thumbnail migration', async () => {
    const database = new AppDatabase(`thumbnail-background-${crypto.randomUUID()}`)
    const resource = createPngResource('d', 'background-thumb')
    await database.resources.put(resource)
    await database.resourceSummaries.put(toResourceSummary(resource))
    const vault = new VaultService(database)
    await vault.initialize()
    const storage = new IndexedDbResourceStorage(database, vault)

    await storage.listResourceListSummaries()
    expect(await database.assetFiles.count()).toBe(0)
    expect(await database.settings.get('repair.resourceThumbnails.asset.v25')).toBeUndefined()

    await storage.repairThumbnailAssets()
    expect(await database.assetFiles.count()).toBe(1)
    expect(await database.settings.get('repair.resourceThumbnails.asset.v25')).toMatchObject({
      value: { version: 25, status: 'complete' },
    })
    database.close()
    await database.delete()
  })
})
