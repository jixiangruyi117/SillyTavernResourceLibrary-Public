/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  auditOfflineResourceCache,
  downloadFullOfflineResources,
  getOfflineResourceStatus,
  offlineResourceInternals,
  removeFullOfflineResources,
} from './OfflineResources'

class MemoryCache {
  readonly responses = new Map<string, Response>()

  async match(request: Request): Promise<Response | undefined> {
    return this.responses.get(new URL(request.url, window.location.href).pathname)?.clone()
  }

  async put(request: Request, response: Response): Promise<void> {
    this.responses.set(new URL(request.url, window.location.href).pathname, response.clone())
  }
}

function installCacheStorage(initialKeys: string[] = []) {
  const cacheMap = new Map(initialKeys.map((key) => [key, new MemoryCache()]))
  const storage = {
    keys: vi.fn(async () => [...cacheMap.keys()]),
    open: vi.fn(async (key: string) => {
      const cache = cacheMap.get(key) ?? new MemoryCache()
      cacheMap.set(key, cache)
      return cache
    }),
    delete: vi.fn(async (key: string) => cacheMap.delete(key)),
  }
  vi.stubGlobal('caches', storage)
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: {},
  })
  return { cacheMap, storage }
}

describe('OfflineResources', () => {
  afterEach(() => {
    localStorage.clear()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('拒绝 API、外站和下载目录进入完整离线清单', () => {
    for (const url of ['/api/session', '//other.test/app.js', '/downloads/archive.zip']) {
      expect(() =>
        offlineResourceInternals.parseManifest({
          version: 'build-1',
          assets: [{ url, size: 1 }],
        }),
      ).toThrow('不安全')
    }
  })

  it('只审计可再生离线缓存并识别损坏状态', async () => {
    installCacheStorage([offlineResourceInternals.cacheName('orphan')])
    localStorage.setItem('srl.offline.full.status.v1', '{')

    const audit = await auditOfflineResourceCache()
    expect(audit.cacheNames).toHaveLength(1)
    expect(audit.anomalies).toContain('离线资源状态记录损坏')
    expect(audit.anomalies).toContain('存在未登记的完整离线缓存')
  })

  it('以小并发逐项缓存完整资源，复用已有项并清理旧版本', async () => {
    const oldName = offlineResourceInternals.cacheName('old-build')
    const { cacheMap, storage } = installCacheStorage([oldName])
    const manifest = {
      version: 'build-2',
      assets: [
        { url: '/index.html', size: 10 },
        { url: '/assets/feature-a.js', size: 20 },
        { url: '/tutorials/example.webp', size: 30 },
      ],
    }
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (url.endsWith('/offline-assets.json')) {
        return new Response(JSON.stringify(manifest), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
      return new Response(url, { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)
    const progress = vi.fn()

    const status = await downloadFullOfflineResources({ onProgress: progress })

    expect(status.cachedVersion).toBe('build-2')
    expect(status.estimatedBytes).toBe(60)
    expect(progress).toHaveBeenCalledTimes(3)
    expect(storage.delete).toHaveBeenCalledWith(oldName)
    expect(cacheMap.get(offlineResourceInternals.cacheName('build-2'))?.responses.size).toBe(3)
    await expect(getOfflineResourceStatus()).resolves.toMatchObject({
      cachedVersion: 'build-2',
      estimatedBytes: 60,
    })
  })

  it('只移除主动完整离线缓存，保留 Workbox 运行时缓存', async () => {
    const fullName = offlineResourceInternals.cacheName('build-2')
    const { cacheMap } = installCacheStorage([fullName, 'srl-feature-assets'])

    await removeFullOfflineResources()

    expect(cacheMap.has(fullName)).toBe(false)
    expect(cacheMap.has('srl-feature-assets')).toBe(true)
  })
})
