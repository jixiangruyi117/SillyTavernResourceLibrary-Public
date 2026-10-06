import { isCapacitorApp } from '../utils/CapacitorDetection'

export const SERVICE_WORKER_RELAUNCH_URL = '/api/relaunch?update-recovery=service-worker'

export interface ReloadLocation {
  replace(url: string): void
}

/**
 * Service Worker 更新完成后读取 Worker 直出的当前应用壳。
 *
 * /api/relaunch 不经过旧 SW 的 SPA 导航回退，也不会清空 Cache Storage；因此能保留
 * 图片、字体与已缓存功能，只替换仍握着旧分包清单的页面文档。
 */
export function relaunchCurrentShell(location: ReloadLocation = window.location): void {
  location.replace(SERVICE_WORKER_RELAUNCH_URL)
}

/** 用户主动恢复加载失败：支持当前壳端点时绕过旧 SW；本机/离线仍使用原页面。 */
export async function reloadAfterLoadFailure(): Promise<void> {
  if (isCapacitorApp() || import.meta.env.DEV || !navigator.onLine) {
    window.location.reload()
    return
  }
  try {
    // VPS 或静态托管不一定提供该端点，确认后才导航，避免把用户送到 API 404 页。
    const response = await fetch(SERVICE_WORKER_RELAUNCH_URL, {
      method: 'HEAD',
      cache: 'no-store',
    })
    if (response.ok && response.headers.get('content-type')?.includes('text/html')) {
      relaunchCurrentShell()
      return
    }
  } catch {
    // 当前网络不可用时仍保留已缓存的页面入口，不清缓存或本机资料。
  }
  window.location.reload()
}
