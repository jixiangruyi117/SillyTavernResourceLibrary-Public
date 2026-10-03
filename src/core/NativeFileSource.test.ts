import { afterEach, expect, it, vi } from 'vitest'

const native = vi.hoisted(() => ({
  enabled: true,
  hashFile: vi.fn(),
  cancelHashFile: vi.fn(),
  createThumbnail: vi.fn(),
  releaseThumbnail: vi.fn(),
}))
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => native.enabled, convertFileSrc: (uri: string) => uri },
  registerPlugin: () => native,
}))
import {
  hashNativeFile,
  materializeNativeFile,
  nativeFileSource,
  rememberNativeFile,
  thumbnailNativeFile,
} from './NativeFileSource'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetAllMocks()
  native.enabled = true
})

it('只把原始 Blob 的身份关联到原件，切片和变换不继承路径', async () => {
  const blob = rememberNativeFile(new Blob(['bytes']), 'file:///original')
  native.hashFile.mockResolvedValue({ hash: 'verified' })
  expect(await hashNativeFile(blob)).toBe('verified')
  expect(native.hashFile).toHaveBeenCalledWith(
    expect.objectContaining({ uri: 'file:///original', size: 5, requestId: expect.any(String) }),
  )
  expect(nativeFileSource(blob.slice(0, 2))).toBeUndefined()
  expect(await hashNativeFile(new Blob([blob, '!']))).toBeUndefined()
  native.enabled = false
  expect(nativeFileSource(blob)).toBeUndefined()
})

it('旧 APK 缺方法才降级，损坏和权限错误不能伪装为不支持', async () => {
  const blob = rememberNativeFile(new Blob(['bytes']), 'file:///original')
  native.hashFile
    .mockRejectedValueOnce({ code: 'UNIMPLEMENTED' })
    .mockRejectedValueOnce(new Error('size changed'))
  expect(await hashNativeFile(blob)).toBeUndefined()
  await expect(hashNativeFile(blob)).rejects.toThrow('size changed')
})

it('可将分享暂存文件物化为不再依赖暂存 URI 的普通文件', async () => {
  const staged = rememberNativeFile(
    new File([], 'card.png', { type: 'image/png' }),
    'file:///staged',
    5,
  )
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({ ok: true, blob: async () => new Blob(['bytes']) }),
  )

  const materialized = await materializeNativeFile(staged, { detachFromNativeSource: true })

  expect(await materialized.text()).toBe('bytes')
  expect(materialized.size).toBe(5)
  expect(nativeFileSource(materialized)).toBeUndefined()
  expect(fetch).toHaveBeenCalledWith('file:///staged', { cache: 'no-store' })
})

it('物化大文件时把停止信号传给原生文件读取并在返回前检查', async () => {
  const staged = rememberNativeFile(new File([], 'large.bin'), 'file:///large.bin', 5)
  const controller = new AbortController()
  const fetchFile = vi.fn().mockResolvedValue({
    ok: true,
    blob: async () => new Blob(['bytes']),
  })
  vi.stubGlobal('fetch', fetchFile)

  const pending = materializeNativeFile(staged, { signal: controller.signal })
  controller.abort(new DOMException('stopped', 'AbortError'))

  await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  expect(fetchFile).toHaveBeenCalledWith(
    'file:///large.bin',
    expect.objectContaining({ signal: controller.signal }),
  )
})

it('只取回降采样结果，并在读取完成或失败后释放原生临时图片', async () => {
  const blob = rememberNativeFile(new Blob(['original']), 'file:///original')
  native.createThumbnail.mockResolvedValue({ uri: 'file:///thumbnail' })
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({ ok: true, blob: async () => new Blob(['small']) }),
  )
  expect(await (await thumbnailNativeFile(blob, 640, 0.82))!.text()).toBe('small')
  expect(native.releaseThumbnail).toHaveBeenCalledWith({ uri: 'file:///thumbnail' })
  vi.mocked(fetch).mockRejectedValueOnce(new Error('missing'))
  await expect(thumbnailNativeFile(blob, 640, 0.82)).rejects.toThrow('missing')
  expect(native.releaseThumbnail).toHaveBeenCalledTimes(2)
})
