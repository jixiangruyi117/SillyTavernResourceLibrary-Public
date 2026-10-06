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
import * as captureHelpers from './CommunitySourceCapture'

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
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('CommunitySourceService archive hardening', () => {
  it('preserves known pin status for legacy captures and applies explicit unpin without duplicating a message', async () => {
    const service = new CommunitySourceService(new MemoryCommunitySourceStorage())
    const first = await service.saveDiscordCapture(
      { ...starter('same content'), pinned: true },
      { capturedAt: 2000 },
    )
    expect(first.messages[0]!.pinned).toBe(true)
    const legacy = await service.saveDiscordCapture(starter('same content'), { capturedAt: 3000 })
    expect(legacy.messages[0]!.pinned).toBe(true)
    const unpinned = await service.saveDiscordCapture(
      { ...starter('same content'), pinned: false },
      { capturedAt: 4000 },
    )
    expect(unpinned.messages[0]!.pinned).toBe(false)
    expect(unpinned.messages[0]!.id).toBe(first.messages[0]!.id)
    const stale = await service.saveDiscordCapture(
      { ...starter('same content'), pinned: true },
      { capturedAt: 1000 },
    )
    expect(stale.messages[0]!.pinned).toBe(false)
  })

  it('serializes captures from separate service instances without losing comments or bindings', async () => {
    // Resolve the same source hash together so both entries reach the storage boundary concurrently.
    const identity = vi.spyOn(captureHelpers, 'hashIdentity').mockResolvedValue('a'.repeat(64))
    const storage = new MemoryCommunitySourceStorage()
    const first = new CommunitySourceService(storage)
    const second = new CommunitySourceService(storage)
    const [a, b] = await Promise.all([
      first.saveDiscordCapture(starter('first'), { resourceId: 'resource-a' }),
      second.saveDiscordCapture(message('44444', '55555', 'Reader', 'second'), {
        resourceId: 'resource-b',
      }),
    ])
    expect(a.source.id).toBe(b.source.id)
    expect(storage.sources.size).toBe(1)
    expect((await storage.listMessages(b.source.id)).map((item) => item.content)).toEqual([
      'first',
      'second',
    ])
    expect(
      (await second.getSourceUsage(b.source.id)).map((item) => item.resourceId).sort(),
    ).toEqual(['resource-a', 'resource-b'])
    expect(b.source.messageCount).toBe(2)
    identity.mockRestore()
  })

  it('does not let an older delivery overwrite the saved message or its local attachments', async () => {
    const storage = new MemoryCommunitySourceStorage()
    const service = new CommunitySourceService(storage)
    const capture = starter('new body')
    const current = await service.saveDiscordCapture(capture, { capturedAt: 2_000 })
    await storage.putMessage({
      ...current.messages[0]!,
      attachments: [
        {
          id: 'new-attachment',
          name: 'new.txt',
          size: 3,
          url: 'https://cdn.discordapp.com/new.txt',
          localAssetId: 'local-new',
          localState: COMMUNITY_SOURCE_ATTACHMENT_LOCAL_STATE.LOCAL,
        },
      ],
    })
    const late = await service.saveDiscordCapture(
      { ...starter('old body'), title: 'old title', attachments: [] },
      { capturedAt: 1_000 },
    )
    expect(late.messages[0]?.content).toBe('new body')
    expect(late.messages[0]?.attachments[0]?.localAssetId).toBe('local-new')
    expect(late.messages[0]?.deliveryCapturedAt).toBe(2_000)
    expect(late.source.title).toBe(capture.title)
  })

  it('saves a late comment without replacing newer source display metadata', async () => {
    const service = new CommunitySourceService(new MemoryCommunitySourceStorage())
    await service.saveDiscordCapture(
      {
        ...starter('new starter'),
        title: 'new title',
        guildName: 'new guild',
        channelName: 'new channel',
        forumTags: ['new tag'],
      },
      { capturedAt: 2_000 },
    )
    const late = await service.saveDiscordCapture(
      {
        ...message('44444', '55555', 'Reader', 'late comment'),
        title: 'old title',
        guildName: 'old guild',
        channelName: 'old channel',
        forumTags: ['old tag'],
      },
      { capturedAt: 1_000 },
    )
    expect(late.messages.map((item) => item.content)).toEqual(['new starter', 'late comment'])
    expect(late.source).toMatchObject({
      title: 'new title',
      guildName: 'new guild',
      channelName: 'new channel',
      forumTags: ['new tag'],
      metadataCapturedAt: 2_000,
    })
    const latest = await service.saveDiscordCapture(
      { ...message('66666', '55555', 'Reader', 'latest comment'), title: 'latest title' },
      { capturedAt: 3_000 },
    )
    expect(latest.source.title).toBe('latest title')
    expect(latest.source.metadataCapturedAt).toBe(3_000)
  })

  it('uses the legacy source timestamp once without letting a late comment advance its metadata clock', async () => {
    const storage = new MemoryCommunitySourceStorage()
    const service = new CommunitySourceService(storage)
    const saved = await service.saveDiscordCapture(starter('starter'), { capturedAt: 2_000 })
    const legacy = { ...saved.source, updatedAt: 2_000 }
    delete legacy.metadataCapturedAt
    await storage.putSource(legacy)
    const late = await service.saveDiscordCapture(
      { ...message('44444', '55555', 'Reader', 'late'), title: 'old title' },
      { capturedAt: 1_000 },
    )
    expect(late.source.title).toBe(saved.source.title)
    expect(late.source.metadataCapturedAt).toBe(2_000)
    const latest = await service.saveDiscordCapture(
      { ...message('66666', '55555', 'Reader', 'latest'), title: 'latest title' },
      { capturedAt: 3_000 },
    )
    expect(latest.source.title).toBe('latest title')
    expect((await service.exportAll()).sources[0]?.metadataCapturedAt).toBe(3_000)
  })

  it('deduplicates concurrent deliveries and refreshed CDN links while keeping both resource bindings', async () => {
    const storage = new MemoryCommunitySourceStorage()
    const put = vi.fn(async () => ({ assetId: 'asset-local' }))
    const assets = { put, getBlob: vi.fn(async () => undefined) }
    const first = new CommunitySourceService(storage, assets)
    const second = new CommunitySourceService(storage, assets)
    const fetcher = vi.fn(async () => new Response('body'))
    vi.stubGlobal('fetch', fetcher)
    const capture = {
      ...starter('same'),
      attachments: [
        {
          id: 'file',
          name: 'file.txt',
          size: 4,
          url: 'https://cdn.discordapp.com/file.txt?ex=first',
        },
      ],
    }
    const [a, b] = await Promise.all([
      first.saveDiscordCapture(capture, { resourceId: 'resource-a', capturedAt: 1_000 }),
      second.saveDiscordCapture(
        {
          ...capture,
          attachments: capture.attachments.map((item) => ({
            ...item,
            url: 'https://cdn.discordapp.com/file.txt?ex=second',
          })),
        },
        { resourceId: 'resource-b', capturedAt: 2_000 },
      ),
    ])
    expect(storage.sources.size).toBe(1)
    expect(storage.messages.size).toBe(1)
    expect(a.source.id).toBe(b.source.id)
    expect(b.messages[0]?.deliveryCapturedAt).toBe(2_000)
    expect(b.messages[0]?.attachments[0]).toMatchObject({
      url: 'https://cdn.discordapp.com/file.txt?ex=second',
      localAssetId: 'asset-local',
    })
    expect(await second.getSourceUsage(b.source.id)).toHaveLength(2)
    expect(fetcher).toHaveBeenCalledOnce()
    expect(put).toHaveBeenCalledOnce()
  })

  it('rejects older or missing edit versions even when they were delivered later', async () => {
    const service = new CommunitySourceService(new MemoryCommunitySourceStorage())
    const latest = { ...starter('latest'), editedTimestamp: '2026-10-03T00:02:00.000Z' }
    await service.saveDiscordCapture(latest, { capturedAt: 2_000 })
    for (const editedTimestamp of ['2026-10-03T00:01:00.000Z', undefined]) {
      const received = await service.saveDiscordCapture(
        { ...starter('old'), editedTimestamp },
        { capturedAt: 3_000 },
      )
      expect(received.messages[0]?.content).toBe('latest')
      expect(received.messages[0]?.deliveryCapturedAt).toBe(2_000)
    }
    const newer = await service.saveDiscordCapture(
      {
        ...latest,
        content: 'newer',
        editedTimestamp: '2026-10-03T00:03:00.000Z',
      },
      { capturedAt: 4_000 },
    )
    expect(newer.messages[0]?.content).toBe('newer')
  })

  it('uses delivery time rather than message creation time and protects legacy saved edits', async () => {
    const storage = new MemoryCommunitySourceStorage()
    const service = new CommunitySourceService(storage)
    const saved = await service.saveDiscordCapture(
      { ...starter('latest'), timestamp: '2000-01-01T00:00:00.000Z' },
      { capturedAt: 2_000 },
    )
    const legacy = { ...saved.messages[0]!, updatedAt: 2_000 }
    delete legacy.deliveryCapturedAt
    await storage.putMessage(legacy)
    const old = await service.saveDiscordCapture(
      { ...starter('old'), timestamp: '2100-01-01T00:00:00.000Z' },
      { capturedAt: 1_000 },
    )
    expect(old.messages[0]?.content).toBe('latest')
    const current = await service.saveDiscordCapture(starter('current'), { capturedAt: 3_000 })
    expect(current.messages[0]?.content).toBe('current')
    expect((await service.exportAll()).messages[0]?.deliveryCapturedAt).toBe(3_000)
  })

  it('accepts a newer Discord edit despite a future local delivery clock', async () => {
    const service = new CommunitySourceService(new MemoryCommunitySourceStorage())
    await service.saveDiscordCapture(
      { ...starter('unmodified'), title: 'current metadata' },
      { capturedAt: 20_000 },
    )
    const edited = await service.saveDiscordCapture(
      { ...starter('first edit'), editedTimestamp: '2026-10-03T00:01:00.000Z' },
      { capturedAt: 1_000 },
    )
    expect(edited.messages[0]?.content).toBe('first edit')
    expect(edited.source.title).toBe('current metadata')
    expect(edited.source.metadataCapturedAt).toBe(20_000)
    await service.saveDiscordCapture(
      {
        ...starter('same edit'),
        title: 'latest metadata',
        editedTimestamp: '2026-10-03T00:01:00.000Z',
      },
      { capturedAt: 20_000 },
    )
    const newer = await service.saveDiscordCapture(
      { ...starter('newer edit'), editedTimestamp: '2026-10-03T00:02:00.000Z' },
      { capturedAt: 2_000 },
    )
    expect(newer.messages[0]?.content).toBe('newer edit')
    expect(newer.messages[0]?.deliveryCapturedAt).toBe(2_000)
    expect(newer.source.title).toBe('latest metadata')
    expect(newer.source.metadataCapturedAt).toBe(20_000)
    const oldVersion = await service.saveDiscordCapture(
      { ...starter('old edit'), editedTimestamp: '2026-10-03T00:01:00.000Z' },
      { capturedAt: 30_000 },
    )
    expect(oldVersion.messages[0]?.content).toBe('newer edit')
    expect(oldVersion.source.metadataCapturedAt).toBe(30_000)
  })

  it('releases a failed save so the same cloud capture can be retried and verified', async () => {
    const storage = new MemoryCommunitySourceStorage()
    const first = new CommunitySourceService(storage)
    const second = new CommunitySourceService(storage)
    vi.spyOn(storage, 'putSourceWithMessages').mockRejectedValueOnce(new Error('disk failure'))
    await expect(first.saveDiscordCapture(starter('body'), { capturedAt: 1_000 })).rejects.toThrow(
      'disk failure',
    )
    expect(storage.messages.size).toBe(0)
    const retried = await second.saveDiscordCapture(starter('body'), { capturedAt: 1_000 })
    expect(retried.messages[0]?.content).toBe('body')
    expect(storage.sources.size).toBe(1)
    expect(storage.messages.size).toBe(1)
  })

  it('rejects a successful storage call that did not persist the newer body', async () => {
    const storage = new MemoryCommunitySourceStorage()
    const service = new CommunitySourceService(storage)
    await service.saveDiscordCapture(starter('old'), { capturedAt: 1_000 })
    vi.spyOn(storage, 'putSourceWithMessages').mockResolvedValueOnce(undefined)
    await expect(service.saveDiscordCapture(starter('new'), { capturedAt: 2_000 })).rejects.toThrow(
      'Discord 消息保存后无法读回',
    )
    const recovered = await service.saveDiscordCapture(starter('new'), { capturedAt: 2_000 })
    expect(recovered.messages[0]?.content).toBe('new')
  })

  it('retries an attachment that failed locally even when the capture content has not changed', async () => {
    const storage = new MemoryCommunitySourceStorage()
    const put = vi
      .fn()
      .mockRejectedValueOnce(new Error('asset failure'))
      .mockResolvedValue({ assetId: 'recovered' })
    const service = new CommunitySourceService(storage, {
      put,
      getBlob: vi.fn(async () => undefined),
    })
    const fetcher = vi.fn(async () => new Response('body'))
    vi.stubGlobal('fetch', fetcher)
    const capture = {
      ...starter('body'),
      attachments: [
        { id: 'file', name: 'file.txt', size: 4, url: 'https://cdn.discordapp.com/file.txt' },
      ],
    }
    const failed = await service.saveDiscordCapture(capture, { capturedAt: 1_000 })
    expect(failed.messages[0]?.attachments[0]?.localState).toBe(
      COMMUNITY_SOURCE_ATTACHMENT_LOCAL_STATE.REMOTE_ONLY,
    )
    const retried = await service.saveDiscordCapture(capture, { capturedAt: 1_000 })
    expect(retried.messages[0]?.attachments[0]?.localAssetId).toBe('recovered')
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(put).toHaveBeenCalledTimes(2)
  })

  it('keeps deferred attachment completion from overwriting a newer delivery', async () => {
    const storage = new MemoryCommunitySourceStorage()
    const assets = {
      put: vi.fn(async () => ({ assetId: 'old-asset' })),
      getBlob: vi.fn(async () => undefined),
    }
    const first = new CommunitySourceService(storage, assets)
    const second = new CommunitySourceService(storage, assets)
    let start!: () => void, release!: () => void
    const started = new Promise<void>((resolve) => {
      start = resolve
    })
    const released = new Promise<void>((resolve) => {
      release = resolve
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        start()
        await released
        return new Response('body')
      }),
    )
    const saved = await first.saveDiscordCapture(
      {
        ...starter('old'),
        attachments: [
          { id: 'old', name: 'old.txt', size: 4, url: 'https://cdn.discordapp.com/old.txt' },
        ],
      },
      { capturedAt: 1_000, deferAttachmentLocalization: true },
    )
    const localization = first.localizeSavedMessageAttachments(
      saved.source.id,
      saved.messages[0]!.messageId,
    )
    await started
    const newer = second.saveDiscordCapture(
      {
        ...starter('new'),
        attachments: [
          { id: 'new', name: 'new.txt', size: 4, url: 'https://cdn.discordapp.com/new.txt' },
        ],
      },
      { capturedAt: 2_000, deferAttachmentLocalization: true },
    )
    release()
    await localization
    const result = await newer
    const readback = await second.findDiscordSourceForCapture(starter())
    expect(result.messages[0]?.content).toBe('new')
    expect(readback?.messages[0]?.content).toBe('new')
    expect(readback?.messages[0]?.attachments.map((item) => item.id)).toEqual(['new'])
    expect(readback?.messages[0]?.deliveryCapturedAt).toBe(2_000)
  })

  it('requests the existing browser lock mechanism per source and lets unrelated posts save independently', async () => {
    const storage = new MemoryCommunitySourceStorage()
    const service = new CommunitySourceService(storage)
    const request = vi.fn(async (_name: string, operation: () => Promise<unknown>) => operation())
    vi.stubGlobal('navigator', { locks: { request } })
    let release!: () => void, start!: () => void
    const started = new Promise<void>((resolve) => {
      start = resolve
    })
    const released = new Promise<void>((resolve) => {
      release = resolve
    })
    vi.spyOn(storage, 'putSourceWithMessages').mockImplementationOnce(async (source, messages) => {
      start()
      await released
      await storage.putSource(source)
      for (const item of messages) await storage.putMessage(item)
    })
    const pending = service.saveDiscordCapture(starter('first'), { capturedAt: 1_000 })
    await started
    const independent = await service.saveDiscordCapture(
      { ...starter('second'), threadId: '99999', channelId: '99999' },
      { capturedAt: 1_000 },
    )
    expect(independent.messages[0]?.content).toBe('second')
    release()
    await pending
    expect(request).toHaveBeenCalledTimes(2)
    expect(request.mock.calls[0]?.[0]).not.toBe(request.mock.calls[1]?.[0])
  })

  it('keeps an in-flight explicit refresh from overwriting a later delivery', async () => {
    vi.spyOn(captureHelpers, 'hashIdentity').mockResolvedValue('a'.repeat(64))
    vi.spyOn(captureHelpers, 'messageKeyHash').mockResolvedValue('b'.repeat(64))
    vi.spyOn(Date, 'now').mockReturnValue(2_000)
    const storage = new MemoryCommunitySourceStorage()
    const service = new CommunitySourceService(storage, {
      put: vi.fn(async () => ({ assetId: 'asset' })),
      getBlob: vi.fn(async () => undefined),
    })
    const saved = await service.saveDiscordCapture(starter('initial'), { capturedAt: 1_000 })
    let start!: () => void, release!: () => void
    const started = new Promise<void>((resolve) => {
      start = resolve
    })
    const released = new Promise<void>((resolve) => {
      release = resolve
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        start()
        await released
        return new Response('body')
      }),
    )
    const refreshing = service.applyDiscordRefresh(
      saved.source.id,
      [
        {
          ...starter('refresh'),
          attachments: [
            { id: 'file', name: 'file.txt', size: 4, url: 'https://cdn.discordapp.com/file.txt' },
          ],
        },
      ],
      { keepPrevious: true },
    )
    await started
    const delivery = service.saveDiscordCapture(starter('later delivery'), { capturedAt: 3_000 })
    // Let all ready storage operations finish while the older refresh still awaits its attachment.
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    release()
    await Promise.all([refreshing, delivery])
    const readback = await service.findDiscordSourceForCapture(starter())
    expect(readback?.messages[0]?.content).toBe('later delivery')
    expect(readback?.messages[0]?.deliveryCapturedAt).toBe(3_000)
    expect(readback?.source.revisions).toHaveLength(1)
  })

  it('preserves explicit refresh and restore decisions against previously captured deliveries', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(2_000)
    const storage = new MemoryCommunitySourceStorage()
    const service = new CommunitySourceService(storage)
    const initial = await service.saveDiscordCapture(starter('initial'), { capturedAt: 1_000 })
    const refreshed = await service.applyDiscordRefresh(initial.source.id, [starter('refresh')], {
      keepPrevious: true,
    })
    expect(refreshed.messages[0]?.deliveryCapturedAt).toBe(2_000)
    expect(refreshed.source.metadataCapturedAt).toBe(2_000)
    const late = await service.saveDiscordCapture(starter('late initial'), { capturedAt: 1_500 })
    expect(late.messages[0]?.content).toBe('refresh')
    vi.mocked(Date.now).mockReturnValue(3_000)
    const restored = await service.restoreRevision(
      initial.source.id,
      refreshed.source.revisions![0]!.id,
    )
    expect(restored.messages[0]?.deliveryCapturedAt).toBe(3_000)
    expect(restored.source.metadataCapturedAt).toBe(3_000)
    const lateRefresh = await service.saveDiscordCapture(starter('late refresh'), {
      capturedAt: 2_500,
    })
    expect(lateRefresh.messages[0]?.content).toBe('initial')
    expect(lateRefresh.source.revisions).toHaveLength(2)
  })

  it('publishes only the source hash after a successful binding and finds that local binding by hash', async () => {
    const storage = new MemoryCommunitySourceStorage()
    const service = new CommunitySourceService(storage)
    const saved = await service.saveDiscordCapture(starter('private body'))
    const events: CustomEvent<{ sourceKeyHash: string }>[] = []
    const target = new EventTarget()
    target.addEventListener('srl:community-source-bound', (event) => {
      events.push(event as CustomEvent<{ sourceKeyHash: string }>)
      expect(storage.bindings.size).toBe(1)
    })
    vi.stubGlobal('window', target)
    const putBinding = vi.spyOn(storage, 'putBinding')
    await service.bindSource('resource-a', saved.source.id)
    await service.bindSource('resource-a', saved.source.id)
    expect(putBinding).toHaveBeenCalledOnce()
    expect(events.map((event) => event.detail)).toEqual([
      { sourceKeyHash: saved.source.sourceKeyHash },
      { sourceKeyHash: saved.source.sourceKeyHash },
    ])
    expect(
      await service.getSourceUsageByKeyHash(saved.source.sourceKeyHash.toUpperCase()),
    ).toMatchObject([{ resourceId: 'resource-a', sourceId: saved.source.id }])
    expect(await service.getSourceUsageByKeyHash('0'.repeat(64))).toEqual([])
    await expect(service.getSourceUsageByKeyHash('invalid')).rejects.toThrow('社区来源哈希无效')
    putBinding.mockRejectedValueOnce(new Error('binding storage failed'))
    await expect(service.bindSource('resource-b', saved.source.id)).rejects.toThrow(
      'binding storage failed',
    )
    expect(events).toHaveLength(2)
  })

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
