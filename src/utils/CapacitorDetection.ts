/**
 * 检测当前是否在 Capacitor 原生应用环境中运行。
 *
 * Capacitor 应用（Android/iOS APK）与浏览器环境的主要差异：
 * - window.opener 和 window.parent 均为 null（无法使用窗口间通信）
 * - 必须使用设备码中继或其他跨设备通信方案
 * - 可用 Capacitor 原生插件（Filesystem、Share、HTTP 等）
 */
export function isCapacitorApp(): boolean {
  // Capacitor 在全局注入 Capacitor 对象
  return (
    typeof window !== 'undefined' &&
    'Capacitor' in window &&
    typeof (window as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor
      ?.isNativePlatform === 'function' &&
    (window as { Capacitor: { isNativePlatform: () => boolean } }).Capacitor.isNativePlatform()
  )
}

/**
 * 检测当前平台类型。
 */
export function getCapacitorPlatform(): 'android' | 'ios' | 'web' {
  if (!isCapacitorApp()) return 'web'
  const platform =
    (window as { Capacitor?: { getPlatform?: () => string } }).Capacitor?.getPlatform?.() ?? 'web'
  if (platform === 'android' || platform === 'ios') return platform
  return 'web'
}

export function isAndroidApk(): boolean {
  return isCapacitorApp() && getCapacitorPlatform() === 'android'
}
