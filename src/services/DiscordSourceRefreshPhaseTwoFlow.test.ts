import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  COMMUNITY_SOURCE_MESSAGE_KIND,
  COMMUNITY_SOURCE_PLATFORM,
  type CommunitySourceMessage,
  type DiscordCapture,
  type ResourceCommunitySourceView,
} from '../types/CommunitySource'
import {
  readDiscordSourceRemote,
  selectDiscordSavedMessageHealthCheckIds,
} from './DiscordSourceRefreshService'

vi.mock('./DiscordSourceSettingsService', () => ({
  loadDiscordSourceConnectionSettings: () => ({
    workerBaseUrl: 'https://bridge.example',
    botToken: 'token',
  }),
}))

function capture(messageId: string, content = `message-${messageId}`): DiscordCapture {
  return {
    guildId: '11111',
    channelId: '22222',
    threadId: '22222',
    starterMessageId: '22222',
    isStarter: messageId === '22222',
    messageId,
    canonicalUrl: `https://discord.com/channels/11111/22222/${messageId}`,
    authorId: '33333',
    authorName: 'Author',
    content,
    timestamp: '2026-08-28T00:00:00.000Z',
    embeds: [],
    attachments: [],
  }
}

function savedMessage(messageId: string): CommunitySourceMessage {
  const item = capture(messageId)
  return {
    id: `source:message:${messageId}`,
    sourceId: 'source',
    messageKeyHash: `hash-${messageId}`,
    messageId,
    kind:
      messageId === '22222'
        ? COMMUNITY_SOURCE_MESSAGE_KIND.STARTER
        : COMMUNITY_SOURCE_MESSAGE_KIND.SELECTED_COMMENT,
    authorId: item.authorId,
    authorName: item.authorName,
    content: item.content,
    embeds: [],
    attachments: [],
    canonicalUrl: item.canonicalUrl,
    timestamp: item.timestamp,
    capturedAt: Number(messageId),
    updatedAt: Number(messageId),
  }
}

function view(messageIds: readonly string[] = ['22222']): ResourceCommunitySourceView {
  return {
    source: {
      id: 'source',
      platform: COMMUNITY_SOURCE_PLATFORM.DISCORD,
      sourceKeyHash: 'source-key',
      guildId: '11111',
      channelId: '22222',
      threadId: '22222',
      starterMessageId: '22222',
      starterAuthorId: '33333',
      canonicalUrl: 'https://discord.com/channels/11111/22222/22222',
      forumTags: [],
      remoteScanCursor: { lastSeenMessageId: '22222' },
      lastCheckedAt: 1,
      createdAt: 1,
      updatedAt: 1,
    },
    messages: messageIds.map(savedMessage),
    binding: {
      id: 'resource:source:source',
      resourceId: 'resource',
      sourceId: 'source',
      createdAt: 1,
    },
  }
}

