/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  SERVICE_WORKER_UPDATE_INTERVAL_MS,
  startServiceWorkerUpdateChecks,
} from './ServiceWorkerUpdateChecks'

function registrationWith(update: () => Promise<unknown>): ServiceWorkerRegistration {
  return { update } as unknown as ServiceWorkerRegistration
}

describe('startServiceWorkerUpdateChecks', () => {
  let visibilityState: DocumentVisibilityState = 'visible'

  afterEach(() => {
    visibilityState = 'visible'
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  function watchVisibility(): void {
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibilityState)
  }

  it('注册完成时立即检查一次更新', () => {
    watchVisibility()
    const update = vi.fn(async () => undefined)
    const stop = startServiceWorkerUpdateChecks(registrationWith(update))

    expect(update).toHaveBeenCalledTimes(1)

    stop()
  })

  it('页面从后台回到前台时立即检查更新', () => {
    watchVisibility()
    const update = vi.fn(async () => undefined)
    const stop = startServiceWorkerUpdateChecks(registrationWith(update))
    update.mockClear()

    visibilityState = 'hidden'
    document.dispatchEvent(new Event('visibilitychange'))
    expect(update).not.toHaveBeenCalled()

    visibilityState = 'visible'
    document.dispatchEvent(new Event('visibilitychange'))
    expect(update).toHaveBeenCalledTimes(1)

    stop()
  })

  it('窗口获得焦点或网络恢复时补查更新', () => {
    watchVisibility()
    const update = vi.fn(async () => undefined)
    const stop = startServiceWorkerUpdateChecks(registrationWith(update))
    update.mockClear()

    window.dispatchEvent(new Event('focus'))
    expect(update).toHaveBeenCalledTimes(1)

    window.dispatchEvent(new Event('online'))
    expect(update).toHaveBeenCalledTimes(2)

    stop()
  })

  it('应用常驻前台时按固定间隔检查', async () => {
    vi.useFakeTimers()
    watchVisibility()
    const update = vi.fn(async () => undefined)
    const stop = startServiceWorkerUpdateChecks(registrationWith(update))
    update.mockClear()

    await vi.advanceTimersByTimeAsync(SERVICE_WORKER_UPDATE_INTERVAL_MS - 1)
    expect(update).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(update).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(SERVICE_WORKER_UPDATE_INTERVAL_MS)
    expect(update).toHaveBeenCalledTimes(2)

    stop()
  })

  it('隐藏页面不做定时检查，停止后移除所有触发器', async () => {
    vi.useFakeTimers()
    watchVisibility()
    const update = vi.fn(async () => undefined)
    const stop = startServiceWorkerUpdateChecks(registrationWith(update))
    update.mockClear()

    visibilityState = 'hidden'
    await vi.advanceTimersByTimeAsync(SERVICE_WORKER_UPDATE_INTERVAL_MS)
    expect(update).not.toHaveBeenCalled()

    stop()
    visibilityState = 'visible'
    document.dispatchEvent(new Event('visibilitychange'))
    window.dispatchEvent(new Event('focus'))
    await vi.advanceTimersByTimeAsync(SERVICE_WORKER_UPDATE_INTERVAL_MS)
    expect(update).not.toHaveBeenCalled()
  })
})
