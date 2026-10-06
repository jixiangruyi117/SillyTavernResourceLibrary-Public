/** @vitest-environment jsdom */
import { mount } from '@vue/test-utils'
import { defineComponent, h, nextTick, ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useGalleryImageGestures } from './UseGalleryImageGestures'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
function fixture() {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      private callback: () => void
      constructor(callback: () => void) {
        this.callback = callback
      }
      observe() {
        this.callback()
      }
      disconnect() {}
    },
  )
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(300)
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(400)
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    left: 0,
    top: 0,
    width: 300,
    height: 400,
  } as DOMRect)
  let gesture!: ReturnType<typeof useGalleryImageGestures>
  const src = ref('one'),
    turn = vi.fn()
  const wrapper = mount(
    defineComponent({
      setup() {
        const stage = ref<HTMLElement>()
        gesture = useGalleryImageGestures(stage, () => src.value, turn)
        return () => h('div', { ref: stage })
      },
    }),
  )
  Object.assign(wrapper.element, { setPointerCapture: vi.fn() })
  gesture.loaded({ target: { naturalWidth: 300, naturalHeight: 400 } } as unknown as Event)
  return { gesture, wrapper, src, turn }
}
const pointer = (id: number, x: number, y: number, timeStamp = 500) =>
  ({ pointerId: id, clientX: x, clientY: y, pointerType: 'touch', timeStamp }) as PointerEvent
describe('gallery image gestures', () => {
  it('zooms around the touch point, clamps panning, and resets for the next image', async () => {
    const { gesture: g, wrapper, src } = fixture()
    g.zoom(2, { x: 50, y: 40 })
    expect(g.style.value.transform).toBe('translate(-50px, -40px) scale(2)')
    g.down(pointer(1, 150, 200))
    g.move(pointer(1, 2000, 2000))
    g.up(pointer(1, 2000, 2000))
    expect(g.style.value.transform).toBe('translate(150px, 200px) scale(2)')
    src.value = 'two'
    await nextTick()
    expect(g.scale.value).toBe(1)
    expect(g.ready.value).toBe(false)
    wrapper.unmount()
  })
  it('pinches without turning and allows the remaining finger to pan after one finger lifts', () => {
    const { gesture: g, wrapper, turn } = fixture()
    g.down(pointer(1, 120, 200))
    g.down(pointer(2, 180, 200))
    g.move(pointer(1, 90, 200))
    g.move(pointer(2, 210, 200))
    expect(g.scale.value).toBeCloseTo(2)
    g.up(pointer(2, 210, 200))
    g.lost(pointer(2, 210, 200))
    const before = g.style.value.transform
    g.move(pointer(1, 100, 240))
    g.up(pointer(1, 100, 240))
    expect(g.style.value.transform).not.toBe(before)
    expect(turn).not.toHaveBeenCalled()
    wrapper.unmount()
  })
  it('turns only when fitted; cancellation and vertical drags never turn pages', () => {
    const { gesture: g, wrapper, turn } = fixture()
    g.down(pointer(1, 240, 200))
    g.up(pointer(1, 60, 200))
    expect(turn).toHaveBeenCalledWith(1)
    turn.mockClear()
    g.down(pointer(1, 240, 200))
    g.cancel()
    g.up(pointer(1, 60, 200))
    g.down(pointer(1, 150, 100))
    g.up(pointer(1, 150, 350))
    g.zoom(2)
    g.down(pointer(1, 240, 200))
    g.move(pointer(1, 60, 200))
    g.up(pointer(1, 60, 200))
    expect(turn).not.toHaveBeenCalled()
    wrapper.unmount()
  })
})
