import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { CategoryService } from './CategoryService'
import type { CreatedStructuredSnapshot, StructuredSnapshot } from './CloudStructuredSnapshot'
import type { ExportService } from './ExportService'
import type { ResourceService } from './ResourceService'
import type { RestoreService } from './RestoreService'

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>()
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
    return [...this.values.keys()][index] ?? null
  }
  removeItem(key: string) {
    this.values.delete(key)
  }
  setItem(key: string, value: string) {
    this.values.set(key, value)
  }
}

const nativeCloud = vi.hoisted(() => ({
  canUseNativeStructuredSnapshotHandoff: vi.fn(),
  clearNativeCloudCredential: vi.fn(),
  cancelActiveNativeCloudTransfer: vi.fn(),
  getLatestNativeCloudJob: vi.fn(),
  invalidateNativeCloudCredential: vi.fn(),
  isNativeCloudTransferAvailable: vi.fn(),
  nativeWebDavFetch: vi.fn(),
  readNativeCloudCredential: vi.fn(),
  readNativeRestoredCardMetadata: vi.fn(),
  restoreNativeStructuredObjects: vi.fn(),
  saveNativeCloudCredential: vi.fn(),
  uploadNativeStructuredSnapshot: vi.fn(),
}))

vi.mock('./NativeCloudTransfer', () => nativeCloud)

import { CloudBackupService } from './CloudBackupService'

function createSnapshot(blob: Blob): CreatedStructuredSnapshot {
  const hash = 'a'.repeat(64)
  const name = `srl-chunk--sha256-${hash}`
  const source = { kind: 'range' as const, contentHash: hash, offset: 0, size: blob.size }
  return {
    snapshot: {
      format: 'srl-structured-cloud-snapshot',
      version: 3,
      createdAt: '2026-08-20T00:00:00.000Z',
      categories: [],
      resources: [],
      versions: [],
      portableData: { version: 1 },
      objectContract: {
        algorithm: 'SHA-256',
        immutable: true,
        naming: 'srl-chunk--sha256-{hash}',
      },
    } satisfies StructuredSnapshot,
    chunks: new Map([[name, blob]]),
    nativeSources: new Map([[name, source]]),
    objectPlans: [
      { name, hash, size: blob.size, blob, source, contentType: 'application/octet-stream' },
    ],
    totalSize: blob.size,
    partCount: 1,
    localReadBytes: 0,
    descriptorUpdates: [],
  }
}

