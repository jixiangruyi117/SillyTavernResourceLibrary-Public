import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  native: false,
  platform: 'web',
  download: vi.fn(),
  prepare: vi.fn(
    async (_options: { sessionId: string; urls: string[] }): Promise<void> => undefined,
  ),
  release: vi.fn(async () => undefined),
  cancel: vi.fn(async () => undefined),
  configure: vi.fn(async (_options: { increaseDownloadConcurrency: boolean }) => undefined),
}))

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => mocks.native,
    getPlatform: () => mocks.platform,
    convertFileSrc: (path: string) => `https://app.test/_capacitor_file_/${path}`,
  },
  registerPlugin: () => ({
    download: mocks.download,
    prepare: mocks.prepare,
    release: mocks.release,
    cancel: mocks.cancel,
    configure: mocks.configure,
  }),
}))

import {
  downloadNativePreviewAsset,
  isNativePreviewAssetAvailable,
  prepareNativePreviewAssets,
  configureNativePreviewDownloadConcurrency,
} from './NativePreviewAsset'

describe('NativePreviewAsset', () => {
  afterEach(() => {
    mocks.native = false
    mocks.platform = 'web'
    mocks.download.mockReset()
    mocks.prepare.mockReset().mockResolvedValue(undefined)
    mocks.release.mockClear()
    mocks.cancel.mockClear()
    mocks.configure.mockReset().mockResolvedValue(undefined)
  })

  it('仅在 Android 原生端启用', () => {
    expect(isNativePreviewAssetAvailable()).toBe(false)
    mocks.native = true
    mocks.platform = 'android'
    expect(isNativePreviewAssetAvailable()).toBe(true)
  })

  it('设置开关只传递两档，旧 APK 不支持时不破坏普通预览', async () => {
    mocks.native = true
    mocks.platform = 'android'
    expect(await configureNativePreviewDownloadConcurrency(true)).toBe(true)
    expect(mocks.configure).toHaveBeenLastCalledWith({ increaseDownloadConcurrency: true })
    expect(await configureNativePreviewDownloadConcurrency(false)).toBe(true)
    expect(mocks.configure).toHaveBeenLastCalledWith({ increaseDownloadConcurrency: false })
    mocks.configure.mockRejectedValueOnce(new Error('UNIMPLEMENTED'))
    expect(await configureNativePreviewDownloadConcurrency(true)).toBe(false)
    const controller = new AbortController()
    await prepareNativePreviewAssets(['https://cdn.example/a.png'], controller.signal, true)
    expect(mocks.prepare).toHaveBeenLastCalledWith(
      expect.objectContaining({ increaseDownloadConcurrency: true }),
    )
    controller.abort()
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
      requestId: expect.any(String),
    })
    expect(result.resourceUrl).toContain('/_capacitor_file_/file:///data/user/0/cache/')
    expect(result.cached).toBe(true)
  })

  it('取消信号传入原生请求，迟到的结果不再交付', async () => {
    mocks.native = true
    mocks.platform = 'android'
    let complete!: (value: unknown) => void
    mocks.download.mockImplementation(
      () =>
        new Promise((resolve) => {
          complete = resolve
        }),
    )
    const controller = new AbortController()
    const result = downloadNativePreviewAsset(
      'https://cdn.example/cover.png',
      4096,
      controller.signal,
    )
    const rejected = expect(result).rejects.toMatchObject({ name: 'AbortError' })
    controller.abort()
    expect(mocks.cancel).toHaveBeenCalledWith({
      requestId: mocks.download.mock.calls[0]![0].requestId,
    })
    complete({ path: 'file:///cache/cover.png' })
    await rejected
  })

  it('已取消的下载不发起原生请求', async () => {
    mocks.native = true
    mocks.platform = 'android'
    await expect(
      downloadNativePreviewAsset('https://cdn.example/a.png', 4096, AbortSignal.abort()),
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(mocks.download).not.toHaveBeenCalled()
  })

  it('只登记素材，不提前下载；结束会话释放登记', async () => {
    const controller = new AbortController()
    await prepareNativePreviewAssets(['https://cdn.example/a.png'], controller.signal)
    expect(mocks.download).not.toHaveBeenCalled()
    controller.abort()
    expect(mocks.release).toHaveBeenCalledWith({
      sessionId: mocks.prepare.mock.calls[0]![0].sessionId,
    })
  })

  it('登记返回晚于取消时再次释放，不遗留原生会话', async () => {
    let complete!: () => void
    mocks.prepare.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          complete = resolve
        }),
    )
    const controller = new AbortController()
    const result = prepareNativePreviewAssets(['https://cdn.example/a.png'], controller.signal)
    controller.abort()
    complete()
    await result
    expect(mocks.release).toHaveBeenCalledTimes(2)
  })
})
