/** @vitest-environment jsdom */
import { nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ResourceImageViewer from './ResourceImageViewer.vue'

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  )
})
afterEach(() => vi.unstubAllGlobals())

async function pointer(
  target: { element: Element },
  type: string,
  values: Record<string, unknown>,
) {
  const event = new Event(type, { bubbles: true, cancelable: true })
  for (const [key, value] of Object.entries(values)) Object.defineProperty(event, key, { value })
  target.element.dispatchEvent(event)
  await nextTick()
}

describe('image viewer touch controls', () => {
  it('closes once on touch release even without a compatibility click, while preserving keyboard clicks', async () => {
    const wrapper = mount(ResourceImageViewer, {
      props: { src: '/image.png', name: '图片', hasNext: true },
      global: { stubs: { teleport: true } },
    })
    const next = wrapper.get('[data-viewer-action="close"]')
    const touch = { pointerType: 'touch', isPrimary: true, pointerId: 1, clientX: 20, clientY: 20 }
    await pointer(next, 'pointerdown', touch)
    await pointer(next, 'pointerup', touch)
    expect(wrapper.emitted('close')).toHaveLength(1)
    await pointer(next, 'click', { detail: 1 })
    expect(wrapper.emitted('close')).toHaveLength(1)
    await pointer(next, 'click', { detail: 0 })
    expect(wrapper.emitted('close')).toHaveLength(2)
    wrapper.unmount()
  })
  it('does not close on a dragged/cancelled touch', async () => {
    const wrapper = mount(ResourceImageViewer, {
      props: { src: '/image.png', name: '图片', hasNext: true },
      global: { stubs: { teleport: true } },
    })
    const next = wrapper.get('[data-viewer-action="close"]')
    const touch = { pointerType: 'touch', isPrimary: true, pointerId: 1, clientX: 20, clientY: 20 }
    await pointer(next, 'pointerdown', touch)
    await pointer(next, 'pointermove', { ...touch, clientX: 40 })
    await pointer(next, 'pointerup', touch)
    await pointer(next, 'pointerdown', touch)
    await pointer(next, 'pointercancel', touch)
    await pointer(next, 'pointerup', touch)
    expect(wrapper.emitted('close')).toBeUndefined()
    wrapper.unmount()
  })
})
