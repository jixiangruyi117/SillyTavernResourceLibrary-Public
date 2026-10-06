/** @vitest-environment jsdom */
import { defineComponent, ref } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import { useDiscordResourceInbox } from './UseDiscordResourceInbox'
import { taskCenter } from '../core/TaskCenter'
import type { SharedFileBatch } from '../utils/ShareTargetIntake'
import type { VaultStatus } from '../types/Vault'
import type { ImportResult } from '../types/Import'

const setup = vi.hoisted(() => ({
  target: { workerUrl: 'https://worker.example', libraryId: 'library-1' },
  list: vi.fn(),
  ack: vi.fn(),
  download: vi.fn(),
  read: vi.fn(),
  stage: vi.fn(),
  nativeRead: vi.fn(),
  cleanupNative: vi.fn(),
  notice: vi.fn(),
  notify: vi.fn(),
  native: false,
  inboxMode: false,
  release: vi.fn(),
}))
vi.mock('../services/NativeDiscordInboxService', () => ({
  isNativeDiscordInboxRunning: () => setup.inboxMode,
  notifyNativeDiscordInboxResult: setup.notify,
}))
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => setup.native, getPlatform: () => 'android' },
  registerPlugin: vi.fn(() => ({})),
}))
vi.mock('../core/AppContainer', () => ({ initializeVaultOnce: async () => undefined }))
vi.mock('../core/LibraryContainer', () => ({ initializeVaultOnce: async () => undefined }))
vi.mock('../core/NativeSecurity', () => ({ requestNativeNotifications: async () => true }))
vi.mock('../core/NoticeCenter', () => ({ noticeCenter: { push: setup.notice, dismiss: vi.fn() } }))
vi.mock('../services/NativeImportKeepAlive', () => ({
  notifyNativeImportAwaitingChoice: setup.notify,
}))
vi.mock('../services/DiscordHandoffService', () => ({
  inboxConnection: () => ({ ...setup.target }),
}))
vi.mock('../services/DiscordResourceInboxService', () => ({
  listDiscordResourceJobs: setup.list,
  acknowledgeDiscordResource: setup.ack,
  downloadWebDiscordResource: setup.download,
  readDiscordResourceJob: setup.read,
}))
vi.mock('../utils/ShareTargetIntake', () => ({
  allowDiscordAttachmentRetry: setup.release,
  cleanupCompletedCloudDiscordResource: setup.cleanupNative,
  stageCloudDiscordResource: setup.stage,
  readCloudDiscordResource: setup.nativeRead,
  cloudWebResourceBatch: (file: File, id: string) => ({
    files: [file],
    recoveryId: id,
    acknowledge: async () => undefined,
  }),
}))
const job = {
  id: '11111111-1111-4111-a111-111111111111',
  name: 'card.json',
  libraryId: 'library-1',
  size: 12,
  state: 'queued',
  createdAt: 1,
  updatedAt: 1,
  expiresAt: 9999999999999,
}
const target = { workerUrl: 'https://worker.example', libraryId: 'library-1' }
const mounted: ReturnType<typeof mount>[] = []
function start(locked = false) {
  const vault = ref({ locked } as VaultStatus)
  const receive = vi.fn<(batch: SharedFileBatch) => void>()
  let intake!: ReturnType<typeof useDiscordResourceInbox>
  const wrapper = mount(
    defineComponent({
      setup() {
        intake = useDiscordResourceInbox(vault, receive)
        return () => null
      },
    }),
  )
  mounted.push(wrapper)
  return { wrapper, vault, receive, request: () => intake.request() }
}
beforeEach(() => {
  vi.clearAllMocks()
  setup.native = false
  setup.inboxMode = false
  setup.target = { ...target }
  setup.list.mockResolvedValue({ jobs: [job], recent: [], hasMore: false })
  setup.ack.mockResolvedValue(undefined)
  setup.download.mockResolvedValue(new File(['{}'], 'card.json'))
  setup.read.mockResolvedValue({
    ...job,
    url: 'https://cdn.discordapp.com/attachments/11111/22222/card.json',
  })
  setup.stage.mockResolvedValue(undefined)
  setup.nativeRead.mockResolvedValue({ transferredBytes: 3, totalBytes: 12 })
  setup.cleanupNative.mockResolvedValue(undefined)
})
afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount()
  for (const task of taskCenter.list()) {
    taskCenter.cancelled(task.operationId)
    taskCenter.dismiss(task.operationId)
  }
})
describe('cloud resource coordination', () => {
  it('acknowledges a native background import without re-delivering the file to the JS importer', async () => {
    setup.native = true
    setup.nativeRead.mockResolvedValue({
      transferredBytes: 12,
      nativeImportOutcome: { state: 'imported', resourceId: 'native-resource-1', name: 'Mira' },
    })
    const intake = start()
    await flushPromises()
    expect(intake.receive).not.toHaveBeenCalled()
    expect(setup.ack).toHaveBeenCalledWith(job.id, 'imported', target, undefined)
    expect(setup.notify).toHaveBeenCalledWith(expect.objectContaining({ state: 'imported' }))
    expect(setup.cleanupNative).toHaveBeenCalledWith(job.id)
    expect(taskCenter.list()[0]?.status).toBe('completed')
    expect(setup.stage).not.toHaveBeenCalled()
  })

  it('notifies a native duplicate as already present while acknowledging the cloud job as consumed', async () => {
    setup.native = true
    setup.nativeRead.mockResolvedValue({
      transferredBytes: 12,
      nativeImportOutcome: { state: 'duplicate_card', resourceId: 'existing-card', name: 'Mira' },
    })
    const intake = start()
    await flushPromises()
    expect(setup.ack).toHaveBeenCalledWith(job.id, 'imported', target, undefined)
    expect(setup.notify).toHaveBeenCalledWith(expect.objectContaining({ kind: 'resource', state: 'duplicate' }))
    expect(taskCenter.list()[0]?.status).toBe('completed')
    expect(intake.receive).not.toHaveBeenCalled()
  })

  it('retries only cloud confirmation after a committed native import, without parsing or downloading again', async () => {
    setup.native = true
    const cleanup = vi.fn()
    setup.nativeRead.mockResolvedValue({
      transferredBytes: 12,
      batch: { files: [new File(['{}'], 'card.json')], acknowledge: cleanup },
    })
    const intake = start()
    await flushPromises()
    setup.ack.mockRejectedValueOnce(new Error('HTTP 503'))
    await intake.receive.mock.calls[0]![0].acknowledge()
    await flushPromises()
    expect(taskCenter.list()[0]?.error).toContain('资源已导入')
    expect(cleanup).not.toHaveBeenCalled()
    expect(setup.notify.mock.calls.map(([result]) => result.state)).toEqual(['imported'])
    await taskCenter.retry(`discord-resource-${job.id}`)
    expect(cleanup).toHaveBeenCalledOnce()
    expect(intake.receive).toHaveBeenCalledOnce()
    expect(setup.stage).not.toHaveBeenCalled()
    expect(setup.ack.mock.calls.map((call) => call[1])).toEqual(['imported', 'imported'])
    expect(taskCenter.list()[0]?.status).toBe('completed')
  })

  it('exposes a native version decision even when the cloud progress acknowledgement never returns', async () => {
    setup.native = true
    setup.nativeRead.mockResolvedValue({
      transferredBytes: 12,
      batch: { files: [new File(['{}'], 'card.json')], acknowledge: vi.fn() },
    })
    const intake = start()
    await flushPromises()
    setup.ack.mockImplementation(() => new Promise(() => undefined))
    const batch = intake.receive.mock.calls[0]![0]
    let resolved = false
    void batch.onItemComplete?.({ status: 'versionCandidate' } as ImportResult)?.then(() => {
      resolved = true
    })
    await flushPromises()
    expect(resolved).toBe(true)
    expect(setup.notify).toHaveBeenCalledWith(expect.objectContaining({ state: 'waiting_version' }))
    await batch.acknowledge()
    expect(setup.notify).not.toHaveBeenCalledWith(expect.objectContaining({ state: 'imported' }))
  })

  it('releases the importer after a local native commit while keeping staging until cloud confirmation succeeds', async () => {
    setup.native = true
    const cleanup = vi.fn()
    setup.nativeRead.mockResolvedValue({
      transferredBytes: 12,
      batch: { files: [new File(['{}'], 'card.json')], acknowledge: cleanup },
    })
    setup.ack.mockImplementation(() => new Promise(() => undefined))
    const intake = start()
    await flushPromises()
    const batch = intake.receive.mock.calls[0]![0]
    let released = false
    void batch.acknowledge().then(() => {
      released = true
    })
    await flushPromises()
    expect(released).toBe(true)
    expect(cleanup).not.toHaveBeenCalled()
    expect(setup.notify).toHaveBeenCalledWith(expect.objectContaining({ state: 'imported' }))
    setup.ack.mockResolvedValue(undefined)
    // A failed/in-flight confirmation must not requeue or download the local file.
    await intake.request()
    expect(intake.receive).toHaveBeenCalledOnce()
    expect(setup.stage).not.toHaveBeenCalled()
  })

  it('keeps independent native completions distinct while the cloud queue is unavailable', async () => {
    setup.native = true
    setup.inboxMode = true
    setup.list.mockImplementation(() => new Promise(() => undefined))
    setup.nativeRead.mockImplementation(async ({ id }) => ({
      transferredBytes: 12,
      batch: { files: [new File(['{}'], `${id}.json`)], acknowledge: vi.fn() },
    }))
    const intake = start()
    await flushPromises()
    const ids = [job.id, '22222222-2222-4222-a222-222222222222']
    for (const id of [...ids, ...ids])
      window.dispatchEvent(
        new CustomEvent('srl:native-share-download-completed', {
          detail: { cloud: true, token: `discord-url-${id}` },
        }),
      )
    await flushPromises()
    expect(intake.receive).toHaveBeenCalledTimes(2)
    expect(taskCenter.list()).toHaveLength(2)
    expect(setup.stage).not.toHaveBeenCalled()
  })

  it.each(['target', 'vault'] as const)(
    'retains a claimed native file if %s changes while its metadata is read',
    async (change) => {
      setup.native = true
      setup.inboxMode = true
      setup.list.mockImplementation(() => new Promise(() => undefined))
      const intake = start()
      await flushPromises()
      const cleanup = vi.fn()
      setup.nativeRead.mockImplementation(async () => {
        if (change === 'target') setup.target = { ...target, libraryId: 'other-library' }
        else intake.vault.value = { locked: true } as VaultStatus
        return {
          transferredBytes: 12,
          batch: {
            files: [new File(['{}'], 'card.json')],
            nativeShareTokens: ['staged-token'],
            acknowledge: cleanup,
          },
        }
      })
      window.dispatchEvent(
        new CustomEvent('srl:native-share-download-completed', {
          detail: { cloud: true, token: `discord-url-${job.id}` },
        }),
      )
      await flushPromises()
      expect(intake.receive).not.toHaveBeenCalled()
      expect(cleanup).not.toHaveBeenCalled()
      expect(setup.release).toHaveBeenCalledWith('staged-token')
      expect(setup.ack).not.toHaveBeenCalled()
    },
  )

  it('does not adopt ordinary share completions as cloud resources', async () => {
    setup.native = true
    setup.list.mockImplementation(() => new Promise(() => undefined))
    const intake = start()
    await flushPromises()
    window.dispatchEvent(
      new CustomEvent('srl:native-share-download-completed', {
        detail: { cloud: false, token: `discord-url-${job.id}` },
      }),
    )
    await flushPromises()
    expect(setup.nativeRead).not.toHaveBeenCalled()
    expect(intake.receive).not.toHaveBeenCalled()
  })

  it('adopts a native cloud completion while its queue listing is still pending, once and into the checked target', async () => {
    setup.native = true
    setup.inboxMode = true
    setup.list.mockImplementation(() => new Promise(() => undefined))
    setup.nativeRead.mockResolvedValue({
      transferredBytes: 12,
      totalBytes: 12,
      batch: { files: [new File(['{}'], 'card.json')], acknowledge: vi.fn() },
    })
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    try {
      const intake = start()
      await flushPromises()
      const event = new CustomEvent('srl:native-share-download-completed', {
        detail: { cloud: true, token: `discord-url-${job.id}` },
      })
      window.dispatchEvent(event)
      await flushPromises()
      expect(intake.receive).toHaveBeenCalledOnce()
      expect(setup.nativeRead).toHaveBeenCalledWith({ id: job.id, ...target })
      window.dispatchEvent(event)
      await flushPromises()
      expect(intake.receive).toHaveBeenCalledOnce()
      expect(setup.stage).not.toHaveBeenCalled()
      expect(setup.download).not.toHaveBeenCalled()
    } finally {
      visibility.mockRestore()
    }
  })

  it('delivers an already downloaded native file without waiting for a cloud progress acknowledgement', async () => {
    setup.native = true
    setup.ack.mockImplementation(() => new Promise(() => undefined))
    setup.nativeRead.mockResolvedValue({
      transferredBytes: 12,
      totalBytes: 12,
      batch: { files: [new File(['{}'], 'card.json')], acknowledge: vi.fn() },
    })
    const intake = start()
    await flushPromises()
    expect(intake.receive).toHaveBeenCalledOnce()
    expect(setup.stage).not.toHaveBeenCalled()
    expect(setup.read).not.toHaveBeenCalled()
  })

  it('preserves interrupted cloud imports and exposes an explicit cancel action', async () => {
    setup.native = true
    const cleanup = vi.fn()
    setup.nativeRead.mockResolvedValue({
      transferredBytes: 12,
      totalBytes: 12,
      batch: {
        files: [new File(['{}'], 'card.json')],
        interrupted: true,
        acknowledge: cleanup,
      },
    })
    const intake = start()
    await flushPromises()

    const batch = intake.receive.mock.calls[0]![0]
    expect(batch.interrupted).toBe(true)
    expect(batch.onCancel).toBeDefined()
    await batch.onCancel?.()

    expect(setup.ack).toHaveBeenCalledWith(
      job.id,
      'cancelled',
      target,
      '用户取消了中断的资源解析。',
    )
    expect(setup.notify).toHaveBeenCalledWith(expect.objectContaining({ state: 'cancelled' }))
    expect(taskCenter.list()[0]?.status).toBe('cancelled')
    expect(cleanup).toHaveBeenCalledOnce()
    await batch.acknowledge()
    expect(cleanup).toHaveBeenCalledOnce()
  })

  it('continues past an active first-page job instead of blocking later downloads', async () => {
    setup.native = true
    const next = { ...job, id: '22222222-2222-4222-a222-222222222222', createdAt: 2 }
    setup.list
      .mockResolvedValueOnce({ jobs: [job], recent: [], hasMore: true })
      .mockResolvedValueOnce({ jobs: [next], recent: [], hasMore: false })
    start()
    await flushPromises()
    expect(setup.list).toHaveBeenNthCalledWith(2, target, `${job.createdAt}:${job.id}`)
    expect(setup.stage).toHaveBeenCalledTimes(2)
  })
  it('checks new cloud jobs while hidden only when the Android receive session is enabled', async () => {
    setup.native = true
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    try {
      const intake = start()
      await flushPromises()
      expect(setup.list).not.toHaveBeenCalled()
      setup.inboxMode = true
      window.dispatchEvent(new Event('srl:receive-discord-inbox'))
      await flushPromises()
      expect(setup.stage).toHaveBeenCalledOnce()
      expect(intake.receive).not.toHaveBeenCalled()
      expect(setup.ack).not.toHaveBeenCalledWith(job.id, 'imported', expect.anything())
    } finally {
      visibility.mockRestore()
    }
  })
  it('receives resources after the existing shared pairing refresh event', async () => {
    setup.list.mockResolvedValueOnce({ jobs: [], recent: [], hasMore: false })
    const intake = start()
    await flushPromises()
    expect(intake.receive).not.toHaveBeenCalled()
    window.dispatchEvent(new Event('srl:receive-discord-inbox'))
    await flushPromises()
    expect(intake.receive).toHaveBeenCalledOnce()
  })
  it('does not acknowledge an import when download completes or when a version still needs a decision', async () => {
    const intake = start()
    await flushPromises()
    expect(intake.receive).toHaveBeenCalledOnce()
    const batch = intake.receive.mock.calls[0]![0]
    expect(setup.ack.mock.calls.map((call) => call[1])).toEqual(['downloading', 'importing'])
    expect(batch.route).toBe('resource')
    await batch.onItemComplete?.({ status: 'versionCandidate' } as ImportResult)
    await batch.acknowledge()
    expect(setup.ack.mock.calls.map((call) => call[1])).not.toContain('imported')
    expect(setup.notify).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'card.json', state: 'waiting_version' }),
    )
    await intake.request()
    expect(setup.download).toHaveBeenCalledOnce()
    await batch.onVersionResolved?.('a'.repeat(64))
    await batch.acknowledge()
    expect(setup.ack.mock.lastCall).toEqual([job.id, 'imported', target, undefined])
    expect(taskCenter.list()[0]?.status).toBe('completed')
    expect(setup.notify).toHaveBeenLastCalledWith(
      expect.objectContaining({ name: 'card.json', state: 'imported' }),
    )
  })
  it('a skipped version never becomes imported', async () => {
    const intake = start()
    await flushPromises()
    const batch = intake.receive.mock.calls[0]![0]
    await batch.onItemComplete?.({ status: 'versionCandidate' } as ImportResult)
    await batch.onVersionResolved?.()
    await batch.acknowledge()
    expect(setup.ack.mock.lastCall?.[1]).toBe('cancelled')
    expect(taskCenter.list()[0]?.status).toBe('cancelled')
    expect(setup.notify).toHaveBeenLastCalledWith(expect.objectContaining({ state: 'cancelled' }))
  })
  it('retains a download failure, exposes retry and reports no successful import', async () => {
    setup.download.mockRejectedValue(new Error('网络失败'))
    const intake = start()
    await flushPromises()
    expect(intake.receive).not.toHaveBeenCalled()
    expect(setup.ack.mock.lastCall?.[1]).toBe('failed')
    expect(taskCenter.list()[0]).toMatchObject({ status: 'failed', retryable: true })
    expect(setup.notice).toHaveBeenCalledOnce()
    expect(setup.notify).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'card.json', state: 'failed' }),
    )
  })
  it('defers locked libraries and resumes without downloading into a changed pairing', async () => {
    const intake = start(true)
    await flushPromises()
    expect(setup.list).not.toHaveBeenCalled()
    setup.download.mockImplementation(async () => {
      setup.target = { ...target, libraryId: 'other-library' }
      return new File(['{}'], 'card.json')
    })
    intake.vault.value = { locked: false } as VaultStatus
    await flushPromises()
    expect(intake.receive).not.toHaveBeenCalled()
    expect(setup.ack.mock.calls.map((call) => call[1])).not.toContain('imported')
  })
  it('ends stale download progress when Android has no active work and retries through the original queue', async () => {
    setup.native = true
    setup.nativeRead.mockResolvedValue({ active: false, transferredBytes: 3, totalBytes: 12 })
    const intake = start()
    await flushPromises()
    const id = `discord-resource-${job.id}`
    const task = taskCenter.list().find((item) => item.operationId === id)!
    expect(task.status).toBe('failed')
    expect(setup.notice).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('下载任务已中断'),
      }),
    )
    expect(intake.receive).not.toHaveBeenCalled()
    expect(setup.ack.mock.lastCall?.[1]).toBe('failed')
    expect(setup.stage).toHaveBeenCalledOnce()
    setup.nativeRead.mockResolvedValue({ active: true, transferredBytes: 3, totalBytes: 12 })
    await taskCenter.retry(id)
    await flushPromises()
    expect(setup.stage).toHaveBeenCalledTimes(2)
    expect(setup.ack.mock.calls.map((call) => call[1])).toContain('queued')
    expect(taskCenter.list().find((item) => item.operationId === id)?.status).toBe('running')
  })

  it('keeps work waiting for the network active without restarting or reporting failure', async () => {
    setup.native = true
    setup.nativeRead.mockResolvedValue({ active: true, transferredBytes: 3, totalBytes: 12 })
    const intake = start()
    await flushPromises()
    await intake.request()
    expect(setup.stage).toHaveBeenCalledOnce()
    expect(setup.ack.mock.calls.map((call) => call[1])).not.toContain('failed')
    expect(setup.notice).not.toHaveBeenCalled()
  })

  it('hands native staging into the same importer once and releases it only after commit', async () => {
    setup.native = true
    setup.read.mockRejectedValue(new Error('直链已过期'))
    const cleanup = vi.fn()
    setup.nativeRead.mockResolvedValue({
      transferredBytes: 12,
      totalBytes: 12,
      batch: {
        files: [new File([], 'card.json')],
        recoveryId: 'native-token',
        acknowledge: cleanup,
      },
    })
    const intake = start()
    await flushPromises()
    expect(setup.stage).not.toHaveBeenCalled()
    expect(setup.read).not.toHaveBeenCalled()
    expect(setup.download).not.toHaveBeenCalled()
    const batch = intake.receive.mock.calls[0]![0]
    expect(cleanup).not.toHaveBeenCalled()
    await batch.onItemComplete?.({ status: 'duplicate' } as ImportResult)
    await batch.acknowledge()
    await flushPromises()
    expect(cleanup).toHaveBeenCalledOnce()
    expect(setup.ack.mock.lastCall?.[1]).toBe('imported')
    expect(setup.notify).toHaveBeenCalledWith(expect.objectContaining({ state: 'duplicate' }))
  })

  it('imports a claimed native completion when its WebView is alive in the background', async () => {
    setup.native = true
    const intake = start()
    await flushPromises()
    expect(intake.receive).not.toHaveBeenCalled()
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    setup.nativeRead.mockResolvedValue({
      transferredBytes: 12,
      totalBytes: 12,
      batch: {
        files: [new File([], 'card.json')],
        recoveryId: 'background-native-token',
        acknowledge: vi.fn(),
      },
    })
    const listCalls = setup.list.mock.calls.length
    window.dispatchEvent(
      new CustomEvent('srl:native-share-download-completed', {
        detail: { token: 'download-token' },
      }),
    )
    await flushPromises()
    expect(intake.receive).toHaveBeenCalledOnce()
    expect(setup.list).toHaveBeenCalledTimes(listCalls)
    expect(setup.notify).not.toHaveBeenCalled()
    const batch = intake.receive.mock.calls[0]![0]
    await batch.onItemComplete?.({ status: 'imported' } as ImportResult)
    await batch.acknowledge()
    expect(setup.notify).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'card.json', state: 'imported' }),
    )
    visibility.mockRestore()
  })

  it('does not turn an already imported file into a parsing failure when cloud confirmation fails', async () => {
    const intake = start()
    await flushPromises()
    const batch = intake.receive.mock.calls[0]![0]
    setup.ack.mockRejectedValueOnce(new Error('HTTP 503'))
    await expect(batch.acknowledge()).rejects.toThrow('HTTP 503')
    await batch.onFailure?.('HTTP 503')
    expect(setup.notify.mock.calls.map(([result]) => result.state)).toEqual(['imported'])
    expect(setup.ack.mock.calls.map((call) => call[1])).not.toContain('failed')
    expect(taskCenter.list()[0]?.error).toContain('资源已导入')
  })

  it('keeps the native cancel action distinct from download failure', async () => {
    setup.native = true
    setup.nativeRead.mockResolvedValue({
      cancelled: true,
      error: '下载已取消',
      transferredBytes: 3,
      totalBytes: 12,
    })
    const intake = start()
    await flushPromises()
    expect(intake.receive).not.toHaveBeenCalled()
    expect(setup.ack.mock.lastCall?.[1]).toBe('cancelled')
    expect(taskCenter.list()[0]?.status).toBe('cancelled')
    expect(setup.notice).not.toHaveBeenCalled()
  })

  it('pauses a Web download when the page is hidden and retains the remote task for reopening', async () => {
    setup.download.mockImplementation(
      (_job, _target, signal: AbortSignal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new DOMException('paused', 'AbortError')))
        }),
    )
    const intake = start()
    await flushPromises()
    expect(setup.download).toHaveBeenCalledOnce()
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    document.dispatchEvent(new Event('visibilitychange'))
    await flushPromises()
    expect(intake.receive).not.toHaveBeenCalled()
    expect(setup.ack.mock.lastCall?.[1]).toBe('queued')
    visibility.mockRestore()
  })
})
