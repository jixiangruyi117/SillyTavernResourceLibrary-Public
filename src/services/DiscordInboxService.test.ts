import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const setup = vi.hoisted(() => ({
  settings: {
    applicationId: 'app-1',
    workerBaseUrl: 'https://worker.example',
    botToken: 'private-bot',
    inboxLibraryId: 'library-1',
    inboxName: '手机资源库',
    inboxSecret: 'S'.repeat(40),
  } as {
    applicationId: string
    workerBaseUrl: string
    botToken: string
    inboxLibraryId?: string
    inboxName?: string
    inboxSecret?: string
  },
  save: vi.fn(),
  clear: vi.fn(),
}))

vi.mock('./DiscordSourceSettingsService', () => ({
  // SRL-PUBLIC-SYNC: PUBLIC-ONLY id=discord-local-installation-id-test-mock
  getDiscordClientId: () => '11111111-1111-1111-1111-111111111111',
  loadDiscordSourceConnectionSettings: () => ({ ...setup.settings }),
  saveDiscordInboxPairing: setup.save,
  clearLocalDiscordInboxPairing: setup.clear,
}))

import {
  acknowledgeDiscordHandoff,
  acknowledgeDiscordInboxJob,
  clearDiscordInboxPairing,
  clearDiscordInboxCloudHistory,
  listDiscordInboxJobs,
  pairDiscordInbox,
  readDiscordInboxStatus,
  receiveDiscordHandoff,
  receiveDiscordInboxJob,
  acknowledgeDiscordInboxSourceBound,
  listDiscordInboxWaitingSources,
} from './DiscordHandoffService'
import { readDiscordResourceJob } from './DiscordResourceInboxService'

const capture = {
  channelId: '22222',
  threadId: '22222',
  messageId: '33333',
  canonicalUrl: 'https://discord.com/channels/@me/22222/33333',
  authorId: '44444',
  authorName: '成员',
  content: '评论正文',
  timestamp: '2026-10-02T00:00:00Z',
}
const delivery = { id: 'job-1', libraryId: 'library-1', capturedAt: 100 }
const request = { workerUrl: 'https://worker.example', token: 'T'.repeat(40) }

