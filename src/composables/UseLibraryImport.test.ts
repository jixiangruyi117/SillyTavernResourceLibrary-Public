import { effectScope, ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useLibraryImport } from './UseLibraryImport'

const {
  inspectArchive,
  tavernFiles,
  startKeepAlive,
  stopKeepAlive,
  suspendKeepAlive,
  confirmImportAction,
} = vi.hoisted(() => ({
  inspectArchive: vi.fn(),
  tavernFiles: vi.fn(),
  startKeepAlive: vi.fn(),
  stopKeepAlive: vi.fn(),
  suspendKeepAlive: vi.fn(),
  confirmImportAction: vi.fn(),
}))

vi.mock('../core/AppContainer', () => ({
  resourceArchiveService: { inspect: inspectArchive, tavernFiles },
  resourceService: {},
}))

vi.mock('../services/NativeImportKeepAlive', () => ({
  isNativeImportKeepAliveAvailable: () => true,
  startNativeImportKeepAlive: startKeepAlive,
  stopNativeImportKeepAlive: stopKeepAlive,
  suspendNativeImportKeepAlive: suspendKeepAlive,
  updateNativeImportKeepAlive: vi.fn(),
}))

vi.mock('../core/NativeSecurity', () => ({
  requestNativeNotifications: vi.fn().mockResolvedValue(true),
}))

vi.mock('./UseConfirmDialog', () => ({
  confirmAction: confirmImportAction,
}))

describe('shared backup route handoff', () => {
  beforeEach(() => {
    inspectArchive.mockReset()
    tavernFiles.mockReset()
    startKeepAlive.mockReset().mockResolvedValue(true)
    stopKeepAlive.mockReset().mockResolvedValue(undefined)
    suspendKeepAlive.mockReset().mockResolvedValue(undefined)
    confirmImportAction.mockReset().mockResolvedValue(true)
    vi.stubGlobal('document', {
      visibilityState: 'visible',
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })
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

    const scope = effectScope()
    const importer = scope.run(() => useLibraryImport(() => context as never))!
    const result = await importer.handleSharedImportChoice([file], 'tavernBackup')
    scope.stop()

    expect(result).toBe(false)
    expect(pendingBackupImport.value).toBeUndefined()
    expect(openRestorePanel).not.toHaveBeenCalled()
    expect(handleRestoreInspect).not.toHaveBeenCalled()
    expect(inspectArchive).toHaveBeenCalledTimes(1)
    expect(context.showNotice).toHaveBeenCalledWith(expect.stringContaining('实际是资源库备份'))
  })

  it('stops an in-flight KeepAlive start if the app returns to foreground', async () => {
    let visibilityListener: (() => void) | undefined
    const documentMock = {
      visibilityState: 'hidden',
      addEventListener: vi.fn((_event: string, listener: () => void) => {
        visibilityListener = listener
      }),
      removeEventListener: vi.fn(),
    }
    vi.stubGlobal('document', documentMock)
    inspectArchive.mockResolvedValue('library')
    let finishStart!: (started: boolean) => void
    startKeepAlive.mockReturnValueOnce(
      new Promise<boolean>((resolve) => {
        finishStart = resolve
      }),
    )
    const file = new File(['{}'], 'backup.zip')
    const context = {
      isBusy: ref(false),
      pendingBackupImport: ref<File>(),
      openRestorePanel: vi.fn(),
      handleRestoreInspect: vi.fn().mockResolvedValue(undefined),
      showNotice: vi.fn(),
    }
    const scope = effectScope()
    const api = scope.run(() => useLibraryImport(() => context as never))!
    const handling = api.handleSharedImportChoice([file], 'libraryBackup')

    await vi.waitFor(() => expect(startKeepAlive).toHaveBeenCalledTimes(1))
    documentMock.visibilityState = 'visible'
    visibilityListener?.()
    finishStart(true)
    expect(await handling).toBe('restore')
    expect(suspendKeepAlive).toHaveBeenCalledTimes(1)
    scope.stop()
    expect(documentMock.removeEventListener).toHaveBeenCalledWith(
      'visibilitychange',
      expect.any(Function),
    )
  })

  it('sends a structurally valid Tavern ZIP through the Tavern parser', async () => {
    inspectArchive.mockResolvedValue('tavern')
    tavernFiles.mockImplementation(async function* () {})
    const file = new File(['{}'], 'tavern.zip')
    const context = {
      isBusy: ref(false),
      isRestorePanelOpen: ref(false),
      pendingVersionImports: ref([]),
      showNotice: vi.fn(),
    }

    const scope = effectScope()
    const importer = scope.run(() => useLibraryImport(() => context as never))!
    const result = await importer.handleSharedImportChoice([file], 'tavernBackup')
    scope.stop()

    expect(result).toBe('consumed')
    expect(tavernFiles).toHaveBeenCalledTimes(1)
  })

  it('rejects a Tavern archive selected through the library route without rerouting it', async () => {
    inspectArchive.mockResolvedValue('tavern')
    tavernFiles.mockImplementation(async function* () {})
    const file = new File(['{}'], 'backup.zip')
    const context = {
      isBusy: ref(false),
      isNativeApk: true,
      isRestorePanelOpen: ref(false),
      pendingVersionImports: ref([]),
      showNotice: vi.fn(),
    }

    const scope = effectScope()
    const importer = scope.run(() => useLibraryImport(() => context as never))!
    const result = await importer.handleSharedImportChoice([file], 'libraryBackup')
    scope.stop()

    expect(result).toBe(false)
    expect(inspectArchive).toHaveBeenCalledTimes(1)
    expect(tavernFiles).not.toHaveBeenCalled()
    expect(startKeepAlive).not.toHaveBeenCalled()
    expect(stopKeepAlive).not.toHaveBeenCalled()
    expect(context.showNotice).toHaveBeenCalledWith(expect.stringContaining('实际是酒馆备份'), 9000)
  })
})
