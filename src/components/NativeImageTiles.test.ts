/** @vitest-environment jsdom */
import { mount, flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const plugin = vi.hoisted(() => ({
  inspectImage: vi.fn(),
  readImageRegion: vi.fn(),
  releaseThumbnail: vi.fn(),
}))
vi.mock('@capacitor/core', () => ({
  Capacitor: { convertFileSrc: (uri: string) => uri },
  registerPlugin: () => plugin,
}))
import NativeImageTiles from './NativeImageTiles.vue'

beforeEach(() => {
  plugin.inspectImage.mockResolvedValue({ supported: true, width: 300, height: 12000 })
  plugin.readImageRegion.mockResolvedValue({ uri: 'file:///tile.webp' })
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    scale: vi.fn(),
    drawImage: vi.fn(),
  } as unknown as CanvasRenderingContext2D)
  vi.stubGlobal(
    'Image',
    class {
      onload?: () => void
      set src(_value: string) {
        queueMicrotask(() => this.onload?.())
      }
    },
  )
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.resetAllMocks()
  vi.unstubAllGlobals()
})

it('长图放大后只解码可见区域；滚动复用画布而不请求全图', async () => {
  const geometry = {
    viewportWidth: 400,
    viewportHeight: 800,
    width: 400,
    height: 16000,
    x: 0,
    y: 7600,
  }
  const wrapper = mount(NativeImageTiles, { props: { source: 'file:///long.png', geometry } })
  await flushPromises()
  expect(plugin.readImageRegion).toHaveBeenLastCalledWith(
    expect.objectContaining({ left: 0, top: 0, right: 300, bottom: 600 }),
  )
  expect(wrapper.emitted('dimensions')).toEqual([[300, 12000]])
  await wrapper.setProps({ geometry: { ...geometry, y: 0 } })
  await flushPromises()
  expect(plugin.readImageRegion).toHaveBeenLastCalledWith(
    expect.objectContaining({ top: 5700, bottom: 6300 }),
  )
  expect(wrapper.findAll('canvas')).toHaveLength(1)
  expect(plugin.releaseThumbnail).toHaveBeenCalledTimes(2)
  wrapper.unmount()
})

it('卸载时仍释放在途分块，不能回写已关闭的查看器', async () => {
  let resolve!: (value: { uri: string }) => void
  plugin.readImageRegion.mockReturnValue(
    new Promise((done) => {
      resolve = done
    }),
  )
  const wrapper = mount(NativeImageTiles, {
    props: {
      source: 'file:///long.png',
      geometry: { viewportWidth: 400, viewportHeight: 800, width: 20, height: 800, x: 0, y: 0 },
    },
  })
  await flushPromises()
  wrapper.unmount()
  resolve({ uri: 'file:///tile.webp' })
  await flushPromises()
  expect(plugin.releaseThumbnail).toHaveBeenCalledWith({ uri: 'file:///tile.webp' })
  expect(wrapper.emitted('loaded')).toBeUndefined()
})
