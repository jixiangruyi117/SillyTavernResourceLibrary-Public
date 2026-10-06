import { fileURLToPath } from 'node:url'

import { build } from 'esbuild'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

const SOURCE_URL = 'https://bridge.example/source/read'
const HEALTH_URL = 'https://bridge.example/source/messages/check'
const THREAD_ID = '22222'
const STARTER_ID = THREAD_ID
const STARTER_AUTHOR_ID = '55555'

type WorkerModule = {
  fetch(request: Request, env: unknown, context: unknown): Promise<Response>
}

let discordSourceWorker: WorkerModule

const env = {
  DISCORD_APPLICATION_ID: '12345',
  DISCORD_PUBLIC_KEY: 'public-key',
  DISCORD_BOT_TOKEN: 'bot-token',
}

const context = {
  waitUntil: () => undefined,
  passThroughOnException: () => undefined,
  props: {},
}

function json(value: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(value), {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  })
}

function message(id: string, authorId = STARTER_AUTHOR_ID): Record<string, unknown> {
  return {
    id,
    author: { id: authorId, username: `author-${authorId}` },
    content: `message-${id}`,
    timestamp: '2026-08-28T00:00:00.000Z',
    embeds: [],
    attachments: [],
  }
}

async function postWorker(path: string, body: unknown): Promise<Record<string, unknown>> {
  const response = await discordSourceWorker.fetch(
    new Request(path, {
      method: 'POST',
      headers: { Authorization: 'Bearer bot-token', 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    env,
    context,
  )
  expect(response.status).toBe(200)
  return (await response.json()) as Record<string, unknown>
}

function installSourceApi(messageIds: readonly string[]): string[] {
  const calls: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request) => {
      const url = new URL(input instanceof Request ? input.url : input.toString())
      calls.push(`${url.pathname}${url.search}`)
      if (url.pathname === `/api/v10/channels/${THREAD_ID}`) {
        return json({ id: THREAD_ID, type: 11, parent_id: '33333', name: 'thread' })
      }
      if (url.pathname === '/api/v10/channels/33333') {
        return json({ id: '33333', type: 15, name: 'forum', available_tags: [] })
      }
      if (url.pathname === '/api/v10/guilds/11111') return json({ id: '11111', name: 'Guild' })
      if (url.pathname === `/api/v10/channels/${THREAD_ID}/messages/${STARTER_ID}`) {
        return json(message(STARTER_ID))
      }
      if (url.pathname === `/api/v10/channels/${THREAD_ID}/messages`) {
        const after = url.searchParams.get('after')
        const before = url.searchParams.get('before')
        const page = [...messageIds]
          .filter((id) => !after || BigInt(id) > BigInt(after))
          .filter((id) => !before || BigInt(id) < BigInt(before))
          .sort((left, right) => (BigInt(left) > BigInt(right) ? -1 : 1))
          .slice(0, 100)
          .map((id) => message(id))
        return json(page)
      }
      throw new Error(`unexpected Discord request: ${url}`)
    }),
  )
  return calls
}

