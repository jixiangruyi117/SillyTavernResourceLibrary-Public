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

it('returns resource decisions to the app while retaining the restore destination for backup choices', async () => {
  const service = await import('./NativeImportKeepAlive')
  await service.notifyNativeImportAwaitingChoice('资源需要确认', '选择历史版本', 'resume')
  expect(plugin.notifyAwaitingChoice).toHaveBeenLastCalledWith({
    title: '资源需要确认',
    message: '选择历史版本',
    destination: 'resume',
  })
  await service.notifyNativeImportAwaitingChoice('备份预检', '选择恢复方式')
  expect(plugin.notifyAwaitingChoice).toHaveBeenLastCalledWith({
    title: '备份预检',
    message: '选择恢复方式',
    destination: 'restore',
  })
})

it('keeps a nested restore alive until both task owners release it', async () => {
  const service = await import('./NativeImportKeepAlive')
  expect(await service.startNativeImportKeepAlive('分享导入', '分类')).toBe(true)
  expect(await service.startNativeImportKeepAlive('备份预检', '校验', 'resume')).toBe(true)
  expect(plugin.start).toHaveBeenLastCalledWith({
    title: '备份预检',
    phase: '校验',
    destination: 'resume',
  })
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
