/** @vitest-environment jsdom */
import { shallowMount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

const runtime = vi.hoisted(() => ({ android: false }))
vi.mock('../core/PlatformService', () => ({
  platform: {
    update: { isAndroidApk: () => runtime.android },
    security: { getState: async () => null },
    backup: { getStatus: async () => null },
    systemUi: { getState: async () => null },
  },
}))
vi.mock('../storage/NativeResourceFileMirror', () => ({
  getNativeResourceStorageInfo: async () => null,
}))
vi.mock('../core/OfflineResources', () => ({
  getOfflineResourceStatus: async () => null,
  downloadFullOfflineResources: vi.fn(),
  removeFullOfflineResources: vi.fn(),
}))
vi.mock('../core/NativeHaptics', () => ({
  isNativeHapticsEnabled: () => false,
  setNativeHapticsEnabled: vi.fn(),
}))
vi.mock('../core/ServiceWorkerUpdate', () => ({
  forceRefresh: vi.fn(),
  manualCheckForUpdate: vi.fn(),
}))
vi.mock('./SecretProtectionSettings.vue', () => ({ default: { template: '<div />' } }))
vi.mock('./MainApiSettings.vue', () => ({ default: { template: '<div />' } }))
vi.mock('./ResourceHealthCenter.vue', () => ({ default: { template: '<div />' } }))

import LayoutSettingsPanel from './LayoutSettingsPanel.vue'

const wrappers: Array<ReturnType<typeof shallowMount>> = []
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount())
  runtime.android = false
})

function mountSettings() {
  const wrapper = shallowMount(LayoutSettingsPanel, {
    props: {
      vaultEnabled: false,
      allowRemotePreviews: true,
      allowScriptPreviews: false,
      preloadGreetingPreviews: true,
      preloadBeautificationPreviews: true,
      extractCharacterAssets: false,
      hideCharacterAssets: false,
      showManuallyBoundResources: true,
      blurThumbnails: false,
      showPerformanceMonitor: false,
      hiddenCharacterAssetCount: 0,
      historySnapshotLimit: 8,
      historySnapshotCount: 0,
    },
  })
  wrappers.push(wrapper)
  return wrapper
}

describe('LayoutSettingsPanel platform-specific preview options', () => {
  it('keeps remote-resource permission but hides Android-only cache switches on Web/PWA', () => {
    runtime.android = false
    const wrapper = mountSettings()
    expect(wrapper.text()).toContain('允许远程资源')
    expect(wrapper.text()).not.toContain('开场白：Android 后台缓存')
    expect(wrapper.text()).not.toContain('美化：Android 后台缓存')
  })

  it('shows both background-cache switches in Android APK', () => {
    runtime.android = true
    const wrapper = mountSettings()
    expect(wrapper.text()).toContain('开场白：Android 后台缓存')
    expect(wrapper.text()).toContain('美化：Android 后台缓存')
  })
})
