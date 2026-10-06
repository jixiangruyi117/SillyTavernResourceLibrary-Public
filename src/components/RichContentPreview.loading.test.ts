/** @vitest-environment jsdom */

import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const nativePreviewMocks = vi.hoisted(() => ({
  available: vi.fn(() => false),
  download: vi.fn(),
}))
const vendorMocks = vi.hoisted(() => ({
  load: vi.fn(async () => ({ jquery: '/* jquery */' })),
  merge: vi.fn(() => ({
    jquery: true,
    lodash: true,
    showdown: true,
    vue: true,
    yamlAndZod: true,
  })),
}))

vi.mock('../services/NativePreviewAsset', () => ({
  isNativePreviewAssetAvailable: nativePreviewMocks.available,
  downloadNativePreviewAsset: nativePreviewMocks.download,
}))
vi.mock('../utils/PreviewVendorLibs', () => ({
  loadPreviewVendorLibs: vendorMocks.load,
  loadedPreviewVendorNames: () => ['jquery'],
  mergePreviewVendorLibNeeds: vendorMocks.merge,
}))

import RichContentPreview from './RichContentPreview.vue'

enableAutoUnmount(afterEach)

describe('RichContentPreview opening transition loading', () => {
  beforeEach(() => {
    localStorage.setItem('srl.preview.allowRemoteResources', 'true')
    localStorage.setItem('srl.preview.allowScripts', 'true')
  })

  afterEach(() => {
    localStorage.clear()
    nativePreviewMocks.available.mockReturnValue(false)
    nativePreviewMocks.download.mockReset()
    vendorMocks.load.mockClear()
    vendorMocks.merge.mockClear()
    vi.unstubAllGlobals()
  })

  it('stable session 同步落地 B 后立即可见，同时继续完成异步 render lifecycle', async () => {
    const first = '```html\n<html><body><main>开场 A</main></body></html>\n```'
    const second = '```html\n<html><body><main>开场 B</main></body></html>\n```'
    const wrapper = mount(RichContentPreview, {
      props: {
        source: first,
        title: 'stable session loading',
        greetingContents: [first, second],
        greetingIndex: 0,
        runtimeScripts: [
          { id: 'lifecycle', name: 'lifecycle', content: 'void 0', source: 'character' },
        ],
        sourceKind: 'openingArchive',
        renderShell: 'content',
        immersive: true,
      },
    })
    await flushPromises()

    let swipeId = 0
    let mountedOpening = 'A'
    let resolveLifecycle: ((changed: boolean) => void) | undefined
    const transitionSwipe = vi.fn(
      (target: number) =>
        new Promise<boolean>((resolve) => {
          swipeId = target
          mountedOpening = target === 1 ? 'B' : 'A'
          resolveLifecycle = resolve
        }),
    )
    const emit = vi.fn(async () => undefined)
    const companionIdentity = { bootCount: 1 }
    const initialFrame = wrapper.find<HTMLIFrameElement>('iframe').element
    const initialContentWindow = {
      postMessage: vi.fn(),
      companionIdentity,
      __SRL_RENDER_COMPAT_HOST__: {
        events: { CHARACTER_MESSAGE_RENDERED: 'character_message_rendered' },
        transitionSwipe,
        emit,
        context: () => ({ chat: [{ swipe_id: swipeId }] }),
      },
    }
    Object.defineProperty(initialFrame, 'contentWindow', {
      configurable: true,
      value: initialContentWindow,
    })
    initialFrame.dispatchEvent(new Event('load'))
    await flushPromises()
    expect(wrapper.find('.rich-content-preview__loading').exists()).toBe(false)

    await wrapper.setProps({ source: second, greetingIndex: 1 })
    await wrapper.vm.$nextTick()

    expect(wrapper.find<HTMLIFrameElement>('iframe').element).toBe(initialFrame)
    expect(transitionSwipe).toHaveBeenCalledWith(1, false, expect.stringContaining('开场 B'))
    expect(swipeId).toBe(1)
    expect(mountedOpening).toBe('B')
    expect(initialContentWindow.companionIdentity).toBe(companionIdentity)
    expect(emit).not.toHaveBeenCalled()
    expect(wrapper.find('.rich-content-preview__loading').exists()).toBe(false)
    expect(initialFrame.classList.contains('is-loading')).toBe(false)

    resolveLifecycle?.(true)
    await flushPromises()
    await flushPromises()

    expect(emit).toHaveBeenCalledWith('character_message_rendered', [0])
    expect(wrapper.find('.rich-content-preview__loading').exists()).toBe(false)
    expect(wrapper.find<HTMLIFrameElement>('iframe').element).toBe(initialFrame)
  })
})
