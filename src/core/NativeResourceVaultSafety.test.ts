/** @vitest-environment jsdom */
import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it, vi } from 'vitest'

const nativeFiles = vi.hoisted(() => ({ info: vi.fn(), clear: vi.fn(), mirror: vi.fn() }))
vi.mock('../storage/NativeResourceFileMirror', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../storage/NativeResourceFileMirror')>()),
  getNativeResourceStorageInfo: nativeFiles.info,
  clearNativeResourceFiles: nativeFiles.clear,
  mirrorNativeResourceFile: nativeFiles.mirror,
}))

import { syncNativeResourceFiles, vaultService } from './AppContainer'

afterEach(() => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

describe('native startup and incomplete vault migration', () => {
  it('does not clear native-only originals while an enabled vault awaits migration/unlock', async () => {
    nativeFiles.info.mockResolvedValue({ storageVersion: 4 })
    vi.spyOn(vaultService, 'isEnabled').mockReturnValue(true)
    nativeFiles.clear.mockResolvedValue(undefined)
    await syncNativeResourceFiles()
    expect(nativeFiles.info).toHaveBeenCalledOnce()
    expect(nativeFiles.clear).not.toHaveBeenCalled()
    expect(nativeFiles.mirror).not.toHaveBeenCalled()
  })
})
