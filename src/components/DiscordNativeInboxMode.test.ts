/** @vitest-environment jsdom */
import { mount, flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
const runtime = vi.hoisted(() => ({
  available: true,
  state: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
}))
vi.mock('../services/NativeDiscordInboxService', () => ({
  isNativeDiscordInboxAvailable: () => runtime.available,
  readNativeDiscordInboxState: runtime.state,
  startNativeDiscordInbox: runtime.start,
  stopNativeDiscordInbox: runtime.stop,
}))
import Mode from './DiscordNativeInboxMode.vue'
beforeEach(() => {
  vi.clearAllMocks()
  runtime.available = true
  runtime.state.mockResolvedValue(false)
  runtime.start.mockResolvedValue(undefined)
  runtime.stop.mockResolvedValue(undefined)
})
describe('receive mode control', () => {
  it('starts on user action and reflects notification stop without enabling again on mount', async () => {
    const wrapper = mount(Mode)
    try {
      await flushPromises()
      expect(runtime.start).not.toHaveBeenCalled()
      await wrapper.get('button').trigger('click')
      expect(runtime.start).toHaveBeenCalledOnce()
      window.dispatchEvent(new CustomEvent('srl:cloud-inbox-state', { detail: { running: true } }))
      expect(wrapper.get('button').attributes('aria-pressed')).toBe('false')
      await flushPromises()
      expect(wrapper.get('button').text()).toBe('停止收件')
      await wrapper.get('button').trigger('click')
      expect(runtime.stop).toHaveBeenCalledOnce()
      window.dispatchEvent(new CustomEvent('srl:cloud-inbox-state', { detail: { running: false } }))
      await flushPromises()
      expect(wrapper.get('button').text()).toBe('开启收件模式')
    } finally {
      wrapper.unmount()
    }
  })
  it('shows permission or old APK failures and releases the button for another attempt', async () => {
    runtime.start.mockRejectedValueOnce(new Error('请先允许系统通知'))
    const wrapper = mount(Mode)
    try {
      await flushPromises()
      await wrapper.get('button').trigger('click')
      await flushPromises()
      expect(wrapper.get('[role="alert"]').text()).toContain('系统通知')
      expect(wrapper.get('button').attributes('disabled')).toBeUndefined()
    } finally {
      wrapper.unmount()
    }
  })
  it('does not offer the native switch in iOS or browser', () => {
    runtime.available = false
    const wrapper = mount(Mode)
    expect(wrapper.find('button').exists()).toBe(false)
    wrapper.unmount()
  })
})
