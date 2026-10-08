/** @vitest-environment jsdom */
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, expect, it, vi } from 'vitest'
const api = vi.hoisted(() => ({ list: vi.fn(), remove: vi.fn(), bulk: vi.fn(), confirm: vi.fn() }))
vi.mock('../utils/ShareTargetIntake', () => ({
  listNativeIntakeFiles: api.list,
  removeNativeIntakeFile: api.remove,
  removeNativeIntakeReceipts: api.bulk,
}))
vi.mock('../composables/UseConfirmDialog', () => ({ confirmAction: api.confirm }))
import NativeIntakeFiles from './NativeIntakeFiles.vue'
import { taskCenter } from '../core/TaskCenter'
const file = {
  token: 'old',
  name: '旧附件.json',
  state: '待导入或待确认',
  bytes: 2048,
  modifiedAt: 1,
  fileCount: 2,
  snapshot: 'snapshot',
  protectedReason: '',
}
beforeEach(() => {
  vi.resetAllMocks()
  api.list.mockResolvedValue([file])
  api.remove.mockResolvedValue(2048)
})
it('lists without cleanup, protects active files and supports cancellation', async () => {
  api.list.mockResolvedValue([
    file,
    { ...file, token: 'busy', name: '下载中.json', protectedReason: '正在下载或导入' },
  ])
  const view = mount(NativeIntakeFiles)
  await flushPromises()
  expect(api.remove).not.toHaveBeenCalled()
  expect(view.get('[aria-label="清理 下载中.json"]').attributes('disabled')).toBeDefined()
  api.confirm.mockResolvedValue(false)
  await view.get('[aria-label="清理 旧附件.json"]').trigger('click')
  await flushPromises()
  expect(api.confirm.mock.calls[0]![0].message).toContain('将放弃这次导入')
  expect(api.remove).not.toHaveBeenCalled()
  view.unmount()
})

it('confirms only removable receipts and keeps cancellation read-only', async () => {
  const receipt = { ...file, token: 'receipt', receiptOnly: true, bytes: 13 }
  api.list.mockResolvedValue([
    receipt,
    file,
    { ...receipt, token: 'active', protectedReason: '正在使用' },
  ])
  const view = mount(NativeIntakeFiles)
  await flushPromises()
  api.confirm.mockResolvedValue(false)
  await view
    .findAll('button')
    .find((button) => button.text() === '一键清理已处理回执')!
    .trigger('click')
  await flushPromises()
  expect(api.confirm.mock.calls[0]![0].message).toContain('1 项已处理回执')
  expect(api.bulk).not.toHaveBeenCalled()
  api.confirm.mockResolvedValue(true)
  api.bulk.mockResolvedValue({ removedTokens: ['receipt'], removedBytes: 13, skipped: [] })
  api.list.mockResolvedValue([file])
  await view
    .findAll('button')
    .find((button) => button.text() === '一键清理已处理回执')!
    .trigger('click')
  await flushPromises()
  expect(api.bulk.mock.calls[0]![0]).toEqual([receipt])
  expect(view.emitted('changed')).toEqual([[2048]])
  expect(api.remove).not.toHaveBeenCalled()
  view.unmount()
})

