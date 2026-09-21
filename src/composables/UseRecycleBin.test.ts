/** @vitest-environment jsdom */
import { ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({
  restore: vi.fn(),
  purge: vi.fn(),
  empty: vi.fn(),
  list: vi.fn(),
  moveToRecycleBin: vi.fn(),
  confirm: vi.fn(),
  sync: vi.fn(),
}))
vi.mock('../core/AppContainer', () => ({
  recycleBinService: api,
  syncNativeResourceFiles: api.sync,
}))
vi.mock('./UseConfirmDialog', () => ({ confirmAction: api.confirm }))
import { useRecycleBin } from './UseRecycleBin'

function setup() {
  const loadLibrary = vi.fn(async () => {})
  const manager = useRecycleBin({
    isDataProtectionOpen: ref(true),
    loadResources: vi.fn(async () => {}),
    loadLibrary,
    refreshStorageHealth: vi.fn(async () => {}),
    showNotice: vi.fn(),
  })
  return { manager, loadLibrary }
}

describe('recycle bin state ownership', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    api.list.mockResolvedValue([])
    api.sync.mockResolvedValue(undefined)
  })

  it('does not delete when the existing confirmation is declined', async () => {
    api.confirm.mockResolvedValue(false)
    await setup().manager.handlePurgeRecycleBinEntry('entry')
    expect(api.purge).not.toHaveBeenCalled()
  })

  it('does not refresh or synchronize files after a failed restore', async () => {
    api.restore.mockRejectedValue(new Error('restore failed'))
    const { manager, loadLibrary } = setup()
    await manager.handleRestoreRecycleBinEntry('entry')
    expect(loadLibrary).not.toHaveBeenCalled()
    expect(api.sync).not.toHaveBeenCalled()
    expect(manager.isRecycleBinBusy.value).toBe(false)
  })

  it('refreshes committed resources and releases busy state after success', async () => {
    const { manager, loadLibrary } = setup()
    await manager.handleRestoreRecycleBinEntry('entry')
    expect(api.restore).toHaveBeenCalledWith('entry')
    expect(loadLibrary).toHaveBeenCalledOnce()
    expect(api.sync).toHaveBeenCalledOnce()
    expect(manager.isRecycleBinBusy.value).toBe(false)
  })
})
