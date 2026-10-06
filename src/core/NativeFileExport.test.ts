/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  beginWrite: vi.fn(),
  appendWrite: vi.fn(),
  commitWrite: vi.fn(),
  abortWrite: vi.fn(),
  getDirectoryStatus: vi.fn(),
}))

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => true,
    getPlatform: () => 'android',
    isPluginAvailable: () => true,
  },
  registerPlugin: () => mocks,
}))

import {
  getNativeExportPreference,
  saveBlobToNativeDestination,
  setNativeExportPreference,
} from './NativeFileExport'

describe('NativeFileExport', () => {
  afterEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
  })

  it('separates image and file defaults and falls back to ask', () => {
    expect(getNativeExportPreference('image')).toBe('ask')
    setNativeExportPreference('image', 'pictures')
    setNativeExportPreference('file', 'downloads')
    expect(getNativeExportPreference('image')).toBe('pictures')
    expect(getNativeExportPreference('file')).toBe('downloads')
  })

  it('streams binary content to the selected native destination', async () => {
    mocks.beginWrite.mockResolvedValue({ token: 'write-1' })
    mocks.appendWrite.mockResolvedValue(undefined)
    mocks.commitWrite.mockResolvedValue({ uri: 'content://downloads/srl.png', bytes: 3 })

    await expect(
      saveBlobToNativeDestination(
        new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }),
        '卡.png',
        'pictures',
      ),
    ).resolves.toEqual({ uri: 'content://downloads/srl.png', bytes: 3 })

    expect(mocks.beginWrite).toHaveBeenCalledWith({
      destination: 'pictures',
      fileName: '卡.png',
      mimeType: 'image/png',
    })
    expect(mocks.appendWrite).toHaveBeenCalledOnce()
    expect(mocks.commitWrite).toHaveBeenCalledWith({ token: 'write-1' })
  })
})
