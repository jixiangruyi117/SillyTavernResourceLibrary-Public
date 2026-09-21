/** @vitest-environment jsdom */

import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { previewBudget } from '../core/PreviewBudget'

const nativePreviewMocks = vi.hoisted(() => ({
  available: vi.fn(() => false),
  download: vi.fn(),
}))
const vendorMocks = vi.hoisted(() => ({
  load: vi.fn(async () => ({ jquery: '/* jquery */' })),
  merge: vi.fn((sources: Iterable<string>) => {
    const source = Array.from(sources).join('\n')
    return {
      fontAwesome: /fa-(?:solid|star)/.test(source),
      jquery: true,
      jqueryUi: /\.draggable\s*\(/.test(source),
      lodash: true,
      showdown: true,
      tailwind: /class=["'][^"']*flex/.test(source),
      toastr: /\btoastr\b/.test(source),
      vue: true,
      vueRouter: /\bVueRouter\b/.test(source),
      yamlAndZod: true,
    }
  }),
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

function readFrameDocument(wrapper: ReturnType<typeof mount>): string {
  return wrapper.find<HTMLIFrameElement>('iframe').attributes('srcdoc') ?? ''
}

function parsePreviewDocument(source: string): Document {
  return new DOMParser().parseFromString(source, 'text/html')
}

function readMountedFrontendDocument(source: string): string {
  const outer = parsePreviewDocument(source)
  return (
    outer
      .querySelector('[data-srl-preview-message-content] div.TH-render > iframe')
      ?.getAttribute('srcdoc') ?? ''
  )
}

function readInitialHostContext(source: string): {
  formattedGreetings?: string[]
  greetingIndex?: number
} {
  const outer = parsePreviewDocument(source)
  const runtime = Array.from(outer.scripts)
    .map((script) => script.textContent ?? '')
    .find((script) => script.includes('__SRL_RENDER_COMPAT_HOST__'))
  const match = runtime?.match(/const context=(\{.*?\});const tavernEvents=/s)
  if (!match) return {}
  return JSON.parse(match[1]) as { formattedGreetings?: string[]; greetingIndex?: number }
}

function readInitialHostGreetingIndex(source: string): number | undefined {
  return readInitialHostContext(source).greetingIndex
}

describe('RichContentPreview', () => {
  beforeEach(() => {
    localStorage.setItem('srl.preview.allowRemoteResources', 'true')
    localStorage.setItem('srl.preview.allowScripts', 'false')
  })

  afterEach(() => {
    localStorage.clear()
    nativePreviewMocks.available.mockReturnValue(false)
    nativePreviewMocks.download.mockReset()
    vendorMocks.load.mockClear()
    vendorMocks.merge.mockClear()
    vi.unstubAllGlobals()
    delete (window as Window & { __SRL_PREVIEW_PERFORMANCE_AUDIT__?: (event: unknown) => void })
      .__SRL_PREVIEW_PERFORMANCE_AUDIT__
    delete document.documentElement.dataset.theme
  })

  it('只展示酒馆消息结果，不自行增加音频控制器或状态说明', async () => {
    const wrapper = mount(RichContentPreview, {
      props: {
        source:
          '<audio preload="auto" src="https://example.com/bgm.mp3" autoplay controls loop style="display:none;"></audio>',
        title: '背景音乐',
      },
    })
    await flushPromises()

    const frameDocument = readFrameDocument(wrapper)
    const iframe = wrapper.find<HTMLIFrameElement>('iframe')
    expect(frameDocument).toContain('style="display:none;"')
    expect(iframe.attributes('src')).toBeUndefined()
    expect(iframe.attributes('srcdoc')).toBe(frameDocument)
    expect(frameDocument).not.toContain('data:text/html')
    expect(wrapper.find('.rich-content-preview__audio-status').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('这是纯背景音乐页面')
  })

  it('CSS 形状正文按 SillyTavern Markdown 输出，不显示资源库分类文案', async () => {
    const wrapper = mount(RichContentPreview, {
      props: {
        source: '她在纸上写下：\n\n.status-card { color: red; }\n\n然后把纸折好。',
        title: '正文',
        immersive: true,
      },
    })
    await flushPromises()

    const frameDocument = readFrameDocument(wrapper)
    expect(frameDocument).toContain('<p>.status-card { color: red; }</p>')
    expect(frameDocument).not.toContain('<style>.status-card')
    expect(wrapper.text()).not.toContain('未识别为 CSS')
    expect(wrapper.text()).not.toContain('普通正文')
  })

  it('title 变化会使 canonical seed revision 失效并重建 builder document', async () => {
    const wrapper = mount(RichContentPreview, {
      props: { source: '<p>正文</p>', title: '旧标题' },
    })
    await flushPromises()
    const initialFrame = wrapper.find<HTMLIFrameElement>('iframe').element
    expect(initialFrame.getAttribute('srcdoc')).toContain('<title>旧标题</title>')

    await wrapper.setProps({ title: '新标题' })
    await flushPromises()

    const rebuiltFrame = wrapper.find<HTMLIFrameElement>('iframe').element
    expect(rebuiltFrame).not.toBe(initialFrame)
    expect(rebuiltFrame.getAttribute('srcdoc')).toContain('<title>新标题</title>')
  })

  it('普通 CSS 围栏仍是 Markdown code，不会应用为样式', async () => {
    const wrapper = mount(RichContentPreview, {
      props: {
        source: '```css\n.status-card { color: red; }\n```',
        title: '正文',
      },
    })
    await flushPromises()

    const frameDocument = readFrameDocument(wrapper)
    expect(frameDocument).toContain('<pre>')
    expect(frameDocument).toContain('.status-card { color: red; }')
    expect(frameDocument).not.toContain('<style>.status-card')
  })

  it('按酒馆第 0 条消息顺序替换名字与 pick 宏', async () => {
    const wrapper = mount(RichContentPreview, {
      props: {
        source: '你好，{{user}}。我是 {{char}}。{{pick::甲::乙}}',
        title: '主开场',
        macroCharName: '林默',
        macroUserName: '顾黎',
      },
    })
    await flushPromises()

    const frameDocument = readFrameDocument(wrapper)
    expect(frameDocument).toMatch(/你好，顾黎。我是 林默。(甲|乙)/)
    expect(frameDocument).not.toContain('{{pick::')
  })

  it.each([false, true])('普通与沉浸预览均采用完整实测高度 immersive=%s', async (immersive) => {
    const wrapper = mount(RichContentPreview, {
      props: {
        source: '长开场白',
        title: '主开场',
        immersive,
      },
    })
    await flushPromises()

    const iframe = wrapper.find<HTMLIFrameElement>('iframe').element
    const contentWindow = { postMessage: vi.fn() }
    Object.defineProperty(iframe, 'contentWindow', {
      configurable: true,
      value: contentWindow,
    })
    expect(iframe.style.height).toBe('')

    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'SRL_PREVIEW_HEIGHT', height: 13244 },
        source: contentWindow as unknown as Window,
      }),
    )
    await wrapper.vm.$nextTick()

    expect(iframe.style.height).toBe('13244px')
  })

  it('窄屏完整缩放宽画布时按缩放后的实测高度显示，不裁切长内容', async () => {
    const wrapper = mount(RichContentPreview, {
      props: {
        source: '长开场白',
        title: '720 宽度开场白',
        immersive: true,
        viewportWidth: 720,
        scale: 0.5,
      },
    })
    await flushPromises()

    const iframe = wrapper.find<HTMLIFrameElement>('iframe').element
    const contentWindow = { postMessage: vi.fn() }
    Object.defineProperty(iframe, 'contentWindow', {
      configurable: true,
      value: contentWindow,
    })
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'SRL_PREVIEW_HEIGHT', height: 1840 },
        source: contentWindow as unknown as Window,
      }),
    )
    await wrapper.vm.$nextTick()

    expect(iframe.style.width).toBe('720px')
    expect(iframe.style.height).toBe('1840px')
    expect(iframe.style.transform).toBe('scale(0.5)')
    expect((wrapper.get('.rich-content-preview__frame').element as HTMLElement).style.height).toBe(
      '920px',
    )
  })

  it('bare 开场白预览保留效果与原文切换，但不增加解析说明', async () => {
    const wrapper = mount(RichContentPreview, {
      props: {
        source: '开场白正文。',
        title: '主开场',
        immersive: true,
        bare: true,
        renderShell: 'content',
        sourceKind: 'openingArchive',
      },
    })
    await flushPromises()

    expect(wrapper.find('.rich-content-preview__toolbar').exists()).toBe(true)
    expect(wrapper.find('iframe').exists()).toBe(true)
    expect(wrapper.text()).toContain('效果预览')
    expect(wrapper.text()).toContain('阅读原文')
    expect(wrapper.text()).not.toContain('未识别为 CSS')
  })

  it('开场白检测到折叠内容后提供展开与收起控制', async () => {
    const wrapper = mount(RichContentPreview, {
      props: {
        source: '<details><summary>标题</summary>正文</details>',
        title: '主开场',
        immersive: true,
        bare: true,
        renderShell: 'content',
        sourceKind: 'openingArchive',
      },
    })
    await flushPromises()

    const iframe = wrapper.find<HTMLIFrameElement>('iframe').element
    const postMessage = vi.fn()
    const contentWindow = { postMessage }
    Object.defineProperty(iframe, 'contentWindow', {
      configurable: true,
      value: contentWindow,
    })
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'SRL_PREVIEW_DETAILS_STATE', total: 1, open: 0 },
        source: contentWindow as unknown as Window,
      }),
    )
    await wrapper.vm.$nextTick()

    const toggle = wrapper.get('button[aria-pressed="false"]')
    expect(toggle.text()).toBe('展开折叠')
    postMessage.mockClear()
    await toggle.trigger('click')
    expect(postMessage).toHaveBeenCalledWith({ type: 'SRL_SET_DETAILS_OPEN', open: true }, '*')

    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'SRL_PREVIEW_DETAILS_STATE', total: 1, open: 1 },
        source: contentWindow as unknown as Window,
      }),
    )
    await wrapper.vm.$nextTick()
    expect(wrapper.get('button[aria-pressed="true"]').text()).toBe('收起折叠')
  })

  it('开场白预览会在主题切换后重建为当前主题的文字颜色', async () => {
    const wrapper = mount(RichContentPreview, {
      props: {
        source: '开场白正文。',
        title: '主开场',
        renderShell: 'content',
        sourceKind: 'openingArchive',
      },
    })
    await flushPromises()
    expect(readFrameDocument(wrapper)).toContain('--SmartThemeBodyColor:#1f2925')

    document.documentElement.dataset.theme = 'dark'
    await flushPromises()

    expect(readFrameDocument(wrapper)).toContain('--SmartThemeBodyColor:#edf0e8')
  })

  it('网页端保留原始外链直显，不因 CORS 受限的预下载延迟开场白', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    vi.stubGlobal('fetch', fetchMock)
    const wrapper = mount(RichContentPreview, {
      props: {
        source: '<img src="https://cdn.example/cover.png">',
        title: '主开场',
        immersive: true,
        bare: true,
        renderShell: 'content',
        sourceKind: 'openingArchive',
        preloadResources: true,
      },
    })
    await flushPromises()

    expect(wrapper.find('iframe').exists()).toBe(true)
    expect(readFrameDocument(wrapper)).toContain('https://cdn.example/cover.png')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('在最终预览文档载入前显示加载条，载入后自动隐藏', async () => {
    const wrapper = mount(RichContentPreview, {
      props: { source: '开场白正文。', title: '主开场' },
    })
    await flushPromises()

    expect(wrapper.find('.rich-content-preview__loading').exists()).toBe(true)
    await wrapper.find('iframe').trigger('load')

    expect(wrapper.find('.rich-content-preview__loading').exists()).toBe(false)
  })

  it('Android 原生缓存预热不会阻塞原始外链预览', async () => {
    nativePreviewMocks.available.mockReturnValue(true)
    let resolveDownload:
      | ((result: {
          resourceUrl: string
          resolvedUrl: string
          contentType: string
          size: number
          cached: boolean
        }) => void)
      | undefined
    nativePreviewMocks.download.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveDownload = resolve
        }),
    )
    const wrapper = mount(RichContentPreview, {
      props: {
        source: '<img src="https://files.catbox.moe/cover.png">',
        title: '主开场',
        immersive: true,
        bare: true,
        renderShell: 'content',
        sourceKind: 'openingArchive',
        preloadResources: true,
      },
    })
    await vi.waitFor(() => expect(nativePreviewMocks.download).toHaveBeenCalledOnce())

    expect(wrapper.find('iframe').exists()).toBe(true)
    expect(readFrameDocument(wrapper)).toContain('https://files.catbox.moe/cover.png')

    wrapper.unmount()
    resolveDownload?.({
      resourceUrl: 'https://app.example/cache/cover.png',
      resolvedUrl: 'https://files.catbox.moe/cover.png',
      contentType: 'image/png',
      size: 5,
      cached: false,
    })
  })

  it('Android 普通外链在正式文档载入后命中缓存也不重启 iframe', async () => {
    nativePreviewMocks.available.mockReturnValue(true)
    let resolveDownload:
      | ((result: {
          resourceUrl: string
          resolvedUrl: string
          contentType: string
          size: number
          cached: boolean
        }) => void)
      | undefined
    nativePreviewMocks.download.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveDownload = resolve
        }),
    )
    const wrapper = mount(RichContentPreview, {
      props: {
        source: '<img src="https://files.catbox.moe/cover.png">',
        title: '主开场',
        immersive: true,
        bare: true,
        renderShell: 'content',
        sourceKind: 'openingArchive',
        preloadResources: true,
      },
    })
    await vi.waitFor(() => expect(nativePreviewMocks.download).toHaveBeenCalledOnce())
    await flushPromises()

    const initialFrame = wrapper.find<HTMLIFrameElement>('iframe').element
    const initialDocument = readFrameDocument(wrapper)
    await wrapper.find('iframe').trigger('load')

    resolveDownload?.({
      resourceUrl: 'https://app.example/cache/cover.png',
      resolvedUrl: 'https://files.catbox.moe/cover.png',
      contentType: 'image/png',
      size: 5,
      cached: false,
    })
    await flushPromises()

    expect(wrapper.find<HTMLIFrameElement>('iframe').element).toBe(initialFrame)
    expect(readFrameDocument(wrapper)).toBe(initialDocument)
  })

  it('网页端切换开场白仍保持外链直显，不创建预下载请求', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const wrapper = mount(RichContentPreview, {
      props: {
        source: '<img src="https://cdn.example/cover.png">',
        title: '主开场',
        immersive: true,
        bare: true,
        renderShell: 'content',
        sourceKind: 'openingArchive',
        preloadResources: true,
      },
    })
    await wrapper.setProps({ source: '下一条开场白' })
    await flushPromises()

    expect(fetchMock).not.toHaveBeenCalled()
    expect(wrapper.find('iframe').exists()).toBe(true)
  })

  it('把手机主窗口高度下发给酒馆助手前端块', async () => {
    const wrapper = mount(RichContentPreview, {
      props: {
        source: '```html\n<body><div style="min-height:100vh">前端</div></body>\n```',
        title: '主开场',
        immersive: true,
        bare: true,
        renderShell: 'content',
        sourceKind: 'openingArchive',
      },
    })
    await flushPromises()

    const iframe = wrapper.find<HTMLIFrameElement>('iframe').element
    const postMessage = vi.fn()
    Object.defineProperty(iframe, 'contentWindow', {
      configurable: true,
      value: { postMessage },
    })
    iframe.dispatchEvent(new Event('load'))

    expect(postMessage).toHaveBeenCalledWith(
      { type: 'SRL_HOST_VIEWPORT_HEIGHT', height: window.innerHeight },
      '*',
    )
  })

  it('Trusted 普通 Markdown 不加载 compatibility vendor chunks', async () => {
    localStorage.setItem('srl.preview.allowScripts', 'true')
    mount(RichContentPreview, {
      props: { source: '**普通正文**', title: '正文' },
    })
    await flushPromises()

    expect(vendorMocks.load).not.toHaveBeenCalled()
  })

  it('仅在 Trusted frontend/script 会话加载本地 compatibility vendors', async () => {
    localStorage.setItem('srl.preview.allowScripts', 'true')
    mount(RichContentPreview, {
      props: {
        source:
          '```html\n<html><body><div class="flex"><i class="fa-solid fa-star"></i></div></body></html>\n```',
        title: '状态栏',
      },
    })
    await flushPromises()

    expect(vendorMocks.load).toHaveBeenCalledOnce()
    expect(vendorMocks.load).toHaveBeenCalledWith(
      expect.objectContaining({
        fontAwesome: true,
        jqueryUi: false,
        lodash: true,
        tailwind: true,
        yamlAndZod: true,
      }),
    )
  })

  it('10 条重 opening 首屏只格式化 current，alternate 首访一次且回访命中 cache', async () => {
    localStorage.setItem('srl.preview.allowScripts', 'true')
    vi.stubGlobal('requestIdleCallback', undefined)
    const performanceEvents: Array<{
      formatterKind?: string
      greetingIndex?: number
      stage: string
    }> = []
    ;(
      window as Window & {
        __SRL_PREVIEW_PERFORMANCE_AUDIT__?: (event: (typeof performanceEvents)[number]) => void
      }
    ).__SRL_PREVIEW_PERFORMANCE_AUDIT__ = (event) => performanceEvents.push(event)
    const greetings = Array.from(
      { length: 10 },
      (_, index) =>
        `\`\`\`html\n<html><body><main data-opening="${index}">开场 ${index}</main></body></html>\n\`\`\``,
    )
    const wrapper = mount(RichContentPreview, {
      props: {
        source: greetings[1],
        title: '重 opening',
        greetingContents: greetings,
        greetingIndex: 1,
        runtimeScripts: [{ id: 'heavy', name: 'heavy', content: 'void 0', source: 'character' }],
        sourceKind: 'openingArchive',
        renderShell: 'content',
      },
    })
    await flushPromises()

    expect(performanceEvents.filter((event) => event.stage === 'formatter')).toEqual([
      expect.objectContaining({ formatterKind: 'current', greetingIndex: 1 }),
    ])

    let swipeId = 1
    const transitionSwipe = vi.fn(async (target: number) => {
      swipeId = target
      return true
    })
    const initialFrame = wrapper.find<HTMLIFrameElement>('iframe').element
    Object.defineProperty(initialFrame, 'contentWindow', {
      configurable: true,
      value: {
        postMessage: vi.fn(),
        __SRL_RENDER_COMPAT_HOST__: {
          events: { CHARACTER_MESSAGE_RENDERED: 'character_message_rendered' },
          transitionSwipe,
          emit: vi.fn(async () => undefined),
          context: () => ({ chat: [{ swipe_id: swipeId }] }),
        },
      },
    })
    initialFrame.dispatchEvent(new Event('load'))

    for (const target of [2, 1, 2]) {
      await wrapper.setProps({ source: greetings[target], greetingIndex: target })
      await flushPromises()
      await flushPromises()
    }

    const formatterEvents = performanceEvents.filter((event) => event.stage === 'formatter')
    expect(formatterEvents.filter((event) => event.greetingIndex === 1)).toHaveLength(1)
    expect(formatterEvents.filter((event) => event.greetingIndex === 2)).toHaveLength(1)
    expect(formatterEvents.filter((event) => ![1, 2].includes(event.greetingIndex ?? -1))).toEqual(
      [],
    )
    expect(wrapper.find<HTMLIFrameElement>('iframe').element).toBe(initialFrame)
    expect(transitionSwipe).toHaveBeenCalledTimes(3)
  })

  it('formatAsDisplayedMessage literal fixture 保留全部登记 opening 的同步格式化结果', async () => {
    localStorage.setItem('srl.preview.allowScripts', 'true')
    vi.stubGlobal('requestIdleCallback', undefined)
    const performanceEvents: Array<{ greetingIndex?: number; stage: string }> = []
    ;(
      window as Window & {
        __SRL_PREVIEW_PERFORMANCE_AUDIT__?: (event: (typeof performanceEvents)[number]) => void
      }
    ).__SRL_PREVIEW_PERFORMANCE_AUDIT__ = (event) => performanceEvents.push(event)
    const greetings = ['**开场 A**', '**开场 B**', '**开场 C**', '**开场 D**']
    const wrapper = mount(RichContentPreview, {
      props: {
        source: greetings[1],
        title: '同步 formatter fixture',
        greetingContents: greetings,
        greetingIndex: 1,
        runtimeScripts: [
          {
            id: 'formatter',
            name: 'formatter',
            content: "TavernHelper['formatAsDisplayedMessage']('**开场 A**')",
            source: 'character',
          },
        ],
      },
    })
    await flushPromises()

    const formattedGreetings = readInitialHostContext(readFrameDocument(wrapper)).formattedGreetings
    expect(formattedGreetings).toHaveLength(4)
    expect(formattedGreetings?.[0]).toContain('<strong>开场 A</strong>')
    expect(formattedGreetings?.[1]).toContain('<strong>开场 B</strong>')
    expect(performanceEvents.filter((event) => event.stage === 'formatter')).toHaveLength(4)
  })

  it('IntersectionObserver 尚未确认可见时不加载 vendor、不解析 MVU、不格式化或 build', async () => {
    localStorage.setItem('srl.preview.allowScripts', 'true')
    let intersectionCallback: IntersectionObserverCallback | undefined
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(callback: IntersectionObserverCallback) {
          intersectionCallback = callback
        }
        disconnect() {}
        observe() {}
        takeRecords() {
          return []
        }
        unobserve() {}
      },
    )
    const performanceEvents: Array<{ stage: string }> = []
    ;(
      window as Window & {
        __SRL_PREVIEW_PERFORMANCE_AUDIT__?: (event: (typeof performanceEvents)[number]) => void
      }
    ).__SRL_PREVIEW_PERFORMANCE_AUDIT__ = (event) => performanceEvents.push(event)
    const wrapper = mount(RichContentPreview, {
      props: {
        source: '```html\n<body><main>offscreen</main></body>\n```',
        title: 'offscreen',
        runtimeScripts: [{ id: 'runtime', name: 'runtime', content: 'void 0' }],
        characterData: {
          first_mes: '<initvar>\nhp: 10\n</initvar>',
          character_book: { entries: [{ comment: '[initvar]', content: 'hp: 1' }] },
        },
      },
    })
    await flushPromises()

    expect(intersectionCallback).toBeTypeOf('function')
    expect(wrapper.find('.rich-content-preview').exists()).toBe(true)
    expect(wrapper.find('iframe').exists()).toBe(false)
    expect(vendorMocks.load).not.toHaveBeenCalled()
    expect(performanceEvents.map((event) => event.stage)).toEqual(['component-created'])
  })

  it('PreviewBudget 在 vendor load 途中 suspend 时丢弃 in-flight build', async () => {
    localStorage.setItem('srl.preview.allowScripts', 'true')
    let resolveVendor: ((value: { jquery: string }) => void) | undefined
    vendorMocks.load.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveVendor = resolve
        }),
    )
    const performanceEvents: Array<{ stage: string }> = []
    ;(
      window as Window & {
        __SRL_PREVIEW_PERFORMANCE_AUDIT__?: (event: (typeof performanceEvents)[number]) => void
      }
    ).__SRL_PREVIEW_PERFORMANCE_AUDIT__ = (event) => performanceEvents.push(event)
    const wrapper = mount(RichContentPreview, {
      props: {
        source: '```html\n<body><main>in flight</main></body>\n```',
        title: 'in-flight suspend',
        runtimeScripts: [{ id: 'runtime', name: 'runtime', content: 'void 0' }],
      },
    })
    await vi.waitFor(() => expect(vendorMocks.load).toHaveBeenCalledOnce())

    await wrapper.setProps({ active: false })
    resolveVendor?.({ jquery: '/* jquery */' })
    await flushPromises()

    expect(wrapper.find('iframe').exists()).toBe(false)
    expect(performanceEvents.some((event) => event.stage === 'document-build')).toBe(false)
  })

  it('阅读原文期间输入变化只标 dirty，不在后台执行重 preview build', async () => {
    localStorage.setItem('srl.preview.allowScripts', 'true')
    const performanceEvents: Array<{ stage: string }> = []
    ;(
      window as Window & {
        __SRL_PREVIEW_PERFORMANCE_AUDIT__?: (event: (typeof performanceEvents)[number]) => void
      }
    ).__SRL_PREVIEW_PERFORMANCE_AUDIT__ = (event) => performanceEvents.push(event)
    const wrapper = mount(RichContentPreview, {
      props: {
        source: '```html\n<body><main>初始</main></body>\n```',
        title: 'Source dirty',
        runtimeScripts: [{ id: 'runtime', name: 'runtime', content: 'void 0' }],
      },
    })
    await flushPromises()
    const sourceButton = wrapper
      .findAll<HTMLButtonElement>('.rich-content-preview__toolbar button')
      .find((button) => button.text() === '阅读原文')!
    await sourceButton.trigger('click')
    await flushPromises()
    performanceEvents.length = 0
    vendorMocks.load.mockClear()

    await wrapper.setProps({
      source: '```html\n<body><main>最新输入</main></body>\n```',
      title: 'Source dirty latest',
    })
    await flushPromises()

    expect(wrapper.find('iframe').exists()).toBe(false)
    expect(vendorMocks.load).not.toHaveBeenCalled()
    expect(performanceEvents).toEqual([])
  })

  it('只在识别到 MVU 初始化数据时建立 opening preview state', async () => {
    localStorage.setItem('srl.preview.allowScripts', 'true')
    const wrapper = mount(RichContentPreview, {
      props: {
        source: '```html\n<html><body><div>状态栏</div></body></html>\n```',
        title: 'MVU 状态栏',
        characterData: {
          first_mes: '<initvar>\nhp: 10\nname: "{{char}}"\n</initvar>',
          alternate_greetings: ['<initvar>\nhp: 20\n</initvar>'],
          character_book: {
            entries: [
              {
                comment: '[initvar] test base',
                content: 'hp: 1\nname: base',
              },
            ],
          },
        },
        macroCharName: '林默',
      },
    })
    let frameDocument = ''
    await vi.waitFor(() => {
      frameDocument = readFrameDocument(wrapper)
      expect(frameDocument).toContain('"mvuRecognized":true')
    })
    expect(frameDocument).toContain('"stat_data":{"hp":10,"name":"林默"}')
    expect(frameDocument).toContain('"stat_data":{"hp":20}')
    expect(frameDocument).toContain("initializeGlobal({},'Mvu',mvu)")
  })

  it('不再向生产文档注入异步 formatter bridge', async () => {
    localStorage.setItem('srl.preview.allowScripts', 'true')
    const wrapper = mount(RichContentPreview, {
      props: {
        source: '开场',
        title: '动态格式化',
        macroCharName: '林默',
        runtimeScripts: [
          { id: 'dynamic', name: 'dynamic', content: 'void 0', source: 'character' },
        ],
      },
    })
    await flushPromises()
    const frameDocument = readFrameDocument(wrapper)
    expect(frameDocument).not.toContain('formatBridgeToken')
    expect('__SRL_RENDER_COMPAT_FORMAT_BRIDGE__' in window).toBe(false)
  })

  it('切换 opening 时复用 outer iframe，并由同一 PreviewSession 确认目标 opening', async () => {
    localStorage.setItem('srl.preview.allowScripts', 'true')
    const first = '```html\n<html><body><main>开场 A</main></body></html>\n```'
    const second = '```html\n<html><body><main>开场 B</main></body></html>\n```'
    const wrapper = mount(RichContentPreview, {
      props: {
        source: first,
        title: '稳定会话',
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
    const transitionSwipe = vi.fn(async (target: number) => {
      swipeId = target
      return true
    })
    const emit = vi.fn(async () => undefined)
    const initialFrame = wrapper.find<HTMLIFrameElement>('iframe').element
    const contentWindow = {
      postMessage: vi.fn(),
      __SRL_RENDER_COMPAT_HOST__: {
        events: { CHARACTER_MESSAGE_RENDERED: 'character_message_rendered' },
        transitionSwipe,
        emit,
        context: () => ({ chat: [{ swipe_id: swipeId }] }),
      },
    }
    Object.defineProperty(initialFrame, 'contentWindow', {
      configurable: true,
      value: contentWindow,
    })
    const dispatchFromPreview = (data: Record<string, unknown>) =>
      window.dispatchEvent(
        new MessageEvent('message', {
          data,
          source: contentWindow as unknown as Window,
        }),
      )

    initialFrame.dispatchEvent(new Event('load'))
    dispatchFromPreview({ type: 'SRL_PREVIEW_HEIGHT', height: 320 })
    dispatchFromPreview({ type: 'SRL_GREETING_NAVIGATE', target: 1 })
    expect(wrapper.emitted('navigateGreeting')).toEqual([[1]])

    await wrapper.setProps({ source: second, greetingIndex: 1 })
    await flushPromises()
    await flushPromises()

    expect(wrapper.find<HTMLIFrameElement>('iframe').element).toBe(initialFrame)
    expect(transitionSwipe).toHaveBeenCalledWith(1, false, expect.stringContaining('开场 B'))
    expect(emit).toHaveBeenCalledWith('character_message_rendered', [0])
    expect(initialFrame.style.height).toBe('320px')
  })

  it('阅读原文销毁 iframe 后以 canonical B seed 直接创建新 PreviewSession', async () => {
    localStorage.setItem('srl.preview.allowScripts', 'true')
    const first = '```html\n<html><body><main>开场 A</main></body></html>\n```'
    const second = '```html\n<html><body><main>开场 B</main></body></html>\n```'
    const wrapper = mount(RichContentPreview, {
      props: {
        source: first,
        title: '会话恢复',
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

    let initialSwipeId = 0
    const initialTransitionSwipe = vi.fn(async (target: number) => {
      initialSwipeId = target
      return true
    })
    const initialFrame = wrapper.find<HTMLIFrameElement>('iframe').element
    const initialContentWindow = {
      postMessage: vi.fn(),
      __SRL_RENDER_COMPAT_HOST__: {
        events: { CHARACTER_MESSAGE_RENDERED: 'character_message_rendered' },
        transitionSwipe: initialTransitionSwipe,
        emit: vi.fn(async () => undefined),
        context: () => ({ chat: [{ swipe_id: initialSwipeId }] }),
      },
    }
    Object.defineProperty(initialFrame, 'contentWindow', {
      configurable: true,
      value: initialContentWindow,
    })
    initialFrame.dispatchEvent(new Event('load'))

    await wrapper.setProps({ source: second, greetingIndex: 1 })
    await flushPromises()
    await flushPromises()
    expect(initialTransitionSwipe).toHaveBeenCalledWith(1, false, expect.stringContaining('开场 B'))

    const sourceButton = wrapper
      .findAll<HTMLButtonElement>('.rich-content-preview__toolbar button')
      .find((button) => button.text() === '阅读原文')
    expect(sourceButton).toBeDefined()
    await sourceButton!.trigger('click')
    await flushPromises()
    expect(wrapper.find('iframe').exists()).toBe(false)

    const previewButton = wrapper
      .findAll<HTMLButtonElement>('.rich-content-preview__toolbar button')
      .find((button) => button.text() === '效果预览')
    expect(previewButton).toBeDefined()
    await previewButton!.trigger('click')
    await flushPromises()

    const resumedFrame = wrapper.find<HTMLIFrameElement>('iframe').element
    expect(resumedFrame).not.toBe(initialFrame)
    const resumedDocument = resumedFrame.getAttribute('srcdoc') ?? ''
    const mountedFrontend = readMountedFrontendDocument(resumedDocument)
    expect(mountedFrontend).toContain('开场 B')
    expect(mountedFrontend).not.toContain('开场 A')
    expect(readInitialHostGreetingIndex(resumedDocument)).toBe(1)

    let resumedSwipeId = 1
    const resumedTransitionSwipe = vi.fn(async (target: number) => {
      resumedSwipeId = target
      return true
    })
    const resumedContentWindow = {
      postMessage: vi.fn(),
      __SRL_RENDER_COMPAT_HOST__: {
        events: { CHARACTER_MESSAGE_RENDERED: 'character_message_rendered' },
        transitionSwipe: resumedTransitionSwipe,
        emit: vi.fn(async () => undefined),
        context: () => ({ chat: [{ swipe_id: resumedSwipeId }] }),
      },
    }
    Object.defineProperty(resumedFrame, 'contentWindow', {
      configurable: true,
      value: resumedContentWindow,
    })
    resumedFrame.dispatchEvent(new Event('load'))
    await flushPromises()
    await flushPromises()

    expect(resumedTransitionSwipe).not.toHaveBeenCalled()
    expect(resumedSwipeId).toBe(1)
    expect(wrapper.find('.rich-content-preview__loading').exists()).toBe(false)
  })

  it('PreviewBudget suspend/resume 后也从 canonical B seed 直接挂载', async () => {
    localStorage.setItem('srl.preview.allowScripts', 'true')
    const first = '```html\n<html><body><main>开场 A</main></body></html>\n```'
    const second = '```html\n<html><body><main>开场 B</main></body></html>\n```'
    const wrapper = mount(RichContentPreview, {
      props: {
        source: first,
        title: '预算恢复',
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

    let initialSwipeId = 0
    const initialTransitionSwipe = vi.fn(async (target: number) => {
      initialSwipeId = target
      return true
    })
    const initialFrame = wrapper.find<HTMLIFrameElement>('iframe').element
    Object.defineProperty(initialFrame, 'contentWindow', {
      configurable: true,
      value: {
        postMessage: vi.fn(),
        __SRL_RENDER_COMPAT_HOST__: {
          events: { CHARACTER_MESSAGE_RENDERED: 'character_message_rendered' },
          transitionSwipe: initialTransitionSwipe,
          emit: vi.fn(async () => undefined),
          context: () => ({ chat: [{ swipe_id: initialSwipeId }] }),
        },
      },
    })
    initialFrame.dispatchEvent(new Event('load'))
    await wrapper.setProps({ source: second, greetingIndex: 1 })
    await flushPromises()
    await flushPromises()
    expect(initialTransitionSwipe).toHaveBeenCalledOnce()

    const competitors = Array.from({ length: 3 }, (_, index) =>
      mount(RichContentPreview, {
        props: { source: `预算竞争 ${index}`, title: `预算竞争 ${index}` },
      }),
    )
    await flushPromises()
    expect(previewBudget.snapshot()[0]?.state).toBe('suspended')
    expect(wrapper.find('iframe').exists()).toBe(false)

    competitors[2].unmount()
    await flushPromises()
    const resumedFrame = wrapper.find<HTMLIFrameElement>('iframe').element
    expect(resumedFrame).not.toBe(initialFrame)
    const resumedDocument = resumedFrame.getAttribute('srcdoc') ?? ''
    expect(readMountedFrontendDocument(resumedDocument)).toContain('开场 B')
    expect(readInitialHostGreetingIndex(resumedDocument)).toBe(1)

    let resumedSwipeId = 1
    const resumedTransitionSwipe = vi.fn(async (target: number) => {
      resumedSwipeId = target
      return true
    })
    Object.defineProperty(resumedFrame, 'contentWindow', {
      configurable: true,
      value: {
        postMessage: vi.fn(),
        __SRL_RENDER_COMPAT_HOST__: {
          events: { CHARACTER_MESSAGE_RENDERED: 'character_message_rendered' },
          transitionSwipe: resumedTransitionSwipe,
          emit: vi.fn(async () => undefined),
          context: () => ({ chat: [{ swipe_id: resumedSwipeId }] }),
        },
      },
    })
    resumedFrame.dispatchEvent(new Event('load'))
    await flushPromises()

    expect(resumedTransitionSwipe).not.toHaveBeenCalled()
    expect(wrapper.find('.rich-content-preview__loading').exists()).toBe(false)
    competitors.slice(0, 2).forEach((competitor) => competitor.unmount())
    wrapper.unmount()
  })

  it('Source 模式 target 改变后直接用最新 current 建 canonical session', async () => {
    localStorage.setItem('srl.preview.allowScripts', 'true')
    const first = '```html\n<html><body><main>开场 A</main></body></html>\n```'
    const second = '```html\n<html><body><main>开场 B</main></body></html>\n```'
    const third = '```html\n<html><body><main>开场 C</main></body></html>\n```'
    const wrapper = mount(RichContentPreview, {
      props: {
        source: first,
        title: 'race fallback',
        greetingContents: [first, second, third],
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

    let initialSwipeId = 0
    const initialFrame = wrapper.find<HTMLIFrameElement>('iframe').element
    Object.defineProperty(initialFrame, 'contentWindow', {
      configurable: true,
      value: {
        postMessage: vi.fn(),
        __SRL_RENDER_COMPAT_HOST__: {
          events: { CHARACTER_MESSAGE_RENDERED: 'character_message_rendered' },
          transitionSwipe: vi.fn(async (target: number) => {
            initialSwipeId = target
            return true
          }),
          emit: vi.fn(async () => undefined),
          context: () => ({ chat: [{ swipe_id: initialSwipeId }] }),
        },
      },
    })
    initialFrame.dispatchEvent(new Event('load'))
    await wrapper.setProps({ source: second, greetingIndex: 1 })
    await flushPromises()
    await flushPromises()

    const sourceButton = wrapper
      .findAll<HTMLButtonElement>('.rich-content-preview__toolbar button')
      .find((button) => button.text() === '阅读原文')
    await sourceButton!.trigger('click')
    await flushPromises()
    await wrapper.setProps({ source: third, greetingIndex: 2 })
    await flushPromises()

    const previewButton = wrapper
      .findAll<HTMLButtonElement>('.rich-content-preview__toolbar button')
      .find((button) => button.text() === '效果预览')
    await previewButton!.trigger('click')
    await flushPromises()

    const resumedFrame = wrapper.find<HTMLIFrameElement>('iframe').element
    const resumedDocument = resumedFrame.getAttribute('srcdoc') ?? ''
    expect(readMountedFrontendDocument(resumedDocument)).toContain('开场 C')
    expect(readMountedFrontendDocument(resumedDocument)).not.toContain('开场 A')
    expect(readInitialHostGreetingIndex(resumedDocument)).toBe(2)

    let resumedSwipeId = 2
    const resumedTransitionSwipe = vi.fn(async (target: number) => {
      resumedSwipeId = target
      return true
    })
    const resumedEmit = vi.fn(async () => undefined)
    Object.defineProperty(resumedFrame, 'contentWindow', {
      configurable: true,
      value: {
        postMessage: vi.fn(),
        __SRL_RENDER_COMPAT_HOST__: {
          events: { CHARACTER_MESSAGE_RENDERED: 'character_message_rendered' },
          transitionSwipe: resumedTransitionSwipe,
          emit: resumedEmit,
          context: () => ({ chat: [{ swipe_id: resumedSwipeId }] }),
        },
      },
    })
    resumedFrame.dispatchEvent(new Event('load'))
    await flushPromises()

    expect(resumedTransitionSwipe).not.toHaveBeenCalled()
    expect(resumedSwipeId).toBe(2)
    expect(resumedEmit).not.toHaveBeenCalled()
    expect(wrapper.find('.rich-content-preview__loading').exists()).toBe(false)
  })

  it('普通 opening 没有 Runtime 时会为 A→B→C→A 重建真实目标文档', async () => {
    localStorage.setItem('srl.preview.allowScripts', 'true')
    const greetings = [
      '<p id="plain-opening">普通 A</p>',
      '<p id="plain-opening">普通 B</p>',
      '<p id="plain-opening">普通 C</p>',
    ]
    const wrapper = mount(RichContentPreview, {
      props: {
        source: greetings[0],
        title: '普通开场',
        greetingContents: greetings,
        greetingIndex: 0,
        sourceKind: 'openingArchive',
        renderShell: 'content',
      },
    })
    await flushPromises()

    for (const index of [0, 1, 2, 0]) {
      if (index !== 0 || wrapper.props('greetingIndex') !== 0) {
        await wrapper.setProps({ source: greetings[index], greetingIndex: index })
        await flushPromises()
      }
      const document = readFrameDocument(wrapper)
      expect(document).toContain(`普通 ${String.fromCharCode(65 + index)}`)
    }
  })
})
