/** @vitest-environment jsdom */
import { mount } from '@vue/test-utils'
import { defineComponent, h, nextTick, ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { usePreviewBudget } from './UsePreviewBudget'

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('stateful reader background budget', () => {
  it.each([true, false])(
    'retains a short background visit only when requested: %s',
    async (retain) => {
      vi.useFakeTimers()
      let visibility: DocumentVisibilityState = 'visible'
      vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility)
      const wrapper = mount(
        defineComponent({
          setup() {
            const { previewEnabled } = usePreviewBudget(
              'test-reader',
              ref(true),
              undefined,
              () => retain,
            )
            return () => (previewEnabled.value ? h('iframe') : h('span'))
          },
        }),
      )
      try {
        await nextTick()
        const frame = wrapper.find('iframe').element
        visibility = 'hidden'
        document.dispatchEvent(new Event('visibilitychange'))
        await nextTick()
        expect(wrapper.find('iframe').exists()).toBe(retain)
        visibility = 'visible'
        document.dispatchEvent(new Event('visibilitychange'))
        await nextTick()
        if (retain) expect(wrapper.find('iframe').element).toBe(frame)
        else expect(wrapper.find('iframe').element).not.toBe(frame)
        visibility = 'hidden'
        document.dispatchEvent(new Event('visibilitychange'))
        await vi.advanceTimersByTimeAsync(30_000)
        expect(wrapper.find('iframe').exists()).toBe(false)
        visibility = 'visible'
        document.dispatchEvent(new Event('visibilitychange'))
        await nextTick()
        expect(wrapper.find('iframe').exists()).toBe(true)
      } finally {
        wrapper.unmount()
      }
    },
  )
})
