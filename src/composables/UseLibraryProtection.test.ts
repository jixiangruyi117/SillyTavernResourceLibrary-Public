import { ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const history = vi.hoisted(() => ({ list: vi.fn(), getSnapshotLimit: vi.fn() }))
vi.mock('../core/AppContainer', () => ({
  browserStorageService: {},
  communitySourceStorage: {},
  historyService: history,
  resourceService: {},
  vaultService: {},
}))

import { useLibraryProtection } from './UseLibraryProtection'

function createProtection() {
  const context = {
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
