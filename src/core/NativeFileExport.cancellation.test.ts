/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const plugin = vi.hoisted(() => ({
  beginWrite: vi.fn(),
  appendWrite: vi.fn(),
  commitWrite: vi.fn(),
  abortWrite: vi.fn(),
}))

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => true,
    getPlatform: () => 'android',
    isPluginAvailable: () => true,
  },
  registerPlugin: () => plugin,
}))

import { saveBlobToNativeDestination } from './NativeFileExport'

describe('NativeFileExport transfer lifecycle', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    plugin.beginWrite.mockResolvedValue({ token: 'write-1' })
    plugin.appendWrite.mockResolvedValue(undefined)
    plugin.commitWrite.mockResolvedValue({ uri: 'content://downloads/test.bin', bytes: 3 })
    plugin.abortWrite.mockResolvedValue(undefined)
  })

  it('does not create a native file for an already cancelled request', async () => {
    const controller = new AbortController()
    controller.abort(new Error('already cancelled'))
    await expect(
      saveBlobToNativeDestination(new Blob(['abc']), 'test.bin', 'downloads', {
        signal: controller.signal,
      }),
    ).rejects.toThrow('already cancelled')
    expect(plugin.beginWrite).not.toHaveBeenCalled()
    expect(plugin.commitWrite).not.toHaveBeenCalled()
  })

  it('aborts rather than committing when cancelled during the final native write', async () => {
    const controller = new AbortController()
    plugin.appendWrite.mockImplementation(async () => controller.abort(new Error('cancelled')))
    await expect(
      saveBlobToNativeDestination(new Blob(['abc']), 'test.bin', 'downloads', {
        signal: controller.signal,
      }),
    ).rejects.toThrow('cancelled')
    expect(plugin.abortWrite).toHaveBeenCalledWith({ token: 'write-1' })
    expect(plugin.commitWrite).not.toHaveBeenCalled()
  })

  it('reports acknowledged bytes and commits only after writing succeeds', async () => {
    const onProgress = vi.fn()
    await saveBlobToNativeDestination(new Blob(['abc']), 'test.bin', 'downloads', { onProgress })
    expect(onProgress).toHaveBeenLastCalledWith({ transferredBytes: 3, totalBytes: 3 })
    expect(plugin.commitWrite).toHaveBeenCalledOnce()
    expect(plugin.abortWrite).not.toHaveBeenCalled()
  })

  it('preserves the write error when abort cleanup also fails', async () => {
    plugin.appendWrite.mockRejectedValue(new Error('disk full'))
    plugin.abortWrite.mockRejectedValue(new Error('cleanup failed'))
    await expect(
      saveBlobToNativeDestination(new Blob(['abc']), 'test.bin', 'downloads'),
    ).rejects.toThrow('disk full')
    expect(plugin.commitWrite).not.toHaveBeenCalled()
  })
})
