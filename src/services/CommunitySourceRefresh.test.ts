import { describe, expect, it } from 'vitest'

import type { CommunitySourceStorage } from '../storage/CommunitySourceStorage'
import {
  COMMUNITY_SOURCE_ATTACHMENT_LOCAL_STATE,
  COMMUNITY_SOURCE_MESSAGE_KIND,
  COMMUNITY_SOURCE_MESSAGE_REMOTE_STATE,
  COMMUNITY_SOURCE_REFRESH_MODE,
  COMMUNITY_SOURCE_REMOTE_STATE,
  type CommunitySource,
  type CommunitySourceBackupData,
  type CommunitySourceMessage,
  type DiscordCapture,
  type ResourceSourceBinding,
} from '../types/CommunitySource'
import { CommunitySourceService } from './CommunitySourceService'

class MemoryCommunitySourceStorage implements CommunitySourceStorage {
  readonly sources = new Map<string, CommunitySource>()
  readonly messages = new Map<string, CommunitySourceMessage>()
  readonly bindings = new Map<string, ResourceSourceBinding>()

  async getSource(id: string) {
    return this.sources.get(id)
  }

  async getSourceByKeyHash(sourceKeyHash: string) {
    return [...this.sources.values()].find((source) => source.sourceKeyHash === sourceKeyHash)
  }

  async putSource(source: CommunitySource) {
    this.sources.set(source.id, structuredClone(source))
  }

  async putSourceWithMessages(
    source: CommunitySource,
    messages: readonly CommunitySourceMessage[],
  ) {
    await this.putSource(source)
    for (const message of messages) await this.putMessage(message)
  }

  async deleteSource(id: string) {
    this.sources.delete(id)
    for (const [messageId, message] of this.messages) {
      if (message.sourceId === id) this.messages.delete(messageId)
    }
    for (const [bindingId, binding] of this.bindings) {
      if (binding.sourceId === id) this.bindings.delete(bindingId)
    }
  }

  async listUnboundSources(limit = 30) {
    const bound = new Set([...this.bindings.values()].map((binding) => binding.sourceId))
    return [...this.sources.values()].filter((source) => !bound.has(source.id)).slice(0, limit)
  }

  async listMessages(sourceId: string) {
    return [...this.messages.values()]
      .filter((message) => message.sourceId === sourceId)
      .sort((left, right) => left.capturedAt - right.capturedAt)
  }

  async getMessage(sourceId: string, messageKeyHash: string) {
    return [...this.messages.values()].find(
      (message) => message.sourceId === sourceId && message.messageKeyHash === messageKeyHash,
    )
  }

  async putMessage(message: CommunitySourceMessage) {
    this.messages.set(message.id, structuredClone(message))
  }

  async deleteMessage(id: string) {
    this.messages.delete(id)
  }

  async listBindingsForResource(resourceId: string) {
    return [...this.bindings.values()].filter((binding) => binding.resourceId === resourceId)
  }

  async listBindingsForSource(sourceId: string) {
    return [...this.bindings.values()].filter((binding) => binding.sourceId === sourceId)
  }

  async putBinding(binding: ResourceSourceBinding) {
    this.bindings.set(binding.id, structuredClone(binding))
  }

  async deleteBinding(id: string) {
    this.bindings.delete(id)
  }

  async exportAll(): Promise<CommunitySourceBackupData> {
    return {
      version: 1,
      sources: structuredClone([...this.sources.values()]),
      messages: structuredClone([...this.messages.values()]),
      bindings: structuredClone([...this.bindings.values()]),
    }
  }

  async mergeAll(data: CommunitySourceBackupData) {
    for (const source of data.sources) await this.putSource(source)
    for (const message of data.messages) await this.putMessage(message)
    for (const binding of data.bindings) await this.putBinding(binding)
  }

  async replaceAll(data: CommunitySourceBackupData) {
    this.sources.clear()
    this.messages.clear()
    this.bindings.clear()
    await this.mergeAll(data)
  }
}

function starter(content: string): DiscordCapture {
  return {
    guildId: '11111',
    channelId: '22222',
    threadId: '22222',
    starterMessageId: '22222',
    isStarter: true,
    messageId: '22222',
    canonicalUrl: 'https://discord.com/channels/11111/22222/22222',
    authorId: '33333',
    authorName: 'Author',
    content,
    timestamp: '2026-08-27T00:00:00.000Z',
    title: '帖子',
    forumTags: ['发布'],
    embeds: [],
    attachments: [],
  }
}

