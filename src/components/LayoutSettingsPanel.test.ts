/** @vitest-environment jsdom */
import { flushPromises, shallowMount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

const runtime = vi.hoisted(() => ({ android: false, postMedia: false, save: vi.fn() }))
vi.mock('../core/LibraryContainer', async () => ({
  browserStorageService: new (
    await import('../services/BrowserStorageService')
  ).BrowserStorageService(),
  discordInboxAutomationSettingsService: {
    load: async () => ({
      bindSameName: false,
      bindSameAuthor: false,
      bindNextPng: false,
      bindForeground: false,
      preferPngContainer: false,
      downloadPostMedia: runtime.postMedia,
    }),
    save: async (settings: { downloadPostMedia?: boolean }) => {
      runtime.save(settings)
      runtime.postMedia = settings.downloadPostMedia === true
    },
  },
}))
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
it('defaults post media downloads off and persists the choice when settings reopen', async () => {
  const first = mountSettings()
  await flushPromises()
  const checkbox = first
    .findAll('label')
    .find((node) => node.text().includes('保存帖子时下载素材图片'))!
    .get('input')
  expect((checkbox.element as HTMLInputElement).checked).toBe(false)
  await checkbox.setValue(true)
  await flushPromises()
  expect(runtime.save).toHaveBeenCalledWith(expect.objectContaining({ downloadPostMedia: true }))
  const second = mountSettings()
  await flushPromises()
  expect(
    (
      second
        .findAll('label')
        .find((node) => node.text().includes('保存帖子时下载素材图片'))!
        .get('input').element as HTMLInputElement
    ).checked,
  ).toBe(true)
})
it('persists modified tag choice in system settings and restores it on reopen', async () => {
  const first = mountSettings()
  const checkbox = first
    .findAll('label')
    .find((node) => node.text().includes('修改版是否更改标签'))!
    .get('input')
  expect((checkbox.element as HTMLInputElement).checked).toBe(false)
  await checkbox.setValue(true)
  const second = mountSettings()
  const reopened = second
    .findAll('label')
    .find((node) => node.text().includes('修改版是否更改标签'))!
    .get('input')
  expect((reopened.element as HTMLInputElement).checked).toBe(true)
  await reopened.setValue(false)
  expect(localStorage.getItem('srl.modifiedResource.syncTags')).toBe('false')
})
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount())
  runtime.android = false
  runtime.postMedia = false
  runtime.save.mockClear()
  localStorage.clear()
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
      hideChatDisplayRegex: true,
      showManuallyBoundResources: true,
      blurThumbnails: false,
      autoDownloadDiscordShareLinks: false,
      persistResourceVersionMatchCache: true,
      skipVersionComparisonOnImport: false,
      showPerformanceMonitor: false,
      hiddenCharacterAssetCount: 0,
    },
  })
  wrappers.push(wrapper)
  return wrapper
}

describe('LayoutSettingsPanel platform-specific preview options', () => {
  it('exposes the same-name candidate switch without enabling it by default', async () => {
    const wrapper = mountSettings()
    const label = wrapper
      .findAll('label')
      .find((node) => node.text().includes('同名资源默认识别为版本候选'))!
    const checkbox = label.get('input[type="checkbox"]')
    expect((checkbox.element as HTMLInputElement).checked).toBe(false)
    await checkbox.setValue(true)
    expect(wrapper.emitted('update:sameNameVersionCandidates')?.[0]).toEqual([true])
  })
  it('exposes the global PNG wrapper preference', async () => {
    const wrapper = mountSettings()
    const label = wrapper
      .findAll('label')
      .find((node) => node.text().includes('同内容角色卡优先使用 PNG 封装'))!
    expect((label.get('input[type="checkbox"]').element as HTMLInputElement).checked).toBe(false)
  })
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
    expect(wrapper.text()).toContain('DC 分享直链默认下载')
  })

  it('hides the Discord direct-link option outside Android APK', () => {
    runtime.android = false
    const wrapper = mountSettings()
    expect(wrapper.text()).not.toContain('DC 分享直链默认下载')
  })
})
