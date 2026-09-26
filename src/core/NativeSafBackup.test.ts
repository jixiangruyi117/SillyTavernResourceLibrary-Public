import { beforeEach, expect, it, vi } from 'vitest'

const plugin = vi.hoisted(() => ({
  getStatus: vi.fn(),
  beginWrite: vi.fn(),
  appendWrite: vi.fn(),
  commitWrite: vi.fn(),
  abortWrite: vi.fn(),
}))
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => true, getPlatform: () => 'android' },
  registerPlugin: () => plugin,
}))
import { openNativeSafBackupWriter } from './NativeSafBackup'

beforeEach(() => {
  vi.resetAllMocks()
  plugin.getStatus.mockResolvedValue({ available: true })
  plugin.beginWrite.mockResolvedValue({ token: 'backup' })
  plugin.appendWrite.mockResolvedValue(undefined)
})

it('coalesces ZIP fragments across entries and flushes the tail before commit', async () => {
  const writer = (await openNativeSafBackupWriter('backup.zip'))!
  const input = Uint8Array.from({ length: 600 * 1024 + 13 }, (_, i) => i % 251)
  for (let offset = 0; offset < input.length; offset += 1024) {
    await writer.write(input.slice(offset, offset + 1024))
  }
  await writer.commit()
  expect(plugin.appendWrite).toHaveBeenCalledTimes(2)
  const bytes = plugin.appendWrite.mock.calls.flatMap(([{ data }]) =>
    Array.from(atob(data as string), (value) => value.charCodeAt(0)),
  )
  expect(new Uint8Array(bytes)).toEqual(input)
  expect(plugin.commitWrite).toHaveBeenCalledWith({ token: 'backup' })
})

it('propagates native write failure and leaves the temporary target abortable', async () => {
  plugin.appendWrite.mockRejectedValue(new Error('目标空间不足'))
  const writer = (await openNativeSafBackupWriter('backup.zip'))!
  await writer.write(new Uint8Array(100))
  await expect(writer.commit()).rejects.toThrow('目标空间不足')
  await writer.abort()
  expect(plugin.commitWrite).not.toHaveBeenCalled()
  expect(plugin.abortWrite).toHaveBeenCalledWith({ token: 'backup' })
})
