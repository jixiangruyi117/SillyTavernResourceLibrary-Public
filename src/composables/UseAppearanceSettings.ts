import { onMounted, onUnmounted, ref } from 'vue'
import { SCOPED_CSS_REMOVED_EVENT, upgradeLegacyAppearanceCss } from '../core/AppearanceScopes'

import { browserStorageService } from '../core/AppContainer'
import { appearanceTransaction, recoverInterruptedAppearance } from '../core/AppearanceSafety'
import { isSafeModeActive } from '../core/SafeStartup'
import type { LayoutMode, PreviewPolicy, UiFontScale } from '../services/BrowserStorageService'
import { sanitizeCssForPreview } from '../utils/PreviewSafety'
import { confirmAction } from './UseConfirmDialog'
import { readStoredTheme, writeStoredTheme, type ThemeValue } from '../utils/LibraryFormatting'

const CUSTOM_UI_STYLE_ID = 'srl-custom-ui-style'
const CUSTOM_UI_CSS_LIMIT = 200_000
const SCRIPT_PREVIEW_CONFIRM =
  '开启后，导入资源中的完整 JavaScript（包括内联、远程脚本和动态代码）会在隔离 iframe 中运行，并可加载远程图片、音频、字体及发起联网请求。\n\n脚本仍不能读取资源库、IndexedDB、登录信息或主页面，但可能暴露 IP、诱导跳转、持续占用 CPU 或导致当前页面卡顿。只应预览你信任来源的文件。'

/**
 * 外观与预览安全策略。
 *
 * 承载主题、资源排版、自定义 CSS、预览安全开关与角色卡配套资源偏好，
 * 这些设置只依赖 BrowserStorageService 与文档对象，与资源库数据流无关。
 */
