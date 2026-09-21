import 'fake-indexeddb/auto'

import { describe, expect, it } from 'vitest'

import { AppDatabase } from '../database/AppDatabase'
import { VaultService } from '../services/VaultService'
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