function sourceReadBody(scanCursor: Record<string, string>): Record<string, unknown> {
  return {
    guildId: '11111',
    channelId: THREAD_ID,
    threadId: THREAD_ID,
    starterMessageId: STARTER_ID,
    savedMessageIds: [],
    scanCursor,
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

beforeAll(async () => {
  const compiled = await build({
    entryPoints: [
      fileURLToPath(new URL('../../workers/discord-source-bridge/src/index.ts', import.meta.url)),
    ],
    bundle: true,
    write: false,
    format: 'esm',
    target: 'es2022',
    platform: 'browser',
  })
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0]!.text).toString('base64')}`
  const loaded = (await import(/* @vite-ignore */ moduleUrl)) as { default: WorkerModule }
  discordSourceWorker = loaded.default
})

describe('Discord source Worker phase two behavior', () => {
  it('keeps initial reads for a specific ordinary-channel message working', async () => {
    const selectedId = '33333'
    const requested: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        const url = new URL(input instanceof Request ? input.url : input.toString())
        requested.push(url.pathname)
        if (url.pathname === `/api/v10/channels/${THREAD_ID}`) {
          return json({ id: THREAD_ID, type: 0, name: 'ordinary-channel' })
        }
        if (url.pathname === `/api/v10/channels/${THREAD_ID}/messages/${selectedId}`) {
          return json(message(selectedId, '70000'))
        }
        if (url.pathname === '/api/v10/guilds/11111') {
          return json({ id: '11111', name: 'Guild' })
        }
        throw new Error(`unexpected Discord request: ${url}`)
      }),
    )

    const result = await postWorker(SOURCE_URL, {
      guildId: '11111',
      channelId: THREAD_ID,
      savedMessageIds: [selectedId],
    })

    expect(result.state).toBe('available')
    expect((result.captures as Array<{ messageId: string }>).map((item) => item.messageId)).toEqual(
      [selectedId],
    )
    expect(requested).toHaveLength(3)
    expect(requested.some((path) => path.endsWith('/messages'))).toBe(false)
  })

  it('keeps a user-installed source as uncheckable when the Bot is not in its guild', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 404 })),
    )

    const result = await postWorker(SOURCE_URL, sourceReadBody({ lastSeenMessageId: '50000' }))

    expect(result).toEqual({ state: 'uncheckable', reason: 'bot_access', stage: 'channel' })
  })

  it('keeps a guild source as uncheckable when the Bot lacks channel permission', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        const url = new URL(input instanceof Request ? input.url : input.toString())
        return url.pathname === '/api/v10/guilds/11111'
          ? json({ id: '11111', name: 'Guild' })
          : new Response('', { status: 403 })
      }),
    )

    const result = await postWorker(SOURCE_URL, sourceReadBody({ lastSeenMessageId: '50000' }))

    expect(result).toEqual({ state: 'uncheckable', reason: 'forbidden', stage: 'channel' })
  })

  it('marks a source unavailable only when the Bot can access the guild but the channel is gone', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        const url = new URL(input instanceof Request ? input.url : input.toString())
        return url.pathname === '/api/v10/guilds/11111'
          ? json({ id: '11111', name: 'Guild' })
          : new Response('', { status: 404 })
      }),
    )

    const result = await postWorker(SOURCE_URL, sourceReadBody({ lastSeenMessageId: '50000' }))

    expect(result).toEqual({ state: 'unavailable', reason: 'not_found', stage: 'channel' })
  })

  it('does not promote a thread-page read failure into source deletion', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        const url = new URL(input instanceof Request ? input.url : input.toString())
        if (url.pathname === `/api/v10/channels/${THREAD_ID}`) {
          return json({ id: THREAD_ID, type: 11, parent_id: '33333', name: 'thread' })
        }
        if (url.pathname === '/api/v10/guilds/11111') {
          return json({ id: '11111', name: 'Guild' })
        }
        if (url.pathname === '/api/v10/channels/33333') {
          return json({ id: '33333', type: 15, name: 'forum', available_tags: [] })
        }
        if (url.pathname === `/api/v10/channels/${THREAD_ID}/messages/${STARTER_ID}`) {
          return json(message(STARTER_ID))
        }
        if (url.pathname === `/api/v10/channels/${THREAD_ID}/messages`) {
          return new Response('', { status: 404 })
        }
        throw new Error(`unexpected Discord request: ${url}`)
      }),
    )

    const result = await postWorker(SOURCE_URL, sourceReadBody({ lastSeenMessageId: '50000' }))

    expect(result).toEqual({ state: 'uncheckable', reason: 'read_failed', stage: 'messages' })
  })

  it.each([25, 150])(
    'incrementally reads %i new messages without a full-history rescan',
    async (count) => {
      const ids = Array.from({ length: count }, (_, index) => String(50001 + index))
      const calls = installSourceApi(ids)

      const result = await postWorker(SOURCE_URL, sourceReadBody({ lastSeenMessageId: '50000' }))

      expect(
        (result.captures as Array<{ messageId: string }>).map((item) => item.messageId),
      ).toEqual(expect.arrayContaining(ids))
      expect(result.scanCursor).toEqual({ lastSeenMessageId: ids.at(-1) })
      const pageCalls = calls.filter((call) => call.includes(`/messages?`))
      expect(pageCalls).toHaveLength(count <= 100 ? 1 : 2)
      expect(calls).toHaveLength(count <= 100 ? 5 : 6)
    },
  )

  it('returns a rotating saved id found in a scan page without collecting other participants', async () => {
    const savedId = '50002'
    const calls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        const url = new URL(input instanceof Request ? input.url : input.toString())
        calls.push(`${url.pathname}${url.search}`)
        if (url.pathname === `/api/v10/channels/${THREAD_ID}`) {
          return json({ id: THREAD_ID, type: 11, parent_id: '33333', name: 'thread' })
        }
        if (url.pathname === '/api/v10/channels/33333') {
          return json({ id: '33333', type: 15, name: 'forum', available_tags: [] })
        }
        if (url.pathname === '/api/v10/guilds/11111') return json({ id: '11111', name: 'Guild' })
        if (url.pathname === `/api/v10/channels/${THREAD_ID}/messages/${STARTER_ID}`) {
          return json(message(STARTER_ID))
        }
        if (url.pathname === `/api/v10/channels/${THREAD_ID}/messages`) {
          return json([message('50003', '80000'), message(savedId, '70000')])
        }
        throw new Error(`unexpected Discord request: ${url}`)
      }),
    )

    const result = await postWorker(SOURCE_URL, {
      ...sourceReadBody({ lastSeenMessageId: '50000' }),
      scanMessageIds: [savedId],
    })

    const capturedIds = (result.captures as Array<{ messageId: string }>).map(
      (item) => item.messageId,
    )
    expect(capturedIds).toContain(savedId)
    expect(capturedIds).not.toContain('50003')
    expect(calls.some((call) => call.endsWith(`/messages/${savedId}`))).toBe(false)
  })

  it('keeps a continuation after 300 messages and resumes without a message gap', async () => {
    const ids = Array.from({ length: 350 }, (_, index) => String(50001 + index))
    const firstCalls = installSourceApi(ids)

    const first = await postWorker(SOURCE_URL, sourceReadBody({ lastSeenMessageId: '50000' }))
    const firstCursor = first.scanCursor as Record<string, string>
    expect(firstCursor).toEqual({
      lastSeenMessageId: '50000',
      pendingBeforeMessageId: '50051',
      pendingHighWaterMessageId: '50350',
    })
    expect(firstCalls.filter((call) => call.includes('/messages?'))).toHaveLength(3)
    expect(firstCalls).toHaveLength(7)

    const secondCalls = installSourceApi(ids)
    const second = await postWorker(SOURCE_URL, sourceReadBody(firstCursor))
    expect(second.scanCursor).toEqual({ lastSeenMessageId: '50350' })
    expect(secondCalls.filter((call) => call.includes('/messages?'))).toHaveLength(1)

    const captured = new Set([
      ...(first.captures as Array<{ messageId: string }>).map((item) => item.messageId),
      ...(second.captures as Array<{ messageId: string }>).map((item) => item.messageId),
    ])
    for (const id of ids) expect(captured.has(id)).toBe(true)
  })

  it('checks at most 12 saved ids with concurrency 2', async () => {
    const ids = Array.from({ length: 15 }, (_, index) => String(60000 + index))
    let active = 0
    let maxActive = 0
    const requested: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        const url = new URL(input instanceof Request ? input.url : input.toString())
        const id = url.pathname.split('/').at(-1) ?? ''
        requested.push(id)
        active += 1
        maxActive = Math.max(maxActive, active)
        await Promise.resolve()
        active -= 1
        return json(message(id, '70000'))
      }),
    )

    const result = await postWorker(HEALTH_URL, {
      channelId: THREAD_ID,
      threadId: THREAD_ID,
      starterMessageId: STARTER_ID,
      messageIds: ids,
    })

    expect(requested).toHaveLength(12)
    expect(maxActive).toBe(2)
    expect(result.checkedMessageIds).toHaveLength(12)
  })

  it('stops scheduling after a mid-batch 429 and does not infer unchecked ids as missing', async () => {
    const ids = Array.from({ length: 12 }, (_, index) => String(61000 + index))
    const requested: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        const url = new URL(input instanceof Request ? input.url : input.toString())
        const id = url.pathname.split('/').at(-1) ?? ''
        requested.push(id)
        if (id === ids[1]) {
          return json({ retry_after: 2.5 }, { status: 429, headers: { 'Retry-After': '2.5' } })
        }
        await new Promise<void>((resolve) => setTimeout(resolve, 5))
        return json(message(id, '70000'))
      }),
    )

    const result = await postWorker(HEALTH_URL, {
      channelId: THREAD_ID,
      threadId: THREAD_ID,
      starterMessageId: STARTER_ID,
      messageIds: ids,
    })

    expect(requested).toEqual(ids.slice(0, 2))
    expect(result).toMatchObject({
      checkedMessageIds: [ids[0]],
      missingMessageIds: [],
      rateLimited: true,
      retryAfterMs: 2500,
    })
  })

  it('marks only an actual message 404 as missing', async () => {
    const oldId = '62000'
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 404 })),
    )

    const result = await postWorker(HEALTH_URL, {
      channelId: THREAD_ID,
      threadId: THREAD_ID,
      starterMessageId: STARTER_ID,
      messageIds: [oldId],
    })

    expect(result).toMatchObject({
      checkedMessageIds: [oldId],
      missingMessageIds: [oldId],
      rateLimited: false,
    })
  })
})
