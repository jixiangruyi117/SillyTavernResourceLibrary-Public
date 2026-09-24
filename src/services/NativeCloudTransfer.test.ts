/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const transfer = vi.hoisted(() => ({
  webDavRequest: vi.fn(),
  beginJob: vi.fn(),
  beginObject: vi.fn(),
  stageObjectFromLibrary: vi.fn(),
  stageObjectFromSources: vi.fn(),
  probeLibraryObject: vi.fn(),
  appendObject: vi.fn(),
  commitObject: vi.fn(),
  abortObject: vi.fn(),
  startJob: vi.fn(),
  finishJobStaging: vi.fn(),
  getJob: vi.fn(),
  saveCredential: vi.fn(),
  clearCredential: vi.fn(),
  invalidateCredential: vi.fn(),
  readCredential: vi.fn(),
  getLatestJob: vi.fn(),
  cancelJob: vi.fn(),
  restoreStructuredFiles: vi.fn(),
  readRestoredCardMetadata: vi.fn(),
}))
const security = vi.hoisted(() => ({ requestNotifications: vi.fn() }))

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => true, getPlatform: () => 'android' },
  registerPlugin: (name: string) => (name === 'NativeCloudTransfer' ? transfer : security),
}))

import {
  canUseNativeStructuredSnapshotHandoff,
  cancelActiveNativeCloudTransfer,
  clearNativeCloudCredential,
  invalidateNativeCloudCredential,
  NATIVE_CLOUD_INLINE_MAX_BYTES,
  nativeWebDavFetch,
  readNativeCloudCredential,
  readNativeRestoredCardMetadata,
  restoreNativeStructuredObjects,
  saveNativeCloudCredential,
  uploadNativeStructuredSnapshot,
} from './NativeCloudTransfer'

