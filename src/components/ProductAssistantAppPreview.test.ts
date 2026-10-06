/** @vitest-environment jsdom */
import { mount, flushPromises } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ExternalAppPreview } from '../types/ExternalApp'
import ProductAssistantAppPreview from './ProductAssistantAppPreview.vue'

afterEach(() => vi.unstubAllGlobals())
describe('chat APP preview lifecycle', () => {
  it('keeps the active trial port on receipt/installation updates, and disconnects only on source/fold/unmount', async () => {
    const port = { close: vi.fn(), start: vi.fn(), onmessage: null, postMessage: vi.fn() }
    vi.stubGlobal(
      'MessageChannel',
      class {
        port1 = port
        port2 = {}
      },
    )
    const summary = {
      id: 'test',
      name: '打卡',
      revision: 1,
      files: ['index.html'],
      previewRevision: 1,
    }
    const preview = {
      runtimeHtml: '<html>真实预览</html>',
      requestedPermissions: ['app.storage'],
    } as ExternalAppPreview
    const wrapper = mount(ProductAssistantAppPreview, {
      attachTo: document.body,
      props: { summary, preview, busy: false },
    })
    const frame = wrapper.get('iframe')
    vi.spyOn((frame.element as HTMLIFrameElement).contentWindow!, 'postMessage').mockImplementation(
      () => {},
    )
    await flushPromises()
    expect(port.start.mock.calls.length).toBeGreaterThan(0)
    const closed = port.close.mock.calls.length
    await wrapper.setProps({ summary: { ...summary } })
    await wrapper.setProps({ summary: { ...summary, installedRevision: 1 } })
    expect(port.close).toHaveBeenCalledTimes(closed)
    expect(wrapper.get('iframe').element).toBe(frame.element)
    expect(wrapper.get('.chat-app-preview__install').attributes('disabled')).toBeDefined()
    await wrapper.get('[aria-label="收起 APP 预览"]').trigger('click')
    expect(port.close).toHaveBeenCalledTimes(closed + 1)
    expect(wrapper.find('iframe').exists()).toBe(false)
    wrapper.unmount()
  })
})
