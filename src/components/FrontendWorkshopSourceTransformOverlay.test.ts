// @vitest-environment jsdom
import { enableAutoUnmount, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'

import FrontendWorkshopSourceTransformOverlay from './FrontendWorkshopSourceTransformOverlay.vue'

enableAutoUnmount(afterEach)

describe('Source transform viewport coordinates', () => {
  it.each([0.5, 1, 1.5])('writes document deltas at %s viewport scale', (scale) => {
    const wrapper = mount(FrontendWorkshopSourceTransformOverlay, {
      props: {
        selection: {
          projectId: 'project',
          sourceRevision: 1,
          instanceId: 'instance',
          runtimeNonce: 'nonce',
          runtimeNodeId: 'element',
          treeScope: 'document',
          tagName: 'div',
          rect: { x: 0, y: 0, width: 100, height: 50 },
        },
        capabilities: { move: true, resize: true, scale: true, rotate: false },
      },
    })
    wrapper.element.getBoundingClientRect = () => new DOMRect(0, 0, 100 * scale, 50 * scale)
    wrapper.element.dispatchEvent(
      new PointerEvent('pointerdown', { pointerId: 1, clientX: 10, clientY: 10 }),
    )
    window.dispatchEvent(
      new PointerEvent('pointermove', {
        pointerId: 1,
        clientX: 10 + 20 * scale,
        clientY: 10 + 10 * scale,
      }),
    )
    window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1 }))
    expect(wrapper.emitted('commit')?.[0]?.[0]).toMatchObject({
      gesture: { mode: 'move', deltaX: 20, deltaY: 10 },
    })
    wrapper.unmount()
  })
})
