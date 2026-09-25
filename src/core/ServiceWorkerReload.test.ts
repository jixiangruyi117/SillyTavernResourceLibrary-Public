import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  SERVICE_WORKER_RELAUNCH_URL,
  relaunchCurrentShell,
  reloadAfterLoadFailure,
} from './ServiceWorkerReload'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('Service Worker 更新后的软重启', () => {
  it('通过 Worker 直出的当前应用壳重新进入，而不是强制清缓存', () => {
    const replace = vi.fn()

    relaunchCurrentShell({ replace })

    expect(replace).toHaveBeenCalledTimes(1)
    expect(replace).toHaveBeenCalledWith('/api/relaunch?update-recovery=service-worker')
    expect(SERVICE_WORKER_RELAUNCH_URL).toContain('/api/relaunch')
    expect(SERVICE_WORKER_RELAUNCH_URL).not.toContain('force-refresh')
  })

  it.each(['hosted', 'unsupported', 'network', 'offline', 'native', 'dev'])(
    '%s 加载失败恢复保留原环境与本机缓存',
    async (mode) => {
      const location = { replace: vi.fn(), reload: vi.fn() }
      vi.stubGlobal('window', {
        location,
        Capacitor: { isNativePlatform: () => mode === 'native' },
      })
      vi.stubGlobal('navigator', { onLine: mode !== 'offline' })
      vi.stubEnv('DEV', mode === 'dev')
      const fetch = vi.fn().mockImplementation(async () => {
        if (mode === 'network') throw new Error('network unavailable')
        return new Response(null, {
          status: mode === 'unsupported' ? 404 : 200,
          headers: { 'content-type': 'text/html' },
        })
      })
      vi.stubGlobal('fetch', fetch)
      await reloadAfterLoadFailure()
      expect(location.replace).toHaveBeenCalledTimes(mode === 'hosted' ? 1 : 0)
      expect(location.reload).toHaveBeenCalledTimes(mode === 'hosted' ? 0 : 1)
      if (['offline', 'native', 'dev'].includes(mode)) expect(fetch).not.toHaveBeenCalled()
      else
        expect(fetch).toHaveBeenCalledWith(SERVICE_WORKER_RELAUNCH_URL, {
          method: 'HEAD',
          cache: 'no-store',
        })
    },
  )
})
