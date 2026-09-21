import 'fake-indexeddb/auto'

import { reactive } from 'vue'
import { describe, expect, it, vi } from 'vitest'

import { AppDatabase } from '../database/AppDatabase'
import { ResourceParserRegistry } from '../parser/ResourceParser'
import { ResourceService } from '../services/ResourceService'
import { findHistoricalDuplicateGroups } from '../services/ResourceVersionMatcher'
import {
  RESOURCE_LINK_TYPE,
  RESOURCE_TYPE,
  toResourceSummary,
  type Resource,
} from '../types/Resource'
import { IndexedDbResourceStorage } from './IndexedDbResourceStorage'

function createResource(index: number): Resource {
  const original = new Uint8Array(64 * 1024)
  original[0] = index % 255
  return {
    id: `resource-${index}`,
    type: RESOURCE_TYPE.CHARACTER_CARD,
    name: `角色 ${index}`,
    description: '压力测试资源',
    fileName: `character-${index}.png`,
    mimeType: 'image/png',
    fileSize: original.byteLength,
    contentHash: index.toString(16).padStart(64, '0'),
    favorite: false,
    categoryId: null,
    categoryIds: [],
    relatedResourceIds: [],
    tags: ['压力测试'],
    metadata: { parserVersion: 5 },
    thumbnailBlob: new Blob([new Uint8Array(128)], { type: 'image/webp' }),
    originalBlob: new Blob([original], { type: 'image/png' }),
    createdAt: index,
    updatedAt: index,
  }
}

