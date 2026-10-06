import 'fake-indexeddb/auto'

import { describe, expect, it, vi } from 'vitest'

import { AppDatabase } from '../database/AppDatabase'
import { VaultService } from '../services/VaultService'
import { CommunitySourceService } from '../services/CommunitySourceService'
import { RESOURCE_TYPE, type Resource } from '../types/Resource'
import { RESOURCE_GALLERY_ASSET_KIND } from '../types/ResourceGallery'
import { IndexedDbResourceStorage } from './IndexedDbResourceStorage'
import {
  COMMUNITY_SOURCE_MESSAGE_KIND,
  COMMUNITY_SOURCE_PLATFORM,
  isEncryptedCommunitySource,
  isEncryptedCommunitySourceMessage,
  isEncryptedResourceSourceBinding,
  type CommunitySource,
  type CommunitySourceMessage,
  type ResourceSourceBinding,
} from '../types/CommunitySource'
import { IndexedDbCommunitySourceStorage } from './IndexedDbCommunitySourceStorage'

const SOURCE_HASH = 'a'.repeat(64)
const MESSAGE_HASH = 'b'.repeat(64)
const RAW_MESSAGE_ID = 'message-secret-123'

function createStorage(database: AppDatabase): {
  storage: IndexedDbCommunitySourceStorage
  vault: VaultService
} {
  const vault = new VaultService(database)
  return { storage: new IndexedDbCommunitySourceStorage(database, vault), vault }
}

function createSource(): CommunitySource {
  return {
    id: crypto.randomUUID(),
    platform: COMMUNITY_SOURCE_PLATFORM.DISCORD,
    sourceKeyHash: SOURCE_HASH,
    guildId: 'guild-secret',
    channelId: 'thread-secret',
    threadId: 'thread-secret',
    starterMessageId: RAW_MESSAGE_ID,
    canonicalUrl: `https://discord.com/channels/guild-secret/thread-secret/${RAW_MESSAGE_ID}`,
    title: '发布帖',
    starterAuthorId: 'author-secret',
    starterAuthorName: '作者',
    forumTags: ['角色卡'],
    createdAt: 1,
    updatedAt: 2,
  }
}

function createMessage(source: CommunitySource, content: string): CommunitySourceMessage {
  return {
    id: `${source.id}:message:${MESSAGE_HASH}`,
    sourceId: source.id,
    messageKeyHash: MESSAGE_HASH,
    messageId: RAW_MESSAGE_ID,
    kind: COMMUNITY_SOURCE_MESSAGE_KIND.STARTER,
    authorId: 'author-secret',
    authorName: '作者',
    content,
    embeds: [],
    attachments: [],
    canonicalUrl: source.canonicalUrl,
    timestamp: '2026-08-27T00:00:00.000Z',
    capturedAt: 3,
    updatedAt: 3,
  }
}

