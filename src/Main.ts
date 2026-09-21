import { createApp } from 'vue'

import { installGlobalErrorHandlers } from './core/FatalErrorNotice'
import { installNativeRuntime } from './core/NativeRuntime'
import { installPerformanceMonitor } from './core/PerformanceMonitor'
import { installSystemInsetsService } from './core/SystemInsetsService'
import {
  beginStartupAttempt,
  installSafeModeBanner,
  installStartupRescuePrompt,
  isSafeModeActive,
} from './core/SafeStartup'
import { disableServiceWorkerForNativeApp, installServiceWorker } from './core/ServiceWorkerUpdate'
import RootApp from './RootApp.vue'
import { isCapacitorApp } from './utils/CapacitorDetection'
import { revealMobileInputIfOccluded, restorePersonalInputScroll } from './utils/MobileInputFocus'
import './styles/Foundation.css'
import './styles/DesignSystemRefinement.css'
import './styles/ProjectNoticeDialog.css'
import './styles/IOSStandaloneSafeAreaSurface.css'

let viewportFrame: number | undefined
let lastViewportHeight = -1
let lastLayoutHeight = -1
let lastViewportOffsetTop = -1
let lastDisplayMode = ''
let lastIosStandalone: boolean | undefined

function applyViewportState(): void {
  viewportFrame = undefined
  const viewportHeight = window.visualViewport?.height ?? window.innerHeight
  const viewportOffsetTop = window.visualViewport?.offsetTop ?? 0
  // The keyboard limits interactive content, but translucent system UI can still
  // expose the page underneath it. Modal backgrounds need the full window size.
  if (window.innerHeight !== lastLayoutHeight) {
    lastLayoutHeight = window.innerHeight
    document.documentElement.style.setProperty('--layout-viewport-height', `${lastLayoutHeight}px`)
  }
  const keyboardGeometryChanged =
    viewportHeight <= lastViewportHeight &&
    (viewportHeight !== lastViewportHeight || viewportOffsetTop !== lastViewportOffsetTop)
  if (viewportHeight !== lastViewportHeight) {
    lastViewportHeight = viewportHeight
    document.documentElement.style.setProperty('--visual-viewport-height', `${viewportHeight}px`)
    document.documentElement.style.setProperty('--app-viewport-height', `${viewportHeight}px`)
  }
  if (viewportOffsetTop !== lastViewportOffsetTop) {
    lastViewportOffsetTop = viewportOffsetTop
    document.documentElement.style.setProperty(
      '--visual-viewport-offset-top',
      `${viewportOffsetTop}px`,
    )
  }
  const iosStandalone = Boolean((navigator as Navigator & { standalone?: boolean }).standalone)
  const displayMode =
    window.matchMedia('(display-mode: standalone)').matches || iosStandalone
      ? 'standalone'
      : 'browser'

  if (displayMode !== lastDisplayMode) {
    lastDisplayMode = displayMode
    document.documentElement.dataset.displayMode = displayMode
  }
  if (iosStandalone !== lastIosStandalone) {
    lastIosStandalone = iosStandalone
    document.documentElement.dataset.iosStandalone = iosStandalone ? 'true' : 'false'
  }
  // Ignore browser chrome/safe-area changes and pinch zoom; a hardware keyboard
  // leaves the visual viewport at full height, so the actions stay available.
  const iosKeyboardOpen =
    iosStandalone &&
    window.innerWidth <= 860 &&
    (window.visualViewport?.scale ?? 1) === 1 &&
    window.innerHeight - viewportHeight > 120
  if (document.documentElement.dataset.iosKeyboardOpen !== String(iosKeyboardOpen)) {
    document.documentElement.dataset.iosKeyboardOpen = String(iosKeyboardOpen)
  }
  if (viewportHeight >= window.innerHeight && (window.visualViewport?.scale ?? 1) === 1) {
    restorePersonalInputScroll()
  }
  const input = document.activeElement
  if (
    iosStandalone &&
    keyboardGeometryChanged &&
    window.innerWidth <= 860 &&
    viewportHeight < window.innerHeight &&
    (window.visualViewport?.scale ?? 1) === 1 &&
    (input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement) &&
    input.closest('[role="dialog"], [role="alertdialog"]')
  ) {
    revealMobileInputIfOccluded(input, { height: viewportHeight, offsetTop: viewportOffsetTop })
  }
}

function scheduleViewportState(): void {
  if (viewportFrame !== undefined) return
  viewportFrame = window.requestAnimationFrame(applyViewportState)
}

applyViewportState()
const startupAttempt = beginStartupAttempt()
if (startupAttempt.rescueRequired) installStartupRescuePrompt()
else if (isSafeModeActive()) installSafeModeBanner()
installNativeRuntime()
void disableServiceWorkerForNativeApp()
window.addEventListener('resize', scheduleViewportState, { passive: true })
window.addEventListener('orientationchange', scheduleViewportState, { passive: true })
window.visualViewport?.addEventListener('resize', scheduleViewportState, { passive: true })
window.visualViewport?.addEventListener('scroll', scheduleViewportState, { passive: true })
window.addEventListener('pageshow', scheduleViewportState, { passive: true })

const app = createApp(RootApp)
installGlobalErrorHandlers(app)
installPerformanceMonitor()
installSystemInsetsService()
app.mount('#app')

// 先让当前页面的入口与异步主界面完成加载，再检查网站更新。
// 避免刚发布新版本时，首屏动态分包下载和 Service Worker 预缓存同时争用网络，
// 在手机慢网下表现成一段时间完全白屏。
function scheduleServiceWorkerInstallation(): void {
  if (isCapacitorApp()) return
  const install = () => {
    const idleCallback = (
      window as Window & {
        requestIdleCallback?: (
          callback: IdleRequestCallback,
          options?: IdleRequestOptions,
        ) => number
      }
    ).requestIdleCallback
    if (idleCallback) {
      idleCallback(() => installServiceWorker(), { timeout: 2500 })
    } else {
      globalThis.setTimeout(() => installServiceWorker(), 800)
    }
  }
  if (document.readyState === 'complete') install()
  else window.addEventListener('load', install, { once: true })
}

scheduleServiceWorkerInstallation()
