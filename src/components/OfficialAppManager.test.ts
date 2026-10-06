/** @vitest-environment jsdom */
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import OfficialAppManager from './OfficialAppManager.vue'

const service = vi.hoisted(() => ({
  list: vi.fn(),
  availableUpdates: vi.fn(),
  install: vi.fn(),
  clearAppData: vi.fn(),
  uninstall: vi.fn(),
}))
vi.mock('../core/OfficialAppRuntime', () => ({ officialAppService: service }))
let wrapper: ReturnType<typeof mount>
beforeEach(() => {
  vi.resetAllMocks()
  service.list.mockResolvedValue([])
  service.availableUpdates.mockResolvedValue({})
  service.install.mockResolvedValue(undefined)
  service.clearAppData.mockResolvedValue(undefined)
  localStorage.clear()
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
it('opens APP guidance in a centered modal from the question-mark control', async () => {
  await flushPromises()
  expect(wrapper.find('.official-app-manager > p').exists()).toBe(false)
  await wrapper.get('[aria-label="查看 APP 管理说明"]').trigger('click')
  const help = document.querySelector<HTMLDialogElement>('#official-app-manager-help-dialog')!
  expect(help.open).toBe(true)
  expect(help.classList.contains('official-app-manager__dialog')).toBe(true)
  expect(help.textContent).toContain('程序按需下载')
  expect(help.textContent).toContain('原有数据保留')
  await help.querySelector<HTMLButtonElement>('button')!.click()
  expect(help.open).toBe(false)
})
async function openCleanup() {
  await flushPromises()
  const row = wrapper.findAll('li').find((row) => row.text().includes('前端了么'))!
  await row
    .findAll('button')
    .find((button) => button.text() === '清理数据')!
    .trigger('click')
  await flushPromises()
  return document.querySelector<HTMLDialogElement>(
    '.official-app-manager__dialog[aria-labelledby="official-app-action-title"]',
  )!
}
function remountManager() {
  wrapper.unmount()
  wrapper = mount(OfficialAppManager, { attachTo: document.body })
}
it('announces installed APP updates in a centered modal and leaves a red dot after skipping', async () => {
  service.list.mockResolvedValue([
    {
      id: 'draw',
      shellVersion: 'srl-0.0.126-v286',
      installedAt: 1,
      files: [],
      entry: '/assets/draw.js',
      styles: [],
    },
  ])
  service.availableUpdates.mockResolvedValue({
    draw: {
      currentVersion: '01234567',
      latestVersion: '89abcdef',
      latestShellVersion: 'srl-0.0.127-v287',
      requiresHostUpdate: false,
    },
  })
  remountManager()
  await flushPromises()
  const dialog = document.querySelector<HTMLDialogElement>('.official-app-manager__updates-dialog')!
  expect(dialog.open).toBe(true)
  expect(dialog.textContent).toContain('抽了么')
  expect(dialog.textContent).toContain('#01234567')
  expect(dialog.textContent).toContain('#89abcdef')
  expect(dialog.classList.contains('official-app-manager__dialog')).toBe(true)
  expect(wrapper.get('.official-app-manager__update-dot').attributes('aria-label')).toBe('有新版本')
  await dialog.querySelector<HTMLButtonElement>('button:not(.confirm-dialog__confirm)')!.click()
  await flushPromises()
  expect(dialog.open).toBe(false)
  expect(JSON.parse(localStorage.getItem('srl.officialApps.skippedUpdates.v1')!)).toEqual({
    draw: '89abcdef',
  })
  expect(wrapper.find('.official-app-manager__update-dot').exists()).toBe(true)
  remountManager()
  await flushPromises()
  expect(document.querySelector('.official-app-manager__updates-dialog')).toBeNull()
  expect(wrapper.find('.official-app-manager__update-dot').exists()).toBe(true)

  service.availableUpdates.mockResolvedValue({
    draw: {
      currentVersion: '01234567',
      latestVersion: '89abcdef',
      latestShellVersion: 'srl-0.0.128-v288',
      requiresHostUpdate: false,
    },
  })
  remountManager()
  await flushPromises()
  expect(document.querySelector('.official-app-manager__updates-dialog')).toBeNull()

  service.availableUpdates.mockResolvedValue({
    draw: {
      currentVersion: '01234567',
      latestVersion: 'abcdef12',
      latestShellVersion: 'srl-0.0.128-v288',
      requiresHostUpdate: false,
    },
  })
  remountManager()
  await flushPromises()
  expect(
    document.querySelector<HTMLDialogElement>('.official-app-manager__updates-dialog')!.open,
  ).toBe(true)
})
it('preserves legacy version skips across shell rebuilds without hiding necessary repairs', async () => {
  localStorage.setItem(
    'srl.officialApps.skippedUpdates.v1',
    JSON.stringify({ draw: '2@srl-0.0.127-v287' }),
  )
  service.availableUpdates.mockResolvedValue({
    draw: {
      currentVersion: '1',
      latestVersion: '2',
      latestShellVersion: 'srl-0.0.128-v288',
      requiresHostUpdate: false,
    },
  })
  remountManager()
  await flushPromises()
  expect(document.querySelector('.official-app-manager__updates-dialog')).toBeNull()
  service.availableUpdates.mockResolvedValue({
    draw: {
      currentVersion: '2',
      latestVersion: '2',
      latestShellVersion: 'srl-0.0.128-v288',
      requiresHostUpdate: false,
      requiresAssetRepair: true,
    },
  })
  remountManager()
  await flushPromises()
  const dialog = document.querySelector<HTMLDialogElement>('.official-app-manager__updates-dialog')!
  expect(dialog.open).toBe(true)
  expect(dialog.textContent).toContain('缺少运行资源')
})
it('updates only the selected APP from the version reminder', async () => {
  service.list
    .mockResolvedValueOnce([
      {
        id: 'draw',
        shellVersion: 'srl-0.0.126-v286',
        installedAt: 1,
        files: [],
        entry: '/assets/draw.js',
        styles: [],
      },
    ])
    .mockResolvedValue([
      {
        id: 'draw',
        shellVersion: 'srl-0.0.127-v287',
        installedAt: 2,
        files: [],
        entry: '/assets/draw.js',
        styles: [],
      },
    ])
  service.availableUpdates
    .mockResolvedValueOnce({
      draw: {
        currentVersion: '01234567',
        latestVersion: '89abcdef',
        latestShellVersion: 'srl-0.0.127-v287',
        requiresHostUpdate: false,
      },
    })
    .mockResolvedValue({})
  remountManager()
  await flushPromises()
  await document
    .querySelector<HTMLButtonElement>(
      '.official-app-manager__updates-dialog button.confirm-dialog__confirm',
    )!
    .click()
  await flushPromises()
  expect(service.install).toHaveBeenCalledExactlyOnceWith('draw')
  expect(wrapper.get('[role="status"]').text()).toContain('更新成功')
  expect(wrapper.find('.official-app-manager__update-dot').exists()).toBe(false)
  expect(wrapper.text()).toContain('已是最新')
})
it('opens a modal confirmation outside the list and cancel does not clear data', async () => {
  const dialog = await openCleanup()
  expect(dialog.parentElement).toBe(document.body)
  expect(dialog.open).toBe(true)
  expect(dialog.textContent).toContain('前端了么')
  expect(service.clearAppData).not.toHaveBeenCalled()
  dialog.querySelector<HTMLButtonElement>('button[type="button"]')!.click()
  await flushPromises()
  expect(
    document.querySelector(
      '.official-app-manager__dialog[aria-labelledby="official-app-action-title"]',
    ),
  ).toBeNull()
  expect(service.clearAppData).not.toHaveBeenCalled()
})
it('accepts only one installation before the busy buttons render', async () => {
  let finish!: () => void
  service.install.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve
      }),
  )
  await flushPromises()
  const buttons = wrapper.findAll('li button').filter((button) => button.text() === '下载')
  const first = buttons[0]!.element as HTMLButtonElement
  const second = buttons[1]!.element as HTMLButtonElement
  first.click()
  first.click()
  second.click()
  await flushPromises()
  expect(service.install).toHaveBeenCalledTimes(1)
  expect(second.disabled).toBe(true)
  finish()
  await flushPromises()
  expect(second.disabled).toBe(false)
  expect(wrapper.get('[role="status"]').text()).toContain('安装成功')
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
