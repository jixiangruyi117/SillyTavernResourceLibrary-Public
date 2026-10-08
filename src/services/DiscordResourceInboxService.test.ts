import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import { DiscordInboxTaskExpiredError } from './DiscordHandoffService'
const setup = vi.hoisted(() => ({
  workerBaseUrl: 'https://worker.example',
  inboxLibraryId: 'library-1',
  inboxSecret: 'S'.repeat(40),
}))
vi.mock('./DiscordSourceSettingsService', () => ({
  loadDiscordSourceConnectionSettings: () => ({ ...setup }),
}))
import {
  acknowledgeDiscordResource,
  downloadWebDiscordResource,
  listDiscordResourceJobs,
  readDiscordResourceJob,
} from './DiscordResourceInboxService'
const job = {
  id: '11111111-1111-4111-a111-111111111111',
  libraryId: 'library-1',
  name: 'card.json',
  size: 4,
  state: 'queued' as const,
  createdAt: 1,
  updatedAt: 1,
  expiresAt: 9999999999999,
}
const target = { workerUrl: 'https://worker.example', libraryId: 'library-1' }
const fetcher = vi.fn<typeof fetch>()
beforeEach(() => {
  vi.clearAllMocks()
  setup.inboxLibraryId = 'library-1'
  vi.stubGlobal('fetch', fetcher)
})
afterEach(() => vi.unstubAllGlobals())
describe('resource inbox transport', () => {
  it('distinguishes exact expired resource tasks from other HTTP failures without reporting remote success', async () => {
    fetcher.mockResolvedValue(
      Response.json({ error: 'resource_task_not_found_or_expired' }, { status: 404 }),
    )
    await expect(acknowledgeDiscordResource(job.id, 'imported', target)).rejects.toMatchObject({
      name: 'DiscordInboxTaskExpiredError',
      kind: 'resource',
    })
    for (const status of [401, 403, 409, 503]) {
      fetcher.mockResolvedValue(
        Response.json({ error: 'resource_task_not_found_or_expired' }, { status }),
      )
      await expect(
        acknowledgeDiscordResource(job.id, 'imported', target),
      ).rejects.not.toBeInstanceOf(DiscordInboxTaskExpiredError)
    }
    fetcher.mockResolvedValue(Response.json({ error: 'unknown_route' }, { status: 404 }))
    await expect(acknowledgeDiscordResource(job.id, 'imported', target)).rejects.not.toBeInstanceOf(
      DiscordInboxTaskExpiredError,
    )
  })
  it('forwards a validated queue cursor and rejects malformed cursors before a request', async () => {
    fetcher.mockResolvedValue(Response.json({ jobs: [job], recent: [], hasMore: false }))
    await listDiscordResourceJobs(target, `1:${job.id}`)
    expect(String(fetcher.mock.lastCall?.[0])).toContain(`after=1%3A${job.id}`)
    await expect(listDiscordResourceJobs(target, '../another-library')).rejects.toThrow('分页无效')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it('explains confirmed imports without treating other conflicts as completed downloads', async () => {
    fetcher.mockImplementation(async () =>
      Response.json({ error: 'resource_already_imported', state: 'imported' }, { status: 409 }),
    )
    await expect(readDiscordResourceJob(job.id, target)).rejects.toThrow('无需重复领取')
    await expect(
      downloadWebDiscordResource(job, target, new AbortController().signal, vi.fn()),
    ).rejects.toThrow('无需重复领取')
    fetcher.mockResolvedValue(Response.json({ error: 'other_conflict' }, { status: 409 }))
    await expect(readDiscordResourceJob(job.id, target)).rejects.toThrow('HTTP 409')
    fetcher.mockResolvedValue(new Response('invalid json', { status: 409 }))
    await expect(readDiscordResourceJob(job.id, target)).rejects.toThrow('HTTP 409')
  })
  it('treats an already-imported acknowledgement as idempotent after native background import', async () => {
    fetcher.mockResolvedValue(
      Response.json({ error: 'resource_already_imported', state: 'imported' }, { status: 409 }),
    )
    await expect(acknowledgeDiscordResource(job.id, 'imported', target)).resolves.toBeUndefined()
    expect(fetcher.mock.lastCall?.[1]).toMatchObject({ method: 'POST' })
  })
  it('uses the paired secret and ID only in headers, validates the returned target, and rejects stale acknowledgements', async () => {
    fetcher.mockResolvedValue(Response.json({ jobs: [job], recent: [], hasMore: false }))
    expect((await listDiscordResourceJobs(target)).jobs[0]?.id).toBe(job.id)
    expect(fetcher.mock.lastCall?.[1]).toMatchObject({
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      headers: { Authorization: `Bearer ${setup.inboxSecret}`, 'X-SRL-Library-ID': 'library-1' },
    })
    expect(String(fetcher.mock.lastCall?.[0])).not.toContain(setup.inboxSecret)
    fetcher.mockResolvedValue(
      Response.json({ jobs: [{ ...job, libraryId: 'other' }], recent: [], hasMore: false }),
    )
    await expect(listDiscordResourceJobs(target)).rejects.toThrow('目标不匹配')
    setup.inboxLibraryId = 'changed'
    await expect(acknowledgeDiscordResource(job.id, 'imported', target)).rejects.toThrow('变更')
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
  it('rejects external redirects/private resource URLs before handing them to native download', async () => {
    fetcher.mockResolvedValue(
      Response.json({
        ...job,
        url: 'https://cdn.discordapp.com.evil.example/attachments/11111/22222/card.json',
      }),
    )
    await expect(readDiscordResourceJob(job.id, target)).rejects.toThrow('直链无效')
  })
  it('accepts Discord CDN attachment path variants also accepted by APK sharing and the Worker', async () => {
    const url = 'https://cdn.discordapp.com/ephemeral-attachments/11111/22222/card.data'
    fetcher.mockResolvedValue(Response.json({ ...job, url }))
    await expect(readDiscordResourceJob(job.id, target)).resolves.toMatchObject({ url })
  })
  it('reports actual bytes and rejects incomplete files without producing a resource File', async () => {
    fetcher.mockResolvedValue(
      new Response('JSON', {
        headers: { 'Content-Length': '4', 'Content-Type': 'application/json' },
      }),
    )
    const progress = vi.fn()
    const file = await downloadWebDiscordResource(
      job,
      target,
      new AbortController().signal,
      progress,
    )
    expect(await file.text()).toBe('JSON')
    expect(progress).toHaveBeenLastCalledWith(4, 4)
    fetcher.mockResolvedValue(new Response('bad', { headers: { 'Content-Length': '4' } }))
    await expect(
      downloadWebDiscordResource(job, target, new AbortController().signal, progress),
    ).rejects.toThrow('不完整')
    fetcher.mockResolvedValue(
      new Response('bad', { headers: { 'Content-Length': String(256 * 1024 * 1024 + 1) } }),
    )
    await expect(
      downloadWebDiscordResource(job, target, new AbortController().signal, progress),
    ).rejects.toThrow('上限')
  })
})