describe('CloudBackupService Native Cloud fail-closed handoff', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('localStorage', new MemoryStorage())
    vi.stubGlobal('sessionStorage', new MemoryStorage())
    nativeCloud.isNativeCloudTransferAvailable.mockReturnValue(true)
    nativeCloud.canUseNativeStructuredSnapshotHandoff.mockResolvedValue(false)
    nativeCloud.readNativeCloudCredential.mockResolvedValue({ state: 'missing', secret: '' })
    nativeCloud.restoreNativeStructuredObjects.mockResolvedValue({
      downloaded: 1,
      reused: 0,
      assembled: 1,
    })
  })

  it('does not report an APK credential as saved until Keystore persistence completes', async () => {
    let finishSave!: () => void
    nativeCloud.saveNativeCloudCredential.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        finishSave = resolve
      }),
    )
    const service = new CloudBackupService(
      {} as ResourceService,
      {} as CategoryService,
      {} as ExportService,
      {} as RestoreService,
    ) as unknown as {
      initializeCredentials: () => Promise<void>
      getSnapshot: CloudBackupService['getSnapshot']
      importPortableCredentials: CloudBackupService['importPortableCredentials']
    }
    await service.initializeCredentials()

    const saving = service.importPortableCredentials({ github: 'new-token' })
    await Promise.resolve()
    expect(service.getSnapshot().credentials.github).toBe('missing')

    finishSave()
    await saving
    expect(service.getSnapshot().credentials.github).toBe('valid')
  })

  it('persists a confirmed APK 401 as invalid and does not preserve the old Keystore secret', async () => {
    const service = new CloudBackupService(
      {} as ResourceService,
      {} as CategoryService,
      {} as ExportService,
      {} as RestoreService,
    ) as unknown as {
      initializeCredentials: () => Promise<void>
      getSnapshot: CloudBackupService['getSnapshot']
      importPortableCredentials: CloudBackupService['importPortableCredentials']
      invalidateCredentialOnConfirmed401: (provider: 'github', error: unknown) => Promise<void>
    }
    await service.initializeCredentials()
    await service.importPortableCredentials({ github: 'old-token' })

    await service.invalidateCredentialOnConfirmed401(
      'github',
      Object.assign(new Error('GitHub 请求失败（401）'), { status: 401 }),
    )

    expect(nativeCloud.invalidateNativeCloudCredential).toHaveBeenCalledWith('github')
    expect(service.getSnapshot().credentials.github).toBe('invalid')

    nativeCloud.readNativeCloudCredential.mockResolvedValueOnce({ state: 'invalid', secret: '' })
    const reopened = new CloudBackupService(
      {} as ResourceService,
      {} as CategoryService,
      {} as ExportService,
      {} as RestoreService,
    )
    await reopened.initializeCredentials()
    expect(reopened.getSnapshot().credentials.github).toBe('invalid')
  })

  it('invalidates an APK credential when structured restore receives a confirmed 401', async () => {
    localStorage.setItem(
      'srl.cloudBackup.settings.v1',
      JSON.stringify({
        activeProvider: 'github',
        github: {
          provider: 'github',
          owner: 'owner',
          repository: 'private-backups',
          retention: 2,
          autoBackup: false,
        },
      }),
    )
    const service = new CloudBackupService(
      {} as ResourceService,
      {} as CategoryService,
      {} as ExportService,
      {} as RestoreService,
    ) as unknown as {
      initializeCredentials: () => Promise<void>
      importPortableCredentials: CloudBackupService['importPortableCredentials']
      restoreBackup: CloudBackupService['restoreBackup']
      readGitHubStructuredSnapshot: ReturnType<typeof vi.fn>
    }
    await service.initializeCredentials()
    await service.importPortableCredentials({ github: 'token' })
    service.readGitHubStructuredSnapshot = vi.fn(async () => {
      throw Object.assign(new Error('原生恢复对象下载失败（401）'), { code: 'HTTP_401' })
    })

    await expect(
      service.restoreBackup({
        id: '1',
        objectKey: 'snapshot.srlmanifest.v3.json.gz',
        size: 1,
        createdAt: 1,
        kind: 'githubSnapshot',
      }),
    ).rejects.toThrow(/401/)
    expect(nativeCloud.invalidateNativeCloudCredential).toHaveBeenCalledWith('github')
  })

  it('does not invalidate an APK credential from a message-only 401 hint', async () => {
    const service = new CloudBackupService(
      {} as ResourceService,
      {} as CategoryService,
      {} as ExportService,
      {} as RestoreService,
    ) as unknown as {
      initializeCredentials: () => Promise<void>
      importPortableCredentials: CloudBackupService['importPortableCredentials']
      invalidateCredentialOnConfirmed401: (provider: 'github', error: unknown) => Promise<void>
    }
    await service.initializeCredentials()
    await service.importPortableCredentials({ github: 'old-token' })

    await service.invalidateCredentialOnConfirmed401(
      'github',
      new Error('代理端口 401 没有响应，并非服务端认证状态'),
    )

    expect(nativeCloud.invalidateNativeCloudCredential).not.toHaveBeenCalled()
  })

  it('does not start a second APK backup while a persisted WorkManager job is queued', async () => {
    nativeCloud.getLatestNativeCloudJob.mockResolvedValueOnce({
      id: 'persisted-job',
      provider: 'github',
      status: 'queued',
      completed: 30,
      total: 40,
      updatedAt: 1,
    })
    const service = new CloudBackupService(
      {} as ResourceService,
      {} as CategoryService,
      {} as ExportService,
      {} as RestoreService,
    ) as unknown as {
      initializeCredentials: () => Promise<void>
      importPortableCredentials: CloudBackupService['importPortableCredentials']
      createBackup: CloudBackupService['createBackup']
    }
    await service.initializeCredentials()
    await service.importPortableCredentials({ github: 'token' })

    await expect(
      service.createBackup({
        provider: 'github',
        owner: 'owner',
        repository: 'private-backups',
        retention: 2,
        autoBackup: false,
      }),
    ).rejects.toThrow(/不会重新开始整个备份/)
    expect(nativeCloud.uploadNativeStructuredSnapshot).not.toHaveBeenCalled()
  })

  it.each([
    {
      provider: 'GitHub',
      upload: 'uploadGitHubStructuredBackup',
      error: /已阻止 GitHub 云对象退回 JS Blob 网络/,
      config: {
        provider: 'github',
        owner: 'owner',
        repository: 'private-backups',
        retention: 2,
        autoBackup: false,
      },
      setup(service: Record<string, unknown>) {
        service.getGitHubRelease = vi.fn().mockResolvedValue({ id: 7 })
        service.listGitHubAssets = vi.fn().mockResolvedValue([])
        service.uploadGitHubAsset = vi.fn()
      },
      uploadSpy: 'uploadGitHubAsset',
    },
    {
      provider: 'Koofr',
      upload: 'uploadWebDavStructuredBackup',
      error: /已阻止 Koofr 云对象退回 JS Blob 网络/,
      config: {
        provider: 'webdav',
        baseUrl: 'https://dav.example.com',
        folder: 'SRL-Backups',
        username: 'user',
        retention: 2,
        autoBackup: false,
      },
      setup(service: Record<string, unknown>) {
        service.ensureWebDavFolder = vi.fn()
        service.listWebDavObjects = vi.fn().mockResolvedValue([])
        service.uploadWebDavObject = vi.fn()
      },
      uploadSpy: 'uploadWebDavObject',
    },
  ])(
    '$provider refuses a JS Blob/Base64 upload when NativeLibrary handoff is incomplete',
    async ({ upload, error, config, setup, uploadSpy }) => {
      const service = new CloudBackupService(
        {} as ResourceService,
        {} as CategoryService,
        {} as ExportService,
        {} as RestoreService,
      ) as unknown as Record<string, unknown>
      setup(service)

      await expect(
        (
          service[upload] as (
            config: unknown,
            secret: string,
            snapshot: CreatedStructuredSnapshot,
          ) => Promise<unknown>
        ).call(
          service,
          config,
          'secret',
          createSnapshot(new Blob([new Uint8Array(5 * 1024 * 1024)])),
        ),
      ).rejects.toThrow(error)

      expect(nativeCloud.canUseNativeStructuredSnapshotHandoff).toHaveBeenCalledOnce()
      expect(nativeCloud.uploadNativeStructuredSnapshot).not.toHaveBeenCalled()
      expect(service[uploadSpy]).not.toHaveBeenCalled()
    },
  )

  it('APK Koofr rejects a wrong-size content-addressed object before native PUT handoff', async () => {
    const snapshot = createSnapshot(new Blob(['changed']))
    const objectName = [...snapshot.chunks.keys()][0]!
    const service = new CloudBackupService(
      {} as ResourceService,
      {} as CategoryService,
      {} as ExportService,
      {} as RestoreService,
    ) as unknown as {
      uploadWebDavStructuredBackup: (
        config: unknown,
        secret: string,
        snapshot: CreatedStructuredSnapshot,
      ) => Promise<unknown>
      ensureWebDavFolder: ReturnType<typeof vi.fn>
      listWebDavObjects: ReturnType<typeof vi.fn>
    }
    service.ensureWebDavFolder = vi.fn()
    service.listWebDavObjects = vi.fn(async () => [
      { objectKey: `objects/${objectName}`, size: snapshot.chunks.get(objectName)!.size + 1 },
    ])

    await expect(
      service.uploadWebDavStructuredBackup(
        {
          provider: 'webdav',
          baseUrl: 'https://app.koofr.net/dav/Koofr',
          folder: 'SRL-Backups',
          username: 'user',
          retention: 2,
          autoBackup: false,
        },
        'secret',
        snapshot,
      ),
    ).rejects.toThrow(/拒绝覆盖 immutable 对象/)
    expect(nativeCloud.canUseNativeStructuredSnapshotHandoff).not.toHaveBeenCalled()
    expect(nativeCloud.uploadNativeStructuredSnapshot).not.toHaveBeenCalled()
  })

  it.each(['github', 'webdav'] as const)(
    'APK V3 %s restore uses native files followed by per-card reads',
    async (provider) => {
      const hash = 'b'.repeat(64)
      const objectName = `srl-chunk--sha256-${hash}`
      const snapshot: StructuredSnapshot = {
        format: 'srl-structured-cloud-snapshot',
        version: 3,
        createdAt: '2026-08-26T00:00:00.000Z',
        categories: [],
        resources: [
          {
            id: 'resource-1',
            type: 'other',
            name: '大资源',
            description: '',
            fileName: 'large.bin',
            mimeType: 'application/octet-stream',
            fileSize: 32,
            contentHash: hash,
            favorite: false,
            categoryId: null,
            tags: [],
            metadata: {},
            createdAt: 1,
            updatedAt: 1,
            object: {
              format: 'srl-github-backup-bundle',
              version: 2,
              createdAt: '2026-08-26T00:00:00.000Z',
              fileName: 'large.bin',
              totalSize: 32,
              totalSha256: hash,
              parts: [
                {
                  name: objectName,
                  size: 32,
                  sha256: hash,
                  storage: {
                    kind: provider === 'github' ? 'github-release' : 'koofr-path',
                    container: 'srl-cloud-objects-0001',
                    objectKey: provider === 'github' ? objectName : `objects/${objectName}`,
                  },
                },
              ],
            },
          },
        ],
        versions: [],
        portableData: { version: 1 },
        objectContract: {
          algorithm: 'SHA-256',
          immutable: true,
          naming: 'srl-chunk--sha256-{hash}',
        },
      }
      const restore = {
        canRestoreStructuredNative: vi.fn(() => true),
        prepareStructuredNative: vi.fn(async () => ({
          preview: { duplicatesToSkip: 0, categoriesToReuse: 0 },
          resources: [{ id: 'resource-1' }],
          versions: [],
          categories: [],
          portableData: { version: 1 },
        })),
        restoreNative: vi.fn(async () => ({ restoredResources: 1 })),
        prepareStructured: vi.fn(),
        restore: vi.fn(),
      } as unknown as RestoreService
      const resources = {
        listSummaries: vi.fn(() => {
          throw new Error('must not load existing card bodies')
        }),
        listResourceListSummaries: vi.fn(async () => []),
      }
      const service = new CloudBackupService(
        resources as unknown as ResourceService,
        { list: vi.fn(async () => []) } as unknown as CategoryService,
        {} as ExportService,
        restore,
      ) as unknown as {
        restoreStructuredBackup: (item: unknown, config: unknown, secret: string) => Promise<number>
        readGitHubStructuredSnapshot: ReturnType<typeof vi.fn>
        readWebDavStructuredSnapshot: ReturnType<typeof vi.fn>
        getGitHubRelease: ReturnType<typeof vi.fn>
        listGitHubAssets: ReturnType<typeof vi.fn>
        createGitHubObjectReader: ReturnType<typeof vi.fn>
      }
      service.readGitHubStructuredSnapshot = vi.fn(async () => snapshot)
      service.readWebDavStructuredSnapshot = vi.fn(async () => snapshot)
      service.getGitHubRelease = vi.fn(async () => ({ id: 41 }))
      service.listGitHubAssets = vi.fn(async () => [
        { id: 99, name: objectName, size: 32, created_at: '', url: '' },
      ])
      service.createGitHubObjectReader = vi.fn()

      await expect(
        service.restoreStructuredBackup(
          {
            id: '7',
            objectKey: 'snapshot.srlmanifest.v3.json.gz',
            size: 32,
            createdAt: 1,
            kind: provider === 'github' ? 'githubSnapshot' : 'webdavSnapshot',
          },
          {
            provider,
            owner: 'owner',
            repository: 'private-backups',
            baseUrl: 'https://app.koofr.net/dav/Koofr',
            folder: 'SRL-Backups',
            username: 'user@example.com',
            retention: 2,
            autoBackup: false,
          },
          'secret',
        ),
      ).resolves.toBe(1)

      expect(nativeCloud.restoreNativeStructuredObjects).toHaveBeenCalledWith({
        config: expect.objectContaining({ provider }),
        secret: 'secret',
        objects: [
          {
            hash,
            size: 32,
            url:
              provider === 'github'
                ? 'https://api.github.com/repos/owner/private-backups/releases/assets/99'
                : `https://app.koofr.net/dav/Koofr/SRL-Backups/objects/${objectName}`,
          },
        ],
        resources: [
          {
            hash,
            size: 32,
            type: 'other',
            fileName: 'large.bin',
            segments: [{ hash, offset: 0, size: 32 }],
          },
        ],
      })
      expect(restore.prepareStructuredNative).toHaveBeenCalledOnce()
      expect(restore.restoreNative).toHaveBeenCalledOnce()
      expect(restore.restoreNative).toHaveBeenCalledWith(expect.any(Object))
      expect(service.createGitHubObjectReader).not.toHaveBeenCalled()
      expect(restore.prepareStructured).not.toHaveBeenCalled()
      expect(resources.listResourceListSummaries).toHaveBeenCalledOnce()
      expect(resources.listSummaries).not.toHaveBeenCalled()
    },
  )

  it('APK Koofr restore plan uses the configured WebDAV host and never the CF proxy', async () => {
    const hash = 'd'.repeat(64)
    const objectName = `srl-chunk--sha256-${hash}`
    const snapshot: StructuredSnapshot = {
      format: 'srl-structured-cloud-snapshot',
      version: 3,
      createdAt: '2026-08-26T00:00:00.000Z',
      categories: [],
      resources: [
        {
          id: 'resource-1',
          type: 'other',
          name: 'Koofr 资源',
          description: '',
          fileName: 'resource.bin',
          mimeType: 'application/octet-stream',
          fileSize: 16,
          contentHash: hash,
          favorite: false,
          categoryId: null,
          tags: [],
          metadata: {},
          createdAt: 1,
          updatedAt: 1,
          object: {
            format: 'srl-github-backup-bundle',
            version: 2,
            createdAt: '2026-08-26T00:00:00.000Z',
            fileName: 'resource.bin',
            totalSize: 16,
            totalSha256: hash,
            parts: [
              {
                name: objectName,
                size: 16,
                sha256: hash,
                storage: {
                  kind: 'koofr-path',
                  container: 'objects',
                  objectKey: `objects/${objectName}`,
                },
              },
            ],
          },
        },
      ],
      versions: [],
      portableData: { version: 1 },
    }
    const service = new CloudBackupService(
      {} as ResourceService,
      {} as CategoryService,
      {} as ExportService,
      {} as RestoreService,
    ) as unknown as {
      buildNativeRestorePlan: (
        snapshot: StructuredSnapshot,
        config: unknown,
        secret: string,
      ) => Promise<{ objects: Array<{ url: string }> }>
    }

    const plan = await service.buildNativeRestorePlan(
      snapshot,
      {
        provider: 'webdav',
        baseUrl: 'https://app.koofr.net/dav/Koofr',
        folder: 'SRL-Backups',
        username: 'user@example.com',
        retention: 2,
        autoBackup: false,
      },
      'secret',
    )

    expect(plan.objects[0]?.url).toBe(
      `https://app.koofr.net/dav/Koofr/SRL-Backups/objects/${objectName}`,
    )
    expect(plan.objects[0]?.url).not.toContain('/api/cloud/proxy/')
  })
})
