/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const picker = vi.hoisted(() => ({ pickImage: vi.fn() }))
const capacitor = vi.hoisted(() => ({ available: true }))

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => true,
    getPlatform: () => 'android',
    isPluginAvailable: () => capacitor.available,
    convertFileSrc: (uri: string) => `https://local.invalid/${encodeURIComponent(uri)}`,
  },
  registerPlugin: () => picker,
}))

import { isNativeImagePickerAvailable, pickNativeImage } from './NativeFilePicker'

describe('NativeFilePicker', () => {
  beforeEach(() => {
    capacitor.available = true
    picker.pickImage.mockReset()
    vi.stubGlobal('fetch', vi.fn())
  })

  it('returns null when the system picker is cancelled', async () => {
    picker.pickImage.mockResolvedValue({ cancelled: true })
    await expect(pickNativeImage()).resolves.toBeNull()
  })

  it('stages a native photo as a browser File', async () => {
    picker.pickImage.mockResolvedValue({
      cancelled: false,
      uri: 'file:///cache/picked.png',
      name: '头像.png',
      mimeType: 'image/png',
    })
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      blob: async () => new Blob(['png'], { type: 'image/png' }),
    } as Response)

    const file = await pickNativeImage()
    expect(isNativeImagePickerAvailable()).toBe(true)
    expect(file?.name).toBe('头像.png')
    expect(file?.type).toBe('image/png')
    expect(file?.size).toBeGreaterThan(0)
  })
})
