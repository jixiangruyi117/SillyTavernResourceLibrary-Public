import { Capacitor } from '@capacitor/core'
import { onBeforeUnmount, onMounted, watch, type Ref } from 'vue'
import { initializeVaultOnce } from '../core/AppContainer'
import { noticeCenter } from '../core/NoticeCenter'
import { taskCenter } from '../core/TaskCenter'
import { requestNativeNotifications } from '../core/NativeSecurity'
import { inboxConnection, type DiscordInboxTarget } from '../services/DiscordHandoffService'
import {
  acknowledgeDiscordResource,
  downloadWebDiscordResource,
  listDiscordResourceJobs,
  readDiscordResourceJob,
  type DiscordResourceJob,
} from '../services/DiscordResourceInboxService'
import { notifyNativeImportAwaitingChoice } from '../services/NativeImportKeepAlive'
import { isNativeDiscordInboxRunning } from '../services/NativeDiscordInboxService'
import {
  cloudWebResourceBatch,
  readCloudDiscordResource,
  stageCloudDiscordResource,
  type SharedFileBatch,
} from '../utils/ShareTargetIntake'
import type { VaultStatus } from '../types/Vault'

interface ActiveResource {
  job: DiscordResourceJob
  target: DiscordInboxTarget
  taskId: string
  controller: AbortController
  delivered: boolean
}

