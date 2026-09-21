import { getNativeSystemUiState } from './NativeSystemUi'
import { getPlatformInfo, type PlatformInfo } from './PlatformService'

let lastInfo: PlatformInfo | undefined
let refreshFrame: number | undefined

const SAFE_AREA_VARIABLES = {
  top: '--safe-top',
  right: '--safe-right',
  bottom: '--safe-bottom',
  left: '--safe-left',
} as const

export function getLastPlatformInfo(): PlatformInfo | undefined {
  return lastInfo
}

function setSafeAreaInset(edge: keyof typeof SAFE_AREA_VARIABLES, value: string): void {
  document.documentElement.style.setProperty(SAFE_AREA_VARIABLES[edge], value)
}

function nativePixelsToCssPixels(value: number): number {
  // WindowInsetsCompat reports device pixels; CSS safe-area consumers use CSS pixels.
  const pixelRatio =
    Number.isFinite(window.devicePixelRatio) && window.devicePixelRatio > 0
      ? window.devicePixelRatio
      : 1
  return Math.max(0, value) / pixelRatio
}

function setWebSafeAreaInsets(): void {
  setSafeAreaInset('top', 'env(safe-area-inset-top, 0px)')
  setSafeAreaInset('right', 'env(safe-area-inset-right, 0px)')
  setSafeAreaInset('bottom', 'env(safe-area-inset-bottom, 0px)')
  setSafeAreaInset('left', 'env(safe-area-inset-left, 0px)')
}

export async function refreshSystemInsets(): Promise<PlatformInfo> {
  const info = await getPlatformInfo()
  lastInfo = info
  const root = document.documentElement

  if (info.kind === 'android') {
    // The native status-bar toggle owns whether the top edge is reserved. When the bar is hidden,
    // SRL deliberately enters true edge-to-edge mode instead of retaining the previous status-bar inset.
    const systemUi = await getNativeSystemUiState().catch(() => null)
    const reserveTop = systemUi?.showStatusBar !== false
    setSafeAreaInset('top', reserveTop ? `${nativePixelsToCssPixels(info.insets.top)}px` : '0px')
    setSafeAreaInset('right', '0px')
    setSafeAreaInset('bottom', `${nativePixelsToCssPixels(info.insets.bottom)}px`)
    setSafeAreaInset('left', '0px')
    root.dataset.statusBarVisible = reserveTop ? 'true' : 'false'
  } else {
    // PWA/Safari keeps the browser-provided notch and home-indicator insets. viewport-fit=cover is
    // declared in index.html, so these values represent the real iOS standalone safe area.
    setWebSafeAreaInsets()
    delete root.dataset.statusBarVisible
  }

  root.dataset.nativeApiVersion = String(info.apiVersion)
  window.dispatchEvent(new CustomEvent('srl:platform-state', { detail: info }))
  return info
}

function scheduleRefresh(): void {
  if (refreshFrame !== undefined) return
  refreshFrame = window.requestAnimationFrame(() => {
    refreshFrame = undefined
    void refreshSystemInsets().catch(() => undefined)
  })
}

export function installSystemInsetsService(): void {
  void refreshSystemInsets().catch(() => undefined)
  window.addEventListener('resize', scheduleRefresh, { passive: true })
  window.addEventListener('orientationchange', scheduleRefresh, { passive: true })
  window.addEventListener('online', scheduleRefresh, { passive: true })
  window.addEventListener('offline', scheduleRefresh, { passive: true })
  window.addEventListener('srl:native-active', scheduleRefresh)
  window.addEventListener('srl:system-ui-changed', scheduleRefresh)
  window.addEventListener('srl:native-memory-pressure', (event) => {
    const detail = event instanceof CustomEvent ? event.detail : undefined
    window.dispatchEvent(new CustomEvent('srl:memory-pressure', { detail }))
  })
}
