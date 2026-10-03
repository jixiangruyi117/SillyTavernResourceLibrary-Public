import { ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const native = vi.hoisted(() => ({
  clear: vi.fn(),
  info: vi.fn(),
  health: vi.fn(),
  confirm: vi.fn(),
  enable: vi.fn(),
  disable: vi.fn(),
  migrate: vi.fn(),
  repair: vi.fn(),
  lock: vi.fn(),
  unlock: vi.fn(),
  legacy: vi.fn(),
  clearLegacy: vi.fn(),
}))
vi.mock('../core/AppContainer', () => ({
  browserStorageService: {
    getHealth: native.health,
    legacyLibraryHistoryCleanup: native.legacy,
    clearLegacyLibraryHistory: native.clearLegacy,
  },
  communitySourceStorage: { migrateVaultMode: native.migrate },
  resourceService: { repairThumbnailAssets: native.repair },
  vaultService: {
    enable: native.enable,
    disable: native.disable,
    lock: native.lock,
    unlock: native.unlock,
    getStatus: () => ({ enabled: false, locked: false }),
  },
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
    isVaultBusy: ref(false),
    loadResources: vi.fn(),
    loadRecycleBin: vi.fn(),
    clearSearchHistory: vi.fn(),
    resetSearchState: vi.fn(),
    resources: ref([]),
    categories: ref([]),
    recycleBinEntries: ref([]),
    recycleUndoEntry: ref(),
  }
  const protection = useLibraryProtection(
    () => context as unknown as ReturnType<Parameters<typeof useLibraryProtection>[0]>,
  )
  return { context, protection }
}

beforeEach(() => {
  vi.resetAllMocks()
  native.legacy.mockResolvedValue({ records: [{ id: 'old', size: 100, createdAt: 1 }], bytes: 100 })
})

describe('useLibraryProtection', () => {
  it('reserves legacy cleanup before confirmation, rejects repeated clicks and vault conversion, and cancels without deleting', async () => {
    let resolve!: (confirmed: boolean) => void
    native.confirm.mockReturnValue(
      new Promise<boolean>((done) => {
        resolve = done
      }),
    )
    const { context, protection } = createProtection()
    const first = protection.clearLegacyLibraryHistory()
    await vi.waitFor(() => expect(native.confirm).toHaveBeenCalledOnce())
    await protection.clearLegacyLibraryHistory()
    await protection.handleVaultEnable('test-password')
    await protection.handleVaultDisable()
    protection.handleVaultLock()
    expect(protection.isClearingLegacyLibraryHistory.value).toBe(true)
    expect(native.confirm).toHaveBeenCalledOnce()
    expect(native.enable).not.toHaveBeenCalled()
    expect(native.lock).not.toHaveBeenCalled()
    resolve(false)
    await first
    expect(native.clearLegacy).not.toHaveBeenCalled()
    expect(protection.isClearingLegacyLibraryHistory.value).toBe(false)
    expect(context.isVaultBusy.value).toBe(false)
  })

  it('does not clean during conversion and releases cleanup after a failed deletion', async () => {
    native.confirm.mockResolvedValue(true)
    native.clearLegacy.mockRejectedValue(new Error('范围已变化'))
    const { context, protection } = createProtection()
    context.isVaultBusy.value = true
    await protection.clearLegacyLibraryHistory()
    expect(native.confirm).not.toHaveBeenCalled()
    context.isVaultBusy.value = false
    await protection.clearLegacyLibraryHistory()
    expect(context.showNotice).toHaveBeenCalledWith('范围已变化')
    expect(protection.isClearingLegacyLibraryHistory.value).toBe(false)
    expect(protection.legacyLibraryHistory.value.records).toHaveLength(1)
    native.clearLegacy.mockResolvedValue(100)
    native.info.mockResolvedValue(null)
    native.health.mockResolvedValue({})
    await protection.clearLegacyLibraryHistory()
    expect(native.clearLegacy).toHaveBeenCalledTimes(2)
    expect(protection.legacyLibraryHistory.value.records).toHaveLength(0)
  })
  it('reserves conversion while confirmation is pending and releases it on cancellation', async () => {
    let resolve!: (confirmed: boolean) => void
    const confirmation = new Promise<boolean>((done) => {
      resolve = done
    })
    native.confirm.mockReturnValue(confirmation)
    const { context, protection } = createProtection()
    const first = protection.handleVaultEnable('test-password')
    const others = [
      protection.handleVaultDisable(),
      protection.handleVaultUnlock('test-password'),
      protection.handleVaultEnable('another-password'),
    ]
    const confirmCount = native.confirm.mock.calls.length
    const busy = context.isVaultBusy.value
    resolve(false)
    await Promise.all([first, ...others])
    expect(confirmCount).toBe(1)
    expect(busy).toBe(true)
    expect(native.unlock).not.toHaveBeenCalled()
    expect(native.enable).not.toHaveBeenCalled()
    expect(native.disable).not.toHaveBeenCalled()
    expect(context.isVaultBusy.value).toBe(false)
  })

  it('prevents disabling or locking until conversion and refresh finish', async () => {
    native.confirm.mockResolvedValue(true)
    let finish!: () => void
    native.enable.mockImplementation(
      () =>
        new Promise<void>((done) => {
          finish = done
        }),
    )
    const { context, protection } = createProtection()
    const first = protection.handleVaultEnable('test-password')
    await vi.waitFor(() => expect(native.enable).toHaveBeenCalledOnce())
    await protection.handleVaultDisable()
    protection.handleVaultLock()
    const busy = context.isVaultBusy.value
    finish()
    await first
    expect(native.disable).not.toHaveBeenCalled()
    expect(native.lock).not.toHaveBeenCalled()
    expect(busy).toBe(true)
    expect(native.migrate).toHaveBeenCalledExactlyOnceWith('encrypted')
    expect(context.isVaultBusy.value).toBe(false)
  })

  it('does not queue a second cache clear during confirmation', async () => {
    let resolve!: (confirmed: boolean) => void
    const confirmation = new Promise<boolean>((done) => {
      resolve = done
    })
    native.confirm.mockReturnValue(confirmation)
    const { context, protection } = createProtection()
    const first = protection.clearNativeTemporaryStorage()
    const second = protection.clearNativeTemporaryStorage()
    const count = native.confirm.mock.calls.length
    const busy = context.isClearingNativeCache.value
    resolve(false)
    await Promise.all([first, second])
    expect(count).toBe(1)
    expect(busy).toBe(true)
    expect(native.clear).not.toHaveBeenCalled()
    expect(context.isClearingNativeCache.value).toBe(false)
  })

  it('releases conversion state after failure and permits a later confirmed attempt', async () => {
    native.confirm.mockResolvedValue(true)
    native.enable.mockRejectedValueOnce(new Error('encrypt failed')).mockResolvedValue(undefined)
    const { context, protection } = createProtection()
    await protection.handleVaultEnable('test-password')
    expect(context.isVaultBusy.value).toBe(false)
    expect(context.showNotice).toHaveBeenCalledWith('encrypt failed')
    expect(native.migrate).not.toHaveBeenCalled()
    await protection.handleVaultEnable('test-password')
    expect(native.enable).toHaveBeenCalledTimes(2)
    expect(native.migrate).toHaveBeenCalledExactlyOnceWith('encrypted')
    expect(context.isVaultBusy.value).toBe(false)
  })
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

  it('opens the vault without reading an archive or changing encryption', () => {
    const { context, protection } = createProtection()
    protection.openVaultPanel()
    expect(context.isDataProtectionOpen.value).toBe(false)
    expect(context.isVaultPanelOpen.value).toBe(true)
    expect(native.enable).not.toHaveBeenCalled()
    expect(native.disable).not.toHaveBeenCalled()
  })

  it('enables encryption after confirmation and refreshes resources without an archive service', async () => {
    native.confirm.mockResolvedValue(true)
    const { context, protection } = createProtection()
    await protection.handleVaultEnable('test-password')
    expect(native.confirm).toHaveBeenCalledWith(
      expect.objectContaining({ title: '开启本地保险库', confirmLabel: '开启加密' }),
    )
    expect(native.enable).toHaveBeenCalledWith('test-password')
    expect(native.migrate).toHaveBeenCalledWith('encrypted')
    expect(context.loadResources).toHaveBeenCalledOnce()
    expect(context.loadRecycleBin).toHaveBeenCalledOnce()
    expect(context.showNotice).toHaveBeenCalledWith('本地数据已完成 AES-256-GCM 加密')
    expect(context.isVaultBusy.value).toBe(false)
  })

  it('keeps encryption unchanged when either conversion is cancelled', async () => {
    native.confirm.mockResolvedValue(false)
    const { protection } = createProtection()
    await protection.handleVaultEnable('test-password')
    await protection.handleVaultDisable()
    expect(native.enable).not.toHaveBeenCalled()
    expect(native.disable).not.toHaveBeenCalled()
    expect(native.migrate).not.toHaveBeenCalled()
  })

  it('disables encryption after confirmation and refreshes the decrypted library', async () => {
    native.confirm.mockResolvedValue(true)
    const { context, protection } = createProtection()
    await protection.handleVaultDisable()
    expect(native.disable).toHaveBeenCalledOnce()
    expect(native.migrate).toHaveBeenCalledWith('plain')
    expect(native.migrate.mock.invocationCallOrder[0]).toBeLessThan(
      native.disable.mock.invocationCallOrder[0]!,
    )
    expect(context.loadResources).toHaveBeenCalledOnce()
    expect(context.loadRecycleBin).toHaveBeenCalledOnce()
    expect(context.showNotice).toHaveBeenCalledWith('本地加密已关闭')
  })
})
