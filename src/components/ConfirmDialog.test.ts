/** @vitest-environment jsdom */
import { flushPromises, mount } from '@vue/test-utils'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import { chooseAction, confirmAction, useConfirmDialogState } from '../composables/UseConfirmDialog'
import ConfirmDialog from './ConfirmDialog.vue'

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.setAttribute('open', '')
  })
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.removeAttribute('open')
  })
})
// Teleport 会把对话框挪到 body 下，组件包装器查不到，统一走 document 查询。
function dialogButtons(): HTMLButtonElement[] {
  return Array.from(document.querySelectorAll<HTMLButtonElement>('.confirm-dialog button'))
}

function confirmButton(): HTMLButtonElement | undefined {
  return dialogButtons().find((button) => button.classList.contains('confirm-dialog__confirm'))
}

function cancelButton(): HTMLButtonElement | undefined {
  return dialogButtons().find((button) => !button.classList.contains('confirm-dialog__confirm'))
}

async function drain(): Promise<void> {
  // 清掉可能残留的对话框，避免用例间互相影响
  const { activeDialog, respond } = useConfirmDialogState()
  for (let i = 0; i < 10 && activeDialog.value; i += 1) {
    respond('cancel')
    await flushPromises()
  }
}

describe('ConfirmDialog + confirmAction', () => {
  it('keeps keyboard focus inside confirmation and restores the opener after cancelling', async () => {
    await drain()
    const opener = document.createElement('button')
    document.body.append(opener)
    opener.focus()
    const wrapper = mount(ConfirmDialog, { attachTo: document.body })
    const pending = confirmAction({ message: '清除数据', danger: true })
    await flushPromises()
    expect(document.activeElement).toBe(cancelButton())
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, cancelable: true }),
    )
    expect(document.activeElement).toBe(confirmButton())
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', cancelable: true }))
    expect(document.activeElement).toBe(cancelButton())
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }))
    await expect(pending).resolves.toBe(false)
    await flushPromises()
    expect(document.activeElement).toBe(opener)
    wrapper.unmount()
    opener.remove()
  })
  it('确认按钮 resolve(true)，附带标题与正文，危险操作有红色样式', async () => {
    await drain()
    const wrapper = mount(ConfirmDialog, { attachTo: document.body })
    const pending = confirmAction({ title: '删除资源', message: '确定删除吗？', danger: true })
    await flushPromises()

    expect(document.body.textContent).toContain('删除资源')
    expect(document.body.textContent).toContain('确定删除吗？')
    const confirm = confirmButton()
    expect(confirm?.classList.contains('confirm-dialog__confirm--danger')).toBe(true)
    confirm?.click()
    expect(await pending).toBe(true)
    await flushPromises()
    expect(document.querySelector('.confirm-dialog')).toBeNull()
    wrapper.unmount()
  })

  it('取消按钮与 Esc 都 resolve(false)', async () => {
    await drain()
    const wrapper = mount(ConfirmDialog, { attachTo: document.body })

    const first = confirmAction({ message: '第一问' })
    await flushPromises()
    cancelButton()?.click()
    expect(await first).toBe(false)

    const second = confirmAction({ message: '第二问' })
    await flushPromises()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(await second).toBe(false)
    wrapper.unmount()
  })

  it('并发请求排队，一次只显示一个', async () => {
    await drain()
    const wrapper = mount(ConfirmDialog, { attachTo: document.body })
    const first = confirmAction({ message: '排队一' })
    const second = confirmAction({ message: '排队二' })
    await flushPromises()

    expect(document.body.textContent).toContain('排队一')
    expect(document.body.textContent).not.toContain('排队二')

    confirmButton()?.click()
    expect(await first).toBe(true)
    await flushPromises()
    expect(document.body.textContent).toContain('排队二')

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(await second).toBe(false)
    wrapper.unmount()
  })

  it('opens a native modal above existing dialogs and consumes back as cancel', async () => {
    await drain()
    const parent = document.createElement('dialog')
    parent.setAttribute('open', '')
    document.body.appendChild(parent)
    const wrapper = mount(ConfirmDialog, { attachTo: document.body })
    const pending = confirmAction({ message: '确认正文', danger: true })
    await flushPromises()
    expect(document.querySelector('dialog.confirm-dialog__overlay')?.hasAttribute('open')).toBe(
      true,
    )
    expect(document.activeElement).toBe(cancelButton())
    const detail = { handled: false }
    window.dispatchEvent(new CustomEvent('srl:back-request', { detail }))
    expect(detail.handled).toBe(true)
    expect(await pending).toBe(false)
    expect(parent.hasAttribute('open')).toBe(true)
    parent.remove()
    wrapper.unmount()
  })
  it('presents a request made before the renderer mounts', async () => {
    await drain()
    const pending = confirmAction({ message: '挂载前已请求确认' })
    const wrapper = mount(ConfirmDialog, { attachTo: document.body })
    await flushPromises()
    expect(document.querySelector('dialog.confirm-dialog__overlay')?.hasAttribute('open')).toBe(
      true,
    )
    cancelButton()?.click()
    expect(await pending).toBe(false)
    wrapper.unmount()
  })
  it('默认文案为「请确认 / 确认 / 取消」', async () => {
    await drain()
    const wrapper = mount(ConfirmDialog, { attachTo: document.body })
    const pending = confirmAction({ message: '仅正文' })
    await flushPromises()
    expect(document.body.textContent).toContain('请确认')
    const labels = dialogButtons().map((button) => button.textContent?.trim())
    expect(labels).toContain('确认')
    expect(labels).toContain('取消')
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await pending
    wrapper.unmount()
  })

  it('centered 选项在移动端仍保持屏幕中央弹窗', async () => {
    await drain()
    const wrapper = mount(ConfirmDialog, { attachTo: document.body })
    const pending = confirmAction({ message: '中央确认', centered: true })
    await flushPromises()

    expect(
      document.querySelector('.confirm-dialog__overlay')?.classList.contains('is-centered'),
    ).toBe(true)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await expect(pending).resolves.toBe(false)
    wrapper.unmount()
  })

  it('第三个明确选项会返回 alternative，不会与取消混淆', async () => {
    await drain()
    const wrapper = mount(ConfirmDialog, { attachTo: document.body })
    const pending = chooseAction({
      message: '发现新版本',
      confirmLabel: '更新',
      cancelLabel: '稍后提醒',
      alternativeLabel: '不更新当前版本',
    })
    await flushPromises()

    const alternative = dialogButtons().find(
      (button) => button.textContent?.trim() === '不更新当前版本',
    )
    alternative?.click()
    await expect(pending).resolves.toBe('alternative')
    wrapper.unmount()
  })
})
