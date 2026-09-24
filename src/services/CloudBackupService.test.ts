import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { CategoryService } from './CategoryService'
import { CloudBackupService } from './CloudBackupService'
import type { CreatedStructuredSnapshot, StructuredSnapshot } from './CloudStructuredSnapshot'
import type { ExportService } from './ExportService'
import type { ResourceService } from './ResourceService'
import type { RestoreService } from './RestoreService'
import { RESOURCE_TYPE, type Resource } from '../types/Resource'
import type { GitHubBackupConfig, WebDavBackupConfig } from '../types/CloudBackup'

class MemoryStorage implements Storage {
  private values = new Map<string, string>()
  get length() {
    return this.values.size
  }
  clear() {
    this.values.clear()
  }
  getItem(key: string) {
    return this.values.get(key) ?? null
  }
  key(index: number) {
    return Array.from(this.values.keys())[index] ?? null
  }
  removeItem(key: string) {
    this.values.delete(key)
  }
  setItem(key: string, value: string) {
    this.values.set(key, value)
  }
}

const githubConfig: GitHubBackupConfig = {
  provider: 'github',
  owner: 'owner',
  repository: 'private-backups',
  retention: 7,
  autoBackup: false,
}
const webDavConfig: WebDavBackupConfig = {
  provider: 'webdav',
  baseUrl: 'https://app.koofr.net/dav/Koofr',
  folder: 'SRL-Backups',
  username: 'user@example.com',
  retention: 7,
  autoBackup: false,
}

function createService(
  resourceService = {} as ResourceService,
  categoryService = {} as CategoryService,
  exportService = {} as ExportService,
  restoreService = {} as RestoreService,
): CloudBackupService {
  return new CloudBackupService(resourceService, categoryService, exportService, restoreService)
}

function githubRepositoryResponse(status = 200, isPrivate = true): Response {
  return new Response(
    JSON.stringify(
      status === 200
        ? {
            full_name: 'owner/private-backups',
            private: isPrivate,
            permissions: { push: true },
          }
        : { message: status === 401 ? 'Bad credentials' : 'forbidden' },
    ),
    { status },
  )
}

function cloudResource(hash: string, id = 'resource-1'): Resource {
  const blob = new Blob([hash.slice(0, 8)], { type: 'application/octet-stream' })
  return {
    id,
    type: RESOURCE_TYPE.OTHER,
    name: id,
    description: '',
    fileName: `${id}.bin`,
    mimeType: blob.type,
    fileSize: blob.size,
    contentHash: hash,
    favorite: false,
    categoryId: null,
    tags: [],
    metadata: {},
    originalBlob: blob,
    createdAt: 1,
    updatedAt: 1,
  }
}

function createdSnapshot(hashes = ['a'.repeat(64)]): CreatedStructuredSnapshot {
  const chunks = new Map<string, Blob>()
  const nativeSources = new Map<
    string,
    { kind: 'range'; contentHash: string; offset: number; size: number }
  >()
  const resources = hashes.map((hash, index) => {
    const blob = new Blob([`object-${index}`], { type: 'application/octet-stream' })
    const name = `srl-chunk--sha256-${hash}`
    chunks.set(name, blob)
    nativeSources.set(name, { kind: 'range', contentHash: hash, offset: 0, size: blob.size })
    const resource = cloudResource(hash, `resource-${index}`)
    const { originalBlob: _originalBlob, thumbnailBlob: _thumbnailBlob, ...record } = resource
    return {
      ...record,
      fileSize: blob.size,
      object: {
        format: 'srl-github-backup-bundle' as const,
        version: 2 as const,
        createdAt: '2026-08-26T00:00:00.000Z',
        fileName: `resource-${index}.bin`,
        totalSize: blob.size,
        totalSha256: hash,
        parts: [{ name, size: blob.size, sha256: hash }],
      },
    }
  }) as StructuredSnapshot['resources']
  const snapshot: StructuredSnapshot = {
    format: 'srl-structured-cloud-snapshot',
    version: 3,
    createdAt: '2026-08-26T00:00:00.000Z',
    categories: [],
    resources,
    versions: [],
    portableData: { version: 1 },
    objectContract: { algorithm: 'SHA-256', immutable: true, naming: 'srl-chunk--sha256-{hash}' },
  }
  return {
    snapshot,
    chunks,
    nativeSources,
    objectPlans: [...chunks].map(([name, blob]) => ({
      name,
      hash: name.slice('srl-chunk--sha256-'.length),
      size: blob.size,
      blob,
      source: nativeSources.get(name)!,
      contentType: 'application/octet-stream',
    })),
    totalSize: [...chunks.values()].reduce((total, blob) => total + blob.size, 0),
    partCount: chunks.size,
    localReadBytes: 0,
    descriptorUpdates: [],
  }
}