describe('IndexedDbResourceStorage', () => {
  it('rebuilds a missing list-summary row from the authoritative resource without treating it as an empty library', async () => {
    const database = new AppDatabase(`resource-list-index-${crypto.randomUUID()}`)
    const storage = new IndexedDbResourceStorage(database)
    const resource = createResource(77)
    await storage.save(resource)
    await database.resourceListSummaries.clear()

    await expect(storage.listResourceListSummaries()).resolves.toMatchObject([{ id: resource.id }])
    expect(await database.resources.get(resource.id)).toBeDefined()
    database.close()
    await database.delete()
  })

  it('stores resources after removing uncloneable metadata values', async () => {
    const database = new AppDatabase(`resource-clone-${crypto.randomUUID()}`)
    const storage = new IndexedDbResourceStorage(database)
    const resource = createResource(1)
    resource.metadata = {
      safe: 'ok',
      nested: {
        keep: 1,
        drop: () => 'not cloneable',
      },
      missing: undefined,
      symbol: Symbol('not cloneable'),
      importedAt: new Date('2026-07-25T00:00:00.000Z'),
      amount: BigInt(12),
    }

    await expect(storage.save(resource)).resolves.toBeUndefined()
    const stored = await storage.get(resource.id)

    expect(stored?.metadata).toEqual({
      safe: 'ok',
      nested: { keep: 1 },
      importedAt: '2026-07-25T00:00:00.000Z',
      amount: '12',
    })

    database.close()
    await database.delete()
  })

  it('updates a Vue reactive resource without writing proxies to IndexedDB', async () => {
    const database = new AppDatabase(`resource-reactive-update-${crypto.randomUUID()}`)
    const storage = new IndexedDbResourceStorage(database)
    const resource = reactive(createResource(2))

    await storage.save(resource)
    resource.name = '改名后的角色'
    resource.description = '改名后保存'

    await expect(storage.save(resource)).resolves.toBeUndefined()
    const stored = await storage.get(resource.id)

    expect(stored?.name).toBe('改名后的角色')
    expect(stored?.description).toBe('改名后保存')
    expect(stored?.originalBlob).toBeInstanceOf(Blob)

    database.close()
    await database.delete()
  })

  it('preserves source links when cloning resources for IndexedDB', async () => {
    const database = new AppDatabase(`resource-source-links-${crypto.randomUUID()}`)
    const storage = new IndexedDbResourceStorage(database)
    const resource = createResource(21)
    resource.sourceLinks = [
      {
        id: 'github-release',
        label: 'GitHub Release',
        url: 'https://github.com/SillyTavern/SillyTavern/releases/tag/1.13.4',
        type: RESOURCE_LINK_TYPE.GITHUB,
        note: '移动端保存来源',
        createdAt: 21,
      },
    ]

    await storage.saveMany([resource])
    const stored = await storage.get(resource.id)

    expect(stored?.sourceLinks).toHaveLength(1)
    expect(stored?.sourceLinks?.[0]).toMatchObject({
      id: 'github-release',
      label: 'GitHub Release',
      url: 'https://github.com/SillyTavern/SillyTavern/releases/tag/1.13.4',
      type: RESOURCE_LINK_TYPE.GITHUB,
      note: '移动端保存来源',
    })

    database.close()
    await database.delete()
  })

  it('preserves stored blobs when only metadata changes', async () => {
    const database = new AppDatabase(`resource-metadata-update-${crypto.randomUUID()}`)
    const storage = new IndexedDbResourceStorage(database)
    const resource = createResource(3)

    await storage.save(resource)
    await storage.update(resource.id, {
      name: '鏀瑰悕鍚庣殑瑙掕壊',
      updatedAt: Date.now(),
    })
    const stored = await storage.get(resource.id)
    const summary = (await storage.listSummaries()).find((item) => item.id === resource.id)

    expect(stored?.name).toBe('鏀瑰悕鍚庣殑瑙掕壊')
    expect(stored?.originalBlob.size).toBe(64 * 1024)
    expect(stored?.thumbnailBlob?.size).toBe(128)
    expect(summary?.thumbnailBlob).toBeUndefined()
    expect(summary?.thumbnailAssetId).toBe(stored?.thumbnailAssetId)
    await expect(database.resources.get(resource.id)).resolves.toMatchObject({
      thumbnailAssetId: stored?.thumbnailAssetId,
      thumbnailBlob: undefined,
    })

    database.close()
    await database.delete()
  })

  it('persists an explicit thumbnail update without replacing the original file', async () => {
    const database = new AppDatabase(`resource-thumbnail-update-${crypto.randomUUID()}`)
    const storage = new IndexedDbResourceStorage(database)
    const resource = createResource(4)
    const nextThumbnail = new Blob([new Uint8Array(256)], { type: 'image/webp' })

    await storage.save(resource)
    await storage.update(resource.id, { thumbnailBlob: nextThumbnail, updatedAt: Date.now() })
    const stored = await storage.get(resource.id)
    const summary = (await storage.listSummaries()).find((item) => item.id === resource.id)

    expect(stored?.originalBlob.size).toBe(64 * 1024)
    expect(stored?.thumbnailBlob?.size).toBe(256)
    expect(summary?.thumbnailBlob).toBeUndefined()
    expect(summary?.thumbnailAssetId).toBe(stored?.thumbnailAssetId)

    await storage.update(resource.id, { thumbnailBlob: undefined, updatedAt: Date.now() })
    expect((await storage.get(resource.id))?.thumbnailBlob).toBeUndefined()
    expect(
      (await storage.listSummaries()).find((item) => item.id === resource.id)?.thumbnailBlob,
    ).toBeUndefined()
    expect(
      (await storage.listSummaries()).find((item) => item.id === resource.id)?.thumbnailAssetId,
    ).toBeUndefined()

    database.close()
    await database.delete()
  })

  it('resumes legacy duplicated thumbnails into the content-addressed asset store', async () => {
    const database = new AppDatabase(`resource-thumbnail-migration-${crypto.randomUUID()}`)
    const resource = createResource(41)
    const { originalBlob: _originalBlob, ...legacySummary } = resource
    await database.resources.put(resource)
    await database.resourceSummaries.put(legacySummary)
    await database.resourceListSummaries.put(legacySummary)

    const storage = new IndexedDbResourceStorage(database)
    await storage.repairThumbnailAssets()
    const summaries = await storage.listSummaries()
    const migratedResource = await database.resources.get(resource.id)
    const migratedSummary = await database.resourceSummaries.get(resource.id)
    const thumbnailAssetId =
      migratedResource && !('encrypted' in migratedResource)
        ? migratedResource.thumbnailAssetId
        : undefined

    expect(migratedResource).toMatchObject({
      thumbnailAssetId: expect.stringMatching(/^asset-/u),
      thumbnailBlob: undefined,
    })
    expect(migratedSummary).toMatchObject({
      thumbnailAssetId,
      thumbnailBlob: undefined,
    })
    expect(summaries[0]?.thumbnailBlob).toBeUndefined()
    await expect(
      (await storage.get(resource.id))?.thumbnailBlob?.arrayBuffer(),
    ).resolves.toHaveProperty('byteLength', 128)
    await expect(
      database.settings.get('migration.resourceThumbnails.asset.v23'),
    ).resolves.toMatchObject({ value: { status: 'complete', migrated: 1 } })

    database.close()
    await database.delete()
  })

  it('lists 500 lightweight summaries without returning original blobs', async () => {
    const database = new AppDatabase(`resource-summary-${crypto.randomUUID()}`)
    const storage = new IndexedDbResourceStorage(database)
    const resources = Array.from({ length: 500 }, (_, index) => createResource(index))

    await storage.saveMany(resources)
    const summaries = await storage.listSummaries()

    expect(summaries).toHaveLength(500)
    expect(summaries.every((resource) => !('originalBlob' in resource))).toBe(true)
    expect(summaries.every((resource) => !resource.thumbnailBlob)).toBe(true)
    expect(summaries.every((resource) => Boolean(resource.thumbnailAssetId))).toBe(true)
    await expect(database.assetFiles.count()).resolves.toBe(1)
    expect(await storage.get('resource-499')).toMatchObject({
      name: '角色 499',
      fileSize: 64 * 1024,
    })
    expect((await storage.get('resource-499'))?.originalBlob.size).toBe(64 * 1024)

    database.close()
    await database.delete()
  })

  it('persists a separate list index without full character-card metadata', async () => {
    const database = new AppDatabase(`resource-list-summary-${crypto.randomUUID()}`)
    const storage = new IndexedDbResourceStorage(database)
    const resource = createResource(700)
    resource.metadata = {
      creator: '测试作者',
      characterVersion: '2.0',
      card: { data: { description: '正文'.repeat(100_000), character_book: { entries: [] } } },
    }

    await storage.save(resource)
    const list = await storage.listResourceListSummaries()
    const storedList = await database.resourceListSummaries.get(resource.id)
    const fullSummary = await database.resourceSummaries.get(resource.id)

    expect(list).toHaveLength(1)
    expect(list[0]?.metadata).toEqual({ creator: '测试作者', characterVersion: '2.0' })
    expect(storedList && 'originalBlob' in storedList).toBe(false)
    expect(storedList && 'card' in (storedList as Resource).metadata).toBe(false)
    expect(fullSummary && 'card' in (fullSummary as Resource).metadata).toBe(true)

    database.close()
    await database.delete()
  })

  it('loads and sorts 5000 summary records without touching the original file table', async () => {
    const database = new AppDatabase(`resource-summary-stress-${crypto.randomUUID()}`)
    const storage = new IndexedDbResourceStorage(database)
    const summaries = Array.from({ length: 5_000 }, (_, index) =>
      toResourceSummary(createResource(index)),
    )
    await database.resourceSummaries.bulkPut(summaries)
    const oneShotTableRead = vi.spyOn(database.resourceSummaries, 'toArray')

    const startedAt = performance.now()
    const loaded = await storage.listSummaries()
    const elapsedMs = performance.now() - startedAt

    expect(loaded).toHaveLength(5_000)
    expect(elapsedMs).toBeLessThan(3_000)
    expect(loaded[0]?.updatedAt).toBe(4_999)
    expect(loaded.at(-1)?.updatedAt).toBe(0)
    expect(loaded.every((resource) => !('originalBlob' in resource))).toBe(true)
    expect(oneShotTableRead).not.toHaveBeenCalled()
    expect(await database.resources.count()).toBe(0)

    database.close()
    await database.delete()
  })

  it('keeps a lightweight summary index for historical versions', async () => {
    const database = new AppDatabase(`resource-version-summary-${crypto.randomUUID()}`)
    const storage = new IndexedDbResourceStorage(database)
    const version = {
      ...createResource(501),
      id: 'historical-version',
      versionGroupId: 'active-resource',
      versionLabel: '第一版',
    }

    await storage.saveVersion(version)
    const summaries = await storage.listVersionSummaries()

    expect(summaries).toHaveLength(1)
    expect(summaries[0]).toMatchObject({
      id: version.id,
      versionGroupId: version.versionGroupId,
      versionLabel: '第一版',
    })
    expect('originalBlob' in summaries[0]).toBe(false)

    await storage.deleteVersion(version.id)
    expect(await storage.listVersionSummaries()).toEqual([])

    database.close()
    await database.delete()
  })

  it('repairs missing and ghost historical summaries from authoritative version records', async () => {
    const database = new AppDatabase(`resource-version-summary-repair-${crypto.randomUUID()}`)
    const storage = new IndexedDbResourceStorage(database)
    const version = {
      ...createResource(502),
      id: 'real-history',
      versionGroupId: 'active-resource',
      versionLabel: '恢复得到的历史版',
    }
    const ghost = {
      ...createResource(503),
      id: 'ghost-history',
      versionGroupId: 'missing-resource',
    }

    // 模拟旧恢复逻辑：真实历史表有记录，摘要索引却缺失并残留无主摘要。
    await database.resourceVersions.put(version)
    await database.resourceVersionSummaries.put(toResourceSummary(ghost))

    const summaries = await storage.listVersionSummaries()

    expect(summaries).toHaveLength(1)
    expect(summaries[0]).toMatchObject({
      id: version.id,
      contentHash: version.contentHash,
      versionGroupId: version.versionGroupId,
    })
    expect('originalBlob' in summaries[0]).toBe(false)
    expect(await database.resourceVersionSummaries.get(ghost.id)).toBeUndefined()

    database.close()
    await database.delete()
  })

  it('uses the real historical table to repair stale hashes and actually removes duplicate versions', async () => {
    const database = new AppDatabase(`resource-version-stale-hash-${crypto.randomUUID()}`)
    const storage = new IndexedDbResourceStorage(database)
    const service = new ResourceService(storage, new ResourceParserRegistry([]))
    const current = {
      ...createResource(504),
      id: 'current',
      contentHash: '1'.repeat(64),
      versionCount: 4,
      updatedAt: 40,
    }
    const duplicatedHash = '1503b4256460'.padEnd(64, '0')
    const firstCopy = {
      ...createResource(505),
      id: 'history-json',
      fileName: 'json',
      mimeType: 'application/json',
      contentHash: duplicatedHash,
      versionGroupId: current.id,
      updatedAt: 30,
    }
    const secondCopy = {
      ...createResource(506),
      id: 'history-1-json',
      fileName: '1.json',
      mimeType: 'application/json',
      contentHash: duplicatedHash,
      versionGroupId: current.id,
      updatedAt: 20,
    }
    const distinctHistory = {
      ...createResource(507),
      id: 'history-distinct',
      contentHash: '2'.repeat(64),
      versionGroupId: current.id,
      updatedAt: 10,
    }

    await storage.save(current)
    await database.resourceVersions.bulkPut([firstCopy, secondCopy, distinctHistory])
    // 模拟用户存量数据库：真实历史已经相同，但两个现有摘要仍保留旧哈希。
    await database.resourceVersionSummaries.bulkPut([
      { ...toResourceSummary(firstCopy), contentHash: 'a'.repeat(64) },
      { ...toResourceSummary(secondCopy), contentHash: 'b'.repeat(64) },
      toResourceSummary(distinctHistory),
    ])

    const repairedSummaries = await storage.listVersionSummaries()
    const duplicateGroups = findHistoricalDuplicateGroups(
      await storage.listSummaries(),
      repairedSummaries,
    )
    const exactGroup = duplicateGroups.find((group) => group.kind === 'exactFile')

    expect(
      repairedSummaries
        .filter((version) => ['history-json', 'history-1-json'].includes(version.id))
        .map((version) => version.contentHash),
    ).toEqual([duplicatedHash, duplicatedHash])
    expect(exactGroup?.keeper.id).toBe('history-json')
    expect(exactGroup?.duplicates.map((version) => version.id)).toEqual(['history-1-json'])

    const deleted = await service.deleteVersions(
      current.id,
      exactGroup!.duplicates.map((version) => version.id),
    )
    const finalVersions = await service.listVersions(current.id)
    const finalHashes = finalVersions.map((version) => version.resource.contentHash)

    expect(deleted).toBe(1)
    expect(finalVersions.map((version) => version.resource.id).sort()).toEqual([
      'current',
      'history-distinct',
      'history-json',
    ])
    expect(new Set(finalHashes).size).toBe(finalHashes.length)
    expect((await storage.get(current.id))?.versionCount).toBe(3)
    expect(await database.resourceVersions.get('history-1-json')).toBeUndefined()
    expect(await database.resourceVersionSummaries.get('history-1-json')).toBeUndefined()

    database.close()
    await database.delete()
  })

  it('从真实历史表回填语义指纹并把 JSON/PNG 封装收敛为一个版本', async () => {
    const database = new AppDatabase(`resource-logical-version-${crypto.randomUUID()}`)
    const storage = new IndexedDbResourceStorage(database)
    const service = new ResourceService(storage, new ResourceParserRegistry([]))
    const data = {
      name: '同一角色',
      description: '相同内容',
      personality: '',
      scenario: '',
      first_mes: '你好',
      mes_example: '',
    }
    const current = {
      ...createResource(601),
      id: 'logical-current',
      fileName: 'card.png',
      versionCount: 2,
      metadata: {
        card: { spec: 'chara_card_v2', spec_version: '2.0', data },
        cardContentHash: 'legacy-png-hash',
      },
    }
    const jsonCarrier = {
      ...createResource(602),
      id: 'logical-json',
      fileName: 'card.json',
      mimeType: 'application/json',
      versionGroupId: current.id,
      metadata: { card: data, cardContentHash: 'legacy-json-hash' },
    }
    await storage.save(current)
    await storage.saveVersion(jsonCarrier)

    expect(await service.backfillCardFingerprints()).toBe(2)

    const storedCurrent = await storage.get(current.id)
    const [storedHistory] = await storage.listAllVersions()
    const [historySummary] = await storage.listVersionSummaries()
    const grouped = await service.listVersions(current.id)
    expect(storedHistory?.metadata.cardContentHash).toBe(storedCurrent?.metadata.cardContentHash)
    expect(historySummary?.metadata.cardContentHash).toBe(storedCurrent?.metadata.cardContentHash)
    expect(storedCurrent?.versionCount).toBe(1)
    expect(grouped).toHaveLength(1)
    expect(grouped[0]?.carriers).toHaveLength(2)

    database.close()
    await database.delete()
  })
})
