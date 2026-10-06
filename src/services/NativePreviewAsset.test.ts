import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  native: false,
  platform: 'web',
  download: vi.fn(),
}))

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => mocks.native,
    getPlatform: () => mocks.platform,
    convertFileSrc: (path: string) => `https://app.test/_capacitor_file_/${path}`,
  },
  registerPlugin: () => ({ download: mocks.download }),
}))

import { downloadNativePreviewAsset, isNativePreviewAssetAvailable } from './NativePreviewAsset'

describe('NativePreviewAsset', () => {
  afterEach(() => {
    mocks.native = false
    mocks.platform = 'web'
    mocks.download.mockReset()
  })

  it('仅在 Android 原生端启用', () => {
    expect(isNativePreviewAssetAvailable()).toBe(false)
    mocks.native = true
    mocks.platform = 'android'
    expect(isNativePreviewAssetAvailable()).toBe(true)
  })

  it('把 Android 缓存文件转换为 WebView 可展示地址', async () => {
    mocks.native = true
    mocks.platform = 'android'
    mocks.download.mockResolvedValue({
      path: 'file:///data/user/0/cache/srl-preview-assets/cover.png',
      resolvedUrl: 'https://cdn.example/cover.png',
      contentType: 'image/png',
      size: 1024,
      cached: true,
    })

    const result = await downloadNativePreviewAsset('https://cdn.example/cover.png', 4096)

    expect(mocks.download).toHaveBeenCalledWith({
      url: 'https://cdn.example/cover.png',
      maxBytes: 4096,
    })
    expect(result.resourceUrl).toContain('/_capacitor_file_/file:///data/user/0/cache/')
    expect(result.cached).toBe(true)
  })
})
