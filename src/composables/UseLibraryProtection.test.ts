import { ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const history = vi.hoisted(() => ({ list: vi.fn(), getSnapshotLimit: vi.fn() }))
const native = vi.hoisted(() => ({
  clear: vi.fn(),
  info: vi.fn(),
  health: vi.fn(),
  confirm: vi.fn(),
}))
vi.mock('../core/AppContainer', () => ({
  browserStorageService: { getHealth: native.health },
  communitySourceStorage: {},
  historyService: history,
  resourceService: {},
  vaultService: {},
}))
vi.mock('../storage/NativeResourceFileMirror', () => ({
  clearNativeTemporaryCaches: native.clear,
  getNativeResourceStorageInfo: native.info,
}))
vi.mock('./UseConfirmDialog', () => ({ confirmAction: native.confirm }))

import { useLibraryProtection } from './UseLibraryProtection'
import { domainEvents } from '../core/DomainEvents'

function createProtection() {
  const context = {
    isNativeApk: true,
    isClearingNativeCache: ref(false),
    storageHealth: ref({}),
    nativeStorageInfo: ref(null),
    showNotice: vi.fn(),
    isDataProtectionOpen: ref(true),
    isVaultPanelOpen: ref(false),
    vaultStatus: ref({ enabled: false, locked: false }),
    historySnapshots: ref([]),
    historySnapshotLimit: ref(8),
  }
  const protection = useLibraryProtection(
    () => context as unknown as ReturnType<Parameters<typeof useLibraryProtection>[0]>,
  )
  return { context, protection }
}

beforeEach(() => {
  vi.resetAllMocks()
  history.list.mockResolvedValue([])
  history.getSnapshotLimit.mockResolvedValue(8)
})

describe('useLibraryProtection history opening', () => {
  it('publishes the new storage measurement after one confirmed cache clear', async () => {
    native.confirm.mockResolvedValue(true)
    native.clear.mockResolvedValue(42 * 1024)
    native.info.mockResolvedValue({ totalBytes: 530 })
    native.health.mockResolvedValue({})
    const listener = vi.fn()
    const unsubscribe = domainEvents.on('NativeTemporaryCachesCleared', listener)
    try {
      const { context, protection } = createProtection()
      await protection.clearNativeTemporaryStorage()
      expect(native.clear).toHaveBeenCalledOnce()
      expect(native.info).toHaveBeenCalledOnce()
      expect(listener).toHaveBeenCalledWith({
        storage: { totalBytes: 530 },
        measuredAt: expect.any(Number),
      })
      expect(context.nativeStorageInfo.value).toEqual({ totalBytes: 530 })
      expect(context.showNotice).toHaveBeenCalledWith(expect.stringContaining('42.0 KB'))
      expect(context.isClearingNativeCache.value).toBe(false)
    } finally {
      unsubscribe()
    }
  })

  it('does not clear or announce a measurement when confirmation is cancelled', async () => {
    native.confirm.mockResolvedValue(false)
    const { protection } = createProtection()
    await protection.clearNativeTemporaryStorage()
    expect(native.clear).not.toHaveBeenCalled()
    expect(native.info).not.toHaveBeenCalled()
  })

  it('reuses the history loaded at startup when the vault panel is opened', async () => {
    const { context, protection } = createProtection()
    await protection.loadHistorySnapshots()
    await protection.openVaultPanel()
    expect(context.isDataProtectionOpen.value).toBe(false)
    expect(context.isVaultPanelOpen.value).toBe(true)
    expect(history.list).toHaveBeenCalledTimes(1)
  })

  it('shares an in-flight startup read with an early first opening', async () => {
    let finishList!: (value: []) => void
    history.list.mockReturnValueOnce(
      new Promise<[]>((resolve) => {
        finishList = resolve
      }),
    )
    const { protection } = createProtection()
    const startup = protection.loadHistorySnapshots()
    const opening = protection.openVaultPanel()
    expect(history.list).toHaveBeenCalledTimes(1)
    finishList([])
    await Promise.all([startup, opening])
    await protection.openVaultPanel()
    expect(history.list).toHaveBeenCalledTimes(1)
  })
})
