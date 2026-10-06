/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const native = vi.hoisted(() => ({
  save: vi.fn(),
  directory: vi.fn(),
  choose: vi.fn(),
  remember: vi.fn(),
  share: vi.fn(),
}))
vi.mock('../core/AppContainer', () => ({ resourceService: {} }))
vi.mock('../core/NativeFileExport', () => ({
  chooseNativeExportDirectory: native.choose,
  getNativeExportDirectoryStatus: native.directory,
  getNativeExportPreference: vi.fn(),
  isNativeFileExportAvailable: vi.fn(),
  saveBlobToNativeDestination: native.save,
  setNativeExportPreference: native.remember,
}))
vi.mock('../utils/LibraryFormatting', () => ({ downloadBlob: native.share }))
import { useNativeResourceExport } from './UseNativeResourceExport'

function setup() {
  const manager = useNativeResourceExport({ showNotice: vi.fn() })
  manager.pendingNativeExport.value = {
    blob: new Blob(['image'], { type: 'image/png' }),
    fileName: 'card.png',
    contentLabel: '原版',
    isImage: true,
  }
  return manager
}

describe('native export state ownership', () => {
  beforeEach(() => vi.resetAllMocks())

  it('keeps the pending file when directory selection is cancelled', async () => {
    native.directory.mockResolvedValue({ available: false })
    native.choose.mockResolvedValue(undefined)
    const manager = setup()
    const pending = manager.pendingNativeExport.value
    await manager.handleNativeExportSelection('directory', true)
    expect(native.save).not.toHaveBeenCalled()
    expect(native.remember).not.toHaveBeenCalled()
    expect(manager.pendingNativeExport.value).toBe(pending)
    expect(manager.isNativeExportBusy.value).toBe(false)
  })

  it('remembers the destination only after saving succeeds', async () => {
    native.save.mockRejectedValueOnce(new Error('disk full'))
    const manager = setup()
    await manager.handleNativeExportSelection('downloads', true)
    expect(native.remember).not.toHaveBeenCalled()
    expect(manager.pendingNativeExport.value?.fileName).toBe('card.png')
    native.save.mockResolvedValueOnce(undefined)
    await manager.handleNativeExportSelection('downloads', true)
    expect(native.remember).toHaveBeenCalledWith('image', 'downloads')
    expect(manager.pendingNativeExport.value).toBeUndefined()
  })

  it('keeps pending exports isolated between mounted app instances', async () => {
    const first = setup()
    const second = setup()
    await first.sharePendingNativeExport()
    expect(first.pendingNativeExport.value).toBeUndefined()
    expect(second.pendingNativeExport.value?.fileName).toBe('card.png')
  })
})
