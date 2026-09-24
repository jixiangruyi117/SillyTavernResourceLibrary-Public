import { registerSW } from 'virtual:pwa-register'

import { isCapacitorApp } from '../utils/CapacitorDetection'
import { relaunchCurrentShell } from './ServiceWorkerReload'
import { startServiceWorkerUpdateChecks } from './ServiceWorkerUpdateChecks'

const BANNER_ID = 'srl-update-notice'

/**
 * 用简单闭包持有运行时的 SW 状态。
 * 避免模块级 let 变量在 vue-tsc 增量的 Linux 构建中被误报 noUnusedLocals。
 */
function createUpdateState() {
  let activeRegistration: ServiceWorkerRegistration | undefined
  let applyUpdateRef: ((reload?: boolean) => void) | undefined
  let stopAutomaticUpdateChecks: (() => void) | undefined

  function showUpdateBanner(applyUpdate: () => void): void {
    if (isCapacitorApp()) return
    if (document.getElementById(BANNER_ID)) return

    const banner = document.createElement('div')
    banner.id = BANNER_ID
    banner.setAttribute('role', 'status')

    const title = document.createElement('strong')
    title.textContent = '资源库有新版本'

    const hint = document.createElement('span')
    hint.textContent = '刷新后使用新版本。本地资源保存在浏览器数据库中，不会因为更新而丢失。'

    const confirm = document.createElement('button')
    confirm.type = 'button'
    confirm.textContent = '立即刷新'
    confirm.addEventListener('click', () => {
      banner.remove()
      applyUpdate()
    })

    const later = document.createElement('button')
    later.type = 'button'
    later.textContent = '稍后'
    later.addEventListener('click', () => banner.remove())

    const actions = document.createElement('div')
    actions.className = 'srl-update-notice__actions'
    actions.append(confirm, later)

    banner.append(title, hint, actions)
    document.body.append(banner)
  }

  function showOfflineReadyBanner(): void {
    if (isCapacitorApp()) return
    const banner = document.createElement('div')
    banner.id = 'srl-offline-ready'
    banner.setAttribute('role', 'status')
    banner.textContent = '资源库已可离线使用'
    document.body.append(banner)
    window.setTimeout(() => banner.remove(), 4000)
  }

  /**
   * 手动触发更新检查，返回是否有新版本可用。
   * 可在设置中由用户主动调用，不依赖定时器或前台切换。
   */
  async function manualCheckForUpdate(): Promise<string> {
    if (isCapacitorApp()) return 'APK 中不使用网页更新，请使用“检查 APK 版本更新”'
    if (!activeRegistration) return 'Service Worker 未注册，请用强制刷新'

    try {
      await activeRegistration.update()
      if (activeRegistration.waiting) {
        if (applyUpdateRef) showUpdateBanner(() => applyUpdateRef?.(true))
        return '发现新版本，点击上方"立即刷新"使用'
      }
      if (activeRegistration.installing) return '正在下载新版本，请稍候…'

      // SW 没检测到变化时，通过统一托管 API transport 请求版本号。
      try {
        const response = await fetch('/api/version', { cache: 'no-store' })
        if (response.ok) {
          const data = (await response.json()) as { version?: string }
          const serverVersion = data?.version ?? ''
          const storedVersion = localStorage.getItem('srl.deploy.version') ?? ''
          if (serverVersion && serverVersion !== storedVersion) {
            localStorage.setItem('srl.deploy.version', serverVersion)
            if (applyUpdateRef) showUpdateBanner(() => applyUpdateRef?.(true))
            return '服务器有新版本（' + serverVersion + '），点击上方"立即刷新"'
          }
          if (serverVersion) {
            return '已是最新版本（' + serverVersion + '）'
          }
        }
      } catch {
        /* 直连失败 */
      }

      return '未检测到更新，可尝试强制刷新'
    } catch {
      return '自动检测失败，请用强制刷新'
    }
  }

  /**
   * 强制跳过 SW 缓存重新加载——注销 Service Worker、清空 Cache Storage、硬刷新。
   * 用于 SW 自身的缓存导致更新检测失败时的兜底恢复。
   */
  async function forceRefresh(): Promise<void> {
    if (activeRegistration) {
      await activeRegistration.unregister().catch(() => undefined)
    }
    if ('caches' in window) {
      const keys = await caches.keys()
      await Promise.all(
        keys.filter((key) => key !== 'srl-official-app-assets-v1').map((key) => caches.delete(key)),
      )
    }
    window.location.reload()
  }

  function installServiceWorker(): void {
    if (import.meta.env.DEV) return
    if (isCapacitorApp()) {
      void disableServiceWorkerForNativeApp()
      return
    }

    const applyUpdate = registerSW({
      // Prompt 模式下，updateSW() 触发 waiting worker 接管后默认会调用 location.reload()。
      // 改走 Worker 直出的当前应用壳，避免刚更新完仍握着旧分包清单；不清 Cache Storage。
      onNeedReload: relaunchCurrentShell,
      onNeedRefresh: () => showUpdateBanner(() => applyUpdate(true)),
      onOfflineReady: showOfflineReadyBanner,
      onRegisteredSW: (_workerUrl, registration) => {
        stopAutomaticUpdateChecks?.()
        activeRegistration = registration ?? undefined
        applyUpdateRef = applyUpdate
        stopAutomaticUpdateChecks = registration
          ? startServiceWorkerUpdateChecks(registration)
          : undefined
      },
    })
  }

  return { installServiceWorker, manualCheckForUpdate, forceRefresh }
}

/**
 * Remote APK 早期版本曾注册网页 Service Worker。原生环境启动时移除这些遗留，
 * 防止 APK 更新通道之外再次出现网页更新提示；IndexedDB 用户数据不会被清理。
 */
export async function disableServiceWorkerForNativeApp(): Promise<void> {
  if (!isCapacitorApp()) return
  document.getElementById(BANNER_ID)?.remove()
  document.getElementById('srl-offline-ready')?.remove()
  if ('serviceWorker' in navigator) {
    const registrations = await navigator.serviceWorker.getRegistrations().catch(() => [])
    await Promise.all(registrations.map((registration) => registration.unregister()))
  }
  if ('caches' in window) {
    const keys = await caches.keys().catch(() => [])
    await Promise.all(keys.map((key) => caches.delete(key)))
  }
}

const state = createUpdateState()

/** 注册 Service Worker。开发模式下不注册，避免缓存干扰调试。 */
export const installServiceWorker = state.installServiceWorker

/** 手动检查更新。在设置页点击"检查网页更新"时调用。 */
export const manualCheckForUpdate = state.manualCheckForUpdate

/** 强制刷新：注销 SW、清空 Cache Storage、硬重载。 */
export const forceRefresh = state.forceRefresh