describe('CommunitySourceService Discord refresh', () => {
  it('clears a stale source-unavailable flag without advancing or discarding checkpoints', async () => {
    const storage = new MemoryCommunitySourceStorage()
    const service = new CommunitySourceService(storage)
    const created = await service.saveDiscordCapture(starter('v1'), { resourceId: 'resource' })
    const unavailable = await service.recordRemoteCheck(
      created.source.id,
      COMMUNITY_SOURCE_REMOTE_STATE.UNAVAILABLE,
      false,
      {
        remoteScanCursor: { lastSeenMessageId: '22222' },
        savedMessageCheckCursor: '22222',
      },
    )

    const cleared = await service.clearRemoteAvailability(created.source.id)

    expect(cleared).not.toHaveProperty('remoteState')
    expect(cleared).not.toHaveProperty('hasRemoteUpdate')
    expect(cleared.lastCheckedAt).toBe(unavailable.lastCheckedAt)
    expect(cleared.remoteScanCursor).toEqual({ lastSeenMessageId: '22222' })
    expect(cleared.savedMessageCheckCursor).toBe('22222')
  })

  it('stores manual refresh without advancing checkpoints and clears it after a real remote check', async () => {
    const storage = new MemoryCommunitySourceStorage()
    const service = new CommunitySourceService(storage)
    const created = await service.saveDiscordCapture(starter('v1'), { resourceId: 'resource' })
    const unavailable = await service.recordRemoteCheck(
      created.source.id,
      COMMUNITY_SOURCE_REMOTE_STATE.UNAVAILABLE,
      false,
      {
        remoteScanCursor: { lastSeenMessageId: '22222' },
        savedMessageCheckCursor: '22222',
      },
    )

    const manual = await service.recordManualRefresh(created.source.id)

    expect(manual.discordRefreshMode).toBe(COMMUNITY_SOURCE_REFRESH_MODE.MANUAL)
    expect(manual).not.toHaveProperty('remoteState')
    expect(manual).not.toHaveProperty('hasRemoteUpdate')
    expect(manual.lastCheckedAt).toBe(unavailable.lastCheckedAt)
    expect(manual.remoteScanCursor).toEqual({ lastSeenMessageId: '22222' })
    expect(manual.savedMessageCheckCursor).toBe('22222')

    const checked = await service.recordRemoteCheck(
      created.source.id,
      COMMUNITY_SOURCE_REMOTE_STATE.AVAILABLE,
    )
    expect(checked).not.toHaveProperty('discordRefreshMode')
  })

  it('keeps the old snapshot only when the user chooses to preserve it', async () => {
    const storage = new MemoryCommunitySourceStorage()
    const service = new CommunitySourceService(storage)
    const created = await service.saveDiscordCapture(starter('v1'), {
      resourceId: 'resource',
      kind: COMMUNITY_SOURCE_MESSAGE_KIND.STARTER,
    })

    const kept = await service.applyDiscordRefresh(created.source.id, [starter('v2')], {
      keepPrevious: true,
    })
    expect(kept.source.revisions).toHaveLength(1)
    expect(kept.source.revisions?.[0].messages[0].content).toBe('v1')
    expect(kept.messages[0].content).toBe('v2')

    const replaced = await service.applyDiscordRefresh(created.source.id, [starter('v3')], {
      keepPrevious: false,
    })
    expect(replaced.source.revisions).toEqual([])
    expect(replaced.messages[0].content).toBe('v3')
  })

  it('does not delete a local saved comment when the remote refresh omits it', async () => {
    const storage = new MemoryCommunitySourceStorage()
    const service = new CommunitySourceService(storage)
    const created = await service.saveDiscordCapture(starter('v1'), { resourceId: 'resource' })
    await service.saveDiscordCapture(
      {
        ...starter('selected comment'),
        isStarter: false,
        messageId: '44444',
        authorId: '55555',
        authorName: 'Reader',
        canonicalUrl: 'https://discord.com/channels/11111/22222/44444',
      },
      { kind: COMMUNITY_SOURCE_MESSAGE_KIND.SELECTED_COMMENT },
    )

    const refreshed = await service.applyDiscordRefresh(created.source.id, [starter('v2')], {
      keepPrevious: false,
    })
    expect(refreshed.messages.map((message) => message.messageId)).toEqual(['22222', '44444'])
    expect(refreshed.messages.find((message) => message.messageId === '44444')?.content).toBe(
      'selected comment',
    )
  })

  it('marks an old saved comment missing without deleting its archived body or local attachment', async () => {
    const storage = new MemoryCommunitySourceStorage()
    const service = new CommunitySourceService(storage)
    const created = await service.saveDiscordCapture(starter('v1'), { resourceId: 'resource' })
    await service.saveDiscordCapture(
      {
        ...starter('old selected comment'),
        isStarter: false,
        messageId: '44444',
        authorId: '55555',
        authorName: 'Reader',
        canonicalUrl: 'https://discord.com/channels/11111/22222/44444',
        attachments: [
          {
            id: 'attachment-1',
            name: 'archive.png',
            size: 10,
            url: 'https://cdn.discordapp.com/archive.png',
          },
        ],
      },
      { kind: COMMUNITY_SOURCE_MESSAGE_KIND.SELECTED_COMMENT },
    )
    const oldComment = [...storage.messages.values()].find(
      (message) => message.messageId === '44444',
    )
    expect(oldComment).toBeDefined()
    if (!oldComment) throw new Error('saved comment missing')
    await storage.putMessage({
      ...oldComment,
      attachments: [
        {
          ...oldComment.attachments[0],
          localAssetId: 'asset-archive',
          localState: COMMUNITY_SOURCE_ATTACHMENT_LOCAL_STATE.LOCAL,
        },
      ],
    })

    const refreshed = await service.applyDiscordRefresh(created.source.id, [], {
      keepPrevious: true,
      missingMessageIds: ['44444'],
      syncState: {
        remoteScanCursor: { lastSeenMessageId: '55555' },
        savedMessageCheckCursor: '44444',
      },
    })

    const missing = refreshed.messages.find((message) => message.messageId === '44444')
    expect(missing).toMatchObject({
      content: 'old selected comment',
      remoteState: COMMUNITY_SOURCE_MESSAGE_REMOTE_STATE.MISSING,
      attachments: [
        {
          id: 'attachment-1',
          localAssetId: 'asset-archive',
          localState: COMMUNITY_SOURCE_ATTACHMENT_LOCAL_STATE.LOCAL,
        },
      ],
    })
    expect(refreshed.source.revisions?.at(-1)?.messages).toContainEqual(
      expect.objectContaining({ messageId: '44444', content: 'old selected comment' }),
    )
    expect(refreshed.source).toMatchObject({
      remoteScanCursor: { lastSeenMessageId: '55555' },
      savedMessageCheckCursor: '44444',
    })
  })

  it('commits confirmed scan progress and clears both cursors when restoring a revision', async () => {
    const storage = new MemoryCommunitySourceStorage()
    const service = new CommunitySourceService(storage)
    const created = await service.saveDiscordCapture(starter('v1'), { resourceId: 'resource' })
    const refreshed = await service.applyDiscordRefresh(created.source.id, [starter('v2')], {
      keepPrevious: true,
      syncState: {
        remoteScanCursor: {
          lastSeenMessageId: '22222',
          pendingBeforeMessageId: '21111',
          pendingHighWaterMessageId: '29999',
        },
        savedMessageCheckCursor: '24444',
      },
    })

    expect(refreshed.source.remoteScanCursor).toEqual({
      lastSeenMessageId: '22222',
      pendingBeforeMessageId: '21111',
      pendingHighWaterMessageId: '29999',
    })
    expect(refreshed.source.savedMessageCheckCursor).toBe('24444')

    const revisionId = refreshed.source.revisions?.[0]?.id
    if (!revisionId) throw new Error('refresh revision missing')
    const restored = await service.restoreRevision(created.source.id, revisionId)
    expect(restored.source.remoteScanCursor).toBeUndefined()
    expect(restored.source.savedMessageCheckCursor).toBeUndefined()
    expect(restored.source.lastCheckedAt).toBeUndefined()
  })
})