describe('NativeCloudTransfer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    transfer.beginJob.mockResolvedValue({ jobId: 'job-1', pipeline: true })
    transfer.beginObject.mockResolvedValue({ token: 'token-1' })
    transfer.stageObjectFromLibrary.mockResolvedValue({ staged: true })
    transfer.stageObjectFromSources.mockResolvedValue({ staged: true })
    transfer.probeLibraryObject.mockResolvedValue({
      available: true,
      size: 256 * 1024 * 1024,
    })
    transfer.appendObject.mockResolvedValue(undefined)
    transfer.commitObject.mockResolvedValue(undefined)
    transfer.startJob.mockResolvedValue({ status: 'queued' })
    transfer.finishJobStaging.mockResolvedValue({ status: 'running' })
    transfer.cancelJob.mockResolvedValue(undefined)
    transfer.restoreStructuredFiles.mockResolvedValue({
      downloaded: 1,
      reused: 0,
      assembled: 1,
    })
    transfer.saveCredential.mockResolvedValue(undefined)
    transfer.clearCredential.mockResolvedValue(undefined)
    transfer.invalidateCredential.mockResolvedValue(undefined)
    transfer.readCredential.mockResolvedValue({ present: false, valid: true })
    transfer.getJob.mockResolvedValue({
      id: 'job-1',
      provider: 'webdav',
      status: 'completed',
      completed: 1,
      total: 1,
      resultId: 'manifest-id',
      resultName: 'snapshot.json.gz',
    })
    security.requestNotifications.mockResolvedValue({ granted: true })
  })

  it('原生恢复只桥接对象地址与分段描述，不桥接 Blob/Base64', async () => {
    const hash = 'a'.repeat(64)
    await restoreNativeStructuredObjects({
      config: {
        provider: 'github',
        owner: 'owner',
        repository: 'repo',
        retention: 2,
        autoBackup: false,
      },
      secret: 'token',
      objects: [{ url: 'https://api.github.com/assets/1', hash, size: 32 }],
      resources: [
        {
          hash,
          size: 32,
          type: 'other',
          fileName: 'resource.bin',
          segments: [{ hash, offset: 0, size: 32 }],
        },
      ],
    })

    expect(transfer.restoreStructuredFiles).toHaveBeenCalledWith({
      config: expect.objectContaining({ provider: 'github' }),
      secret: 'token',
      objects: [{ url: 'https://api.github.com/assets/1', hash, size: 32 }],
      resources: [
        {
          hash,
          size: 32,
          type: 'other',
          fileName: 'resource.bin',
          segments: [{ hash, offset: 0, size: 32 }],
        },
      ],
    })
    expect(transfer.appendObject).not.toHaveBeenCalled()
    expect(transfer.readRestoredCardMetadata).not.toHaveBeenCalled()
  })

  it('reads exactly one verified card per metadata request', async () => {
    const options = { hash: 'b'.repeat(64), size: 180 * 1024 * 1024, fileName: 'card.png' }
    transfer.readRestoredCardMetadata.mockResolvedValueOnce({
      hash: options.hash,
      card: { name: 'card' },
    })
    await expect(readNativeRestoredCardMetadata(options)).resolves.toMatchObject({
      card: { name: 'card' },
    })
    expect(transfer.readRestoredCardMetadata).toHaveBeenCalledWith(options)
    expect(transfer.restoreStructuredFiles).not.toHaveBeenCalled()
  })

  it('requires an APK update instead of using the retired aggregate-response method', async () => {
    transfer.restoreStructuredFiles.mockRejectedValueOnce(
      Object.assign(new Error('not implemented'), { code: 'UNIMPLEMENTED' }),
    )
    await expect(
      restoreNativeStructuredObjects({
        config: {
          provider: 'github',
          owner: 'owner',
          repository: 'repo',
          retention: 2,
          autoBackup: false,
        },
        secret: 'token',
        objects: [],
        resources: [],
      }),
    ).rejects.toThrow('请更新 Android APK')
  })

  it('awaits Android credential writes and preserves the durable invalid state', async () => {
    await saveNativeCloudCredential('github', 'token')
    await invalidateNativeCloudCredential('github')
    transfer.readCredential.mockResolvedValueOnce({ present: false, valid: false })
    await expect(readNativeCloudCredential('github')).resolves.toEqual({
      state: 'invalid',
      secret: '',
    })
    await clearNativeCloudCredential('github')

    expect(transfer.saveCredential).toHaveBeenCalledWith({ provider: 'github', secret: 'token' })
    expect(transfer.invalidateCredential).toHaveBeenCalledWith({ provider: 'github' })
    expect(transfer.clearCredential).toHaveBeenCalledWith({ provider: 'github' })
  })

  it('cancels the persisted active WorkManager job after a WebView process restart', async () => {
    transfer.getLatestJob.mockResolvedValueOnce({
      present: true,
      id: 'persisted-job',
      provider: 'github',
      status: 'queued',
      completed: 3,
      total: 10,
      updatedAt: 1,
    })

    await expect(cancelActiveNativeCloudTransfer()).resolves.toBe(true)
    expect(transfer.cancelJob).toHaveBeenCalledWith({ jobId: 'persisted-job' })
  })

  it('把 CapacitorHttp 不接受的 PROPFIND 交给受限原生 WebDAV 通道', async () => {
    transfer.webDavRequest.mockResolvedValue({
      status: 207,
      headers: { 'content-type': 'application/xml' },
      body: '<multistatus />',
    })

    const response = await nativeWebDavFetch('https://example.test/dav/SRL-Backups', {
      method: 'PROPFIND',
      headers: { Authorization: 'Basic credential', Depth: '1' },
    })

    expect(transfer.webDavRequest).toHaveBeenCalledWith({
      url: 'https://example.test/dav/SRL-Backups',
      method: 'PROPFIND',
      headers: { authorization: 'Basic credential', depth: '1' },
    })
    expect(response.status).toBe(207)
    await expect(response.text()).resolves.toBe('<multistatus />')
  })

  it('完全相同时只暂存最终清单并由 Android 最后提交', async () => {
    const result = await uploadNativeStructuredSnapshot({
      config: {
        provider: 'webdav',
        baseUrl: 'https://example.test/dav',
        folder: 'backup',
        username: 'user',
        retention: 7,
        autoBackup: false,
      },
      secret: 'secret',
      objects: [],
      manifest: {
        name: 'snapshot.json.gz',
        blob: new Blob(['manifest']),
        contentType: 'application/gzip',
      },
    })

    expect(transfer.beginJob).toHaveBeenCalledWith(expect.objectContaining({ expectedTotal: 1 }))
    expect(transfer.startJob).toHaveBeenCalledBefore(transfer.beginObject)
    expect(transfer.beginObject).toHaveBeenCalledOnce()
    expect(transfer.beginObject).toHaveBeenCalledWith(
      expect.objectContaining({ manifest: true, name: 'snapshot.json.gz' }),
    )
    expect(transfer.commitObject).toHaveBeenCalledBefore(transfer.finishJobStaging)
    expect(transfer.finishJobStaging).toHaveBeenCalledWith({ jobId: 'job-1' })
    expect(result).toEqual({
      id: 'manifest-id',
      name: 'snapshot.json.gz',
      metrics: expect.objectContaining({
        localReadBytes: 8,
        bridgeBytes: 8,
        httpRequestCount: 0,
        retryCount: 0,
      }),
    })
  })

  it('只在 NativeLibrary 原件真实可用时允许大型 changed object 进入原生 handoff', async () => {
    const blob = new Blob([new Uint8Array(NATIVE_CLOUD_INLINE_MAX_BYTES + 1)])
    const object = {
      name: `srl-chunk--sha256-${'a'.repeat(64)}`,
      blob,
      contentType: 'application/octet-stream',
      nativeSource: {
        kind: 'range' as const,
        contentHash: 'b'.repeat(64),
        offset: 1024,
        size: blob.size,
      },
    }
    const manifest = {
      name: 'snapshot.json.gz',
      blob: new Blob(['manifest']),
      contentType: 'application/gzip',
    }

    await expect(
      canUseNativeStructuredSnapshotHandoff({ objects: [object], manifest }),
    ).resolves.toBe(true)
    expect(transfer.probeLibraryObject).toHaveBeenCalledWith({
      sourceHash: 'b'.repeat(64),
      minimumSize: 1024 + blob.size,
    })

    transfer.probeLibraryObject.mockResolvedValueOnce({ available: false, size: 0 })
    await expect(
      canUseNativeStructuredSnapshotHandoff({ objects: [object], manifest }),
    ).resolves.toBe(false)

    await expect(
      canUseNativeStructuredSnapshotHandoff({
        objects: [{ ...object, nativeSource: undefined }],
        manifest,
      }),
    ).resolves.toBe(false)
  })

  it('大型 NativeLibrary source 在 staging 时消失也不会重新退回 Base64 Bridge', async () => {
    const blob = new Blob([new Uint8Array(NATIVE_CLOUD_INLINE_MAX_BYTES + 1)])
    transfer.stageObjectFromLibrary.mockResolvedValueOnce({ staged: false })

    await expect(
      uploadNativeStructuredSnapshot({
        config: {
          provider: 'webdav',
          baseUrl: 'https://example.test/dav',
          folder: 'backup',
          username: 'user',
          retention: 7,
          autoBackup: false,
        },
        secret: 'secret',
        objects: [
          {
            name: `srl-chunk--sha256-${'c'.repeat(64)}`,
            blob,
            contentType: 'application/octet-stream',
            nativeSource: {
              kind: 'range',
              contentHash: 'd'.repeat(64),
              offset: 0,
              size: blob.size,
            },
          },
        ],
        manifest: {
          name: 'snapshot.json.gz',
          blob: new Blob(['manifest']),
          contentType: 'application/gzip',
        },
      }),
    ).rejects.toThrow('阻止云对象退回 JS Blob/Base64')

    expect(transfer.beginObject).not.toHaveBeenCalled()
    expect(transfer.appendObject).not.toHaveBeenCalled()
  })

  it('旧 APK 未声明流水能力时保持全部暂存后再启动', async () => {
    transfer.beginJob.mockResolvedValueOnce({ jobId: 'job-1' })

    await uploadNativeStructuredSnapshot({
      config: {
        provider: 'webdav',
        baseUrl: 'https://example.test/dav',
        folder: 'backup',
        username: 'user',
        retention: 7,
        autoBackup: false,
      },
      secret: 'secret',
      objects: [],
      manifest: {
        name: 'snapshot.json.gz',
        blob: new Blob(['manifest']),
        contentType: 'application/gzip',
      },
    })

    expect(transfer.commitObject).toHaveBeenCalledBefore(transfer.startJob)
    expect(transfer.finishJobStaging).not.toHaveBeenCalled()
  })

  it('流水暂存失败时取消已启动的后台任务，不留下半成品 job', async () => {
    transfer.beginObject.mockRejectedValueOnce(new Error('暂存失败'))

    await expect(
      uploadNativeStructuredSnapshot({
        config: {
          provider: 'webdav',
          baseUrl: 'https://example.test/dav',
          folder: 'backup',
          username: 'user',
          retention: 7,
          autoBackup: false,
        },
        secret: 'secret',
        objects: [],
        manifest: {
          name: 'snapshot.json.gz',
          blob: new Blob(['manifest']),
          contentType: 'application/gzip',
        },
      }),
    ).rejects.toThrow('暂存失败')

    expect(transfer.startJob).toHaveBeenCalledBefore(transfer.beginObject)
    expect(transfer.finishJobStaging).not.toHaveBeenCalled()
    expect(transfer.cancelJob).toHaveBeenCalledWith({ jobId: 'job-1' })
  })

  it('手动备份不套用仅 Wi-Fi/充电约束', async () => {
    await uploadNativeStructuredSnapshot({
      config: {
        provider: 'github',
        owner: 'owner',
        repository: 'repo',
        retention: 7,
        autoBackup: true,
        protection: { wifiOnly: true, chargingOnly: true },
      },
      releaseId: 1,
      secret: 'token',
      objects: [],
      manifest: {
        name: 'snapshot.json.gz',
        blob: new Blob(['x']),
        contentType: 'application/gzip',
      },
    })

    expect(transfer.beginJob).toHaveBeenCalledWith(
      expect.objectContaining({ wifiOnly: false, chargingOnly: false }),
    )
  })
})
