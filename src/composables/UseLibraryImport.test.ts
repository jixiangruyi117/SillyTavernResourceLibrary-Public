import { ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useLibraryImport } from './UseLibraryImport'

const { inspectArchive, tavernFiles, startKeepAlive, stopKeepAlive } = vi.hoisted(() => ({
  inspectArchive: vi.fn(),
  tavernFiles: vi.fn(),
  startKeepAlive: vi.fn(),
  stopKeepAlive: vi.fn(),
}))

vi.mock('../core/AppContainer', () => ({
  resourceArchiveService: { inspect: inspectArchive, tavernFiles },
  resourceService: {},
}))

vi.mock('../services/NativeImportKeepAlive', () => ({
  isNativeImportKeepAliveAvailable: () => true,
  startNativeImportKeepAlive: startKeepAlive,
  stopNativeImportKeepAlive: stopKeepAlive,
  updateNativeImportKeepAlive: vi.fn(),
}))

vi.mock('../core/NativeSecurity', () => ({
  requestNativeNotifications: vi.fn().mockResolvedValue(true),
}))

describe('shared backup route handoff', () => {
  beforeEach(() => {
    inspectArchive.mockReset()
    tavernFiles.mockReset()
    startKeepAlive.mockReset().mockResolvedValue(true)
    stopKeepAlive.mockReset().mockResolvedValue(undefined)
    vi.stubGlobal('document', { visibilityState: 'visible' })
  })
  afterEach(() => vi.unstubAllGlobals())

  it('keeps a structurally valid SRL ZIP pending for restore even from the Tavern share route', async () => {
    inspectArchive.mockResolvedValue('library')
    const file = new File(['{}'], 'backup.zip')
    const pendingBackupImport = ref<File>()
    const openRestorePanel = vi.fn()
    const handleRestoreInspect = vi.fn().mockResolvedValue(undefined)
    const context = {
      isBusy: ref(false),
      pendingBackupImport,
      openRestorePanel,
      handleRestoreInspect,
      showNotice: vi.fn(),
    }

    const result = await useLibraryImport(() => context as never).handleSharedImportChoice(
      [file],
      'tavernBackup',
    )

    expect(result).toBe('restore')
    expect(pendingBackupImport.value).toBeUndefined()
    expect(openRestorePanel).toHaveBeenCalledWith('import')
    expect(handleRestoreInspect).toHaveBeenCalledWith(file)
    expect(inspectArchive).toHaveBeenCalledTimes(1)
  })

  it('sends a structurally valid Tavern ZIP through the Tavern parser', async () => {
    inspectArchive.mockResolvedValue('tavern')
    tavernFiles.mockImplementation(async function* () {})
    const file = new File(['{}'], 'tavern.zip')
    const context = {
      isBusy: ref(false),
      isRestorePanelOpen: ref(false),
      showNotice: vi.fn(),
    }

    const result = await useLibraryImport(() => context as never).handleSharedImportChoice(
      [file],
      'tavernBackup',
    )

    expect(result).toBe('consumed')
    expect(tavernFiles).toHaveBeenCalledTimes(1)
  })

  it('stops the detection task before starting and stopping the Tavern import task', async () => {
    inspectArchive.mockResolvedValue('tavern')
    tavernFiles.mockImplementation(async function* () {})
    const file = new File(['{}'], 'backup.zip')
    const context = {
      isBusy: ref(false),
      isNativeApk: true,
      isRestorePanelOpen: ref(false),
      showNotice: vi.fn(),
    }

    const result = await useLibraryImport(() => context as never).handleSharedImportChoice(
      [file],
      'libraryBackup',
    )

    expect(result).toBe('consumed')
    expect(inspectArchive).toHaveBeenCalledTimes(1)
    expect(tavernFiles).toHaveBeenCalledTimes(1)
    expect(startKeepAlive).toHaveBeenCalledTimes(2)
    expect(stopKeepAlive).toHaveBeenCalledTimes(2)
    expect(startKeepAlive.mock.invocationCallOrder[1]).toBeGreaterThan(
      stopKeepAlive.mock.invocationCallOrder[0]!,
    )
    expect(stopKeepAlive.mock.invocationCallOrder[1]).toBeGreaterThan(
      startKeepAlive.mock.invocationCallOrder[1]!,
    )
  })
})
