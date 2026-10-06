import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ platform: 'android', native: true, available: true }))
const plugin = vi.hoisted(() => ({
  getStatus: vi.fn(),
  getRecord: vi.fn(),
  getRecords: vi.fn(),
  getRecordsByKeys: vi.fn(),
  putRecords: vi.fn(),
  applyBatch: vi.fn(),
  deleteRecords: vi.fn(),
  clearStore: vi.fn(),
  getState: vi.fn(),
  putState: vi.fn(),
  beginBlob: vi.fn(),
  appendBlob: vi.fn(),
  completeBlob: vi.fn(),
  readBlobChunk: vi.fn(),
  deleteBlob: vi.fn(),
}))

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => state.native,
    getPlatform: () => state.platform,
    isPluginAvailable: () => state.available,
  },
  registerPlugin: () => plugin,
}))

import { nativeAppDatabase } from './NativeAppDatabaseBridge'

function encodeBase64(value: string): string {
  return btoa(value)
}

describe('NativeAppDatabaseBridge', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.platform = 'android'
    state.native = true
    state.available = true
    plugin.beginBlob.mockResolvedValue({ token: 'token', offset: 0, alreadyStored: false })
    plugin.appendBlob.mockImplementation(async ({ offset, data }) => {
      const binary = atob(data)
      return { offset: offset + binary.length }
    })
    plugin.completeBlob.mockResolvedValue({
      sha256: 'a'.repeat(64),
      size: 3,
      mimeType: 'text/plain',
    })
  })

  it('streams a large Blob in bounded chunks and verifies native offsets', async () => {
    const blob = new Blob([new Uint8Array(1024 * 1024 + 7)], { type: 'application/octet-stream' })
    await expect(
      nativeAppDatabase.writeBlob('assetFiles', 'asset-1', 'blob', blob),
    ).resolves.toEqual({
      sha256: 'a'.repeat(64),
      size: 3,
      mimeType: 'text/plain',
    })
    expect(plugin.appendBlob).toHaveBeenCalledTimes(2)
    const chunks = plugin.appendBlob.mock.calls.map(([call]) => atob(call.data).length)
    expect(chunks).toEqual([1024 * 1024, 7])
    expect(plugin.completeBlob).toHaveBeenCalledWith({ token: 'token' })
  })

  it('resumes a partially staged Blob from the native byte offset', async () => {
    plugin.beginBlob.mockResolvedValue({
      token: 'resumable-token',
      offset: 2,
      alreadyStored: false,
    })
    plugin.completeBlob.mockResolvedValue({
      sha256: 'b'.repeat(64),
      size: 6,
      mimeType: 'text/plain',
    })
    await nativeAppDatabase.writeBlob('assetFiles', 'asset-2', 'blob', new Blob(['abcdef']))
    expect(plugin.appendBlob).toHaveBeenCalledTimes(1)
    expect(plugin.appendBlob).toHaveBeenCalledWith({
      token: 'resumable-token',
      offset: 2,
      data: encodeBase64('cdef'),
    })
  })

  it('persists migration checkpoints through native app state', async () => {
    plugin.getState.mockResolvedValue({ found: true, value: '{"copied":5}' })
    plugin.putState.mockResolvedValue(undefined)
    await nativeAppDatabase.putState('migration:resources', '{"copied":5}')
    await expect(nativeAppDatabase.getState('migration:resources')).resolves.toBe('{"copied":5}')
    expect(plugin.putState).toHaveBeenCalledWith({
      key: 'migration:resources',
      value: '{"copied":5}',
    })
  })

  it('exposes one native transaction for coordinated multi-table resource changes', async () => {
    plugin.applyBatch.mockResolvedValue({ applied: 2 })
    const operations = [
      {
        type: 'put' as const,
        store: 'resources' as const,
        rows: [{ key: '"r1"', value: { id: 'r1' } }],
      },
      { type: 'delete' as const, store: 'resourceListSummaries' as const, keys: ['"stale"'] },
    ]
    await expect(nativeAppDatabase.applyBatch(operations)).resolves.toBe(2)
    expect(plugin.applyBatch).toHaveBeenCalledWith({ operations })
  })

  it('reconstructs a Blob from native ranged reads and rejects PWA access', async () => {
    plugin.readBlobChunk.mockResolvedValue({
      found: true,
      blob: {
        mimeType: 'text/plain',
        size: 11,
        sha256: 'c'.repeat(64),
        offset: 0,
        data: encodeBase64('hello world'),
        eof: true,
      },
    })
    const restored = await nativeAppDatabase.readBlob('assetFiles', 'asset-1', 'blob')
    await expect(restored?.text()).resolves.toBe('hello world')

    state.native = false
    await expect(nativeAppDatabase.status()).rejects.toThrow('Android 原生数据库不可用')
    expect(plugin.getStatus).not.toHaveBeenCalled()
  })
})
