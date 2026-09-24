/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest'

const runtime = vi.hoisted(() => ({ native: false, registerSW: vi.fn() }))

vi.mock('virtual:pwa-register', () => ({
  registerSW: runtime.registerSW,
}))

vi.mock('../utils/CapacitorDetection', () => ({
  isCapacitorApp: () => runtime.native,
}))

import {
  disableServiceWorkerForNativeApp,
  installServiceWorker,
  manualCheckForUpdate,
} from './ServiceWorkerUpdate'

describe('ServiceWorkerUpdate native boundary', () => {
  afterEach(() => {
    runtime.native = false
    runtime.registerSW.mockReset()
    vi.unstubAllGlobals()
    document.body.replaceChildren()
  })

  it('does not register the website Service Worker inside the APK', async () => {
    runtime.native = true

    installServiceWorker()

    expect(runtime.registerSW).not.toHaveBeenCalled()
    await expect(manualCheckForUpdate()).resolves.toContain('检查 APK 版本更新')
  })

  it('unregisters legacy website workers and clears Cache Storage inside the APK', async () => {
    runtime.native = true
    const unregister = vi.fn(async () => true)
    const getRegistrations = vi.fn(async () => [
      { unregister } as unknown as ServiceWorkerRegistration,
    ])
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: { getRegistrations },
    })
    const deleteCache = vi.fn(async () => true)
    vi.stubGlobal('caches', {
      keys: vi.fn(async () => ['workbox-precache', 'legacy-runtime']),
      delete: deleteCache,
    })
    const updateBanner = document.createElement('div')
    updateBanner.id = 'srl-update-notice'
    document.body.append(updateBanner)

    await disableServiceWorkerForNativeApp()

    expect(unregister).toHaveBeenCalledOnce()
    expect(deleteCache).toHaveBeenCalledTimes(2)
    expect(document.getElementById('srl-update-notice')).toBeNull()
  })
})