describe('CloudBackupService V3', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    vi.stubGlobal('localStorage', new MemoryStorage())
    vi.stubGlobal('sessionStorage', new MemoryStorage())
    vi.stubGlobal('indexedDB', new IDBFactory())
  })

  it('persists a Web credential in encrypted IndexedDB without localStorage/sessionStorage plaintext', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () => githubRepositoryResponse()),
    )
    const first = createService()
    await first.saveConfig(githubConfig, 'saved-token')
    expect(localStorage.getItem('srl.cloudBackup.settings.v1')).not.toContain('saved-token')
    expect(localStorage.getItem('srl.cloudBackup.localSecrets.v1')).toBeNull()
    expect(sessionStorage.getItem('srl.cloudBackup.secret.github')).toBeNull()

    const reopened = createService()
    await reopened.initializeCredentials()
    expect(reopened.getSnapshot().credentials.github).toBe('valid')
    await expect(reopened.testConnection(githubConfig)).resolves.toContain('私有仓库')
  })

  it('在上传社区内容前能够识别公开 GitHub 仓库', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(githubRepositoryResponse(200, false)))
    const service = createService()

    await expect(service.inspectGitHubRepository(githubConfig, 'token')).resolves.toMatchObject({
      fullName: 'owner/private-backups',
      isPrivate: false,
      canWrite: true,
    })
  })

  it('同一仓库的社区内容首次校验后复用私有状态', async () => {
    const resource = cloudResource('a'.repeat(64))
    resource.contentHash = await crypto.subtle
      .digest('SHA-256', await resource.originalBlob.arrayBuffer())
      .then((value) =>
        [...new Uint8Array(value)].map((byte) => byte.toString(16).padStart(2, '0')).join(''),
      )
    const resourceService = {
      listSummaries: vi.fn(async () => [resource]),
      listVersions: vi.fn(async () => []),
      listVersionSummaries: vi.fn(async () => []),
      get: vi.fn(async () => resource),
      updateBackupDescriptor: vi.fn(async () => undefined),
    } as unknown as ResourceService
    const categoryService = { list: vi.fn(async () => []) } as unknown as CategoryService
    const fetchMock = vi.fn().mockResolvedValue(githubRepositoryResponse())
    vi.stubGlobal('fetch', fetchMock)
    const service = createService(resourceService, categoryService) as unknown as {
      saveConfig: CloudBackupService['saveConfig']
      createBackup: CloudBackupService['createBackup']
      uploadGitHubStructuredBackup: ReturnType<typeof vi.fn>
      prune: ReturnType<typeof vi.fn>
      reuseUnchangedStructuredBackup: ReturnType<typeof vi.fn>
    }
    const config = { ...githubConfig, contentSelection: { communitySources: true } }
    await service.saveConfig(config, 'token')
    service.uploadGitHubStructuredBackup = vi.fn(async () => ({
      id: 'manifest-1',
      objectKey: 'snapshot.srlmanifest.v3.json.gz',
      size: resource.fileSize,
      createdAt: Date.now(),
      kind: 'githubSnapshot',
    }))
    service.prune = vi.fn(async () => 0)
    await service.createBackup()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    service.reuseUnchangedStructuredBackup = vi.fn(async () => ({
      id: 'manifest-1',
      objectKey: 'snapshot.srlmanifest.v3.json.gz',
      size: resource.fileSize,
      createdAt: Date.now(),
      kind: 'githubSnapshot',
    }))
    await service.createBackup()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('公开 GitHub 仓库会在社区内容上传前被服务层阻断', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(githubRepositoryResponse(200, false)))
    const service = createService()

    await expect(
      service.createBackup(
        { ...githubConfig, contentSelection: { communitySources: true } },
        'token',
      ),
    ).rejects.toThrow('已阻止上传 Discord 社区内容')
  })

  it('always confirms a GitHub asset with a remote GET even when POST reports the expected size', async () => {
    const service = createService() as unknown as {
      confirmGitHubAssetSize: (
        config: GitHubBackupConfig,
        secret: string,
        asset: unknown,
        size: number,
      ) => Promise<unknown>
      githubFetch: ReturnType<typeof vi.fn>
    }
    const asset = {
      id: 17,
      name: 'object.bin',
      size: 4,
      created_at: '2026-08-26T00:00:00.000Z',
      url: '',
    }
    service.githubFetch = vi.fn(async () => new Response(JSON.stringify(asset)))

    await expect(service.confirmGitHubAssetSize(githubConfig, 'token', asset, 4)).resolves.toEqual(
      asset,
    )
    expect(service.githubFetch).toHaveBeenCalledOnce()
    expect(service.githubFetch).toHaveBeenCalledWith(githubConfig, 'token', '/releases/assets/17')
  })

  it('deletes expired manifests before starting an orphan grace period', async () => {
    let now = Date.parse('2026-08-26T00:00:00.000Z')
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    const service = createService() as unknown as {
      prune: (config: GitHubBackupConfig, secret: string) => Promise<number>
      listRetentionBackups: ReturnType<typeof vi.fn>
      readGitHubStructuredSnapshot: ReturnType<typeof vi.fn>
      getGitHubRelease: ReturnType<typeof vi.fn>
      listGitHubAssets: ReturnType<typeof vi.fn>
      githubFetch: ReturnType<typeof vi.fn>
    }
    const current = {
      id: '1',
      objectKey: 'current.srlmanifest.v3.json.gz',
      size: 1,
      createdAt: 2,
      kind: 'githubSnapshot' as const,
    }
    const expired = {
      ...current,
      id: '2',
      objectKey: 'expired.srlmanifest.v3.json.gz',
      createdAt: 1,
    }
    service.listRetentionBackups = vi
      .fn()
      .mockResolvedValueOnce([current, expired])
      .mockResolvedValue([current])
    service.readGitHubStructuredSnapshot = vi.fn(async () => ({
      format: 'srl-structured-cloud-snapshot',
      version: 3,
      createdAt: '2026-08-26T00:00:00.000Z',
      categories: [],
      resources: [],
      versions: [],
      portableData: { version: 1 },
    }))
    service.getGitHubRelease = vi.fn(async (_config, _secret, _create, tag) =>
      tag === 'srl-cloud-objects-0001' ? { id: 41 } : undefined,
    )
    service.listGitHubAssets = vi.fn(async () => [
      {
        id: 99,
        name: `srl-chunk--sha256-${'a'.repeat(64)}`,
        size: 4,
        created_at: '2020-01-01T00:00:00.000Z',
        url: '',
      },
    ])
    service.githubFetch = vi.fn(async () => new Response(null, { status: 204 }))

    await expect(service.prune({ ...githubConfig, retention: 1 }, 'token')).resolves.toBe(1)
    expect(service.githubFetch).toHaveBeenCalledTimes(1)
    expect(service.githubFetch.mock.calls[0]?.[2]).toBe('/releases/assets/2')

    now += 24 * 60 * 60 * 1000
    await expect(service.prune({ ...githubConfig, retention: 1 }, 'token')).resolves.toBe(0)
    // Normal automatic maintenance does not enumerate unrelated remote chunks.
    expect(service.githubFetch).toHaveBeenCalledTimes(1)
    expect(service.listGitHubAssets).not.toHaveBeenCalled()
  })

  it('never collects a chunk still referenced by an expired history snapshot', async () => {
    const partHash = 'b'.repeat(64)
    const service = createService() as unknown as {
      prune: (config: GitHubBackupConfig, secret: string) => Promise<number>
      listRetentionBackups: ReturnType<typeof vi.fn>
      readGitHubStructuredSnapshot: ReturnType<typeof vi.fn>
      getGitHubRelease: ReturnType<typeof vi.fn>
      listGitHubAssets: ReturnType<typeof vi.fn>
      githubFetch: ReturnType<typeof vi.fn>
    }
    const current = {
      id: 'current',
      objectKey: 'current.srlmanifest.v3.json.gz',
      size: 1,
      createdAt: 2,
      kind: 'githubSnapshot' as const,
    }
    const expired = {
      ...current,
      id: 'expired',
      objectKey: 'older.srlmanifest.v3.json.gz',
      createdAt: 1,
    }
    service.listRetentionBackups = vi.fn(async () => [current, expired])
    service.readGitHubStructuredSnapshot = vi.fn(async (_config, _secret, item) => ({
      format: 'srl-structured-cloud-snapshot',
      version: 3,
      createdAt: '2026-08-26T00:00:00.000Z',
      categories: [],
      resources: [],
      versions:
        item.id === 'expired'
          ? [
              {
                id: 'historical-version',
                fileSize: 4,
                contentHash: partHash,
                object: {
                  format: 'srl-github-backup-bundle',
                  version: 2,
                  createdAt: '2026-08-26T00:00:00.000Z',
                  fileName: 'small.json',
                  totalSize: 4,
                  totalSha256: partHash,
                  parts: [{ name: `srl-chunk--sha256-${partHash}`, size: 4, sha256: partHash }],
                },
              },
            ]
          : [],
      portableData: { version: 1 },
    }))
    service.getGitHubRelease = vi.fn(async (_config, _secret, _create, tag) =>
      tag === 'srl-cloud-objects-0001' ? { id: 41 } : undefined,
    )
    service.listGitHubAssets = vi.fn(async () => [
      { id: 99, name: `srl-chunk--sha256-${partHash}`, size: 4, created_at: '', url: '' },
    ])
    service.githubFetch = vi.fn(async () => new Response(null, { status: 204 }))

    await expect(service.prune({ ...githubConfig, retention: 1 }, 'token')).resolves.toBe(1)

    expect(service.githubFetch).toHaveBeenCalledTimes(1)
    expect(service.githubFetch).toHaveBeenCalledWith(
      { ...githubConfig, retention: 1 },
      'token',
      '/releases/assets/expired',
      { method: 'DELETE' },
    )
  })

  it('atomically keeps the old credential when a replacement fails validation', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(githubRepositoryResponse())
      .mockResolvedValueOnce(githubRepositoryResponse(401))
      .mockResolvedValueOnce(githubRepositoryResponse())
    vi.stubGlobal('fetch', fetchMock)
    const service = createService()
    await service.saveConfig(githubConfig, 'old-token')
    await expect(service.saveConfig(githubConfig, 'bad-new-token')).rejects.toThrow(/401/)
    expect(service.getSnapshot().credentials.github).toBe('valid')
    await service.testConnection(githubConfig)
    expect(new Headers(fetchMock.mock.calls.at(-1)?.[1]?.headers).get('authorization')).toBe(
      'Bearer old-token',
    )
  })

  it('invalidates GitHub only on 401, not on 403, 404, or network errors', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(githubRepositoryResponse())
      .mockResolvedValueOnce(githubRepositoryResponse(403))
      .mockResolvedValueOnce(new Response('{}', { status: 404 }))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(githubRepositoryResponse(401))
    vi.stubGlobal('fetch', fetchMock)
    const service = createService()
    await service.saveConfig(githubConfig, 'saved-token')
    for (const expected of [/403/, /404/, /没有收到响应/]) {
      await expect(service.testConnection(githubConfig)).rejects.toThrow(expected)
      expect(service.getSnapshot().credentials.github).toBe('valid')
    }
    await expect(service.testConnection(githubConfig)).rejects.toThrow(/401/)
    expect(service.getSnapshot().credentials.github).toBe('invalid')
  })

  it('invalidates Koofr only on a confirmed 401', async () => {
    const response = (status: number) =>
      new Response(status === 204 ? null : '', {
        status,
        headers: { 'X-SRL-Cloud-Proxy': '1' },
      })
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(405))
      .mockResolvedValueOnce(response(405))
      .mockResolvedValueOnce(response(405))
      .mockResolvedValueOnce(response(201))
      .mockResolvedValueOnce(response(204))
      .mockResolvedValueOnce(response(403))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(response(401))
    vi.stubGlobal('fetch', fetchMock)
    const service = createService()
    await service.saveConfig(webDavConfig, 'saved-password')
    await expect(service.testConnection(webDavConfig)).rejects.toThrow(/403/)
    expect(service.getSnapshot().credentials.webdav).toBe('valid')
    await expect(service.testConnection(webDavConfig)).rejects.toThrow(/没有收到响应/)
    expect(service.getSnapshot().credentials.webdav).toBe('valid')
    await expect(service.testConnection(webDavConfig)).rejects.toThrow(/401/)
    expect(service.getSnapshot().credentials.webdav).toBe('invalid')
  })

  it('sends Web GitHub directly with a binary body and never calls the CF proxy', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 201 }))
    vi.stubGlobal('fetch', fetchMock)
    const service = createService() as unknown as {
      cloudFetch: (url: string, init: RequestInit, provider: 'github') => Promise<Response>
    }
    const body = new Blob([new Uint8Array([1, 2, 3])])
    await service.cloudFetch(
      'https://uploads.github.com/repos/owner/repo/releases/1/assets',
      { method: 'POST', body },
      'github',
    )
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'https://uploads.github.com/repos/owner/repo/releases/1/assets',
    )
    expect(fetchMock.mock.calls[0]?.[1]?.body).toBe(body)
    expect(String(fetchMock.mock.calls[0]?.[0])).not.toContain('/api/cloud/proxy/github')
  })

  it('sends Web Koofr through the same-origin proxy with the original binary body', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('', {
        status: 201,
        headers: { 'X-SRL-Cloud-Proxy': '1' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const service = createService() as unknown as {
      cloudFetch: (url: string, init: RequestInit, provider: 'webdav') => Promise<Response>
    }
    const body = new Blob([new Uint8Array([4, 5, 6])])
    await service.cloudFetch(
      'https://app.koofr.net/dav/Koofr/SRL-Backups/objects/a',
      { method: 'PUT', body },
      'webdav',
    )
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock.mock.calls[0]?.[0]).toContain('/api/cloud/proxy/koofr?url=')
    expect(fetchMock.mock.calls[0]?.[1]?.body).toBe(body)
  })

  it('rotates GitHub immutable object containers at the 900-object threshold', async () => {
    const service = createService() as unknown as {
      getGitHubRelease: ReturnType<typeof vi.fn>
      listGitHubAssets: ReturnType<typeof vi.fn>
      uploadGitHubAsset: ReturnType<typeof vi.fn>
      confirmGitHubAssetSize: ReturnType<typeof vi.fn>
      uploadGitHubStructuredBackup: (
        config: GitHubBackupConfig,
        secret: string,
        snapshot: CreatedStructuredSnapshot,
      ) => Promise<unknown>
    }
    let secondContainerCreated = false
    service.getGitHubRelease = vi.fn(async (_config, _secret, create, tag) => {
      if (tag === 'srl-cloud-snapshots') return { id: 10 }
      if (tag === 'srl-cloud-objects-0001') return { id: 20 }
      if (tag === 'srl-cloud-objects-0002' && create) {
        secondContainerCreated = true
        return { id: 30 }
      }
      return undefined
    })
    service.listGitHubAssets = vi.fn(async (_config, _secret, releaseId: number) =>
      releaseId === 20
        ? Array.from({ length: 899 }, (_, index) => ({
            id: index + 1,
            name: `old-${index}`,
            size: 1,
            created_at: '2026-08-01T00:00:00Z',
          }))
        : [],
    )
    service.uploadGitHubAsset = vi.fn(async (_config, _secret, releaseId, name, blob) => ({
      id: Math.random(),
      name,
      size: blob.size,
      created_at: '2026-08-26T00:00:00Z',
      releaseId,
    }))
    service.confirmGitHubAssetSize = vi.fn(async (_config, _secret, asset) => asset)
    await service.uploadGitHubStructuredBackup(
      githubConfig,
      'token',
      createdSnapshot(['a'.repeat(64), 'b'.repeat(64)]),
    )
    expect(secondContainerCreated).toBe(true)
    expect(
      service.uploadGitHubAsset.mock.calls
        .filter((call) => String(call[3]).startsWith('srl-chunk--sha256-'))
        .map((call) => call[2]),
    ).toEqual([20, 30])
  })

  it('never commits the GitHub manifest when the current object still fails', async () => {
    const service = createService() as unknown as {
      getGitHubRelease: ReturnType<typeof vi.fn>
      listGitHubAssets: ReturnType<typeof vi.fn>
      uploadGitHubAsset: ReturnType<typeof vi.fn>
      uploadGitHubStructuredBackup: (
        config: GitHubBackupConfig,
        secret: string,
        snapshot: CreatedStructuredSnapshot,
      ) => Promise<unknown>
    }
    service.getGitHubRelease = vi.fn(async (_config, _secret, create, tag) => {
      if (tag === 'srl-cloud-snapshots') return { id: 10 }
      if (tag === 'srl-cloud-objects-0001') return create ? { id: 20 } : undefined
      return undefined
    })
    service.listGitHubAssets = vi.fn(async () => [])
    service.uploadGitHubAsset = vi.fn(async () => {
      throw new Error('network down')
    })
    await expect(
      service.uploadGitHubStructuredBackup(githubConfig, 'token', createdSnapshot()),
    ).rejects.toThrow('未提交快照清单')
    expect(service.uploadGitHubAsset).toHaveBeenCalledTimes(3)
  })

  it('commits a Koofr snapshot manifest only after all objects are verified', async () => {
    const calls: string[] = []
    const service = createService() as unknown as {
      ensureWebDavFolder: ReturnType<typeof vi.fn>
      listWebDavObjects: ReturnType<typeof vi.fn>
      uploadWebDavObject: ReturnType<typeof vi.fn>
      uploadWebDavStructuredBackup: (
        config: WebDavBackupConfig,
        secret: string,
        snapshot: CreatedStructuredSnapshot,
      ) => Promise<unknown>
    }
    service.ensureWebDavFolder = vi.fn(async () => undefined)
    service.listWebDavObjects = vi.fn(async () => [])
    service.uploadWebDavObject = vi.fn(async (_config, _secret, key) => {
      calls.push(key)
    })
    await service.uploadWebDavStructuredBackup(webDavConfig, 'password', createdSnapshot())
    expect(calls[0]).toMatch(/^objects\/srl-chunk--sha256-/)
    expect(calls.at(-1)).toMatch(/^snapshots\/.*\.srlmanifest\.v3\.json\.gz$/)
  })

  it('uses the no-op reuse path when the local fingerprint is unchanged', async () => {
    const resource = cloudResource('a'.repeat(64))
    resource.contentHash = await crypto.subtle
      .digest('SHA-256', await resource.originalBlob.arrayBuffer())
      .then((value) =>
        [...new Uint8Array(value)].map((byte) => byte.toString(16).padStart(2, '0')).join(''),
      )
    const resourceService = {
      listSummaries: vi.fn(async () => [resource]),
      listVersions: vi.fn(async () => []),
      listVersionSummaries: vi.fn(async () => []),
      get: vi.fn(async () => resource),
      updateBackupDescriptor: vi.fn(async () => undefined),
    } as unknown as ResourceService
    const categoryService = { list: vi.fn(async () => []) } as unknown as CategoryService
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(githubRepositoryResponse()))
    const service = createService(resourceService, categoryService) as unknown as {
      saveConfig: CloudBackupService['saveConfig']
      createBackup: CloudBackupService['createBackup']
      uploadGitHubStructuredBackup: ReturnType<typeof vi.fn>
      prune: ReturnType<typeof vi.fn>
      reuseUnchangedStructuredBackup: ReturnType<typeof vi.fn>
    }
    await service.saveConfig(githubConfig, 'token')
    service.uploadGitHubStructuredBackup = vi.fn(async () => ({
      id: 'manifest-1',
      objectKey: 'snapshot.srlmanifest.v3.json.gz',
      size: resource.fileSize,
      createdAt: Date.now(),
      kind: 'githubSnapshot',
    }))
    service.prune = vi.fn(async () => 0)
    await service.createBackup()
    expect(service.prune).toHaveBeenCalledWith(
      expect.objectContaining(githubConfig),
      'token',
      'snapshot.srlmanifest.v3.json.gz',
    )
    service.reuseUnchangedStructuredBackup = vi.fn(async () => ({
      id: 'manifest-1',
      objectKey: 'snapshot.srlmanifest.v3.json.gz',
      size: resource.fileSize,
      createdAt: Date.now(),
      kind: 'githubSnapshot',
    }))
    const second = await service.createBackup()
    expect(second.unchanged).toBe(true)
    expect(service.uploadGitHubStructuredBackup).toHaveBeenCalledOnce()
    expect(resourceService.get).toHaveBeenCalledOnce()
  })

  it('restores V3 resources directly without materializing a giant ZIP', async () => {
    const resource = cloudResource('a'.repeat(64))
    const restore = {
      prepare: vi.fn(),
      restoreStructured: vi.fn(async () => ({ restoredResources: 1 })),
    } as unknown as RestoreService
    const service = createService(
      { listResourceListSummaries: vi.fn(async () => []) } as unknown as ResourceService,
      { list: vi.fn(async () => []) } as unknown as CategoryService,
      {} as ExportService,
      restore,
    ) as unknown as {
      saveConfig: CloudBackupService['saveConfig']
      restoreBackup: CloudBackupService['restoreBackup']
      readGitHubStructuredSnapshot: ReturnType<typeof vi.fn>
      createGitHubObjectReader: ReturnType<typeof vi.fn>
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(githubRepositoryResponse()))
    await service.saveConfig(githubConfig, 'token')
    service.readGitHubStructuredSnapshot = vi.fn(async () => createdSnapshot().snapshot)
    service.createGitHubObjectReader = vi.fn(async () => async () => resource.originalBlob)
    await expect(
      service.restoreBackup({
        id: '1',
        objectKey: 'snapshot.srlmanifest.v3.json.gz',
        size: resource.fileSize,
        createdAt: Date.now(),
        kind: 'githubSnapshot',
      }),
    ).resolves.toBe(1)
    expect(restore.restoreStructured).toHaveBeenCalledWith(
      expect.objectContaining({ version: 3 }),
      expect.any(Function),
      [],
      [],
      expect.any(String),
    )
    expect(restore.prepare).not.toHaveBeenCalled()
  })

  it('lists every V3 resource and filters cloud restore by unique resource ID', async () => {
    const first = 'a'.repeat(64)
    const second = 'b'.repeat(64)
    const snapshot = createdSnapshot([first, first, second]).snapshot
    snapshot.resources[1] = { ...snapshot.resources[1]!, id: 'same-content-different-resource' }
    const restore = {
      restoreStructured: vi.fn(async () => ({ restoredResources: 1 })),
    } as unknown as RestoreService
    const service = createService(
      { listResourceListSummaries: vi.fn(async () => []) } as unknown as ResourceService,
      { list: vi.fn(async () => []) } as unknown as CategoryService,
      {} as ExportService,
      restore,
    ) as unknown as {
      saveConfig: CloudBackupService['saveConfig']
      listBackupResources: CloudBackupService['listBackupResources']
      restoreBackup: CloudBackupService['restoreBackup']
      readGitHubStructuredSnapshot: ReturnType<typeof vi.fn>
      createGitHubObjectReader: ReturnType<typeof vi.fn>
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(githubRepositoryResponse()))
    await service.saveConfig(githubConfig, 'token')
    service.readGitHubStructuredSnapshot = vi.fn(async () => snapshot)
    service.createGitHubObjectReader = vi.fn(async () => async () => new Blob(['object']))

    const listed = await service.listBackupResources({
      id: '1',
      objectKey: 'snapshot.srlmanifest.v3.json.gz',
      size: 1,
      createdAt: Date.now(),
      kind: 'githubSnapshot',
    })
    expect(listed.map((resource) => resource.id)).toEqual([
      snapshot.resources[0]!.id,
      'same-content-different-resource',
      snapshot.resources[2]!.id,
    ])

    await service.restoreBackup(
      {
        id: '1',
        objectKey: 'snapshot.srlmanifest.v3.json.gz',
        size: 1,
        createdAt: Date.now(),
        kind: 'githubSnapshot',
      },
      undefined,
      ['same-content-different-resource'],
    )
    expect(restore.restoreStructured).toHaveBeenCalledWith(
      expect.objectContaining({
        resources: [
          expect.objectContaining({ id: 'same-content-different-resource', contentHash: first }),
        ],
        versions: [],
      }),
      expect.any(Function),
      [],
      [],
      expect.any(String),
    )
  })
})
