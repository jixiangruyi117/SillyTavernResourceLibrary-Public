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
