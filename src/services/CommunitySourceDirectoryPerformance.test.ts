import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { CommunitySourceStorage } from '../storage/CommunitySourceStorage'
import {
  COMMUNITY_SOURCE_MESSAGE_KIND,
  COMMUNITY_SOURCE_PLATFORM,
  toCommunitySourceSummary,
  type CommunitySource,
  type CommunitySourceBackupData,
  type CommunitySourceMessage,
  type ResourceSourceBinding,
} from '../types/CommunitySource'
import { CommunitySourceService } from './CommunitySourceService'

const source: CommunitySource = {
  id: 'source-1',
  platform: COMMUNITY_SOURCE_PLATFORM.DISCORD,
  sourceKeyHash: 'a'.repeat(64),
  guildId: '11111',
  guildName: '社区 A',
  channelId: '22222',
  channelName: '角色发布',
  starterMessageId: '33333',
  canonicalUrl: 'https://discord.com/channels/11111/22222/33333',
  title: '帖子',
  forumTags: [],
  createdAt: 1,
  updatedAt: 1,
}

const message: CommunitySourceMessage = {
  id: 'message-1',
  sourceId: source.id,
  messageKeyHash: 'b'.repeat(64),
  messageId: '33333',
  kind: COMMUNITY_SOURCE_MESSAGE_KIND.STARTER,
  authorId: '44444',
  authorName: 'Author',
  content: '完整正文',
  embeds: [],
  attachments: [],
  canonicalUrl: source.canonicalUrl,
  timestamp: '2026-08-28T00:00:00.000Z',
  capturedAt: 1,
  updatedAt: 1,
}

const binding: ResourceSourceBinding = {
  id: 'resource-1:source:source-1',
  resourceId: 'resource-1',
  sourceId: source.id,
  createdAt: 1,
}

function storageMock(): CommunitySourceStorage {
  return {
    getSource: vi.fn(async (id) => (id === source.id ? structuredClone(source) : undefined)),
    getSourceSummary: vi.fn(async (id) =>
      id === source.id ? toCommunitySourceSummary(source) : undefined,
    ),
    getSourceByKeyHash: vi.fn(async () => undefined),
    putSource: vi.fn(async () => undefined),
    deleteSource: vi.fn(async () => undefined),
    listUnboundSources: vi.fn(async () => []),
    listMessages: vi.fn(async (sourceId) =>
      sourceId === source.id ? [structuredClone(message)] : [],
    ),
    getMessage: vi.fn(async () => undefined),
    putMessage: vi.fn(async () => undefined),
    deleteMessage: vi.fn(async () => undefined),
    listBindingsForResource: vi.fn(async (resourceId) =>
      resourceId === binding.resourceId ? [structuredClone(binding)] : [],
    ),
    listBindingsForSource: vi.fn(async () => [structuredClone(binding)]),
    putBinding: vi.fn(async () => undefined),
    deleteBinding: vi.fn(async () => undefined),
    exportAll: vi.fn(async (): Promise<CommunitySourceBackupData> => ({
      version: 1,
      sources: [],
      messages: [],
      bindings: [],
    })),
    mergeAll: vi.fn(async () => undefined),
    replaceAll: vi.fn(async () => undefined),
  }
}

describe('CommunitySourceService directory loading', () => {
  let storage: CommunitySourceStorage
  let service: CommunitySourceService

  beforeEach(() => {
    storage = storageMock()
    service = new CommunitySourceService(storage)
  })

  it('lists lightweight source summaries without reading message bodies', async () => {
    const summaries = await service.listSummariesForResource('resource-1')

    expect(summaries).toHaveLength(1)
    expect(summaries[0]?.source.guildName).toBe('社区 A')
    expect(storage.getSourceSummary).toHaveBeenCalledWith('source-1')
    expect(storage.listMessages).not.toHaveBeenCalled()
  })

  it('loads messages only when a selected source is opened and backfills its summary', async () => {
    const view = await service.getForResource('resource-1', 'source-1')

    expect(view?.messages).toHaveLength(1)
    expect(view?.source.messageCount).toBe(1)
    expect(view?.source.latestMessagePreview).toBe('完整正文')
    expect(storage.listMessages).toHaveBeenCalledTimes(1)
    expect(storage.putSource).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'source-1',
        messageCount: 1,
        missingMessageCount: 0,
        latestMessagePreview: '完整正文',
      }),
    )
  })
})
