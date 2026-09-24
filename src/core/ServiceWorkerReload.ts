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
