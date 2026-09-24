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
import {
  isMobileEditableElement,
  revealMobileInputIfOccluded,
  restorePersonalInputScroll,
  type MobileEditableElement,
} from './utils/MobileInputFocus'
import './styles/Foundation.css'
import './styles/DesignSystemRefinement.css'
import './styles/ProjectNoticeDialog.css'
import './styles/IOSStandaloneSafeAreaSurface.css'

let viewportFrame: number | undefined
let lastViewportHeight = -1
let lastLayoutHeight = -1
let expandedVisualViewportHeight = -1
let lastViewportOffsetTop = -1
let lastDisplayMode = ''
let lastIOSDevice: boolean | undefined
let layoutViewportWidth = -1
let viewportSettleFrame: number | undefined
let lastViewportSignature = ''
let stableViewportFrames = 0
let focusRevealPending = false
let focusRevealTarget: MobileEditableElement | undefined
let focusRevealAttempted = false
let keyboardFocusActive = false

function isIOSDevice(): boolean {
  const browser = navigator as Navigator & { maxTouchPoints?: number }
  return (
    /\b(?:iPhone|iPad|iPod)\b/iu.test(browser.userAgent || '') ||
    (browser.platform === 'MacIntel' && (browser.maxTouchPoints ?? 0) > 1)
  )
}

function getViewportBounds() {
  return {
    height: window.visualViewport?.height ?? window.innerHeight,
    offsetTop: window.visualViewport?.offsetTop ?? 0,
  }
}

function getViewportSignature(): string {
  const viewport = window.visualViewport
  return [
    window.innerWidth,
    viewport?.height ?? window.innerHeight,
    viewport?.offsetTop ?? 0,
    viewport?.offsetLeft ?? 0,
    viewport?.scale ?? 1,
  ].join(':')
}

function markFocusedMobileInputForReveal(): void {
  const input = document.activeElement
  if (!isMobileEditableElement(input)) {
    focusRevealPending = false
    focusRevealTarget = undefined
    return
  }
  focusRevealAttempted = false
  focusRevealTarget = input
  stableViewportFrames = 0
  const viewport = getViewportBounds()
  keyboardFocusActive = true
  focusRevealPending = viewport.height < expandedVisualViewportHeight
  scheduleViewportState()
}

function scheduleViewportSettleCheck(): void {
  if (viewportSettleFrame !== undefined) return
  viewportSettleFrame = window.requestAnimationFrame(checkViewportStability)
}

function checkViewportStability(): void {
  viewportSettleFrame = undefined
  const signature = getViewportSignature()
  if (signature !== lastViewportSignature) {
    stableViewportFrames = 0
    scheduleViewportState()
    return
  }
  stableViewportFrames += 1
  if (stableViewportFrames < 2) {
    scheduleViewportSettleCheck()
    return
  }
  const input = document.activeElement
  if (
    focusRevealPending &&
    !focusRevealAttempted &&
    focusRevealTarget === input &&
    isMobileEditableElement(input) &&
    lastIOSDevice &&
    window.innerWidth <= 860 &&
    (window.visualViewport?.scale ?? 1) === 1 &&
    getViewportBounds().height < expandedVisualViewportHeight
  ) {
    // Consume this focus/keyboard session before scrolling. A resulting
    // VisualViewport event must not queue a second correction for the same field.
    focusRevealAttempted = true
    focusRevealPending = false
    focusRevealTarget = undefined
    revealMobileInputIfOccluded(input, getViewportBounds())
  }
}

function applyViewportState(): void {
  viewportFrame = undefined
  const { height: viewportHeight, offsetTop: viewportOffsetTop } = getViewportBounds()
  const windowHeight = window.innerHeight
  const viewportWidth = window.innerWidth
  // Keep the backdrop/layout sizing baseline separate from the visual viewport
  // baseline used for keyboard state: Safari/PWA may report different heights
  // for innerHeight and visualViewport even when the keyboard is closed.
  if (viewportWidth !== layoutViewportWidth || lastLayoutHeight < 0) {
    layoutViewportWidth = viewportWidth
    lastLayoutHeight = Math.max(windowHeight, viewportHeight)
    expandedVisualViewportHeight = viewportHeight
  } else if (viewportHeight >= lastLayoutHeight || windowHeight >= lastLayoutHeight) {
    lastLayoutHeight = Math.max(windowHeight, viewportHeight)
  } else {
    lastLayoutHeight = Math.max(lastLayoutHeight, windowHeight)
  }
  const focusedEditable = isMobileEditableElement(document.activeElement)
  if (!focusedEditable && !keyboardFocusActive) expandedVisualViewportHeight = viewportHeight
  else if (viewportHeight >= expandedVisualViewportHeight) {
    expandedVisualViewportHeight = viewportHeight
  }
  document.documentElement.style.setProperty('--layout-viewport-height', `${lastLayoutHeight}px`)
  const viewportSignature = getViewportSignature()
  const viewportGeometryChanged = viewportSignature !== lastViewportSignature
  if (viewportGeometryChanged) {
    lastViewportSignature = viewportSignature
    stableViewportFrames = 0
    const input = document.activeElement
    if (
      isMobileEditableElement(input) &&
      !focusRevealAttempted &&
      viewportHeight < expandedVisualViewportHeight
    ) {
      focusRevealPending = true
      focusRevealTarget = input
      keyboardFocusActive = true
    }
  }
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
  const iosDevice = iosStandalone || isIOSDevice()
  const displayMode =
    window.matchMedia('(display-mode: standalone)').matches || iosStandalone
      ? 'standalone'
      : 'browser'

  if (displayMode !== lastDisplayMode) {
    lastDisplayMode = displayMode
    document.documentElement.dataset.displayMode = displayMode
  }
  if (iosDevice !== lastIOSDevice) {
    lastIOSDevice = iosDevice
  }
  if (document.documentElement.dataset.iosStandalone !== String(iosStandalone)) {
    document.documentElement.dataset.iosStandalone = iosStandalone ? 'true' : 'false'
  }
  // On iOS Safari and standalone PWA, the visual viewport is the keyboard
  // signal. Do not compare it to innerHeight: WebKit may shrink both values
  // during the same keyboard animation, making that delta report a false negative.
  const iosKeyboardOpen =
    iosDevice &&
    window.innerWidth <= 860 &&
    (window.visualViewport?.scale ?? 1) === 1 &&
    keyboardFocusActive &&
    viewportHeight < expandedVisualViewportHeight
  if (document.documentElement.dataset.iosKeyboardOpen !== String(iosKeyboardOpen)) {
    document.documentElement.dataset.iosKeyboardOpen = String(iosKeyboardOpen)
  }
  if (viewportHeight >= expandedVisualViewportHeight && (window.visualViewport?.scale ?? 1) === 1) {
    restorePersonalInputScroll()
    keyboardFocusActive = false
    focusRevealPending = false
    focusRevealTarget = undefined
    focusRevealAttempted = false
  }
  if (viewportGeometryChanged || focusRevealPending) scheduleViewportSettleCheck()
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
window.addEventListener('focusin', markFocusedMobileInputForReveal, {
  capture: true,
  passive: true,
})

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
