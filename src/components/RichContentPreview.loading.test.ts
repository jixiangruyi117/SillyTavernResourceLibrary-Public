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
import { browserStorageService } from '../core/AppContainer'

enableAutoUnmount(afterEach)

describe('RichContentPreview opening transition loading', () => {
  it('头像转换与兼容库准备并行，库尚未完成时已开始读取头像', async () => {
    let finish: ((value: { jquery: string }) => void) | undefined
    vendorMocks.load.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    const avatarRead = vi.spyOn(FileReader.prototype, 'readAsDataURL').mockImplementation(function (
      this: FileReader,
    ) {
      Object.defineProperty(this, 'result', { value: 'data:image/png;base64,AA==' })
      this.onload?.call(this, new ProgressEvent('load') as ProgressEvent<FileReader>)
    })
    const wrapper = mount(RichContentPreview, {
      props: {
        source: '正文',
        title: 'parallel avatar',
        charAvatar: new Blob(['avatar']),
        runtimeScripts: [
          { id: 'parallel', name: 'parallel', source: 'character', content: 'void 0' },
        ],
      },
    })
    try {
      await flushPromises()
      expect(vendorMocks.load).toHaveBeenCalled()
      expect(avatarRead).toHaveBeenCalledTimes(1)
      expect(wrapper.find('iframe').exists()).toBe(false)
      finish?.({ jquery: '/* jquery */' })
      await flushPromises()
      expect(wrapper.find('iframe').attributes('srcdoc')).toContain('data:image/png;base64,AA==')
    } finally {
      avatarRead.mockRestore()
    }
  })

  it('美化预加载设置变动不会重建开场白的正式 iframe', async () => {
    const wrapper = mount(RichContentPreview, {
      props: { source: '正文', title: 'policy isolation' },
    })
    await flushPromises()
    const frame = wrapper.find('iframe').element
    browserStorageService.setPreviewPolicy({
      ...browserStorageService.getPreviewPolicy(),
      preloadBeautificationResources: true,
    })
    await flushPromises()
    expect(wrapper.find('iframe').element).toBe(frame)
    browserStorageService.setPreviewPolicy({
      ...browserStorageService.getPreviewPolicy(),
      increaseDownloadConcurrency: true,
    })
    await flushPromises()
    expect(wrapper.find('iframe').element).toBe(frame)
    browserStorageService.setPreviewPolicy({
      ...browserStorageService.getPreviewPolicy(),
      allowRemoteResources: false,
      allowScripts: false,
    })
    await flushPromises()
    expect(wrapper.find('iframe').element).not.toBe(frame)
  })

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

  it.each([false, true])(
    'stable session 保留正文并等待当前图片（开场标题变化：%s）',
    async (rename) => {
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
      const previewDocument = document.implementation.createHTMLDocument('preview')
      Object.defineProperty(initialFrame, 'contentDocument', { value: previewDocument })
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

      await wrapper.setProps({
        source: second,
        greetingIndex: 1,
        ...(rename ? { title: '开场 B' } : {}),
      })
      await wrapper.vm.$nextTick()
      await flushPromises()

      expect(wrapper.find<HTMLIFrameElement>('iframe').element).toBe(initialFrame)
      expect(transitionSwipe).toHaveBeenCalledWith(1, false, expect.stringContaining('开场 B'))
      expect(swipeId).toBe(1)
      expect(mountedOpening).toBe('B')
      expect(initialContentWindow.companionIdentity).toBe(companionIdentity)
      expect(emit).not.toHaveBeenCalled()
      expect(wrapper.find('.rich-content-preview__loading').exists()).toBe(true)
      expect(wrapper.find('.rich-content-preview__frame').attributes('aria-busy')).toBe('true')

      const images = [previewDocument.createElement('img'), previewDocument.createElement('img')]
      for (const image of images) {
        Object.defineProperty(image, 'complete', { configurable: true, value: false })
        previewDocument.body.append(image)
      }

      resolveLifecycle?.(true)
      await flushPromises()
      await flushPromises()

      expect(emit).toHaveBeenCalledWith('character_message_rendered', [0])
      expect(wrapper.find('.rich-content-preview__loading').exists()).toBe(true)
      images[0].dispatchEvent(new Event('load'))
      await flushPromises()
      expect(wrapper.find('.rich-content-preview__loading').exists()).toBe(true)
      images[1].dispatchEvent(new Event('error'))
      await flushPromises()
      expect(wrapper.find('.rich-content-preview__loading').exists()).toBe(false)
      expect(wrapper.find('.rich-content-preview__frame').attributes('aria-busy')).toBe('false')
      expect(wrapper.find<HTMLIFrameElement>('iframe').element).toBe(initialFrame)
    },
  )

  it.each([false, true])('首屏仅等待可见图片，隐藏场景不阻塞（嵌套页面：%s）', async (nested) => {
    const wrapper = mount(RichContentPreview, {
      props: { source: '开场 A', title: 'visible media' },
    })
    await flushPromises()
    const frame = wrapper.find<HTMLIFrameElement>('iframe').element
    const previewDocument = document.implementation.createHTMLDocument('preview')
    Object.defineProperty(frame, 'contentDocument', { value: previewDocument })
    let content = previewDocument
    if (nested) {
      const child = previewDocument.createElement('iframe')
      child.srcdoc = '<p>首屏</p>'
      previewDocument.body.append(child)
      content = document.implementation.createHTMLDocument('child')
      Object.defineProperties(content, {
        URL: { value: 'about:srcdoc' },
        readyState: { value: 'interactive' },
      })
      Object.defineProperty(child, 'contentDocument', { value: content })
    }
    const currentImage = content.createElement('img')
    content.body.style.visibility = 'hidden'
    currentImage.style.visibility = 'visible'
    const futureImage = content.createElement('img')
    const futureScene = content.createElement('section')
    futureScene.style.display = 'none'
    futureScene.append(futureImage)
    for (const image of [currentImage, futureImage])
      Object.defineProperty(image, 'complete', { value: false })
    content.body.append(currentImage, futureScene)
    const futureListener = vi.spyOn(futureImage, 'addEventListener')
    // The existing layout message precedes load, which still waits for hidden assets.
    window.dispatchEvent(
      new MessageEvent('message', {
        source: frame.contentWindow,
        data: { type: 'SRL_PREVIEW_HEIGHT', height: 300 },
      }),
    )
    await flushPromises()
    expect(wrapper.find('.rich-content-preview__loading').exists()).toBe(true)
    expect(futureListener).not.toHaveBeenCalledWith('load', expect.any(Function), expect.anything())
    currentImage.dispatchEvent(new Event('load'))
    await flushPromises()
    expect(wrapper.find('.rich-content-preview__loading').exists()).toBe(false)
    frame.dispatchEvent(new Event('load'))
    await flushPromises()
    expect(wrapper.find('.rich-content-preview__loading').exists()).toBe(false)
  })

  it('首个文档加载完成前保留提示，旧 iframe 的迟到 load 不结束新预览', async () => {
    const wrapper = mount(RichContentPreview, {
      props: { source: '开场 A', title: 'initial load' },
    })
    await flushPromises()
    const oldFrame = wrapper.find<HTMLIFrameElement>('iframe').element
    expect(wrapper.find('.rich-content-preview__loading').exists()).toBe(true)
    await wrapper.setProps({ source: '开场 B' })
    await flushPromises()
    const currentFrame = wrapper.find<HTMLIFrameElement>('iframe').element
    expect(currentFrame).not.toBe(oldFrame)
    oldFrame.dispatchEvent(new Event('load'))
    await flushPromises()
    expect(wrapper.find('.rich-content-preview__loading').exists()).toBe(true)
    currentFrame.dispatchEvent(new Event('load'))
    await flushPromises()
    expect(wrapper.find('.rich-content-preview__loading').exists()).toBe(false)
  })

  it('快速 B→C 切换取消旧图片等待，迟到 B 不收起 C 的提示', async () => {
    const greetings = ['A', 'B', 'C'].map(
      (label) => '```html\n<html><body>开场 ' + label + '</body></html>\n```',
    )
    const wrapper = mount(RichContentPreview, {
      props: { source: greetings[0], title: 'rapid swipe', greetingContents: greetings },
    })
    await flushPromises()
    const frame = wrapper.find<HTMLIFrameElement>('iframe').element
    const previewDocument = document.implementation.createHTMLDocument('preview')
    Object.defineProperty(frame, 'contentDocument', { value: previewDocument })
    let swipeId = 0
    const pictures: HTMLImageElement[] = []
    Object.defineProperty(frame, 'contentWindow', {
      configurable: true,
      value: {
        postMessage: vi.fn(),
        __SRL_RENDER_COMPAT_HOST__: {
          events: { CHARACTER_MESSAGE_RENDERED: 'character_message_rendered' },
          transitionSwipe: vi.fn(async (target: number) => {
            swipeId = target
            previewDocument.body.replaceChildren()
            const image = previewDocument.createElement('img')
            Object.defineProperty(image, 'complete', { value: false })
            pictures.push(image)
            previewDocument.body.append(image)
            return true
          }),
          emit: vi.fn(async () => undefined),
          context: () => ({ chat: [{ swipe_id: swipeId }] }),
        },
      },
    })
    frame.dispatchEvent(new Event('load'))
    await wrapper.setProps({ source: greetings[1], greetingIndex: 1 })
    await flushPromises()
    expect(wrapper.find('.rich-content-preview__loading').exists()).toBe(true)
    const removeOldListener = vi.spyOn(pictures[0], 'removeEventListener')
    await wrapper.setProps({ source: greetings[2], greetingIndex: 2 })
    await flushPromises()
    expect(removeOldListener).toHaveBeenCalledWith('load', expect.any(Function))
    pictures[0].dispatchEvent(new Event('load'))
    await flushPromises()
    expect(wrapper.find('.rich-content-preview__loading').exists()).toBe(true)
    pictures[1].dispatchEvent(new Event('load'))
    await flushPromises()
    expect(wrapper.find('.rich-content-preview__loading').exists()).toBe(false)
    expect(wrapper.find<HTMLIFrameElement>('iframe').element).toBe(frame)
  })
})