/** Transport coordination only: every file and decision goes through the existing share importer. */
export function useDiscordResourceInbox(
  vault: Ref<VaultStatus>,
  receive: (batch: SharedFileBatch) => void,
) {
  const active = new Map<string, ActiveResource>()
  const native = Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android'
  let disposed = false
  let running = false
  let requested = false
  let nativeTimer: number | undefined
  let readingNative = false
  let notificationPermissionChecked = false
  const visible = () =>
    document.visibilityState !== 'hidden' || (native && isNativeDiscordInboxRunning())

  function changed(): void {
    window.dispatchEvent(new Event('srl:discord-resources-updated'))
  }
  function targetCurrent(target: DiscordInboxTarget): boolean {
    try {
      const current = inboxConnection()
      return current.workerUrl === target.workerUrl && current.libraryId === target.libraryId
    } catch {
      return false
    }
  }
  async function state(
    entry: ActiveResource,
    value: Parameters<typeof acknowledgeDiscordResource>[1],
    error?: string,
  ) {
    await acknowledgeDiscordResource(entry.job.id, value, entry.target, error)
    changed()
  }
  async function failure(entry: ActiveResource, reason: unknown): Promise<void> {
    const message = reason instanceof Error ? reason.message : String(reason || '资源下载失败')
    taskCenter.fail(entry.taskId, message)
    active.delete(entry.job.id)
    try {
      await state(entry, 'failed', message)
    } catch {
      /* Keep remote task for idempotent replay. */
    }
    noticeCenter.push({ id: entry.taskId, type: 'error', message: `${entry.job.name}：${message}` })
    if (document.visibilityState === 'hidden')
      await notifyNativeImportAwaitingChoice(
        '资源下载或导入失败',
        `${entry.job.name}：${message}`,
        'resume',
      )
    changed()
  }

  function deliver(entry: ActiveResource, original: SharedFileBatch): void {
    if (disposed || entry.delivered || vault.value.locked || !targetCurrent(entry.target)) return
    entry.delivered = true
    taskCenter.update(entry.taskId, { phase: '已下载，等待解析导入', cancelable: false })
    let waiting = 0
    let failed = false
    let skipped = false
    const batch: SharedFileBatch = {
      ...original,
      route: 'resource',
      // Explicit cloud command chooses resources; a retained file does not open the route picker.
      interrupted: false,
      recoveryId: original.recoveryId || entry.taskId,
      onItemComplete: async (result) => {
        if (result.status === 'failed') failed = true
        if (result.status === 'versionCandidate') {
          waiting += 1
          taskCenter.update(entry.taskId, { phase: '等待确认历史版本' })
          await state(entry, 'waiting_version').catch(() => {
            noticeCenter.push({
              id: entry.taskId,
              type: 'warning',
              message: '文件已下载并等待版本选择，云端状态尚未确认；请完成本机选择。',
            })
          })
          await notifyNativeImportAwaitingChoice(
            '资源需要确认历史版本',
            `${entry.job.name} 已下载，请回到资源库选择保存方式。`,
            'resume',
          )
        }
      },
      onVersionResolved: async (hash) => {
        waiting = Math.max(0, waiting - 1)
        if (!hash) skipped = true
      },
      onFailure: (message) => failure(entry, message),
      acknowledge: async () => {
        if (waiting) return
        if (failed || skipped) {
          await state(
            entry,
            skipped ? 'cancelled' : 'failed',
            skipped ? '已跳过版本导入，文件未新增。' : '资源解析或导入失败。',
          )
          if (skipped) taskCenter.cancelled(entry.taskId)
          else taskCenter.fail(entry.taskId, '资源未全部导入，请重试。')
          active.delete(entry.job.id)
          changed()
          return
        }
        // This callback is invoked only after the importer commits all items/decisions.
        await state(entry, 'imported')
        await original.acknowledge()
        taskCenter.update(entry.taskId, { phase: '已导入资源库' })
        taskCenter.complete(entry.taskId)
        active.delete(entry.job.id)
        noticeCenter.dismiss(entry.taskId)
        changed()
      },
    }
    receive(batch)
  }

  async function readNative(): Promise<void> {
    if (readingNative || disposed || vault.value.locked) return
    readingNative = true
    try {
      for (const entry of active.values()) {
        if (entry.delivered || !targetCurrent(entry.target)) continue
        try {
          const result = await readCloudDiscordResource({
            id: entry.job.id,
            libraryId: entry.target.libraryId,
            workerUrl: entry.target.workerUrl,
          })
          if (result.cancelled) {
            await state(entry, 'cancelled', '下载已取消，附件暂存仍保留，可重试。')
            taskCenter.cancelled(entry.taskId)
            active.delete(entry.job.id)
            continue
          }
          if (result.error) throw new Error(result.error)
          taskCenter.updateTransfer(entry.taskId, {
            transferredBytes: result.transferredBytes,
            totalBytes: result.totalBytes && result.totalBytes > 0 ? result.totalBytes : undefined,
          })
          if (result.batch) {
            await state(entry, 'importing')
            deliver(entry, result.batch)
          }
        } catch (error) {
          await failure(entry, error)
        }
      }
    } finally {
      readingNative = false
      scheduleNative()
    }
  }
  function scheduleNative(): void {
    if (nativeTimer !== undefined) clearTimeout(nativeTimer)
    nativeTimer = undefined
    // Only active native transfers need progress snapshots; no idle cloud polling.
    if (
      native &&
      !disposed &&
      document.visibilityState !== 'hidden' &&
      [...active.values()].some((entry) => !entry.delivered && targetCurrent(entry.target))
    )
      nativeTimer = window.setTimeout(() => void readNative(), 1_000)
  }

  async function accept(job: DiscordResourceJob, target: DiscordInboxTarget): Promise<void> {
    if (active.has(job.id) || active.size >= 100) return
    const controller = new AbortController()
    const taskId = `discord-resource-${job.id}`
    const entry: ActiveResource = { job, target, taskId, controller, delivered: false }
    active.set(job.id, entry)
    taskCenter.start({
      operationId: taskId,
      name: `云端资源：${job.name}`,
      phase: '准备下载',
      background: true,
      action: {
        label: '查看收件箱',
        run: () => {
          window.dispatchEvent(
            new CustomEvent('srl:native-deep-link', { detail: { kind: 'inbox' } }),
          )
        },
      },
      cancelable: !native,
      cancel: () => controller.abort(new DOMException('用户已取消下载', 'AbortError')),
      retry: async () => {
        await acknowledgeDiscordResource(job.id, 'queued', target)
        await request()
      },
    })
    try {
      await state(entry, 'downloading')
      taskCenter.update(taskId, { phase: '正在下载' })
      if (native) {
        if (!notificationPermissionChecked) {
          notificationPermissionChecked = true
          const granted = await requestNativeNotifications().catch(() => false)
          if (!granted)
            noticeCenter.push({
              type: 'info',
              message: '系统通知未开启，下载状态仍可在资源下载和任务中心查看。',
            })
        }
        // A native receive session may have finished this file while the WebView was absent.
        // Use its target-checked staging before an expiring CDN link is needed again.
        const retained = await readCloudDiscordResource({
          id: job.id,
          libraryId: target.libraryId,
          workerUrl: target.workerUrl,
        }).catch(() => undefined)
        if (retained?.batch) {
          await state(entry, 'importing')
          deliver(entry, retained.batch)
          return
        }
        const fresh = await readDiscordResourceJob(job.id, target)
        await stageCloudDiscordResource({
          id: job.id,
          libraryId: target.libraryId,
          workerUrl: target.workerUrl,
          url: fresh.url,
        })
        scheduleNative()
      } else {
        const file = await downloadWebDiscordResource(
          job,
          target,
          controller.signal,
          (bytes, total) =>
            taskCenter.updateTransfer(taskId, { transferredBytes: bytes, totalBytes: total }),
        )
        controller.signal.throwIfAborted()
        if (!targetCurrent(target) || vault.value.locked || disposed)
          throw new DOMException('下载领取已暂停', 'AbortError')
        await state(entry, 'importing')
        deliver(entry, cloudWebResourceBatch(file, taskId))
      }
    } catch (error) {
      if (
        controller.signal.aborted ||
        (error instanceof DOMException && error.name === 'AbortError')
      ) {
        active.delete(job.id)
        taskCenter.cancelled(taskId)
        const paused = document.visibilityState === 'hidden' || vault.value.locked || disposed
        await state(entry, paused ? 'queued' : 'cancelled').catch(() => undefined)
      } else await failure(entry, error)
    }
  }

  async function request(): Promise<void> {
    requested = true
    if (running || disposed) return
    running = true
    try {
      await initializeVaultOnce()
      do {
        requested = false
        if (vault.value.locked || !visible()) break
        let target: DiscordInboxTarget
        try {
          const connection = inboxConnection()
          target = { workerUrl: connection.workerUrl, libraryId: connection.libraryId }
        } catch {
          break
        }
        for (const entry of active.values()) {
          if (targetCurrent(entry.target)) continue
          entry.controller.abort()
          active.delete(entry.job.id)
          taskCenter.fail(
            entry.taskId,
            '当前配对已改变，未向新目标导入；原生已领取的文件仍在原目标暂存。',
          )
        }
        const handled = new Set<string>()
        let cursor: string | undefined
        for (let page = 0; page < 5 && !disposed; page += 1) {
          const result = await listDiscordResourceJobs(target, cursor)
          const jobs = result.jobs.filter((job) => !active.has(job.id) && !handled.has(job.id))
          for (const job of jobs) {
            if (vault.value.locked || !visible() || !targetCurrent(target)) break
            handled.add(job.id)
            await accept(job, target)
          }
          if (!result.hasMore || !result.jobs.length) break
          const last = result.jobs.at(-1)!
          const next = `${last.createdAt}:${last.id}`
          if (cursor === next) break // An older Worker may ignore pagination; do not loop its first page.
          cursor = next
        }
        if (native) await readNative()
      } while (requested && !disposed)
    } catch (error) {
      // Older Workers remain usable for post saving; the panel explains the missing resource update.
      window.dispatchEvent(
        new CustomEvent('srl:discord-resources-error', {
          detail: error instanceof Error ? error.message : '资源下载队列读取失败',
        }),
      )
    } finally {
      running = false
      changed()
    }
  }

  function visibility(): void {
    if (document.visibilityState !== 'hidden') {
      void request()
      scheduleNative()
    } else {
      if (!native)
        for (const entry of active.values()) if (!entry.delivered) entry.controller.abort()
      scheduleNative()
    }
  }
  function wake(event?: Event): void {
    // A claimed native download may finish while the WebView is still alive in the background.
    // Deliver that retained file through the existing background import owner without polling new jobs.
    if (native && event?.type.startsWith('srl:native-share-download-')) void readNative()
    void request()
  }
  const events = [
    'srl:receive-discord-resources',
    'srl:receive-discord-inbox',
    'srl:native-active',
    'srl:native-share-download-completed',
    'srl:native-share-download-failed',
    'online',
  ]
  watch(
    () => vault.value.locked,
    (locked) => {
      if (!locked) void request()
      else if (!native)
        for (const entry of active.values()) if (!entry.delivered) entry.controller.abort()
    },
  )
  onMounted(() => {
    for (const event of events) window.addEventListener(event, wake)
    document.addEventListener('visibilitychange', visibility)
    void request()
  })
  onBeforeUnmount(() => {
    disposed = true
    if (nativeTimer !== undefined) clearTimeout(nativeTimer)
    for (const entry of active.values()) entry.controller.abort()
    for (const event of events) window.removeEventListener(event, wake)
    document.removeEventListener('visibilitychange', visibility)
  })
  return { request }
}
