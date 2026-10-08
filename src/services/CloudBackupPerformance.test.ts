/** @vitest-environment node */
// SRL-PUBLIC-SYNC: BEGIN PUBLIC-ONLY id=cloud-performance-worker-settings
vi.mock('./PublicWorkerSettingsService', () => ({
  publicWorkerEndpoint: (pathname: string) => new URL(pathname, 'https://worker.example/'),
}))
// SRL-PUBLIC-SYNC: END PUBLIC-ONLY id=cloud-performance-worker-settings
import { IDBFactory } from 'fake-indexeddb'
import { JSDOM } from 'jsdom'
import type { CreatedStructuredSnapshot } from './CloudStructuredSnapshot'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CloudBackupTransport } from './CloudBackupTransport'
import { CloudBackupMetricsTracker } from './CloudBackupMetrics'
import type { GitHubBackupConfig } from '../types/CloudBackup'

const config: GitHubBackupConfig = {
  provider: 'github',
  owner: 'owner',
  repository: 'backups',
  autoBackup: false,
  retention: 7,
}
class Probe extends CloudBackupTransport {
  constructor() {
    super()
    this.transportState.activeMetrics = new CloudBackupMetricsTracker()
  }
  upload(snapshot: CreatedStructuredSnapshot) {
    return this.uploadGitHubStructuredBackup(config, 'fixture', snapshot)
  }
  listDav() {
    return this.listWebDavObjects(
      {
        provider: 'webdav',
        baseUrl: 'https://app.koofr.net/dav/Koofr',
        folder: 'backups',
        username: 'fixture',
        retention: 7,
        autoBackup: false,
      },
      'fixture',
    )
  }
  listContainers() {
    return this.listGitHubObjectContainers(config, 'fixture')
  }
  listAssets(id: number, target = config) {
    return this.listGitHubAssets(target, 'fixture', id)
  }
  confirm() {
    return this.confirmGitHubAssetSize(
      config,
      'fixture',
      { id: 1, name: 'manifest', size: 10, state: 'uploaded', url: '', created_at: '' },
      10,
    )
  }
  remove(id: number) {
    return this.githubFetch(config, 'fixture', `/releases/assets/${id}`, { method: 'DELETE' })
  }
}
afterEach(() => vi.unstubAllGlobals())
describe('cloud inventory reuse', () => {
  it('finds sorted object containers from one release-list request, including gaps', async () => {
    const fetch = vi.fn(
      async (_url: RequestInfo | URL) =>
        new Response(
          JSON.stringify([
            { id: 3, tag_name: 'srl-cloud-objects-0003', assets: [] },
            { id: 9, tag_name: 'unrelated', assets: [] },
            { id: 1, tag_name: 'srl-cloud-objects-0001', assets: [] },
          ]),
        ),
    )
    vi.stubGlobal('fetch', fetch)
    expect((await new Probe().listContainers()).map((item) => item.id)).toEqual([1, 3])
    expect(fetch).toHaveBeenCalledOnce()
    expect(String(fetch.mock.calls[0]?.[0])).toContain('/releases?per_page=10&page=1')
  })
  it('keeps several container inventories, updates deletions and invalidates a different destination', async () => {
    const fetch = vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === 'DELETE'
        ? new Response(null, { status: 204 })
        : new Response(
            JSON.stringify([{ id: 1, name: 'object', size: 10, url: '', created_at: '' }]),
          ),
    )
    vi.stubGlobal('fetch', fetch)
    const probe = new Probe()
    await probe.listAssets(1)
    await probe.listAssets(2)
    await probe.listAssets(1)
    expect(fetch).toHaveBeenCalledTimes(2)
    await probe.remove(1)
    expect(await probe.listAssets(1)).toEqual([])
    expect(await probe.listAssets(2)).toEqual([])
    expect(fetch).toHaveBeenCalledTimes(3)
    await probe.listAssets(1, { ...config, repository: 'another' })
    expect(fetch).toHaveBeenCalledTimes(4)
  })
  it('accepts a complete upload response without a redundant manifest GET', async () => {
    const fetch = vi.fn(async () => {
      throw new Error('extra request')
    })
    vi.stubGlobal('fetch', fetch)
    expect(await new Probe().confirm()).toMatchObject({ id: 1, size: 10 })
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('bounded remote preparation', () => {
  it('lists object containers with pagination and loads asset inventories at most three at a time', async () => {
    vi.stubGlobal('indexedDB', new IDBFactory())
    const containers = Array.from({ length: 12 }, (_, index) => ({
      id: index + 1,
      tag_name: `srl-cloud-objects-${String(index + 1).padStart(4, '0')}`,
      assets: [],
    }))
    let active = 0
    let peak = 0
    let release!: () => void
    const barrier = new Promise<void>((resolve) => {
      release = resolve
    })
    const listingPages: number[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (target: string, init?: RequestInit) => {
        const url = new URL(target)
        if (url.pathname.endsWith('/releases/tags/srl-cloud-snapshots'))
          return Response.json({ id: 100, tag_name: 'srl-cloud-snapshots', assets: [] })
        if (url.pathname.endsWith('/releases')) {
          const page = Number(url.searchParams.get('page'))
          listingPages.push(page)
          return Response.json(containers.slice((page - 1) * 10, page * 10))
        }
        if (init?.method === 'POST')
          return Response.json({
            id: 1000,
            name: url.searchParams.get('name'),
            size: (init.body as Blob).size,
            state: 'uploaded',
            created_at: new Date().toISOString(),
          })
        active += 1
        peak = Math.max(peak, active)
        await barrier
        active -= 1
        return Response.json([])
      }),
    )
    const snapshot: CreatedStructuredSnapshot = {
      snapshot: {
        format: 'srl-structured-cloud-snapshot',
        version: 3,
        createdAt: new Date().toISOString(),
        resources: [],
        versions: [],
        categories: [],
        portableData: { version: 1 },
      },
      chunks: new Map(),
      nativeSources: new Map(),
      objectPlans: [],
      totalSize: 0,
      partCount: 0,
      localReadBytes: 0,
      descriptorUpdates: [],
    }
    const operation = new Probe().upload(snapshot)
    await vi.waitFor(() => expect(active).toBe(3))
    release()
    await operation
    expect(peak).toBe(3)
    expect(listingPages).toEqual([1, 2])
  })
  it('enumerates Koofr directories concurrently and reuses the same-operation inventory', async () => {
    const dom = new JSDOM('')
    vi.stubGlobal('DOMParser', dom.window.DOMParser)
    let release!: () => void
    const barrier = new Promise<void>((resolve) => {
      release = resolve
    })
    let active = 0
    const fetch = vi.fn(async () => {
      active += 1
      await barrier
      active -= 1
      return new Response(
        '<d:multistatus xmlns:d="DAV:"><d:response><d:href>/object.bin</d:href><d:propstat><d:prop><d:getcontentlength>4</d:getcontentlength></d:prop></d:propstat></d:response></d:multistatus>',
        { status: 207, headers: { 'x-srl-cloud-proxy': '1' } },
      )
    })
    vi.stubGlobal('fetch', fetch)
    try {
      const probe = new Probe()
      const operation = probe.listDav()
      await vi.waitFor(() => expect(active).toBe(3))
      release()
      const result = await operation
      expect(result.map((entry) => entry.objectKey)).toEqual([
        'object.bin',
        'objects/object.bin',
        'snapshots/object.bin',
      ])
      expect(await probe.listDav()).toEqual(result)
      expect(fetch).toHaveBeenCalledTimes(3)
    } finally {
      dom.window.close()
    }
  })
})
