import { describe, expect, it, vi } from 'vitest'

import { SERVICE_WORKER_RELAUNCH_URL, relaunchCurrentShell } from './ServiceWorkerReload'

describe('Service Worker 更新后的软重启', () => {
  it('通过 Worker 直出的当前应用壳重新进入，而不是强制清缓存', () => {
    const replace = vi.fn()

    relaunchCurrentShell({ replace })

    expect(replace).toHaveBeenCalledTimes(1)
    expect(replace).toHaveBeenCalledWith('/api/relaunch?update-recovery=service-worker')
    expect(SERVICE_WORKER_RELAUNCH_URL).toContain('/api/relaunch')
    expect(SERVICE_WORKER_RELAUNCH_URL).not.toContain('force-refresh')
  })
})
