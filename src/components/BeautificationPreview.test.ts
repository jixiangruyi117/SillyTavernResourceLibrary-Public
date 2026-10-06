/** @vitest-environment jsdom */
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { JSDOM } from 'jsdom'

import { RESOURCE_TYPE, type Resource } from '../types/Resource'
import BeautificationPreview from './BeautificationPreview.vue'

function makeThemeResource(source: string): Resource {
  return {
    id: 'beauty-1',
    type: RESOURCE_TYPE.BEAUTIFICATION,
    name: '启动动画主题',
    description: '',
    fileName: 'startup-theme.json',
    mimeType: 'application/json',
    fileSize: source.length,
    contentHash: 'beauty-hash',
    favorite: false,
    categoryId: null,
    tags: [],
    metadata: {},
    originalBlob: { text: async () => source } as Blob,
    createdAt: 1,
    updatedAt: 1,
  }
}

function frameDocument(wrapper: ReturnType<typeof mount>): string {
  return wrapper.find<HTMLIFrameElement>('.beauty-preview__frame').attributes('srcdoc') ?? ''
}

describe('BeautificationPreview', () => {
  afterEach(() => {
    localStorage.clear()
    vi.unstubAllGlobals()
  })

  it('exposes startup compatibility hooks and leaves authored animation visibility intact', async () => {
    const source = JSON.stringify({
      main_text_color: '#eee8dc',
      custom_css:
        '#loader.splash-screen{animation:intro 1s ease both}.splash-logo{opacity:.8}@keyframes intro{from{opacity:0}to{opacity:1}}',
    })
    const wrapper = mount(BeautificationPreview, { props: { resource: makeThemeResource(source) } })
    await flushPromises()

    await wrapper.find('select[aria-label="预览场景"]').setValue('startup')
    const document = frameDocument(wrapper)
    expect(document).toContain('id="preloader"')
    expect(document).toContain('id="loader" class="splash-screen"')
    expect(document).toContain('class="splash-logo"')
    expect(document).toContain('id="load-spinner"')
    expect(document).toContain('#loader.splash-screen{animation:intro 1s ease both}')
    expect(document).not.toContain(
      '.st-preview-shell>*,.st-preview-shell form{visibility:visible!important',
    )
    expect(wrapper.text()).toContain('样式涉及')
  })

  it('covers welcome, chat and major panels with stable theme compatibility hooks', async () => {
    const source = JSON.stringify({ custom_css: '#chat{border:0}.welcomePanel{padding:20px}' })
    const wrapper = mount(BeautificationPreview, { props: { resource: makeThemeResource(source) } })
    await flushPromises()

    expect(
      wrapper
        .findAll('select[aria-label="预览场景"] option')
        .map((option) => option.attributes('value')),
    ).toEqual(['chat', 'welcome', 'startup'])
    const expected: Array<[string, string[]]> = [
      ['欢迎页', ['#top-settings-holder', '#sheld', '.welcomePanel']],
      [
        '聊天',
        [
          '#chat',
          '.mes.bot_mes.last_mes',
          '#send_form',
          '#left-nav-panel',
          '#ai_response_configuration',
          '#rm_api_block',
          '#main_api',
          '#AdvancedFormatting',
          '#ContextSettings',
          '#right-nav-panel',
          '#rm_characters_block',
          '#PersonaManagement',
          '#persona-management-block',
          '#WorldInfo',
          '#world_popup_entries_list',
          '#Backgrounds',
          '#bg_menu_content',
          '#rm_extensions_block',
          '#extensions_settings',
          '#user-settings-block',
          '#UI-Theme-Block',
        ],
      ],
    ]

    for (const [label, selectors] of expected) {
      const option = wrapper
        .findAll('select[aria-label="预览场景"] option')
        .find((candidate) => candidate.text().split(' · ')[0] === label)
      expect(option, `missing scene option: ${label}`).toBeTruthy()
      await wrapper.find('select[aria-label="预览场景"]').setValue(option!.attributes('value'))
      const document = frameDocument(wrapper)
      const parsed = new DOMParser().parseFromString(document, 'text/html')
      for (const selector of selectors) {
        expect(
          parsed.querySelector(selector),
          `missing hook ${selector} in ${label}`,
        ).not.toBeNull()
      }
    }
  })

  it('recreates the startup document when replaying the opening animation', async () => {
    const wrapper = mount(BeautificationPreview, {
      props: { resource: makeThemeResource(JSON.stringify({ custom_css: '' })) },
    })
    await flushPromises()

    await wrapper.find('select[aria-label="预览场景"]').setValue('startup')
    const firstFrame = wrapper.find('.beauty-preview__frame').element
    const replay = wrapper.find('.beauty-preview__replay')
    expect(replay.exists()).toBe(true)
    await replay.trigger('click')
    expect(frameDocument(wrapper)).toContain('data-preview-scene="startup"')
    expect(wrapper.find('.beauty-preview__frame').element).not.toBe(firstFrame)
  })

  it('lets existing Tavern theme selectors reach message attributes, avatars and controls', async () => {
    const css =
      '.mes[is_user="true"] .avatar img{border-radius:0}.mes[mesid="1"] .mes_buttons{color:red}'
    const resource = makeThemeResource(JSON.stringify({ custom_css: css }))
    const wrapper = mount(BeautificationPreview, { props: { resource } })
    await flushPromises()
    await wrapper.find('select[aria-label="预览场景"]').setValue('chat')
    const parsed = new DOMParser().parseFromString(frameDocument(wrapper), 'text/html')
    for (const selector of [
      '.mes[is_user="true"] .avatar img',
      '.mes[mesid="1"] .mes_buttons',
      '.mes[is_user="false"][is_system="false"] .mes_text',
      '.last_mes .swipe_right',
      '#send_form #nonQRFormItems #send_textarea',
    ]) {
      expect(parsed.querySelector(selector), selector).not.toBeNull()
    }
    expect(frameDocument(wrapper)).toContain(css)
    expect(await resource.originalBlob.text()).toBe(JSON.stringify({ custom_css: css }))
    expect(wrapper.find('iframe').attributes('sandbox')).not.toContain('allow-same-origin')
    wrapper.unmount()
  })

  it('maps exported theme geometry and visibility settings into the preview document', async () => {
    const wrapper = mount(BeautificationPreview, {
      props: {
        resource: makeThemeResource(
          JSON.stringify({
            chat_width: 65,
            font_scale: 1.2,
            shadow_width: 4,
            blur_strength: 7,
            avatar_style: 1,
            chat_display: 2,
            timestamps_enabled: false,
            timer_enabled: false,
            mesIDDisplay_enabled: true,
            message_token_count_enabled: true,
            fast_ui_mode: false,
          }),
        ),
      },
    })
    await flushPromises()
    const parsed = new DOMParser().parseFromString(frameDocument(wrapper), 'text/html')
    for (const name of ['big-avatars', 'documentstyle', 'no-timestamps', 'no-timer'])
      expect(parsed.body.classList.contains(name), name).toBe(true)
    for (const name of ['no-mesIDDisplay', 'no-tokenCount', 'no-blur'])
      expect(parsed.body.classList.contains(name), name).toBe(false)
    for (const variable of [
      '--sheldWidth:65vw',
      '--fontScale:1.2',
      '--shadowWidth:4',
      '--blurStrength:7',
    ])
      expect(parsed.head.textContent).toContain(variable)
    wrapper.unmount()
  })

  it.each([
    [0, ''],
    [1, 'bubblechat'],
    [2, 'documentstyle'],
  ])(
    'selects chat display %s without mixing mutually exclusive modes',
    async (chat_display, expected) => {
      const wrapper = mount(BeautificationPreview, {
        props: { resource: makeThemeResource(JSON.stringify({ chat_display })) },
      })
      await flushPromises()
      const parsed = new DOMParser().parseFromString(frameDocument(wrapper), 'text/html')
      expect(parsed.body.classList.contains('bubblechat')).toBe(expected === 'bubblechat')
      expect(parsed.body.classList.contains('documentstyle')).toBe(expected === 'documentstyle')
      wrapper.unmount()
    },
  )

  it('allows preloaded blob styles and fonts when remote resources are enabled', async () => {
    localStorage.setItem('srl.preview.allowRemoteResources', 'true')
    const wrapper = mount(BeautificationPreview, {
      props: { resource: makeThemeResource(JSON.stringify({ custom_css: '' })) },
    })
    await flushPromises()

    const document = frameDocument(wrapper)
    expect(document).toContain("style-src 'unsafe-inline' blob: http: https:")
    expect(document).toContain('font-src data: blob: http: https:')
    wrapper.unmount()
    localStorage.removeItem('srl.preview.allowRemoteResources')
  })

  it('nests every panel below its toggle and operates drawers without author script permission', async () => {
    const wrapper = mount(BeautificationPreview, {
      props: { resource: makeThemeResource('{}') },
    })
    await flushPromises()
    const dom = new JSDOM(frameDocument(wrapper), { runScripts: 'dangerously' })
    try {
      const doc = dom.window.document
      expect(doc.querySelectorAll('.drawer > .drawer-toggle + .drawer-content')).toHaveLength(9)
      expect(doc.querySelectorAll('.openDrawer')).toHaveLength(0)
      doc.querySelector<HTMLButtonElement>('#rightNavDrawerIcon')!.click()
      expect(doc.querySelectorAll('.openDrawer')).toHaveLength(1)
      expect(doc.querySelector('#right-nav-panel')!.classList.contains('openDrawer')).toBe(true)
      const generation = doc.querySelector<HTMLButtonElement>('#leftNavDrawerIcon')!
      generation.click()
      expect(doc.querySelectorAll('.openDrawer')).toHaveLength(1)
      expect(doc.querySelector('#left-nav-panel')!.classList.contains('openDrawer')).toBe(true)
      expect(doc.querySelector('#rightNavDrawerIcon')!.getAttribute('aria-expanded')).toBe('false')
      generation.dispatchEvent(
        new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      )
      expect(doc.querySelectorAll('.openDrawer')).toHaveLength(0)
      expect(doc.activeElement).toBe(generation)
      doc.querySelector<HTMLButtonElement>('#rightNavDrawerIcon')!.click()
      const search = doc.querySelector<HTMLInputElement>('#character_search_bar')!
      search.value = '林间'
      search.dispatchEvent(new dom.window.Event('input'))
      expect(doc.querySelectorAll('.character_select:not([hidden])')).toHaveLength(1)
      expect(doc.querySelector('.character_select:not([hidden])')!.textContent).toContain(
        '林间来客',
      )
      doc.querySelector<HTMLButtonElement>('#backgrounds-drawer-toggle')!.click()
      doc.querySelectorAll<HTMLButtonElement>('.bg_example')[1]!.click()
      expect(doc.querySelector('.bg_example.selected')!.textContent).toBe('冬日档案')
      expect(doc.querySelector<HTMLElement>('#bg1')!.style.background).toContain('linear-gradient')
      doc.querySelector<HTMLButtonElement>('#userSettingsDrawerIcon')!.click()
      const scale = doc.querySelector<HTMLInputElement>('#font_scale')!
      scale.value = '1.25'
      scale.dispatchEvent(new dom.window.Event('input'))
      expect(doc.documentElement.style.getPropertyValue('--fontScale')).toBe('1.25')
      expect(doc.querySelector('#custom_api_url_text')!.classList.contains('text_pole')).toBe(true)
    } finally {
      dom.window.close()
      wrapper.unmount()
    }
  })

  it('authorizes only the built-in nonce script and prevents style or title breakouts', async () => {
    const source = JSON.stringify({
      main_text_color: 'rgb(</style><script>window.authorRan=true</script>)',
      custom_css: '</style><script>window.authorRan=true</script><style>.mes{color:red}',
    })
    const resource = makeThemeResource(source)
    resource.name = '</title><script>window.authorRan=true</script>'
    const wrapper = mount(BeautificationPreview, { props: { resource } })
    await flushPromises()
    await wrapper.find('select[aria-label="预览场景"]').setValue('startup')
    const doc = new DOMParser().parseFromString(frameDocument(wrapper), 'text/html')
    expect(doc.scripts).toHaveLength(1)
    const nonce = doc.scripts[0]!.nonce
    expect(nonce).toMatch(/^[\da-f]{32}$/)
    const policy = doc.querySelector('meta[http-equiv]')!.getAttribute('content')!
    expect(policy).toContain(`script-src 'nonce-${nonce}'`)
    expect(policy).not.toContain("script-src 'unsafe-inline'")
    expect(doc.scripts[0]!.textContent).not.toContain('authorRan')
    expect(doc.querySelector('#preloader')).not.toBeNull()
    expect(doc.querySelector('.welcomePanel')).not.toBeNull()
    expect(wrapper.find('iframe').attributes('sandbox')).toBe('allow-scripts')
    expect(await resource.originalBlob.text()).toBe(source)
    wrapper.unmount()
  })

  it('changes the inspection width without rebuilding the current document', async () => {
    const wrapper = mount(BeautificationPreview, { props: { resource: makeThemeResource('{}') } })
    await flushPromises()
    const frame = wrapper.find('iframe').element
    await wrapper.find('select[aria-label="预览画布宽度"]').setValue('390px')
    expect(wrapper.find('iframe').element).toBe(frame)
    expect(wrapper.find('iframe').attributes('style')).toContain('width: 390px')
    wrapper.unmount()
  })

  it('keeps one iframe mounted through fullscreen entry and exit', async () => {
    const wrapper = mount(BeautificationPreview, { props: { resource: makeThemeResource('{}') } })
    try {
      await flushPromises()
      // jsdom does not implement the native dialog methods; real top-layer behavior is browser-checked.
      const dialog = wrapper.find<HTMLDialogElement>('dialog').element
      dialog.close = vi.fn(() => dialog.removeAttribute('open'))
      const show = (dialog.show = vi.fn(() => dialog.setAttribute('open', '')))
      const showModal = (dialog.showModal = vi.fn(() => dialog.setAttribute('open', '')))
      await wrapper.find('select[aria-label="预览画布宽度"]').setValue('390px')
      const frame = wrapper.find('iframe').element
      const source = frameDocument(wrapper)
      await wrapper
        .findAll('button')
        .find((button) => button.text() === '全屏预览')!
        .trigger('click')
      expect(showModal).toHaveBeenCalledOnce()
      expect(wrapper.findAll('iframe')).toHaveLength(1)
      expect(wrapper.find('iframe').element).toBe(frame)
      expect(frameDocument(wrapper)).toBe(source)
      expect(wrapper.find('iframe').attributes('style') ?? '').not.toContain('390px')
      await wrapper.find('dialog').trigger('cancel')
      expect(show).toHaveBeenCalledOnce()
      expect(wrapper.find('iframe').element).toBe(frame)
      expect(frameDocument(wrapper)).toBe(source)
      expect(wrapper.find('iframe').attributes('style')).toContain('width: 390px')
      expect(wrapper.find('dialog').classes()).not.toContain('beauty-fullscreen-overlay')
    } finally {
      wrapper.unmount()
    }
  })

  it('reloads the original theme without changing the scene, canvas width or resource', async () => {
    const resource = makeThemeResource(JSON.stringify({ font_scale: 1.2 }))
    const original = await resource.originalBlob.text()
    const wrapper = mount(BeautificationPreview, { props: { resource } })
    await flushPromises()
    await wrapper.find('select[aria-label="预览场景"]').setValue('welcome')
    await wrapper.find('select[aria-label="预览画布宽度"]').setValue('390px')
    const frame = wrapper.find('iframe').element
    const source = frameDocument(wrapper)
    await wrapper
      .find('.beauty-preview__header')
      .findAll('button')
      .find((button) => button.text() === '还原主题')!
      .trigger('click')
    expect(wrapper.find('iframe').element).not.toBe(frame)
    expect(frameDocument(wrapper)).toBe(source)
    expect(wrapper.find<HTMLSelectElement>('select[aria-label="预览场景"]').element.value).toBe(
      'welcome',
    )
    expect(wrapper.find<HTMLSelectElement>('select[aria-label="预览画布宽度"]').element.value).toBe(
      '390px',
    )
    expect(await resource.originalBlob.text()).toBe(original)
    wrapper.unmount()
  })

  it('fits a phone canvas in a narrow host while preserving its internal viewport and document', async () => {
    let resized: ((entries: Array<{ contentRect: { width: number } }>) => void) | undefined
    const disconnect = vi.fn()
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: typeof resized) {
          resized = callback
        }
        observe() {}
        disconnect = disconnect
      },
    )
    const wrapper = mount(BeautificationPreview, { props: { resource: makeThemeResource('{}') } })
    await flushPromises()
    const original = frameDocument(wrapper)
    const frame = wrapper.find('iframe').element
    await wrapper.find('select[aria-label="预览画布宽度"]').setValue('390px')
    resized!([{ contentRect: { width: 300 } }])
    await flushPromises()
    const canvas = wrapper.find<HTMLElement>('.beauty-preview__canvas').element
    expect(Number.parseFloat(canvas.style.width)).toBe(300)
    expect(Number.parseFloat(canvas.style.height)).toBeCloseTo((844 * 300) / 390)
    expect(wrapper.find('iframe').element).toBe(frame)
    expect(wrapper.find('iframe').attributes('style')).toContain('width: 390px')
    expect(frameDocument(wrapper)).toBe(original)
    wrapper.unmount()
    expect(disconnect).toHaveBeenCalledOnce()
  })

  it('网页端保留主题外链直显，不因 CORS 受限的预下载显示失败', async () => {
    localStorage.setItem('srl.preview.allowRemoteResources', 'true')
    localStorage.setItem('srl.preview.preloadBeautificationResources', 'true')
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    vi.stubGlobal('fetch', fetchMock)
    const wrapper = mount(BeautificationPreview, {
      props: {
        resource: makeThemeResource(
          JSON.stringify({
            custom_css: 'body{background-image:url(https://cdn.example/cover.png)}',
          }),
        ),
      },
    })
    await flushPromises()

    expect(frameDocument(wrapper)).toContain('https://cdn.example/cover.png')
    expect(wrapper.text()).not.toContain('未能预下载')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('在主题预览载入前显示加载条，载入后自动隐藏', async () => {
    const wrapper = mount(BeautificationPreview, {
      props: { resource: makeThemeResource(JSON.stringify({ custom_css: '' })) },
    })
    await flushPromises()

    expect(wrapper.find('.beauty-preview__loading').exists()).toBe(true)
    await wrapper.find('.beauty-preview__frame').trigger('load')
    expect(wrapper.find('.beauty-preview__loading').exists()).toBe(false)
  })

  it('does not create a throwaway document while the resource is still being read', async () => {
    let finishRead!: (source: string) => void
    const resource = makeThemeResource('{}')
    resource.originalBlob = {
      text: () =>
        new Promise<string>((resolve) => {
          finishRead = resolve
        }),
    } as Blob
    const wrapper = mount(BeautificationPreview, { props: { resource } })
    await flushPromises()
    const mountedBeforeRead = wrapper.findAll('iframe').length
    finishRead(JSON.stringify({ font_scale: 1.25 }))
    await flushPromises()
    expect(wrapper.findAll('iframe')).toHaveLength(1)
    expect(frameDocument(wrapper)).toContain('--fontScale:1.25')
    wrapper.unmount()
    expect(mountedBeforeRead).toBe(0)
  })

  it('reuses theme validation when switching scenes and invalidates it for a new resource', async () => {
    const supports = vi.fn(() => true)
    vi.stubGlobal('CSS', { supports })
    const wrapper = mount(BeautificationPreview, {
      props: { resource: makeThemeResource(JSON.stringify({ main_text_color: '#123456' })) },
    })
    await flushPromises()
    const initialValidationCount = supports.mock.calls.length
    for (const scene of ['welcome', 'startup', 'chat']) {
      await wrapper.find('select[aria-label="预览场景"]').setValue(scene)
      expect(frameDocument(wrapper)).toContain('--SmartThemeBodyColor:#123456')
    }
    const countAfterSwitching = supports.mock.calls.length
    await wrapper.setProps({
      resource: makeThemeResource(JSON.stringify({ main_text_color: '#654321' })),
    })
    await flushPromises()
    expect(frameDocument(wrapper)).toContain('--SmartThemeBodyColor:#654321')
    expect(supports.mock.calls.length).toBeGreaterThan(countAfterSwitching)
    wrapper.unmount()
    expect(countAfterSwitching).toBe(initialValidationCount)
  })

  it('ignores a late file read after switching resources and never renders a failed read', async () => {
    let finishOldRead!: (source: string) => void
    const oldResource = makeThemeResource('{}')
    oldResource.originalBlob = {
      text: () =>
        new Promise<string>((resolve) => {
          finishOldRead = resolve
        }),
    } as Blob
    const wrapper = mount(BeautificationPreview, { props: { resource: oldResource } })
    await flushPromises()
    await wrapper.setProps({
      resource: makeThemeResource(JSON.stringify({ main_text_color: '#654321' })),
    })
    await flushPromises()
    const currentFrame = wrapper.find('iframe').element
    finishOldRead(JSON.stringify({ main_text_color: '#123456' }))
    await flushPromises()
    expect(wrapper.find('iframe').element).toBe(currentFrame)
    expect(frameDocument(wrapper)).toContain('--SmartThemeBodyColor:#654321')
    const unreadable = makeThemeResource('{}')
    unreadable.originalBlob = {
      text: async (): Promise<string> => {
        throw new Error('unreadable')
      },
    } as Blob
    await wrapper.setProps({ resource: unreadable })
    await flushPromises()
    expect(wrapper.findAll('iframe')).toHaveLength(0)
    expect(wrapper.text()).toContain('无法读取美化文件内容')
    wrapper.unmount()
  })
})