function response(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('Discord refresh phase two checkpoint flow', () => {
  it('does not run health checks or advance checkpoints when the Bot cannot access the guild', async () => {
    const current = view(['22222', '30000'])
    const paths: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        const url = new URL(input instanceof Request ? input.url : input.toString())
        paths.push(url.pathname)
        return response({ state: 'uncheckable', reason: 'bot_access', stage: 'channel' })
      }),
    )

    const result = await readDiscordSourceRemote(current)

    expect(result).toEqual({ state: 'uncheckable', reason: 'bot_access', stage: 'channel' })
    expect(paths).toEqual(['/source/read'])
    expect(current.source.remoteScanCursor).toEqual({ lastSeenMessageId: '22222' })
    expect(current.source.savedMessageCheckCursor).toBeUndefined()
  })

  it('fails closed when an old Bridge reports unavailable without a checked failure stage', async () => {
    const current = view()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response({ state: 'unavailable', reason: 'not_found' })),
    )

    await expect(readDiscordSourceRemote(current)).resolves.toEqual({
      state: 'uncheckable',
      reason: 'read_failed',
      stage: 'channel',
    })
  })

  it('reuses a saved message already captured by the incremental page instead of GETing it again', async () => {
    const current = view(['22222', '30000'])
    const paths: string[] = []
    let sourceBody: Record<string, unknown> | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(input instanceof Request ? input.url : input.toString())
        paths.push(url.pathname)
        if (url.pathname !== '/source/read') throw new Error(`unexpected request: ${url}`)
        sourceBody = JSON.parse(String(init?.body)) as Record<string, unknown>
        return response({
          state: 'available',
          captures: [capture('22222'), capture('30000')],
          missingMessageIds: [],
          scanCursor: { lastSeenMessageId: '30000' },
        })
      }),
    )

    const result = await readDiscordSourceRemote(current)

    expect(paths).toEqual(['/source/read'])
    expect(sourceBody?.scanMessageIds).toEqual(['22222', '30000'])
    expect(result).toMatchObject({
      state: 'available',
      syncState: { savedMessageCheckCursor: '30000' },
    })
  })

  it('does not mutate a checkpoint while a refresh diff is awaiting the user decision', async () => {
    const current = view()
    const sourceBodies: Array<Record<string, unknown>> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(input instanceof Request ? input.url : input.toString())
        if (url.pathname !== '/source/read') throw new Error(`unexpected request: ${url}`)
        sourceBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
        return response({
          state: 'available',
          captures: [capture('22222'), capture('22223')],
          missingMessageIds: [],
          scanCursor: { lastSeenMessageId: '22223' },
        })
      }),
    )

    const first = await readDiscordSourceRemote(current)
    const second = await readDiscordSourceRemote(current)

    expect(first).toMatchObject({
      state: 'available',
      diff: { newMessages: 1 },
      syncState: { remoteScanCursor: { lastSeenMessageId: '22223' } },
    })
    expect(second).toMatchObject({ state: 'available', diff: { newMessages: 1 } })
    expect(sourceBodies.map((body) => body.scanCursor)).toEqual([
      { lastSeenMessageId: '22222' },
      { lastSeenMessageId: '22222' },
    ])
    expect(current.source.remoteScanCursor).toEqual({ lastSeenMessageId: '22222' })
  })

  it('advances the health cursor only through the continuously checked prefix after 429', async () => {
    const current = view(['22222', '30000', '40000', '50000'])
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        const url = new URL(input instanceof Request ? input.url : input.toString())
        if (url.pathname === '/source/read') {
          return response({
            state: 'available',
            captures: [capture('22222')],
            missingMessageIds: [],
            scanCursor: { lastSeenMessageId: '22222' },
          })
        }
        if (url.pathname === '/source/messages/check') {
          return response({
            state: 'available',
            captures: [capture('30000'), capture('50000')],
            missingMessageIds: [],
            checkedMessageIds: ['30000', '50000'],
            rateLimited: true,
            retryAfterMs: 1500,
          })
        }
        throw new Error(`unexpected request: ${url}`)
      }),
    )

    const result = await readDiscordSourceRemote(current)

    expect(result).toMatchObject({
      state: 'available',
      rateLimited: true,
      retryAfterMs: 1500,
      syncState: { savedMessageCheckCursor: '30000' },
    })
    expect(current.messages.find((item) => item.messageId === '40000')?.remoteState).toBeUndefined()
    expect(
      current.messages.find((item) => item.messageId === '40000')?.lastRemoteCheckedAt,
    ).toBeUndefined()
  })

  it.each([30, 100, 500])('eventually rotates through all %i locally saved messages', (count) => {
    const ids = Array.from({ length: count }, (_, index) => String(70000 + index))
    const current = view(ids)
    const checked = new Set<string>()

    for (let round = 0; round < Math.ceil(count / 12); round += 1) {
      const batch = selectDiscordSavedMessageHealthCheckIds(current, [])
      for (const id of batch) checked.add(id)
      current.source.savedMessageCheckCursor = batch.at(-1)
    }

    expect(checked).toEqual(new Set(ids))
  })
})
