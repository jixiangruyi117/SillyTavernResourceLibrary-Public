/** @vitest-environment jsdom */
import { flushPromises, mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { SRL_BACK_REQUEST_EVENT } from '../composables/UseBackStack'

const { getExternalApp, requireCustomTool, getData } = vi.hoisted(() => ({
  getExternalApp: vi.fn(),
  requireCustomTool: vi.fn(),
  getData: vi.fn(),
}))

vi.mock('../core/AppContainer', () => ({
  externalAppService: {
    get: getExternalApp,
    requireCustomTool,
    getData,
    recordLaunch: vi.fn(),
    recordHealthyLaunch: vi.fn(),
    recordRuntimeError: vi.fn(),
  },
  externalAppSdkService: {},
}))

import ExternalAppHost from './ExternalAppHost.vue'

describe('ExternalAppHost', () => {
  it('invokes registered tools over the same isolated runtime, narrows SDK permissions and rechecks the installed fingerprint after completion', async () => {
    const descriptor = {
      id: 'com.example.tools/note',
      appId: 'com.example.tools',
      name: 'note',
      title: '工具',
      appName: '工具 APP',
      available: true,
      version: '1.0.0',
      apiVersion: 'srl-app-tools@1',
      fingerprint: 'current',
      description: '权限核对',
      permissions: [] as import('../types/ExternalApp').ExternalAppPermission[],
      parameters: {
        type: 'object' as const,
        properties: {},
        required: [],
        additionalProperties: false as const,
      },
    }
    requireCustomTool.mockResolvedValue(descriptor)
    getData.mockResolvedValue('PRIVATE_APP_VALUE')
    getExternalApp.mockResolvedValue({
      id: descriptor.appId,
      enabled: true,
      runtimeHtml: '<html>工具</html>',
      packageFingerprint: 'current',
      manifest: { id: descriptor.appId, name: '工具 APP', version: '1.0.0', tools: [descriptor] },
    })
    const port = {
      postMessage: vi.fn(),
      start: vi.fn(),
      close: vi.fn(),
      onmessage: undefined as ((event: MessageEvent) => void) | undefined,
    }
    vi.stubGlobal(
      'MessageChannel',
      class {
        port1 = port
        port2 = {}
      },
    )
    const wrapper = mount(ExternalAppHost, {
      props: { appId: descriptor.appId, assistantTool: descriptor },
      attachTo: document.body,
    })
    try {
      await flushPromises()
      const iframe = wrapper.get('iframe').element as HTMLIFrameElement
      const post = vi.spyOn(iframe.contentWindow!, 'postMessage').mockImplementation(() => {})
      iframe.dispatchEvent(new Event('load'))
      await flushPromises()
      const nonce = (post.mock.calls[0]![0] as { nonce: string }).nonce
      const send = (data: Record<string, unknown>) =>
        port.onmessage!(new MessageEvent('message', { data: { ...data, nonce } }))
      const pending = wrapper.vm.invokeTool(descriptor, '{}', new AbortController().signal)
      await flushPromises()
      send({ type: 'srl:tools-ready', names: ['note'] })
      const call = port.postMessage.mock.calls.find(([data]) => data.type === 'srl:tool-call')![0]
      send({
        type: 'srl:request',
        id: 'sdk',
        sequence: 1,
        method: 'storage.get',
        payload: { key: 'private' },
      })
      await flushPromises()
      expect(port.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'sdk', ok: false, error: expect.stringContaining('超出') }),
      )
      expect(getData).not.toHaveBeenCalled()
      send({ type: 'srl:tool-result', id: call.id, ok: true, result: '{"blocked":true}' })
      await expect(pending).resolves.toEqual({ blocked: true })
      expect(requireCustomTool).toHaveBeenLastCalledWith(descriptor.id, 'current')
      expect(wrapper.get('iframe').attributes('sandbox')).toBe('allow-scripts')
      expect(wrapper.get('[data-srl-feature-header]').classes()).toContain(
        'feature-app-header--panel',
      )
      expect(wrapper.find('[aria-label="全屏预览"]').exists()).toBe(false)
    } finally {
      wrapper.unmount()
      wrapper.element.remove()
      vi.unstubAllGlobals()
    }
  })
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
