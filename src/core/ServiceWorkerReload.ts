export interface ReloadLocation {
  replace(url: string): void
}

/**
 * Service Worker 更新完成后重新读取当前应用壳。
 */
export function relaunchCurrentShell(location: ReloadLocation = window.location): void {
  location.replace('/')
}
