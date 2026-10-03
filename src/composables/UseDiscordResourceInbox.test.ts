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
  notice: vi.fn(),
  notify: vi.fn(),
  native: false,
  inboxMode: false,
}))
vi.mock('../services/NativeDiscordInboxService', () => ({
  isNativeDiscordInboxRunning: () => setup.inboxMode,
}))
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => setup.native, getPlatform: () => 'android' },
}))
vi.mock('../core/AppContainer', () => ({ initializeVaultOnce: async () => undefined }))
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
})
afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount()
  for (const task of taskCenter.list()) {
    taskCenter.cancelled(task.operationId)
    taskCenter.dismiss(task.operationId)
  }
})
describe('cloud resource coordination', () => {
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
    expect(setup.notify).toHaveBeenCalledOnce()
    await intake.request()
    expect(setup.download).toHaveBeenCalledOnce()
    await batch.onVersionResolved?.('a'.repeat(64))
    await batch.acknowledge()
    expect(setup.ack.mock.lastCall).toEqual([job.id, 'imported', target, undefined])
    expect(taskCenter.list()[0]?.status).toBe('completed')
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
  })
  it('retains a download failure, exposes retry and reports no successful import', async () => {
    setup.download.mockRejectedValue(new Error('网络失败'))
    const intake = start()
    await flushPromises()
    expect(intake.receive).not.toHaveBeenCalled()
    expect(setup.ack.mock.lastCall?.[1]).toBe('failed')
    expect(taskCenter.list()[0]).toMatchObject({ status: 'failed', retryable: true })
    expect(setup.notice).toHaveBeenCalledOnce()
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
    expect(cleanup).toHaveBeenCalledOnce()
    expect(setup.ack.mock.lastCall?.[1]).toBe('imported')
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
    visibility.mockRestore()
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
