import 'fake-indexeddb/auto'

import { describe, expect, it } from 'vitest'

import { AppDatabase } from '../database/AppDatabase'
import { VaultService } from '../services/VaultService'
import {
  RESOURCE_TYPE,
  toResourceListSummary,
  toResourceSummary,
  type Resource,
} from '../types/Resource'
import { IndexedDbResourceStorage } from './IndexedDbResourceStorage'

function createResource(index: number): Resource {
  const original = new Uint8Array(64 * 1024)
  original[0] = index % 255
  return {
    id: `thumbnail-regression-${index}`,
    type: RESOURCE_TYPE.CHARACTER_CARD,
    name: `缩略图回归 ${index}`,
    description: '模拟 PNG 角色卡',
    fileName: `thumbnail-regression-${index}.png`,
    mimeType: 'image/png',
    fileSize: original.byteLength,
    contentHash: index.toString(16).padStart(64, '0'),
    favorite: false,
    categoryId: null,
    categoryIds: [],
    relatedResourceIds: [],
    tags: [],
    metadata: { parserVersion: 5 },
    thumbnailBlob: new Blob([new Uint8Array(128)], { type: 'image/webp' }),
    originalBlob: new Blob([original], { type: 'image/png' }),
    createdAt: index,
    updatedAt: index,
  }
}

describe('IndexedDbResourceStorage thumbnail regression', () => {
  it('uses AssetStore when a VaultService instance exists but the vault is disabled', async () => {
    const database = new AppDatabase(`thumbnail-disabled-vault-${crypto.randomUUID()}`)
    const vault = new VaultService(database)
    await vault.initialize()
    expect(vault.isEnabled()).toBe(false)

    const storage = new IndexedDbResourceStorage(database, vault)
    const resource = createResource(1)
    await storage.save(resource)

    const stored = await database.resources.get(resource.id)
    const summary = await database.resourceSummaries.get(resource.id)
    const listSummary = await database.resourceListSummaries.get(resource.id)
    const assetId = stored && !('encrypted' in stored) ? stored.thumbnailAssetId : undefined

    expect(assetId).toMatch(/^asset-/u)
    expect(stored).toMatchObject({ thumbnailAssetId: assetId })
    expect(stored && !('encrypted' in stored) ? stored.thumbnailBlob : undefined).toBeUndefined()
    expect(summary).toMatchObject({ thumbnailAssetId: assetId })
    expect(summary && !('encrypted' in summary) ? summary.thumbnailBlob : undefined).toBeUndefined()
    expect(listSummary).toMatchObject({ thumbnailAssetId: assetId })
    expect(
      listSummary && !('encrypted' in listSummary) ? listSummary.thumbnailBlob : undefined,
    ).toBeUndefined()
    expect(await database.assetFiles.count()).toBe(1)
    await expect(
      (await storage.get(resource.id))?.thumbnailBlob?.arrayBuffer(),
    ).resolves.toHaveProperty('byteLength', 128)

    database.close()
    await database.delete()
  })

  it('repairs v0.0.60 records created after the v23 migration had already completed', async () => {
    const database = new AppDatabase(`thumbnail-v24-repair-${crypto.randomUUID()}`)
    const current = createResource(2)
    const historical: Resource = {
      ...createResource(3),
      id: 'thumbnail-regression-history',
      versionGroupId: current.id,
      versionLabel: '历史 PNG',
    }

    await database.resources.put(current)
    await database.resourceSummaries.put(toResourceSummary(current))
    await database.resourceListSummaries.put(toResourceListSummary(current))
    await database.resourceVersions.put(historical)
    await database.resourceVersionSummaries.put(toResourceSummary(historical))
    await database.settings.put({
      id: 'migration.resourceThumbnails.asset.v23',
      value: {
        version: 23,
        status: 'complete',
        stage: 'complete',
        migrated: 0,
      },
      updatedAt: Date.now(),
    })

    const vault = new VaultService(database)
    await vault.initialize()
    const storage = new IndexedDbResourceStorage(database, vault)
    await storage.repairThumbnailAssets()

    const list = await storage.listResourceListSummaries()
    const versionSummaries = await storage.listVersionSummaries()
    const storedCurrent = await database.resources.get(current.id)
    const storedHistorical = await database.resourceVersions.get(historical.id)
    const storedSummary = await database.resourceSummaries.get(current.id)
    const storedListSummary = await database.resourceListSummaries.get(current.id)
    const storedVersionSummary = await database.resourceVersionSummaries.get(historical.id)
    const currentAssetId =
      storedCurrent && !('encrypted' in storedCurrent) ? storedCurrent.thumbnailAssetId : undefined
    const historicalAssetId =
      storedHistorical && !('encrypted' in storedHistorical)
        ? storedHistorical.thumbnailAssetId
        : undefined

    expect(currentAssetId).toMatch(/^asset-/u)
    expect(historicalAssetId).toBe(currentAssetId)
    expect(storedCurrent).toMatchObject({ thumbnailAssetId: currentAssetId })
    expect(
      storedCurrent && !('encrypted' in storedCurrent) ? storedCurrent.thumbnailBlob : undefined,
    ).toBeUndefined()
    expect(storedHistorical).toMatchObject({ thumbnailAssetId: historicalAssetId })
    expect(
      storedHistorical && !('encrypted' in storedHistorical)
        ? storedHistorical.thumbnailBlob
        : undefined,
    ).toBeUndefined()
    expect(storedSummary).toMatchObject({ thumbnailAssetId: currentAssetId })
    expect(
      storedSummary && !('encrypted' in storedSummary) ? storedSummary.thumbnailBlob : undefined,
    ).toBeUndefined()
    expect(storedListSummary).toMatchObject({ thumbnailAssetId: currentAssetId })
    expect(
      storedListSummary && !('encrypted' in storedListSummary)
        ? storedListSummary.thumbnailBlob
        : undefined,
    ).toBeUndefined()
    expect(storedVersionSummary).toMatchObject({ thumbnailAssetId: historicalAssetId })
    expect(
      storedVersionSummary && !('encrypted' in storedVersionSummary)
        ? storedVersionSummary.thumbnailBlob
        : undefined,
    ).toBeUndefined()
    expect(list.find((item) => item.id === current.id)?.thumbnailAssetId).toBe(currentAssetId)
    expect(versionSummaries.find((item) => item.id === historical.id)?.thumbnailAssetId).toBe(
      historicalAssetId,
    )
    expect(await database.assetFiles.count()).toBe(1)
    await expect(
      database.settings.get('repair.resourceThumbnails.asset.v24'),
    ).resolves.toMatchObject({
      value: {
        version: 24,
        status: 'complete',
        stage: 'complete',
        repaired: 2,
      },
    })
    await expect(
      (await storage.get(current.id))?.thumbnailBlob?.arrayBuffer(),
    ).resolves.toHaveProperty('byteLength', 128)

    database.close()
    await database.delete()
  })
})
