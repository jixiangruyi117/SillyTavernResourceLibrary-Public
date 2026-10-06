/** @vitest-environment jsdom */
import { mount, flushPromises } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ConfirmDialog from './ConfirmDialog.vue'
import { confirmAction, useConfirmDialogState } from '../composables/UseConfirmDialog'

afterEach(() => {
  useConfirmDialogState().respond('cancel')
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})
describe('token review in the shared confirmation', () => {
  it('opens the actual prompt from a pie sector, returns on Escape without resolving, then cancels', async () => {
    HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
      this.open = true
    })
    HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
      this.open = false
    })
    const wrapper = mount(ConfirmDialog, { attachTo: document.body })
    const resolved = vi.fn()
    const pending = confirmAction({
      title: '预计输入约 100 tokens',
      message: '原发送说明',
      tokenReview: {
        total: 100,
        model: '测试模型',
        destination: 'https://example.invalid/v1',
        parts: [
          {
            id: 'system',
            title: '系统提示',
            tokens: 70,
            content: '真实系统提示：<script>不是 HTML</script>',
          },
          { id: 'history', title: '聊天记录', tokens: 30, content: '用户：继续制作日记' },
        ],
      },
    }).then(resolved)
    await vi.waitFor(() => expect(document.querySelectorAll('path[role="button"]')).toHaveLength(2))
    expect(document.querySelector('details')).toBeNull()
    expect(document.body.textContent).not.toContain('发送范围')
    expect(
      document.querySelectorAll('path[role="button"]')[0]?.getAttribute('aria-label'),
    ).toContain('70.0%')
    ;(document.querySelector('path[role="button"]') as SVGElement).dispatchEvent(
      new MouseEvent('click', { bubbles: true }),
    )
    await flushPromises()
    expect(document.querySelector('pre')?.textContent).toBe(
      '真实系统提示：<script>不是 HTML</script>',
    )
    expect(document.querySelector('pre script')).toBeNull()
    expect(document.querySelector('footer')).toBeNull()
    expect(resolved).not.toHaveBeenCalled()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await flushPromises()
    expect(document.querySelector('pre')).toBeNull()
    expect(document.activeElement).toBe(document.querySelector('path[role="button"]'))
    expect(resolved).not.toHaveBeenCalled()
    const buttons = [...document.querySelectorAll('footer button')]
    ;(buttons[0] as HTMLButtonElement).click()
    await pending
    expect(resolved).toHaveBeenCalledWith(false)
    wrapper.unmount()
  })
})
