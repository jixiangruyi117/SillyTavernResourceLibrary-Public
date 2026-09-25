/** @vitest-environment jsdom */
import { flushPromises, mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { SRL_BACK_REQUEST_EVENT } from '../composables/UseBackStack'

const { getExternalApp } = vi.hoisted(() => ({ getExternalApp: vi.fn() }))

vi.mock('../core/AppContainer', () => ({
  externalAppService: {
    get: getExternalApp,
    recordLaunch: vi.fn(),
    recordHealthyLaunch: vi.fn(),
    recordRuntimeError: vi.fn(),
  },
  externalAppSdkService: {},
}))

import ExternalAppHost from './ExternalAppHost.vue'

describe('ExternalAppHost', () => {
  it('reveals the third-party exit after 1.5 seconds and cancels an interrupted hold', async () => {
    const hostPort = {
      postMessage: vi.fn(),
      start: vi.fn(),
      close: vi.fn(),
      onmessage: undefined as ((event: MessageEvent) => void) | undefined,
    }
    vi.stubGlobal(
      'MessageChannel',
      class {
        port1 = hostPort
        port2 = {}
      },
    )
    getExternalApp.mockResolvedValue({
      id: 'com.example.hold',
      enabled: true,
      runtimeHtml: '<html><body>hold</body></html>',
      manifest: { id: 'com.example.hold', name: '长按验证', version: '1.0.0', immersive: true },
    })
    const wrapper = mount(ExternalAppHost, { props: { appId: 'com.example.hold' } })
    try {
      await flushPromises()
      const iframe = document.body.querySelector('.external-app-host__frame') as HTMLIFrameElement
      const connectMessage = vi
        .spyOn(iframe.contentWindow!, 'postMessage')
        .mockImplementation(() => {})
      iframe.dispatchEvent(new Event('load'))
      await flushPromises()
      const nonce = (connectMessage.mock.calls[0]![0] as { nonce: string }).nonce
      const signal = (type: string) =>
        hostPort.onmessage!(new MessageEvent('message', { data: { type, nonce } }))
      vi.useFakeTimers()
      signal('srl:host-hold-start')
      await vi.advanceTimersByTimeAsync(1000)
      signal('srl:host-hold-end')
      await vi.advanceTimersByTimeAsync(1500)
      expect(wrapper.find('.external-app-host__exit-handle').exists()).toBe(false)
      signal('srl:host-hold-start')
      await vi.advanceTimersByTimeAsync(1499)
      expect(wrapper.find('.external-app-host__exit-handle').exists()).toBe(false)
      await vi.advanceTimersByTimeAsync(1)
      expect(wrapper.find('.external-app-host__exit-handle').exists()).toBe(true)
      signal('srl:host-hold-end')
      await vi.advanceTimersByTimeAsync(2999)
      expect(wrapper.find('.external-app-host__exit-handle').exists()).toBe(true)
      await wrapper.get('.external-app-host__exit-handle').trigger('click')
      expect(wrapper.emitted('back')).toHaveLength(1)
    } finally {
      wrapper.unmount()
      vi.useRealTimers()
      vi.unstubAllGlobals()
    }
  })
  it('uses the shared header for built-in lists and keeps reading navigation inside the app', async () => {
    const hostPort = {
      postMessage: vi.fn(),
      start: vi.fn(),
      close: vi.fn(),
      onmessage: undefined as ((event: MessageEvent) => void) | undefined,
    }
    vi.stubGlobal(
      'MessageChannel',
      class {
        port1 = hostPort
        port2 = {}
      },
    )
    getExternalApp.mockResolvedValue({
      id: 'com.srl.duleme',
      enabled: true,
      runtimeHtml: '<!doctype html><html><body>reader</body></html>',
      manifest: { id: 'com.srl.duleme', name: '读了么', version: '0.1.14', immersive: true },
    })
    const wrapper = mount(ExternalAppHost, { props: { appId: 'com.srl.duleme', official: true } })
    try {
      await flushPromises()
      const workspace = document.body.querySelector(
        '.external-app-host__workspace--builtin-reader',
      )!
      expect(workspace.querySelector('[data-srl-feature-header]')?.textContent).toContain('读了么')
      expect(workspace.querySelector('.external-app-host__runtime')).toBeNull()
      expect(workspace.querySelector('.external-app-host__immersive-hint')).toBeNull()
      const iframe = workspace.querySelector('iframe')!
      const connectMessage = vi
        .spyOn(iframe.contentWindow!, 'postMessage')
        .mockImplementation(() => {})
      iframe.dispatchEvent(new Event('load'))
      await flushPromises()
      const nonce = (connectMessage.mock.calls[0]![0] as { nonce: string }).nonce
      const navigate = async (page: string, sequence: number) => {
        hostPort.onmessage!(
          new MessageEvent('message', {
            data: {
              type: 'srl:request',
              nonce,
              sequence,
              id: String(sequence),
              method: 'ui.readerNavigation',
              payload: {
                page,
                cover: true,
                colors: { paper: '#202622', ink: '#d0d3c6', line: 'url(https://example.com)' },
              },
            },
          }),
        )
        await flushPromises()
      }
      await navigate('chats', 1)
      expect((workspace as HTMLElement).style.getPropertyValue('--color-canvas')).toBe('#202622')
      expect((workspace as HTMLElement).style.getPropertyValue('--color-ink')).toBe('#d0d3c6')
      expect((workspace as HTMLElement).style.getPropertyValue('--color-line')).toBe('')
      expect(workspace.querySelector('[data-srl-feature-header]')?.textContent).toContain(
        '聊天记录',
      )
      ;(workspace.querySelector('[aria-label="返回角色列表"]') as HTMLElement).click()
      expect(hostPort.postMessage).toHaveBeenCalledWith({
        type: 'srl:reader-action',
        nonce,
        action: 'back',
      })
      expect(wrapper.emitted('back')).toBeUndefined()
      await navigate('reader', 2)
      expect(workspace.querySelector('[data-srl-feature-header]')).toBeNull()
      expect(workspace.getAttribute('data-reader-page')).toBe('reader')
      const detail = { handled: false }
      window.dispatchEvent(new CustomEvent(SRL_BACK_REQUEST_EVENT, { detail }))
      expect(detail.handled).toBe(true)
      expect(document.body.classList.contains('external-app-fullscreen')).toBe(true)
      await navigate('roles', 3)
      hostPort.onmessage!(
        new MessageEvent('message', {
          data: { type: 'srl:request', nonce, sequence: 4, id: '4', method: 'ui.exitFullscreen' },
        }),
      )
      await flushPromises()
      expect(wrapper.emitted('back')).toHaveLength(1)
      await wrapper.setProps({ official: false })
      await navigate('reader', 5)
      expect(hostPort.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ id: '5', ok: false }),
      )
    } finally {
      wrapper.unmount()
      vi.unstubAllGlobals()
    }
  })

  it('renders an isolated workspace shell around an enabled app', async () => {
    const featureHubEscape = vi.fn()
    window.addEventListener('keydown', featureHubEscape)
    getExternalApp.mockResolvedValue({
      id: 'com.srl.example.counter',
      enabled: true,
      runtimeHtml: '<!doctype html><html><body>example</body></html>',
      installedAt: 1,
      updatedAt: 1,
      manifest: {
        schemaVersion: 1,
        id: 'com.srl.example.counter',
        name: '离线计数器',
        version: '1.0.0',
        entry: 'index.html',
      },
    })
    const wrapper = mount(ExternalAppHost, { props: { appId: 'com.srl.example.counter' } })
    await flushPromises()

    expect(wrapper.find('.external-app-host__status').exists()).toBe(false)
    expect(wrapper.get('.external-app-host__runtime').text()).toContain('独立工作区')
    expect(wrapper.get('.external-app-host__runtime').text()).toContain('本机 .srlapp · v1.0.0')
    expect(wrapper.get('.external-app-host__frame').attributes('sandbox')).toBe('allow-scripts')
    expect(wrapper.get('.external-app-host__workspace').attributes('style')).toContain(
      '--external-app-splash: #237f87',
    )

    await wrapper.get('.external-app-host__fullscreen-toggle').trigger('click')
    expect(wrapper.classes()).toContain('external-app-host--fullscreen')
    expect(wrapper.find('.feature-app-header').exists()).toBe(false)
    expect(document.body.querySelector('.external-app-host__workspace--immersive')).not.toBeNull()
    expect(wrapper.find('.external-app-host__fullscreen-exit').exists()).toBe(false)
    expect(wrapper.find('.external-app-host__immersive-hint').exists()).toBe(false)
    expect(wrapper.find('.external-app-host__exit-handle').exists()).toBe(false)
    expect(wrapper.find('.external-app-host__fullscreen-error').exists()).toBe(false)
    expect(document.body.classList.contains('external-app-fullscreen')).toBe(true)

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await new Promise((resolve) => window.setTimeout(resolve, 300))
    await nextTick()
    expect(featureHubEscape).not.toHaveBeenCalled()
    expect(wrapper.classes()).not.toContain('external-app-host--fullscreen')
    expect(document.body.classList.contains('external-app-fullscreen')).toBe(false)

    await wrapper.get('.external-app-host__fullscreen-toggle').trigger('click')
    const detail = { handled: false }
    window.dispatchEvent(new CustomEvent(SRL_BACK_REQUEST_EVENT, { detail }))
    await nextTick()
    expect(detail.handled).toBe(true)
    expect(wrapper.classes()).not.toContain('external-app-host--fullscreen')

    wrapper.unmount()
    window.removeEventListener('keydown', featureHubEscape)
    expect(document.body.classList.contains('external-app-fullscreen')).toBe(false)
  })
})