it('pauses the owner at a batch boundary and resumes only through explicit task action', async () => {
  const receipt = { ...file, token: 'pause', receiptOnly: true, bytes: 13 }
  api.list.mockResolvedValue([receipt])
  api.confirm.mockResolvedValue(true)
  let finishBatch!: () => void
  const second = vi.fn()
  api.bulk.mockImplementation(async (_, control) => {
    await control.beforeBatch()
    await new Promise<void>((resolve) => {
      finishBatch = resolve
    })
    control.progress(1, { removedTokens: ['pause'], removedBytes: 13, skipped: [] })
    await control.beforeBatch()
    if (!control.signal.aborted) second()
    return { removedTokens: ['pause'], removedBytes: 13, skipped: [] }
  })
  const view = mount(NativeIntakeFiles)
  await flushPromises()
  await view
    .findAll('button')
    .find((button) => button.text() === '一键清理已处理回执')!
    .trigger('click')
  await flushPromises()
  const task = taskCenter.active().find((task) => task.name === '清理已处理回执')!
  await taskCenter.open(task.operationId)
  expect(task.phase).toContain('正在暂停')
  finishBatch()
  await flushPromises()
  expect(task.phase).toContain('已暂停')
  expect(second).not.toHaveBeenCalled()
  api.list.mockResolvedValue([])
  await taskCenter.open(task.operationId)
  await flushPromises()
  expect(second).toHaveBeenCalledOnce()
  expect(task.status).toBe('completed')
  expect(task.actionLabel).toBeUndefined()
  view.unmount()
  taskCenter.dismiss(task.operationId)
})

it('waits for an in-flight batch on stop and never restarts cleanup on reopening', async () => {
  api.list.mockResolvedValue([{ ...file, token: 'stop', receiptOnly: true }])
  api.confirm.mockResolvedValue(true)
  let finishBatch!: () => void
  const second = vi.fn()
  api.bulk.mockImplementation(async (_, control) => {
    await new Promise<void>((resolve) => {
      finishBatch = resolve
    })
    await control.beforeBatch()
    if (!control.signal.aborted) second()
    return { removedTokens: [], removedBytes: 0, skipped: [] }
  })
  const view = mount(NativeIntakeFiles)
  await flushPromises()
  await view
    .findAll('button')
    .find((button) => button.text() === '一键清理已处理回执')!
    .trigger('click')
  await flushPromises()
  const task = taskCenter.active().find((task) => task.name === '清理已处理回执')!
  expect(taskCenter.cancel(task.operationId)).toBe(true)
  expect(task.status).toBe('running')
  expect(task.phase).toContain('正在停止')
  finishBatch()
  await flushPromises()
  expect(task.status).toBe('cancelled')
  expect(second).not.toHaveBeenCalled()
  view.unmount()
  const reopened = mount(NativeIntakeFiles)
  await flushPromises()
  expect(api.bulk).toHaveBeenCalledOnce()
  reopened.unmount()
  taskCenter.dismiss(task.operationId)
})
it('confirms one entry and updates measured remaining bytes', async () => {
  const view = mount(NativeIntakeFiles)
  await flushPromises()
  api.confirm.mockResolvedValue(true)
  api.list.mockResolvedValue([])
  await view.get('[aria-label="清理 旧附件.json"]').trigger('click')
  await flushPromises()
  expect(api.remove).toHaveBeenCalledWith(file)
  expect(view.text()).toContain('没有接收暂存文件')
  expect(view.emitted('changed')).toEqual([[0]])
  view.unmount()
})
it('shows errors and re-reads partial cleanup instead of reporting success', async () => {
  const view = mount(NativeIntakeFiles)
  await flushPromises()
  api.confirm.mockResolvedValue(true)
  api.remove.mockRejectedValue(new Error('文件已变化'))
  await view.get('[aria-label="清理 旧附件.json"]').trigger('click')
  await flushPromises()
  expect(api.list).toHaveBeenCalledTimes(2)
  expect(view.text()).toContain('文件已变化')
  expect(view.text()).not.toContain('已清理')
  expect(view.get('[aria-label="清理 旧附件.json"]').attributes('disabled')).toBeUndefined()
  view.unmount()
})
it('pages large inventories in twenty visible rows', async () => {
  api.list.mockResolvedValue(
    Array.from({ length: 25 }, (_, index) => ({
      ...file,
      token: `${index}`,
      name: `附件${index}.json`,
    })),
  )
  const view = mount(NativeIntakeFiles)
  await flushPromises()
  expect(view.findAll('li')).toHaveLength(20)
  await view
    .findAll('button')
    .find((button) => button.text() === '下一页')!
    .trigger('click')
  expect(view.findAll('li')).toHaveLength(5)
  view.unmount()
})