describe('Discord inbox transport', () => {
  const fetchMock = vi.fn<typeof fetch>()
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', fetchMock)
    setup.settings = {
      applicationId: 'app-1',
      workerBaseUrl: 'https://worker.example',
      botToken: 'private-bot',
      inboxLibraryId: 'library-1',
      inboxName: '手机资源库',
      inboxSecret: 'S'.repeat(40),
    }
    setup.save.mockResolvedValue(undefined)
    setup.clear.mockResolvedValue(undefined)
  })
  afterEach(() => vi.unstubAllGlobals())
  it('passes a validated post cursor without changing credentials and rejects malformed cursors before a request', async () => {
    fetchMock.mockResolvedValue(Response.json({ jobs: [], recent: [], hasMore: false }))
    const cursor = '123:00000000-0000-4000-a000-000000000001'
    await listDiscordInboxJobs(cursor)
    expect(fetchMock.mock.lastCall?.[0]).toBe(
      `https://worker.example/inbox/jobs?after=${encodeURIComponent(cursor)}`,
    )
    const count = fetchMock.mock.calls.length
    await expect(listDiscordInboxJobs('../other')).rejects.toThrow('游标')
    expect(fetchMock).toHaveBeenCalledTimes(count)
  })

  it('reads a receipt repeatedly and never acknowledges before the local owner commits', async () => {
    fetchMock.mockImplementation(async () => Response.json({ capture, delivery }))
    expect((await receiveDiscordHandoff(request)).capture.content).toBe('评论正文')
    await receiveDiscordHandoff(request)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls.every(([, options]) => options?.method === 'GET')).toBe(true)
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }))
    await acknowledgeDiscordHandoff(request, delivery, 'saved')
    expect(fetchMock.mock.lastCall?.[0]).toBe(`https://worker.example/handoff/${request.token}/ack`)
    expect(JSON.parse(fetchMock.mock.lastCall?.[1]?.body as string)).toEqual({
      libraryId: 'library-1',
      state: 'saved',
    })
    expect(fetchMock.mock.lastCall?.[1]?.headers).toMatchObject({
      Authorization: `Bearer ${'S'.repeat(40)}`,
      'X-SRL-Library-ID': 'library-1',
    })
  })

  it('keeps old single-use handoffs compatible without fabricating a receipt', async () => {
    fetchMock.mockResolvedValue(Response.json({ capture }))
    expect((await receiveDiscordHandoff(request)).delivery).toBeUndefined()
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('explains an already saved post without attempting to parse a cleared cloud body', async () => {
    fetchMock.mockResolvedValue(
      Response.json({ error: 'delivery_already_saved', state: 'waiting_binding' }, { status: 409 }),
    )
    await expect(receiveDiscordHandoff(request)).rejects.toThrow('云端正文已清理')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('rejects another library or Worker before any acknowledgment', async () => {
    fetchMock.mockImplementation(async () =>
      Response.json({ capture, delivery: { ...delivery, libraryId: 'other-library' } }),
    )
    await expect(receiveDiscordHandoff(request)).rejects.toThrow('另一份资源库')
    await expect(
      acknowledgeDiscordHandoff(request, { ...delivery, libraryId: 'other-library' }, 'saved'),
    ).rejects.toThrow('另一份资源库')
    expect(fetchMock).toHaveBeenCalledOnce()
    await expect(
      receiveDiscordHandoff({ ...request, workerUrl: 'https://another.example' }),
    ).rejects.toThrow('另一份资源库')
    expect(fetchMock.mock.lastCall?.[1]?.headers).toBeUndefined()
  })

  it('allows an unpaired message to use the existing manual path', async () => {
    fetchMock.mockResolvedValue(
      Response.json({ capture, delivery: { ...delivery, libraryId: null } }),
    )
    expect((await receiveDiscordHandoff(request)).capture.messageId).toBe('33333')
  })

  it('uses only the protected endpoint credential to list bounded queue and receipt states', async () => {
    fetchMock.mockResolvedValue(
      Response.json({
        jobs: [{ id: 'job-1', createdAt: 100, state: 'pending' }],
        recent: [{ id: 'job-2', createdAt: 101, state: 'waiting_binding' }],
        hasMore: false,
      }),
    )
    const jobs = await listDiscordInboxJobs()
    expect(jobs.jobs).toHaveLength(1)
    expect(jobs.recent[0]?.state).toBe('waiting_binding')
    expect(fetchMock.mock.lastCall?.[1]?.headers).toEqual({
      Authorization: `Bearer ${'S'.repeat(40)}`,
      'X-SRL-Library-ID': 'library-1',
    })
    expect(JSON.stringify(fetchMock.mock.calls)).not.toContain('private-bot')
  })

  it('rejects malformed or oversized lists and a substituted job identity', async () => {
    fetchMock.mockResolvedValue(
      Response.json({
        jobs: [{ id: 'job-1', createdAt: 100, state: 'saved' }],
        recent: [],
        hasMore: false,
      }),
    )
    await expect(listDiscordInboxJobs()).rejects.toThrow('列表无效')
    fetchMock.mockResolvedValue(
      Response.json({
        jobs: Array.from({ length: 21 }, () => ({ id: 'job-1', createdAt: 100, state: 'pending' })),
        recent: [],
        hasMore: true,
      }),
    )
    await expect(listDiscordInboxJobs()).rejects.toThrow('列表无效')
    fetchMock.mockResolvedValue(
      Response.json({ capture, delivery: { ...delivery, id: 'wrong-job' } }),
    )
    await expect(receiveDiscordInboxJob('job-1')).rejects.toThrow('目标不匹配')
  })

  it('identifies a missing inbox job-list route from the Worker', async () => {
    fetchMock.mockResolvedValue(Response.json({ error: 'not_found' }, { status: 404 }))

    await expect(listDiscordInboxJobs()).rejects.toThrow(
      '当前 Worker 未提供收件箱任务列表接口（GET /inbox/jobs，HTTP 404）',
    )
    expect(fetchMock.mock.lastCall?.[0]).toBe('https://worker.example/inbox/jobs')
  })

  it('reads the matching queue job and retries an idempotent acknowledgment after network failure', async () => {
    fetchMock.mockResolvedValue(Response.json({ capture, delivery }))
    expect((await receiveDiscordInboxJob('job-1')).delivery?.id).toBe('job-1')
    fetchMock.mockRejectedValueOnce(new Error('offline'))
    await expect(acknowledgeDiscordInboxJob('job-1', 'waiting_binding')).rejects.toThrow('offline')
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }))
    await acknowledgeDiscordInboxJob('job-1', 'waiting_binding')
    expect(setup.clear).not.toHaveBeenCalled()
    expect(JSON.parse(fetchMock.mock.lastCall?.[1]?.body as string)).toEqual({
      state: 'waiting_binding',
    })
  })

  it('reads pairing status and refuses to overwrite a still usable local identity', async () => {
    fetchMock.mockResolvedValue(
      Response.json({ libraryId: 'library-1', name: '手机资源库', paired: true, expiresInDays: 7 }),
    )
    expect((await readDiscordInboxStatus()).paired).toBe(true)
    await expect(pairDiscordInbox('新资源库')).rejects.toThrow('先解除')
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('explains a missing scoped-cleanup route without claiming cloud tasks expired', async () => {
    fetchMock.mockResolvedValue(Response.json({ error: 'not_found' }, { status: 404 }))

    await expect(clearDiscordInboxCloudHistory('posts')).rejects.toThrow(
      'Worker 未提供分类清理接口（DELETE /inbox/cleanup-scoped，HTTP 404），本次没有删除记录',
    )
    expect(fetchMock.mock.lastCall?.[0]).toBe('https://worker.example/inbox/cleanup-scoped')
    expect(fetchMock.mock.lastCall?.[1]).toMatchObject({
      method: 'DELETE',
      body: JSON.stringify({ scope: 'posts' }),
    })
  })

  it('uses the backwards-compatible cleanup route when clearing both cloud inboxes', async () => {
    fetchMock.mockResolvedValue(Response.json({ ok: true, posts: 2, resources: 3 }))

    await expect(clearDiscordInboxCloudHistory('both')).resolves.toEqual({ posts: 2, resources: 3 })
    expect(fetchMock.mock.lastCall?.[0]).toBe('https://worker.example/inbox/cleanup')
    expect(fetchMock.mock.lastCall?.[1]).toMatchObject({ method: 'DELETE' })
    expect(fetchMock.mock.lastCall?.[1]).not.toHaveProperty('body')
  })

  it('reports expired task responses only when the Worker identifies an expired task', async () => {
    fetchMock.mockResolvedValue(
      Response.json({ error: 'resource_task_not_found_or_expired' }, { status: 404 }),
    )

    await expect(receiveDiscordInboxJob('job-1')).rejects.toThrow('云端任务已过期或已不存在')
  })

  it('shows the exact method and route rejected by a Worker with HTTP 405', async () => {
    fetchMock.mockResolvedValue(Response.json({ error: 'method_not_allowed' }, { status: 405 }))

    await expect(
      readDiscordResourceJob('12345678-1234-1234-1234-123456789abc', {
        workerUrl: 'https://worker.example',
        libraryId: 'library-1',
      }),
    ).rejects.toThrow('请求：GET /inbox/resources/:id。')
  })

  it('saves a new pairing through the protected settings owner, never in a URL', async () => {
    setup.settings.inboxLibraryId = undefined
    setup.settings.inboxSecret = undefined
    const pair = {
      libraryId: 'new-library',
      secret: 'N'.repeat(40),
      code: 'ABCDEFGH',
      expiresAt: Date.now() + 60_000,
    }
    fetchMock.mockResolvedValue(Response.json(pair))
    await pairDiscordInbox(' 我的手机 ')
    expect(setup.save).toHaveBeenCalledWith({ ...pair, name: '我的手机' }, undefined, {
      workerBaseUrl: 'https://worker.example',
      applicationId: 'app-1',
    })
    expect(fetchMock.mock.lastCall?.[0]).toBe('https://worker.example/inbox/pair')
    expect(fetchMock.mock.lastCall?.[1]?.headers).toMatchObject({
      Authorization: 'Bearer private-bot',
    })
  })

  it('revokes a newly allocated address when protected storage fails', async () => {
    setup.settings.inboxLibraryId = undefined
    setup.settings.inboxSecret = undefined
    const pair = {
      libraryId: 'new-library',
      secret: 'N'.repeat(40),
      code: 'ABCDEFGH',
      expiresAt: Date.now() + 60_000,
    }
    fetchMock
      .mockResolvedValueOnce(Response.json(pair))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
    setup.save.mockRejectedValueOnce(new Error('protected storage failed'))
    await expect(pairDiscordInbox('手机')).rejects.toThrow('protected storage failed')
    expect(fetchMock.mock.lastCall?.[1]).toMatchObject({
      method: 'DELETE',
      headers: { Authorization: `Bearer ${pair.secret}`, 'X-SRL-Library-ID': pair.libraryId },
    })
    expect(setup.clear).not.toHaveBeenCalled()
  })

  it('preserves local access on revoke network failure, and clears a confirmed revoked address', async () => {
    fetchMock.mockRejectedValueOnce(new Error('offline'))
    await expect(clearDiscordInboxPairing()).rejects.toThrow('offline')
    expect(setup.clear).not.toHaveBeenCalled()
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 403 }))
    await clearDiscordInboxPairing()
    expect(setup.clear).toHaveBeenCalledOnce()
  })

  it('uses the existing installation identity for an unpaired manual receipt', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }))
    await acknowledgeDiscordHandoff(request, { ...delivery, libraryId: null }, 'waiting_binding')
    const body = JSON.parse(fetchMock.mock.lastCall?.[1]?.body as string)
    expect(body.libraryId).toMatch(/^[a-f0-9-]{36}$/u)
    expect(fetchMock.mock.lastCall?.[1]?.headers).toEqual({ 'Content-Type': 'application/json' })
  })

  it('does not clear a new target when an older revoke response arrives later', async () => {
    let finish!: (value: Response) => void
    fetchMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    const revoke = clearDiscordInboxPairing()
    setup.settings.inboxLibraryId = 'library-2'
    finish(new Response(null, { status: 204 }))
    await revoke
    expect(setup.clear).not.toHaveBeenCalled()
  })

  it('refuses to confirm a frozen target against changed pairing and validates waiting-source pagination', async () => {
    const expected = { workerUrl: 'https://worker.example', libraryId: 'old-library' }
    await expect(acknowledgeDiscordInboxJob('job-1', 'saved', expected)).rejects.toThrow('已变更')
    expect(fetchMock).not.toHaveBeenCalled()
    const hash = 'a'.repeat(64)
    fetchMock.mockResolvedValue(Response.json({ sourceKeyHashes: [hash], nextCursor: hash }))
    expect((await listDiscordInboxWaitingSources()).nextCursor).toBe(hash)
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }))
    await acknowledgeDiscordInboxSourceBound(hash)
    expect(fetchMock.mock.lastCall?.[0]).toBe(
      `https://worker.example/inbox/sources/${hash}/ack-bound`,
    )
  })
})