export function useAppearanceSettings(showNotice: (message: string) => void) {
  const recoveredCss = recoverInterruptedAppearance()
  if (recoveredCss !== undefined) browserStorageService.setCustomUiCss(recoveredCss)
  const safeMode = isSafeModeActive()
  const theme = ref<ThemeValue>(readStoredTheme())
  const layoutMode = ref<LayoutMode>(browserStorageService.getLayoutMode())
  const uiFontScale = ref<UiFontScale>(browserStorageService.getUiFontScale())
  const storedPreviewPolicy = browserStorageService.getPreviewPolicy()
  const previewPolicy = ref<PreviewPolicy>(
    safeMode
      ? {
          allowRemoteResources: false,
          allowScripts: false,
          preloadGreetingResources: false,
          preloadBeautificationResources: false,
        }
      : storedPreviewPolicy,
  )
  const customUiCss = ref(safeMode ? '' : browserStorageService.getCustomUiCss())
  const handleScopedCssRemoval = (event: Event) => {
    const css = (event as CustomEvent<string>).detail
    if (typeof css !== 'string') return
    appearanceTransaction.clear(
      css,
      (value) => {
        customUiCss.value = isSafeModeActive() ? '' : value
        syncCustomUiCss()
      },
      (value) => browserStorageService.setCustomUiCss(value),
    )
  }
  onMounted(() => window.addEventListener(SCOPED_CSS_REMOVED_EVENT, handleScopedCssRemoval))
  onUnmounted(() => window.removeEventListener(SCOPED_CSS_REMOVED_EVENT, handleScopedCssRemoval))
  const extractCharacterAssets = ref(browserStorageService.getExtractCharacterAssets())
  const showManuallyBoundResources = ref(browserStorageService.getShowManuallyBoundResources())
  const hideCharacterAssets = ref(browserStorageService.getHideCharacterAssets())
  const blurThumbnails = ref(browserStorageService.getBlurThumbnails())
  // 设置面板使用受控开关，取消确认后需要重建面板才能让开关回到实际状态。
  const settingsPanelKey = ref(0)

  function applyTheme(value: ThemeValue): void {
    theme.value = value
    document.documentElement.dataset.theme = value
    writeStoredTheme(value)
  }

  function applyLayoutMode(value: LayoutMode): void {
    layoutMode.value = value
    browserStorageService.setLayoutMode(value)
  }

  function applyUiFontScale(value: UiFontScale): void {
    uiFontScale.value = browserStorageService.setUiFontScale(value)
    document.documentElement.dataset.fontScale = uiFontScale.value
  }

  function syncCustomUiCss(): void {
    let style = document.getElementById(CUSTOM_UI_STYLE_ID) as HTMLStyleElement | null
    if (!style) {
      style = document.createElement('style')
      style.id = CUSTOM_UI_STYLE_ID
      document.head.append(style)
    }
    style.textContent = sanitizeCssForPreview(
      isSafeModeActive()
        ? ''
        : upgradeLegacyAppearanceCss(customUiCss.value, browserStorageService.getCustomUiPresets()),
      {
        allowExternalResources: previewPolicy.value.allowRemoteResources,
      },
    )
  }

  function saveCustomUiCss(value: string): void {
    const nextCss = value.slice(0, CUSTOM_UI_CSS_LIMIT)
    if (isSafeModeActive() && nextCss) {
      showNotice('当前处于安全模式；恢复正常启动后才能应用自定义 CSS')
      return
    }
    const previousCss = browserStorageService.getCustomUiCss()
    const apply = (css: string) => {
      customUiCss.value = css
      syncCustomUiCss()
    }
    const persist = (css: string) => browserStorageService.setCustomUiCss(css)
    if (!nextCss || nextCss === previousCss) {
      appearanceTransaction.clear(nextCss, apply, persist)
      showNotice(nextCss ? '自定义 CSS 未发生变化' : '自定义 CSS 已清除')
      return
    }
    appearanceTransaction.begin({
      previousCss,
      nextCss,
      apply,
      persist,
      onKeep: () => showNotice('自定义 CSS 已确认保留'),
      onRollback: () => showNotice('未确认更改，已自动恢复上一版 CSS'),
    })
    showNotice('自定义 CSS 已临时应用，请在 15 秒内选择“保留更改”')
  }

  function applyRemotePreviewPolicy(enabled: boolean): void {
    previewPolicy.value = browserStorageService.setPreviewPolicy({
      allowRemoteResources: enabled,
      allowScripts: false,
      preloadGreetingResources: previewPolicy.value.preloadGreetingResources,
      preloadBeautificationResources: previewPolicy.value.preloadBeautificationResources,
    })
    syncCustomUiCss()
  }

  async function applyScriptPreviewPolicy(enabled: boolean): Promise<void> {
    if (enabled && isSafeModeActive()) {
      showNotice('安全模式下不能开启脚本预览')
      settingsPanelKey.value += 1
      return
    }
    if (
      enabled &&
      !(await confirmAction({
        title: '高风险预览确认',
        message: SCRIPT_PREVIEW_CONFIRM,
        confirmLabel: '开启脚本预览',
        danger: true,
      }))
    ) {
      settingsPanelKey.value += 1
      return
    }
    previewPolicy.value = browserStorageService.setPreviewPolicy({
      allowRemoteResources: enabled || previewPolicy.value.allowRemoteResources,
      allowScripts: enabled,
      preloadGreetingResources: previewPolicy.value.preloadGreetingResources,
      preloadBeautificationResources: previewPolicy.value.preloadBeautificationResources,
    })
    syncCustomUiCss()
  }

  function applyGreetingPreviewPreload(enabled: boolean): void {
    previewPolicy.value = browserStorageService.setPreviewPolicy({
      ...previewPolicy.value,
      preloadGreetingResources: enabled,
    })
  }

  function applyBeautificationPreviewPreload(enabled: boolean): void {
    previewPolicy.value = browserStorageService.setPreviewPolicy({
      ...previewPolicy.value,
      preloadBeautificationResources: enabled,
    })
  }

  function applyExtractCharacterAssets(enabled: boolean): void {
    extractCharacterAssets.value = enabled
    browserStorageService.setExtractCharacterAssets(enabled)
  }

  /** 恢复便携配置后重新读取全部外观设置，并立即应用到文档。 */
  function reloadAppearanceSettings(): void {
    theme.value = readStoredTheme()
    document.documentElement.dataset.theme = theme.value
    layoutMode.value = browserStorageService.getLayoutMode()
    uiFontScale.value = browserStorageService.getUiFontScale()
    document.documentElement.dataset.fontScale = uiFontScale.value
    previewPolicy.value = isSafeModeActive()
      ? {
          allowRemoteResources: false,
          allowScripts: false,
          preloadGreetingResources: false,
          preloadBeautificationResources: false,
        }
      : browserStorageService.getPreviewPolicy()
    customUiCss.value = isSafeModeActive() ? '' : browserStorageService.getCustomUiCss()
    extractCharacterAssets.value = browserStorageService.getExtractCharacterAssets()
    showManuallyBoundResources.value = browserStorageService.getShowManuallyBoundResources()
    hideCharacterAssets.value = browserStorageService.getHideCharacterAssets()
    blurThumbnails.value = browserStorageService.getBlurThumbnails()
  }

  return {
    theme,
    layoutMode,
    uiFontScale,
    previewPolicy,
    customUiCss,
    extractCharacterAssets,
    hideCharacterAssets,
    showManuallyBoundResources,
    blurThumbnails,
    settingsPanelKey,
    applyTheme,
    applyLayoutMode,
    applyUiFontScale,
    syncCustomUiCss,
    saveCustomUiCss,
    applyRemotePreviewPolicy,
    applyScriptPreviewPolicy,
    applyGreetingPreviewPreload,
    applyBeautificationPreviewPreload,
    applyExtractCharacterAssets,
    reloadAppearanceSettings,
  }
}