describe('IndexedDbCommunitySourceStorage', () => {
  it.each([false, true])(
    'restores gallery and deleted-target posts without changing content (vault=%s)',
    async (encrypted) => {
      const database = new AppDatabase(`community-binding-repair-${crypto.randomUUID()}`)
      const { storage, vault } = createStorage(database)
      await vault.initialize()
      if (encrypted) await vault.enable('binding-repair-test-password')
      const resources = new IndexedDbResourceStorage(database, vault)
      const service = new CommunitySourceService(storage)
      const ordinary: Resource = {
        id: 'normal',
        name: '正常角色卡',
        description: '',
        type: RESOURCE_TYPE.CHARACTER_CARD,
        fileName: 'card.png',
        mimeType: 'image/png',
        fileSize: 1,
        contentHash: 'd'.repeat(64),
        originalBlob: new Blob(['x']),
        favorite: false,
        categoryId: null,
        tags: [],
        metadata: {},
        createdAt: 1,
        updatedAt: 4,
      }
      const gallery: Resource = {
        ...ordinary,
        id: 'gallery',
        type: RESOURCE_TYPE.OTHER,
        metadata: { assetKind: RESOURCE_GALLERY_ASSET_KIND, galleryOwnerId: ordinary.id },
      }
      try {
        await resources.save(ordinary)
        await resources.save(gallery)
        const sources = ['gallery-only', 'deleted-gallery', 'mixed'].map((id, index) => ({
          ...createSource(),
          id,
          sourceKeyHash: String(index + 1).repeat(64),
        }))
        for (const source of sources) {
          await storage.putSource(source)
          await storage.putMessage({
            ...createMessage(source, `完整正文-${source.id}`),
            attachments: [
              {
                id: 'attachment',
                name: 'data.json',
                size: 1,
                url: 'https://cdn.discordapp.com/attachments/1/2/data.json',
              },
            ],
          })
          await storage.putBinding({
            id: `${source.id}-bad`,
            sourceId: source.id,
            resourceId: source.id === 'deleted-gallery' ? 'removed-gallery' : 'gallery',
            createdAt: 5,
          })
        }
        const validBinding = {
          id: 'mixed-normal',
          sourceId: 'mixed',
          resourceId: 'normal',
          note: '保留有效关联',
          createdAt: 6,
        }
        await storage.putBinding(validBinding)
        const before = await storage.exportAll()
        expect(await storage.listUnboundSources()).toEqual([])
        const snapshot = await resources.listResourceListSummaries()
        expect(await service.repairInvalidResourceBindings(snapshot)).toBe(3)
        const after = await storage.exportAll()
        expect(after.sources).toEqual(before.sources)
        expect(after.messages).toEqual(before.messages)
        expect(after.bindings).toEqual([validBinding])
        expect((await service.listPendingSources()).map((view) => view.source.id).sort()).toEqual([
          'deleted-gallery',
          'gallery-only',
        ])
        expect(await service.repairInvalidResourceBindings(snapshot)).toBe(0)
        // Restoring an ordinary resource may preserve its timestamp; metadata must be rechecked.
        expect(
          await storage.repairInvalidResourceBindings(
            new Set(),
            new Map([['normal', ordinary.updatedAt]]),
          ),
        ).toBe(0)
        expect((await storage.exportAll()).bindings).toEqual([validBinding])
        await service.bindSource('normal', 'gallery-only')
        expect(await service.getSourceUsage('gallery-only')).toMatchObject([
          { resourceId: 'normal' },
        ])
        expect((await service.listPendingSources()).map((view) => view.source.id)).toEqual([
          'deleted-gallery',
        ])
      } finally {
        database.close()
        await database.delete()
      }
    },
  )

  it('preserves restored resources, changed gallery targets and missing summary indexes', async () => {
    const database = new AppDatabase(`community-repair-snapshot-${crypto.randomUUID()}`)
    const { storage } = createStorage(database)
    const source = createSource()
    try {
      await storage.putSource(source)
      for (const id of ['restored', 'changed', 'missing-summary']) {
        const resource: Resource = {
          id,
          name: id,
          description: '',
          type: RESOURCE_TYPE.OTHER,
          fileName: 'image.png',
          mimeType: 'image/png',
          fileSize: 1,
          contentHash: 'e'.repeat(64),
          originalBlob: new Blob(['x']),
          favorite: false,
          categoryId: null,
          tags: [],
          metadata: { assetKind: RESOURCE_GALLERY_ASSET_KIND },
          createdAt: 1,
          updatedAt: 9,
        }
        await database.resources.put(resource)
        if (id !== 'missing-summary') {
          const { originalBlob: _blob, ...summary } = resource
          await database.resourceSummaries.put(summary)
        }
        await storage.putBinding({
          id: `binding-${id}`,
          resourceId: id,
          sourceId: source.id,
          createdAt: 1,
        })
      }
      expect(
        await storage.repairInvalidResourceBindings(
          new Set(),
          new Map([
            ['changed', 8],
            ['missing-summary', 9],
          ]),
        ),
      ).toBe(0)
      expect((await storage.exportAll()).bindings).toHaveLength(3)
    } finally {
      database.close()
      await database.delete()
    }
  })

  it('refuses binding repair while the vault is locked', async () => {
    const database = new AppDatabase(`community-repair-locked-${crypto.randomUUID()}`)
    const { storage, vault } = createStorage(database)
    try {
      await vault.initialize()
      await vault.enable('binding-repair-test-password')
      const source = createSource()
      await storage.putSource(source)
      await storage.putMessage(createMessage(source, '需要保留的正文'))
      await storage.putBinding({
        id: 'orphan',
        resourceId: 'removed-gallery',
        sourceId: source.id,
        createdAt: 1,
      })
      vault.lock()
      await expect(storage.repairInvalidResourceBindings(new Set(), new Map())).rejects.toThrow(
        '解锁',
      )
      expect(await database.resourceSourceBindings.count()).toBe(1)
      expect(await database.communitySourceMessages.count()).toBe(1)
    } finally {
      database.close()
      await database.delete()
    }
  })

  it('rolls back removed orphan bindings if another target cannot be decoded', async () => {
    const database = new AppDatabase(`community-repair-rollback-${crypto.randomUUID()}`)
    const { storage, vault } = createStorage(database)
    try {
      await vault.initialize()
      await vault.enable('binding-repair-test-password')
      const source = createSource()
      await storage.putSource(source)
      await storage.putBinding({
        id: 'first-orphan',
        resourceId: 'a-missing',
        sourceId: source.id,
        createdAt: 1,
      })
      const resource: Resource = {
        id: 'z-gallery',
        name: '图库图',
        description: '',
        type: RESOURCE_TYPE.OTHER,
        fileName: 'image.png',
        mimeType: 'image/png',
        fileSize: 1,
        contentHash: 'f'.repeat(64),
        originalBlob: new Blob(['x']),
        favorite: false,
        categoryId: null,
        tags: [],
        metadata: { assetKind: RESOURCE_GALLERY_ASSET_KIND },
        createdAt: 1,
        updatedAt: 4,
      }
      await new IndexedDbResourceStorage(database, vault).save(resource)
      await storage.putBinding({
        id: 'second-gallery',
        resourceId: resource.id,
        sourceId: source.id,
        createdAt: 1,
      })
      const decode = vi
        .spyOn(vault, 'decodeResourceSummary')
        .mockRejectedValueOnce(new Error('解密失败'))
      await expect(
        storage.repairInvalidResourceBindings(new Set(), new Map([[resource.id, 4]])),
      ).rejects.toThrow('解密失败')
      expect(await database.resourceSourceBindings.count()).toBe(2)
      decode.mockRestore()
    } finally {
      database.close()
      await database.delete()
    }
  })

  it('stores sources, full message bodies and resource bindings independently', async () => {
    const database = new AppDatabase(`community-source-${crypto.randomUUID()}`)
    const { storage } = createStorage(database)
    const source = createSource()
    const content = '完整正文'.repeat(3_000)
    const message = createMessage(source, content)
    const binding: ResourceSourceBinding = {
      id: `resource-a:source:${source.id}`,
      resourceId: 'resource-a',
      sourceId: source.id,
      createdAt: 4,
    }

    await storage.putSource(source)
    await storage.putMessage(message)
    await storage.putBinding(binding)

    await expect(storage.getSourceByKeyHash(source.sourceKeyHash)).resolves.toMatchObject({
      title: '发布帖',
    })
    const storedMessages = await storage.listMessages(source.id)
    expect(storedMessages[0]?.content).toBe(content)
    await expect(storage.listBindingsForResource('resource-a')).resolves.toHaveLength(1)

    database.close()
    await database.delete()
  })

  it('returns only recent unbound sources within the requested limit', async () => {
    const database = new AppDatabase(`community-source-pending-${crypto.randomUUID()}`)
    const { storage } = createStorage(database)
    const older = {
      ...createSource(),
      sourceKeyHash: 'c'.repeat(64),
      title: '较早待整理',
      updatedAt: 10,
    }
    const bound = {
      ...createSource(),
      sourceKeyHash: 'd'.repeat(64),
      title: '已经关联',
      updatedAt: 20,
    }
    const newer = {
      ...createSource(),
      sourceKeyHash: 'e'.repeat(64),
      title: '最近待整理',
      updatedAt: 30,
    }

    await storage.putSource(older)
    await storage.putSource(bound)
    await storage.putSource(newer)
    await storage.putBinding({
      id: `resource-a:source:${bound.id}`,
      resourceId: 'resource-a',
      sourceId: bound.id,
      createdAt: 21,
    })

    const pending = await storage.listUnboundSources(2)
    expect(pending.map((source) => source.id)).toEqual([newer.id, older.id])

    database.close()
    await database.delete()
  })

  it('deleting a source cascades only its messages and bindings', async () => {
    const database = new AppDatabase(`community-source-delete-${crypto.randomUUID()}`)
    const { storage } = createStorage(database)
    const now = Date.now()
    const source: CommunitySource = {
      id: crypto.randomUUID(),
      platform: COMMUNITY_SOURCE_PLATFORM.DISCORD,
      sourceKeyHash: SOURCE_HASH,
      channelId: 'a',
      canonicalUrl: 'https://discord.com/channels/g/a/a',
      forumTags: [],
      createdAt: now,
      updatedAt: now,
    }
    await storage.putSource(source)
    await storage.putMessage({
      id: `${source.id}:message:${MESSAGE_HASH}`,
      sourceId: source.id,
      messageKeyHash: MESSAGE_HASH,
      messageId: 'a',
      kind: COMMUNITY_SOURCE_MESSAGE_KIND.SELECTED_COMMENT,
      authorId: 'u',
      authorName: 'U',
      content: '保留在本地的评论',
      embeds: [],
      attachments: [],
      canonicalUrl: 'https://discord.com/channels/g/a/a',
      timestamp: '2026-08-27T00:00:00.000Z',
      capturedAt: now,
      updatedAt: now,
    })
    await storage.putBinding({
      id: 'binding-a',
      resourceId: 'resource-a',
      sourceId: source.id,
      createdAt: now,
    })

    await storage.deleteSource(source.id)

    await expect(storage.getSource(source.id)).resolves.toBeUndefined()
    await expect(storage.listMessages(source.id)).resolves.toEqual([])
    await expect(storage.listBindingsForResource('resource-a')).resolves.toEqual([])
    database.close()
    await database.delete()
  })

  it('moves Discord payloads into AES-GCM Vault records without exposing message metadata in raw rows', async () => {
    const database = new AppDatabase(`community-source-vault-${crypto.randomUUID()}`)
    const { storage, vault } = createStorage(database)
    await vault.initialize()
    const source = createSource()
    const content = '保险箱完整正文'.repeat(2_000)
    const message = createMessage(source, content)
    const binding: ResourceSourceBinding = {
      id: `resource-a:source:${source.id}`,
      resourceId: 'resource-a',
      sourceId: source.id,
      note: '我的私密备注',
      createdAt: 4,
    }
    await storage.putSource(source)
    await storage.putMessage(message)
    await storage.putBinding(binding)

    await vault.enable('community-vault-password')
    await storage.migrateVaultMode('encrypted')

    const rawSource = await database.communitySources.get(source.id)
    const rawMessage = await database.communitySourceMessages.get(message.id)
    const rawBinding = await database.resourceSourceBindings.get(binding.id)
    expect(rawSource && isEncryptedCommunitySource(rawSource)).toBe(true)
    expect(rawMessage && isEncryptedCommunitySourceMessage(rawMessage)).toBe(true)
    expect(rawBinding && isEncryptedResourceSourceBinding(rawBinding)).toBe(true)
    expect(JSON.stringify(rawSource)).not.toContain('thread-secret')
    expect(JSON.stringify(rawSource)).not.toContain('发布帖')
    expect(JSON.stringify(rawMessage)).not.toContain(RAW_MESSAGE_ID)
    expect(JSON.stringify(rawMessage)).not.toContain('作者')
    expect(JSON.stringify(rawMessage)).not.toContain('保险箱完整正文')
    expect(JSON.stringify(rawBinding)).not.toContain('我的私密备注')

    const decoded = await storage.listMessages(source.id)
    expect(decoded[0]?.content).toBe(content)
    expect((await storage.getSource(source.id))?.channelId).toBe('thread-secret')
    expect((await storage.listBindingsForResource('resource-a'))[0]?.note).toBe('我的私密备注')

    await storage.migrateVaultMode('plain')
    await vault.disable()
    const plainMessage = await database.communitySourceMessages.get(message.id)
    expect(plainMessage && isEncryptedCommunitySourceMessage(plainMessage)).toBe(false)
    expect((plainMessage as CommunitySourceMessage).content).toBe(content)

    database.close()
    await database.delete()
  })

  it('reads and backfills a legacy encrypted source without summaryPayload', async () => {
    const database = new AppDatabase(`community-source-summary-backfill-${crypto.randomUUID()}`)
    const { storage, vault } = createStorage(database)
    await vault.initialize()
    await vault.enable('community-vault-password')
    const source = { ...createSource(), guildName: '社区 A', channelName: '角色发布' }
    await storage.putSource(source)

    const encrypted = await database.communitySources.get(source.id)
    expect(encrypted && isEncryptedCommunitySource(encrypted)).toBe(true)
    if (!encrypted || !isEncryptedCommunitySource(encrypted))
      throw new Error('missing encrypted source')
    const { summaryPayload: _summaryPayload, ...legacy } = encrypted
    await database.communitySources.put(legacy)

    await expect(storage.getSourceSummary(source.id)).resolves.toMatchObject({
      id: source.id,
      guildName: '社区 A',
      channelName: '角色发布',
      revisionCount: 0,
    })
    const backfilled = await database.communitySources.get(source.id)
    expect(backfilled && isEncryptedCommunitySource(backfilled)).toBe(true)
    expect(
      backfilled && isEncryptedCommunitySource(backfilled) && backfilled.summaryPayload,
    ).toBeDefined()

    database.close()
    await database.delete()
  })
})
