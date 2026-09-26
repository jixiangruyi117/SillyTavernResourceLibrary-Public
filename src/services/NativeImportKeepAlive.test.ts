import { beforeEach, expect, it, vi } from 'vitest'

const plugin = vi.hoisted(() => ({
  start: vi.fn(),
  stop: vi.fn(),
  update: vi.fn(),
  notifyAwaitingChoice: vi.fn(),
}))
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => true, getPlatform: () => 'android' },
  registerPlugin: () => plugin,
}))

beforeEach(() => {
  vi.resetModules()
  vi.resetAllMocks()
})

it('keeps a nested restore alive until both task owners release it', async () => {
  const service = await import('./NativeImportKeepAlive')
  expect(await service.startNativeImportKeepAlive('分享导入', '分类')).toBe(true)
  expect(await service.startNativeImportKeepAlive('备份预检', '校验')).toBe(true)
  const result = { title: '完成', message: '完成', successful: true }
  await service.stopNativeImportKeepAlive(result)
  expect(plugin.stop).not.toHaveBeenCalled()
  await service.stopNativeImportKeepAlive(result)
  expect(plugin.stop).toHaveBeenCalledTimes(1)
  service.updateNativeImportKeepAlive('完成', '结束', 1)
  expect(plugin.update).not.toHaveBeenCalled()
})

it('does not retain a lease when the OS rejects the start', async () => {
  plugin.start.mockRejectedValue(new Error('not allowed'))
  const service = await import('./NativeImportKeepAlive')
  expect(await service.startNativeImportKeepAlive('导出', '写入')).toBe(false)
  await service.stopNativeImportKeepAlive({ title: '', message: '', successful: false })
  expect(plugin.stop).not.toHaveBeenCalled()
})
