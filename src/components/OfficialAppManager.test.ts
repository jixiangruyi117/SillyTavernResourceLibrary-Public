/** @vitest-environment jsdom */
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import OfficialAppManager from './OfficialAppManager.vue'

const service = vi.hoisted(() => ({ list: vi.fn(), clearAppData: vi.fn(), uninstall: vi.fn() }))
vi.mock('../core/OfficialAppRuntime', () => ({ officialAppService: service }))
let wrapper: ReturnType<typeof mount>
beforeEach(() => {
  vi.resetAllMocks()
  service.list.mockResolvedValue([])
  service.clearAppData.mockResolvedValue(undefined)
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open')
  }
  wrapper = mount(OfficialAppManager, { attachTo: document.body })
})
afterEach(() => {
  wrapper.unmount()
  document.body.innerHTML = ''
})
async function openCleanup() {
  await flushPromises()
  const row = wrapper.findAll('li').find((row) => row.text().includes('前端了么'))!
  await row
    .findAll('button')
    .find((button) => button.text() === '清理数据')!
    .trigger('click')
  await flushPromises()
  return document.querySelector('dialog')!
}
it('opens a modal confirmation outside the list and cancel does not clear data', async () => {
  const dialog = await openCleanup()
  expect(dialog.parentElement).toBe(document.body)
  expect(dialog.open).toBe(true)
  expect(dialog.textContent).toContain('前端了么')
  expect(service.clearAppData).not.toHaveBeenCalled()
  dialog.querySelector<HTMLButtonElement>('button[type="button"]')!.click()
  await flushPromises()
  expect(document.querySelector('dialog')).toBeNull()
  expect(service.clearAppData).not.toHaveBeenCalled()
})
it('keeps busy and successful outcomes visible in the same dialog', async () => {
  let finish!: () => void
  service.clearAppData.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve
      }),
  )
  const dialog = await openCleanup()
  dialog.querySelector<HTMLButtonElement>('button[type="submit"]')!.click()
  await flushPromises()
  expect(dialog.querySelector('[role="status"]')?.textContent).toContain('正在清理')
  expect(dialog.querySelector('button[type="submit"]')?.hasAttribute('disabled')).toBe(true)
  finish()
  await flushPromises()
  expect(service.clearAppData).toHaveBeenCalledExactlyOnceWith('frontendWorkshop', false)
  expect(dialog.open).toBe(true)
  expect(dialog.querySelector('[role="status"]')?.textContent).toContain('已清理')
  expect(dialog.textContent).toContain('刷新页面')
})
it('shows the actual cleanup failure next to confirmation and allows retry', async () => {
  service.clearAppData.mockRejectedValueOnce(
    new Error('其他页面正在使用这个 APP，请关闭后再清理数据'),
  )
  const dialog = await openCleanup()
  dialog.querySelector<HTMLButtonElement>('button[type="submit"]')!.click()
  await flushPromises()
  expect(dialog.querySelector('[role="alert"]')?.textContent).toContain('其他页面正在使用')
  expect(dialog.querySelector('button[type="submit"]')?.hasAttribute('disabled')).toBe(false)
  expect(dialog.querySelector('[role="status"]')).toBeNull()
  dialog.querySelector<HTMLButtonElement>('button[type="submit"]')!.click()
  await flushPromises()
  expect(service.clearAppData).toHaveBeenCalledTimes(2)
  expect(dialog.querySelector('[role="status"]')?.textContent).toContain('已清理')
})
