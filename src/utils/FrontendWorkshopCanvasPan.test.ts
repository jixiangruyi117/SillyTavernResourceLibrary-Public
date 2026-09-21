// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { installFrontendWorkshopCanvasPan } from './FrontendWorkshopCanvasPan'

afterEach(() => {
  vi.useRealTimers()
  document.body.innerHTML = ''
})
function pointer(target: Element, type: string, x = 10, y = 20) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y })
  Object.defineProperties(event, { pointerId: { value: 1 }, isPrimary: { value: true } })
  target.dispatchEvent(event)
}
describe('canvas hold gesture', () => {
  it('does not intercept short clicks; held drags suppress only their following click and clean up', async () => {
    vi.useFakeTimers()
    document.body.innerHTML = '<button>运行</button>'
    const button = document.querySelector('button')!
    const action = vi.fn()
    button.addEventListener('click', action)
    const publish = vi.fn()
    const dispose = installFrontendWorkshopCanvasPan(window, () => true, publish)
    pointer(button, 'pointerdown')
    pointer(button, 'pointerup')
    button.click()
    expect(action).toHaveBeenCalledOnce()
    expect(publish).not.toHaveBeenCalled()
    pointer(button, 'pointerdown')
    await vi.advanceTimersByTimeAsync(400)
    pointer(button, 'pointermove', 30, 40)
    pointer(button, 'pointerup')
    button.click()
    expect(publish.mock.calls.map((call) => call[0].phase)).toEqual(['start', 'move', 'end'])
    expect(action).toHaveBeenCalledOnce()
    pointer(button, 'pointerdown')
    dispose()
    await vi.advanceTimersByTimeAsync(500)
    expect(publish).toHaveBeenCalledTimes(3)
    button.click()
    expect(action).toHaveBeenCalledTimes(2)
  })
  it('leaves text fields and early scroll movement alone and honors disabled mode', async () => {
    vi.useFakeTimers()
    document.body.innerHTML = '<textarea></textarea><div>画布</div>'
    const publish = vi.fn()
    let enabled = true
    const dispose = installFrontendWorkshopCanvasPan(window, () => enabled, publish)
    pointer(document.querySelector('textarea')!, 'pointerdown')
    await vi.advanceTimersByTimeAsync(500)
    const surface = document.querySelector('div')!
    pointer(surface, 'pointerdown')
    pointer(surface, 'pointermove', 30, 40)
    await vi.advanceTimersByTimeAsync(500)
    enabled = false
    pointer(surface, 'pointerdown')
    await vi.advanceTimersByTimeAsync(500)
    expect(publish).not.toHaveBeenCalled()
    dispose()
  })
})
