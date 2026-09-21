import { BUILD_INFO } from './BuildInfo'

const FULL_OFFLINE_CACHE_PREFIX = 'srl-full-offline-'
const OFFLINE_STATE_KEY = 'srl.offline.full.status.v1'
const DOWNLOAD_CONCURRENCY = 3

export interface OfflineAssetEntry {
  url: string
  size: number
}

export interface OfflineAssetManifest {
  version: string
  assets: OfflineAssetEntry[]
  totalBytes: number
}

export interface OfflineResourceStatus {
  supported: boolean
  availableVersion: string
  estimatedBytes: number
  cachedVersion: string
  lastUpdatedAt?: number
}

export interface OfflineDownloadProgress {
  completed: number
  total: number
  cachedBytes: number
  totalBytes: number
  currentUrl: string
}

interface StoredOfflineState {
  version: string
  updatedAt: number
}

export interface OfflineCacheAudit {
  anomalies: string[]
  cacheNames: string[]
}

function cacheName(version: string): string {
  return `${FULL_OFFLINE_CACHE_PREFIX}${version.replace(/[^a-zA-Z0-9._-]/gu, '-')}`
}

function isAllowedAssetUrl(value: string): boolean {
  if (!value.startsWith('/') || value.startsWith('//')) return false
  const pathname = value.split(/[?#]/u, 1)[0] ?? ''
  return (
    !pathname.startsWith('/api/') &&
    !pathname.startsWith('/downloads/') &&
    pathname !== '/offline-assets.json' &&
    !pathname.endsWith('.map')
  )
}

function parseManifest(value: unknown): OfflineAssetManifest {
  if (!value || typeof value !== 'object') throw new Error('离线资源清单格式无效')
  const record = value as Partial<OfflineAssetManifest>
  if (typeof record.version !== 'string' || !record.version || !Array.isArray(record.assets)) {
    throw new Error('离线资源清单格式无效')
  }
  const assets = record.assets.map((asset) => {
    if (
      !asset ||
      typeof asset !== 'object' ||
      typeof asset.url !== 'string' ||
      !isAllowedAssetUrl(asset.url) ||
      !Number.isSafeInteger(asset.size) ||
      asset.size < 0
    ) {
      throw new Error('离线资源清单包含不安全的资源地址')
    }
    return { url: asset.url, size: asset.size }
  })
  const uniqueAssets = [...new Map(assets.map((asset) => [asset.url, asset])).values()]
  return {
    version: record.version,
    assets: uniqueAssets,
    totalBytes: uniqueAssets.reduce((total, asset) => total + asset.size, 0),
  }
}

async function fetchManifest(signal?: AbortSignal): Promise<OfflineAssetManifest> {
  const response = await fetch('/offline-assets.json', { cache: 'no-store', signal })
  if (!response.ok) throw new Error(`无法读取离线资源清单（HTTP ${response.status}）`)
  return parseManifest(await response.json())
}

function loadStoredState(): StoredOfflineState | null {
  try {
    const value = JSON.parse(localStorage.getItem(OFFLINE_STATE_KEY) ?? 'null') as unknown
    if (
      value &&
      typeof value === 'object' &&
      typeof (value as StoredOfflineState).version === 'string' &&
      Number.isFinite((value as StoredOfflineState).updatedAt)
    ) {
      return value as StoredOfflineState
    }
  } catch {
    // A corrupt preference must not make the settings panel unusable.
  }
  return null
}

async function hasCachedVersion(version: string): Promise<boolean> {
  if (!('caches' in globalThis)) return false
  const keys = await caches.keys()
  return keys.includes(cacheName(version))
}

export async function getOfflineResourceStatus(): Promise<OfflineResourceStatus> {
  if (!('caches' in globalThis) || !('serviceWorker' in navigator)) {
    return {
      supported: false,
      availableVersion: BUILD_INFO.buildId,
      estimatedBytes: 0,
      cachedVersion: '',
    }
  }
  const manifest = await fetchManifest()
  const stored = loadStoredState()
  const cached = stored ? await hasCachedVersion(stored.version) : false
  return {
    supported: true,
    availableVersion: manifest.version,
    estimatedBytes: manifest.totalBytes,
    cachedVersion: cached ? (stored?.version ?? '') : '',
    lastUpdatedAt: cached ? stored?.updatedAt : undefined,
  }
}

export async function downloadFullOfflineResources(
  options: {
    signal?: AbortSignal
    onProgress?: (progress: OfflineDownloadProgress) => void
  } = {},
): Promise<OfflineResourceStatus> {
  if (!('caches' in globalThis)) throw new Error('当前浏览器不支持离线资源缓存')
  const manifest = await fetchManifest(options.signal)
  const targetCacheName = cacheName(manifest.version)
  const cache = await caches.open(targetCacheName)
  let nextIndex = 0
  let completed = 0
  let cachedBytes = 0

  const worker = async (): Promise<void> => {
    while (nextIndex < manifest.assets.length) {
      options.signal?.throwIfAborted()
      const index = nextIndex
      nextIndex += 1
      const asset = manifest.assets[index]
      if (!asset) continue
      const request = new Request(new URL(asset.url, window.location.origin), { cache: 'reload' })
      if (!(await cache.match(request))) {
        const response = await fetch(request, { signal: options.signal })
        if (!response.ok)
          throw new Error(`离线资源下载失败：${asset.url}（HTTP ${response.status}）`)
        await cache.put(request, response)
      }
      completed += 1
      cachedBytes += asset.size
      options.onProgress?.({
        completed,
        total: manifest.assets.length,
        cachedBytes,
        totalBytes: manifest.totalBytes,
        currentUrl: asset.url,
      })
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(DOWNLOAD_CONCURRENCY, manifest.assets.length) }, () => worker()),
  )
  options.signal?.throwIfAborted()

  const oldCaches = (await caches.keys()).filter(
    (key) => key.startsWith(FULL_OFFLINE_CACHE_PREFIX) && key !== targetCacheName,
  )
  await Promise.all(oldCaches.map((key) => caches.delete(key)))
  const updatedAt = Date.now()
  localStorage.setItem(
    OFFLINE_STATE_KEY,
    JSON.stringify({ version: manifest.version, updatedAt } satisfies StoredOfflineState),
  )
  return {
    supported: true,
    availableVersion: manifest.version,
    estimatedBytes: manifest.totalBytes,
    cachedVersion: manifest.version,
    lastUpdatedAt: updatedAt,
  }
}

export async function removeFullOfflineResources(): Promise<void> {
  if ('caches' in globalThis) {
    const keys = await caches.keys()
    await Promise.all(
      keys
        .filter((key) => key.startsWith(FULL_OFFLINE_CACHE_PREFIX))
        .map((key) => caches.delete(key)),
    )
  }
  localStorage.removeItem(OFFLINE_STATE_KEY)
}

/** 只核对可再生缓存与其状态标记，不联网，也不读取用户资源。 */
export async function auditOfflineResourceCache(): Promise<OfflineCacheAudit> {
  if (!('caches' in globalThis)) return { anomalies: [], cacheNames: [] }
  const cacheNames = (await caches.keys()).filter((key) =>
    key.startsWith(FULL_OFFLINE_CACHE_PREFIX),
  )
  const rawState = localStorage.getItem(OFFLINE_STATE_KEY)
  const state = loadStoredState()
  const anomalies: string[] = []
  if (rawState !== null && !state) anomalies.push('离线资源状态记录损坏')
  if (state && !(await hasCachedVersion(state.version))) {
    anomalies.push(`状态记录指向不存在的缓存版本 ${state.version}`)
  }
  if (!state && cacheNames.length) anomalies.push('存在未登记的完整离线缓存')
  if (cacheNames.length > 1) anomalies.push(`同时保留了 ${cacheNames.length} 个完整离线缓存`)
  return { anomalies, cacheNames }
}

export const offlineResourceInternals = {
  cacheName,
  parseManifest,
}
