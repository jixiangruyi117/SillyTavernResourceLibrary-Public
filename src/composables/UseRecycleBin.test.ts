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
  const refreshResources = vi.fn(async () => {})
  const prepareResourceRefresh = vi.fn(() => refreshResources)
  const manager = useRecycleBin({
    isDataProtectionOpen: ref(true),
    prepareResourceRefresh,
    loadLibrary,
    refreshStorageHealth: vi.fn(async () => {}),
    showNotice: vi.fn(),
  })
  return { manager, loadLibrary, prepareResourceRefresh, refreshResources }
}

describe('recycle bin state ownership', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    api.list.mockResolvedValue([])
    api.sync.mockResolvedValue(undefined)
  })

  it('prepares the refresh before moving and reuses the complete committed catalogue', async () => {
    const { manager, prepareResourceRefresh, refreshResources } = setup()
    const record = { id: 'archive', resourceCount: 1 }
    const resources = [{ id: 'remaining' }]
    api.moveToRecycleBin.mockImplementation(async () => {
      expect(prepareResourceRefresh).toHaveBeenCalledOnce()
      return { record, resources }
    })
    await manager.moveResourcesToRecycleBin(['deleted'])
    expect(refreshResources).toHaveBeenCalledExactlyOnceWith(resources)
    expect(manager.recycleUndoEntry.value).toEqual(record)
    expect(api.list).toHaveBeenCalledOnce()
  })

  it('does not publish a catalogue or replace undo after an archive/delete failure', async () => {
    const { manager, refreshResources } = setup()
    api.moveToRecycleBin.mockRejectedValue(new Error('archive failed'))
    await expect(manager.moveResourcesToRecycleBin(['deleted'])).rejects.toThrow('archive failed')
    expect(refreshResources).not.toHaveBeenCalled()
    expect(manager.recycleUndoEntry.value).toBeUndefined()
    expect(api.list).not.toHaveBeenCalled()
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
