/** @vitest-environment jsdom */

import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../core/NativeHaptics', () => ({ triggerNativeHaptic: vi.fn() }))

import ProjectNoticeDialog from './ProjectNoticeDialog.vue'

function makeScrollable(element: HTMLElement): void {
  Object.defineProperty(element, 'scrollHeight', { configurable: true, value: 1200 })
  Object.defineProperty(element, 'clientHeight', { configurable: true, value: 400 })
  element.scrollTop = 0
  element.dispatchEvent(new Event('scroll'))
}

describe('ProjectNoticeDialog', () => {
  afterEach(() => {
    vi.useRealTimers()
    document.body.innerHTML = ''
  })

  it('requires both five seconds and reaching the bottom before acknowledgement', async () => {
    vi.useFakeTimers()
    const wrapper = mount(ProjectNoticeDialog, {
      attachTo: document.body,
      props: { open: true },
    })
    await flushPromises()

    const body = document.querySelector<HTMLElement>('.project-notice__body')!
    const button = document.querySelector<HTMLButtonElement>('.project-notice__footer button')!
    makeScrollable(body)
    await flushPromises()

    expect(button.disabled).toBe(true)
    expect(button.textContent).toContain('5 秒')

    vi.advanceTimersByTime(5_000)
    await flushPromises()
    expect(button.disabled).toBe(true)
    expect(button.textContent).toContain('滑至底部')

    body.scrollTop = 800
    body.dispatchEvent(new Event('scroll'))
    await flushPromises()
    expect(button.disabled).toBe(false)
    expect(button.textContent).toContain('我已阅读')

    button.click()
    expect(wrapper.emitted('acknowledged')).toHaveLength(1)
    wrapper.unmount()
  })

  it('does not unlock early when the reader reaches the bottom before five seconds', async () => {
    vi.useFakeTimers()
    const wrapper = mount(ProjectNoticeDialog, {
      attachTo: document.body,
      props: { open: true },
    })
    await flushPromises()

    const body = document.querySelector<HTMLElement>('.project-notice__body')!
    const button = document.querySelector<HTMLButtonElement>('.project-notice__footer button')!
    makeScrollable(body)
    body.scrollTop = 800
    body.dispatchEvent(new Event('scroll'))
    await flushPromises()

    expect(button.disabled).toBe(true)

    vi.advanceTimersByTime(4_000)
    await flushPromises()
    expect(button.disabled).toBe(true)
    expect(button.textContent).toContain('1 秒')

    vi.advanceTimersByTime(1_000)
    await flushPromises()
    expect(button.disabled).toBe(false)
    wrapper.unmount()
  })

  it('does not allow Escape or the overlay to dismiss a required first-reading notice', async () => {
    vi.useFakeTimers()
    const wrapper = mount(ProjectNoticeDialog, {
      attachTo: document.body,
      props: { open: true },
    })
    await flushPromises()

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }))
    document.querySelector<HTMLElement>('.project-notice__overlay')?.click()
    expect(wrapper.emitted('acknowledged')).toBeUndefined()
    expect(document.querySelector('.project-notice')).not.toBeNull()
    wrapper.unmount()
  })

  it('关闭状态不吞掉工作台的 Escape 返回事件', async () => {
    const wrapper = mount(ProjectNoticeDialog, {
      attachTo: document.body,
      props: { open: false },
    })
    await flushPromises()
    const event = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true })

    window.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(false)
    wrapper.unmount()
  })

  it('shows data, source and responsibility notices without the old public repository reference', () => {
    const wrapper = mount(ProjectNoticeDialog, {
      attachTo: document.body,
      props: { open: true },
    })

    expect(document.body.textContent).toContain('数据与隐私')
    expect(document.body.textContent).toContain('源码与费用')
    expect(document.body.textContent).toContain('使用责任')
    expect(document.body.textContent).toContain('本项目源码不收取购买费')
    expect(document.body.textContent).not.toContain('SillyTavernResourceLibrary-Public')
    expect(document.body.textContent).not.toContain('功能现状')
    wrapper.unmount()
  })
})
