import { afterEach, describe, expect, it, vi } from 'vitest'

import type { CommunitySourceStorage } from '../storage/CommunitySourceStorage'
import {
  COMMUNITY_SOURCE_ATTACHMENT_LOCAL_STATE,
  COMMUNITY_SOURCE_MESSAGE_KIND,
  COMMUNITY_SOURCE_MESSAGE_REMOTE_STATE,
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
    return structuredClone(this.sources.get(id))
  }

  async getSourceByKeyHash(sourceKeyHash: string) {
    const source = [...this.sources.values()].find((item) => item.sourceKeyHash === sourceKeyHash)
    return source ? structuredClone(source) : undefined
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

  async replaceSourceWithMessages(
    source: CommunitySource,
    messages: readonly CommunitySourceMessage[],
  ) {
    await this.putSource(source)
    for (const [id, message] of this.messages) {
      if (message.sourceId === source.id) this.messages.delete(id)
    }
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
    return [...this.sources.values()]
      .filter((source) => !bound.has(source.id))
      .slice(0, limit)
      .map((source) => structuredClone(source))
  }

  async listMessages(sourceId: string) {
    return [...this.messages.values()]
      .filter((message) => message.sourceId === sourceId)
      .sort((left, right) => left.capturedAt - right.capturedAt)
      .map((message) => structuredClone(message))
  }

  async getMessage(sourceId: string, messageKeyHash: string) {
    const message = [...this.messages.values()].find(
      (item) => item.sourceId === sourceId && item.messageKeyHash === messageKeyHash,
    )
    return message ? structuredClone(message) : undefined
  }

  async putMessage(message: CommunitySourceMessage) {
    this.messages.set(message.id, structuredClone(message))
  }

  async deleteMessage(id: string) {
    this.messages.delete(id)
  }

  async listBindingsForResource(resourceId: string) {
    return [...this.bindings.values()]
      .filter((binding) => binding.resourceId === resourceId)
      .map((binding) => structuredClone(binding))
  }

  async listBindingsForSource(sourceId: string) {
    return [...this.bindings.values()]
      .filter((binding) => binding.sourceId === sourceId)
      .map((binding) => structuredClone(binding))
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

function starter(content = 'starter'): DiscordCapture {
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

function message(
  messageId: string,
  authorId: string,
  authorName: string,
  content: string,
  authorBot = false,
): DiscordCapture {
  return {
    ...starter(content),
    isStarter: false,
    messageId,
    authorId,
    authorName,
    authorBot,
    canonicalUrl: `https://discord.com/channels/11111/22222/${messageId}`,
    timestamp: `2026-08-27T00:00:${messageId.slice(-2).padStart(2, '0')}.000Z`,
    title: undefined,
    forumTags: [],
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('CommunitySourceService archive hardening', () => {
  it('stores small Discord attachments locally but leaves large ones remote-only', async () => {
    const storage = new MemoryCommunitySourceStorage()
    const put = vi.fn(async () => ({ assetId: 'asset-local' }))
    const service = new CommunitySourceService(storage, {
      put,
      getBlob: vi.fn(async () => undefined),
    })
    const fetchMock = vi.fn(
      async () =>
        new Response(new Blob(['small'], { type: 'text/plain' }), {
          status: 200,
          headers: { 'content-length': '5' },
        }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const created = await service.saveDiscordCapture(
      {
        ...starter(),
        attachments: [
          {
            id: 'small',
            name: 'small.txt',
            size: 5,
            url: 'https://cdn.discordapp.com/attachments/a/small.txt',
            contentType: 'text/plain',
          },
          {
            id: 'large',
            name: 'large.bin',
            size: 9 * 1024 * 1024,
            url: 'https://cdn.discordapp.com/attachments/a/large.bin',
          },
        ],
      },
      { resourceId: 'resource-a' },
    )

    expect(created.messages[0].attachments[0]).toMatchObject({
      localAssetId: 'asset-local',
      localState: COMMUNITY_SOURCE_ATTACHMENT_LOCAL_STATE.LOCAL,
    })
    expect(created.messages[0].attachments[1]).toMatchObject({
      localState: COMMUNITY_SOURCE_ATTACHMENT_LOCAL_STATE.REMOTE_ONLY,
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(put).toHaveBeenCalledWith(
      expect.any(Blob),
      expect.objectContaining({ source: 'remote', vaultProtected: true }),
    )
  })

  it('persists the post body before deferred attachment localization starts', async () => {
    const storage = new MemoryCommunitySourceStorage()
    const service = new CommunitySourceService(storage, {
      put: vi.fn(async () => ({ assetId: 'asset-local' })),
      getBlob: vi.fn(async () => undefined),
    })
    const fetchMock = vi.fn(async () => new Response('attachment', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const created = await service.saveDiscordCapture(
      {
        ...starter('正文已保存'),
        attachments: [
          {
            id: 'deferred',
            name: 'deferred.txt',
            size: 10,
            url: 'https://cdn.discordapp.com/attachments/a/deferred.txt',
          },
        ],
      },
      { resourceId: 'resource-a', deferAttachmentLocalization: true },
    )

    expect(created.messages[0].content).toBe('正文已保存')
    expect(created.messages[0].attachments[0]?.localState).toBe(
      COMMUNITY_SOURCE_ATTACHMENT_LOCAL_STATE.REMOTE_ONLY,
    )
    expect(fetchMock).not.toHaveBeenCalled()
    expect((await storage.listMessages(created.source.id))[0]?.content).toBe('正文已保存')
  })

  it('keeps automatic attachment failures remote-only and persists explicit failures as failed', async () => {
    const storage = new MemoryCommunitySourceStorage()
    const service = new CommunitySourceService(storage, {
      put: vi.fn(async () => ({ assetId: 'unused' })),
      getBlob: vi.fn(async () => undefined),
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('denied', { status: 403 })),
    )

    const created = await service.saveDiscordCapture(
      {
        ...starter(),
        attachments: [
          {
            id: 'unavailable',
            name: 'unavailable.txt',
            size: 10,
            url: 'https://cdn.discordapp.com/attachments/a/unavailable.txt',
          },
        ],
      },
      { resourceId: 'resource-a', deferAttachmentLocalization: true },
    )

    await service.localizeSavedMessageAttachments(created.source.id, created.messages[0].messageId)
    expect((await storage.listMessages(created.source.id))[0]?.attachments[0]?.localState).toBe(
      COMMUNITY_SOURCE_ATTACHMENT_LOCAL_STATE.REMOTE_ONLY,
    )

    await expect(
      service.saveAttachmentToLocal(
        created.source.id,
        created.messages[0].messageId,
        'unavailable',
      ),
    ).rejects.toThrow('附件保存到本机失败')
    expect((await storage.listMessages(created.source.id))[0]?.attachments[0]?.localState).toBe(
      COMMUNITY_SOURCE_ATTACHMENT_LOCAL_STATE.FAILED,
    )
  })

  it('falls back from the Discord attachment URL to proxyUrl', async () => {
    const storage = new MemoryCommunitySourceStorage()
    const service = new CommunitySourceService(storage, {
      put: vi.fn(async () => ({ assetId: 'asset-proxy' })),
      getBlob: vi.fn(async () => undefined),
    })
    const fetchMock = vi.fn(async (input: RequestInfo | URL) =>
      String(input).includes('media.discordapp.net')
        ? new Response(new Blob(['proxy']), { status: 200 })
        : new Response('expired', { status: 404 }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const created = await service.saveDiscordCapture(
      {
        ...starter(),
        attachments: [
          {
            id: 'fallback',
            name: 'fallback.txt',
            size: 5,
            url: 'https://cdn.discordapp.com/attachments/a/fallback.txt',
            proxyUrl: 'https://media.discordapp.net/attachments/a/fallback.txt',
          },
        ],
      },
      { resourceId: 'resource-a' },
    )

    expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual([
      'https://cdn.discordapp.com/attachments/a/fallback.txt',
      'https://media.discordapp.net/attachments/a/fallback.txt',
    ])
    expect(created.messages[0].attachments[0]).toMatchObject({
      localAssetId: 'asset-proxy',
      localState: COMMUNITY_SOURCE_ATTACHMENT_LOCAL_STATE.LOCAL,
    })
  })

  it('records source and message remote checks concurrently without overwriting the source state', async () => {
    const storage = new MemoryCommunitySourceStorage()
    const service = new CommunitySourceService(storage)
    const created = await service.saveDiscordCapture(starter(), { resourceId: 'resource-a' })
    const putSource = vi.spyOn(storage, 'putSource')
    putSource.mockClear()

    await Promise.all([
      service.recordRemoteCheck(created.source.id, COMMUNITY_SOURCE_REMOTE_STATE.AVAILABLE, true),
      service.recordMessageRemoteCheck(created.source.id, [], [created.messages[0].messageId]),
    ])

    expect(putSource).toHaveBeenCalledTimes(1)
    expect(await storage.getSource(created.source.id)).toMatchObject({
      remoteState: COMMUNITY_SOURCE_REMOTE_STATE.AVAILABLE,
      hasRemoteUpdate: true,
    })
    expect((await storage.listMessages(created.source.id))[0]).toMatchObject({
      remoteState: COMMUNITY_SOURCE_MESSAGE_REMOTE_STATE.MISSING,
    })
  })

  it('keeps display names out of source identity while updating their local presentation values', async () => {
    const storage = new MemoryCommunitySourceStorage()
    const service = new CommunitySourceService(storage)
    const first = await service.saveDiscordCapture(
      { ...starter(), guildName: '旧社区名', channelName: '旧频道名' },
      { resourceId: 'resource-a' },
    )
    const second = await service.saveDiscordCapture({
      ...starter(),
      guildName: '新社区名',
      channelName: '新频道名',
    })

    expect(second.source.id).toBe(first.source.id)
    expect(storage.sources.size).toBe(1)
    expect(await storage.getSource(first.source.id)).toMatchObject({
      guildName: '新社区名',
      channelName: '新频道名',
    })
  })

  it('marks a deleted remote message missing without deleting its local body', async () => {
    const storage = new MemoryCommunitySourceStorage()
    const service = new CommunitySourceService(storage)
    const created = await service.saveDiscordCapture(starter('v1'), { resourceId: 'resource-a' })
    await service.saveDiscordCapture(message('44444', '55555', 'Reader', 'keep me'), {
      kind: COMMUNITY_SOURCE_MESSAGE_KIND.SELECTED_COMMENT,
    })

    const refreshed = await service.applyDiscordRefresh(created.source.id, [starter('v1')], {
      keepPrevious: false,
      missingMessageIds: ['44444'],
    })
    const local = refreshed.messages.find((item) => item.messageId === '44444')
    expect(local?.content).toBe('keep me')
    expect(local?.remoteState).toBe(COMMUNITY_SOURCE_MESSAGE_REMOTE_STATE.MISSING)
  })

  it('lets the user decline newly discovered messages while refreshing existing ones', async () => {
    const storage = new MemoryCommunitySourceStorage()
    const service = new CommunitySourceService(storage)
    const created = await service.saveDiscordCapture(starter('v1'), { resourceId: 'resource-a' })
    const authorUpdate = message('44444', '33333', 'Author', 'author update')
    const botUpdate = message('55555', '66666', 'Helper', 'bot update', true)

    const refreshed = await service.applyDiscordRefresh(
      created.source.id,
      [starter('v2'), authorUpdate, botUpdate],
      {
        keepPrevious: false,
        includeNewMessageIds: ['55555'],
      },
    )

    expect(refreshed.messages.find((item) => item.messageId === '22222')?.content).toBe('v2')
    expect(refreshed.messages.some((item) => item.messageId === '55555')).toBe(true)
    expect(refreshed.messages.some((item) => item.messageId === '44444')).toBe(false)
    expect(refreshed.source.ignoredRemoteMessageIds).toContain('44444')
  })

  it('remembers declined-only remote messages and explicit saving clears the ignore marker', async () => {
    const storage = new MemoryCommunitySourceStorage()
    const service = new CommunitySourceService(storage)
    const created = await service.saveDiscordCapture(starter('v1'), { resourceId: 'resource-a' })
    const authorUpdate = message('44444', '33333', 'Author', 'author update')

    const ignored = await service.ignoreRemoteMessages(created.source.id, ['44444'], {
      remoteScanCursor: { lastSeenMessageId: '44444' },
      savedMessageCheckCursor: '33333',
    })
    expect(ignored.ignoredRemoteMessageIds).toEqual(['44444'])
    expect(ignored.remoteScanCursor).toEqual({ lastSeenMessageId: '44444' })
    expect(ignored.savedMessageCheckCursor).toBe('33333')

    await service.saveDiscordCapture(authorUpdate, {
      kind: COMMUNITY_SOURCE_MESSAGE_KIND.AUTHOR_UPDATE,
    })
    const source = await storage.getSource(created.source.id)
    expect(source?.ignoredRemoteMessageIds).toEqual([])
    expect(
      (await storage.listMessages(created.source.id)).some((item) => item.messageId === '44444'),
    ).toBe(true)
  })

  it('keeps the ignored remote message list bounded to the latest 128 ids', async () => {
    const storage = new MemoryCommunitySourceStorage()
    const service = new CommunitySourceService(storage)
    const created = await service.saveDiscordCapture(starter('v1'), { resourceId: 'resource-a' })
    const ids = Array.from({ length: 150 }, (_, index) => String(70000 + index))

    const ignored = await service.ignoreRemoteMessages(created.source.id, ids)

    expect(ignored.ignoredRemoteMessageIds).toHaveLength(128)
    expect(ignored.ignoredRemoteMessageIds).toEqual(ids.slice(-128))
  })

  it('restores a revision exactly and keeps the pre-restore state as a rollback revision', async () => {
    const storage = new MemoryCommunitySourceStorage()
    const service = new CommunitySourceService(storage)
    const created = await service.saveDiscordCapture(starter('v1'), { resourceId: 'resource-a' })
    const v2 = await service.applyDiscordRefresh(created.source.id, [starter('v2')], {
      keepPrevious: true,
    })
    const revision = v2.source.revisions?.[0]
    expect(revision).toBeDefined()

    const restored = await service.restoreRevision(created.source.id, revision!.id)
    expect(restored.messages).toHaveLength(1)
    expect(restored.messages[0].content).toBe('v1')
    expect(restored.source.revisions).toHaveLength(2)
    expect(restored.source.revisions?.at(-1)?.messages[0].content).toBe('v2')
  })

  it('refuses to permanently delete a source that is still bound unless force is explicit', async () => {
    const storage = new MemoryCommunitySourceStorage()
    const service = new CommunitySourceService(storage)
    const created = await service.saveDiscordCapture(starter(), { resourceId: 'resource-a' })
    await service.bindSource('resource-b', created.source.id)

    await expect(service.deleteSource(created.source.id)).rejects.toThrow('仍被 2 个资源使用')
    expect(await service.getSourceUsage(created.source.id)).toHaveLength(2)

    await service.unbindSource('resource-a', created.source.id)
    await expect(service.deleteSource(created.source.id)).rejects.toThrow('仍被 1 个资源使用')

    await service.deleteSource(created.source.id, { force: true })
    expect(await storage.getSource(created.source.id)).toBeUndefined()
    expect(await service.getSourceUsage(created.source.id)).toHaveLength(0)
  })

  it('never leaves an empty source when deleting the final local message', async () => {
    const storage = new MemoryCommunitySourceStorage()
    const service = new CommunitySourceService(storage)
    const created = await service.saveDiscordCapture(starter(), { resourceId: 'resource-a' })

    await expect(
      service.deleteSavedMessage(created.source.id, created.messages[0].messageId),
    ).rejects.toThrow('最后一条本地内容')
    expect(await storage.getSource(created.source.id)).toBeDefined()
    expect(await storage.listMessages(created.source.id)).toHaveLength(1)

    await service.unbindSource('resource-a', created.source.id)
    await service.deleteSavedMessage(created.source.id, created.messages[0].messageId)
    expect(await storage.getSource(created.source.id)).toBeUndefined()
    expect(await storage.listMessages(created.source.id)).toHaveLength(0)
  })

  it('finds an existing Discord source so duplicate adds can reuse its binding and messages', async () => {
    const storage = new MemoryCommunitySourceStorage()
    const service = new CommunitySourceService(storage)
    const created = await service.saveDiscordCapture(starter(), { resourceId: 'resource-a' })

    const found = await service.findDiscordSourceForCapture(starter())
    expect(found?.source.id).toBe(created.source.id)
    expect(found?.messages).toHaveLength(1)
    expect(found?.bindings.map((binding) => binding.resourceId)).toEqual(['resource-a'])
  })
})
