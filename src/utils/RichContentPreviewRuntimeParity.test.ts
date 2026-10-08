/** @vitest-environment jsdom */

import { describe, expect, it, vi } from 'vitest'

import { buildRichContentPreview } from './RichContentPreview'

const scriptPolicy = { allowRemoteResources: true, allowScripts: true }

function readFrontendSrcdoc(documentSource: string): string {
  const body = new DOMParser().parseFromString(documentSource, 'text/html').body
  return body.querySelector<HTMLIFrameElement>('div.TH-render iframe')?.getAttribute('srcdoc') ?? ''
}

describe('RichContentPreview shared compatibility runtime', () => {
  it.each([
    '<main style="position:fixed;inset:0">固定层</main>',
    '<main style="min-height:100vh">视口最小高度</main>',
  ])('相同视口不形成父子高度反馈循环：%s', (source) => {
    const result = buildRichContentPreview(
      '```html\n<html><body>' + source + '</body></html>\n```',
      'viewport loop',
      scriptPolicy,
      [],
      { renderShell: 'content' },
    )
    const childDocument = new DOMParser().parseFromString(
      readFrontendSrcdoc(result.document),
      'text/html',
    )
    const childScript = Array.from(childDocument.scripts).find((script) =>
      script.textContent?.includes('const updateViewport='),
    )?.textContent
    const hostDocument = new DOMParser().parseFromString(result.document, 'text/html')
    const hostScript = Array.from(hostDocument.scripts).find((script) =>
      script.textContent?.includes('const broadcast='),
    )?.textContent
    expect(childScript).toBeTruthy()
    expect(hostScript).toBeTruthy()
    let contentHeight = 12800
    Object.defineProperty(childDocument.body, 'scrollHeight', { get: () => contentHeight })
    const frames: (() => void)[] = []
    const childMessages: ((event: { data: unknown }) => void)[] = []
    const hostMessages: ((event: { data: unknown; source?: unknown }) => void)[] = []
    const frame = {
      style: { height: '' },
      dataset: {} as Record<string, string>,
      addEventListener: vi.fn(),
      contentWindow: {},
    }
    const childWindow = {
      frameElement: frame,
      addEventListener: (type: string, listener: (event: { data: unknown }) => void) => {
        if (type === 'message') childMessages.push(listener)
      },
      postMessage: (data: unknown) => childMessages.forEach((listener) => listener({ data })),
    }
    frame.contentWindow = childWindow
    const hostWindow = {
      addEventListener: (
        type: string,
        listener: (event: { data: unknown; source?: unknown }) => void,
      ) => {
        if (type === 'message') hostMessages.push(listener)
      },
    }
    const postMessage = vi.fn((data: unknown) =>
      hostMessages.forEach((listener) => listener({ data, source: childWindow })),
    )
    new Function('document', 'window', hostScript ?? '')(
      {
        readyState: 'complete',
        querySelectorAll: () => [frame],
        querySelector: () => null,
      },
      hostWindow,
    )
    let resize = () => {}
    class Observer {
      constructor(callback: () => void) {
        resize = callback
      }
      observe() {}
    }
    new Function(
      'document',
      'window',
      'parent',
      'requestAnimationFrame',
      'ResizeObserver',
      'getComputedStyle',
      childScript ?? '',
    )(
      childDocument,
      childWindow,
      { postMessage },
      (callback: () => void) => frames.push(callback),
      Observer,
      () => ({ position: 'fixed', top: '0px', bottom: '0px' }),
    )
    const viewport = (height: number) =>
      hostMessages.forEach((listener) =>
        listener({ data: { type: 'SRL_HOST_VIEWPORT_HEIGHT', height } }),
      )
    const flushLayout = () => {
      for (let count = 0; frames.length && count < 4; count++) frames.shift()?.()
    }
    viewport(844)
    flushLayout()
    expect(frames).toHaveLength(0)
    expect(frame.style.height).toBe('12800px')
    const settledCount = postMessage.mock.calls.length
    viewport(844)
    flushLayout()
    expect(postMessage).toHaveBeenCalledTimes(settledCount)
    viewport(660)
    flushLayout()
    expect(frames).toHaveLength(0)
    expect(childDocument.documentElement.style.getPropertyValue('--TH-viewport-height')).toBe(
      '660px',
    )
    contentHeight = 13600
    resize()
    flushLayout()
    expect(frame.style.height).toBe('13600px')
    contentHeight = 500
    resize()
    flushLayout()
    expect(frame.style.height).toBe('660px')
    expect(frames).toHaveLength(0)
  })

  it('matches TavernHelper message iframe auto-height ownership', () => {
    const result = buildRichContentPreview(
      '```html\n<html><body><main>carousel</main></body></html>\n```',
      'auto-height',
      scriptPolicy,
      [],
      { renderShell: 'content' },
    )
    const srcdoc = readFrontendSrcdoc(result.document)

    expect(srcdoc).toContain('const contentHeight=body.scrollHeight')
    expect(srcdoc).toContain('const frame=window.frameElement')
    expect(srcdoc).toContain("frame.style.height=Math.ceil(height)+'px'")
    expect(srcdoc).toContain('observer.observe(body)')
    expect(srcdoc).not.toContain('observer.observe(document.documentElement)')
    expect(srcdoc).not.toContain('body.offsetHeight')
    expect(srcdoc).not.toContain('root.scrollHeight')
    expect(srcdoc).not.toContain('root.offsetHeight')
    expect(result.document).toContain("data.type!=='SRL_FRAME_LAYOUT_READY'")
    expect(result.document).not.toContain("data.type!=='SRL_FRAME_LAYOUT'")
  })

  it('keeps host viewport and measured iframe content height as separate signals', () => {
    const result = buildRichContentPreview(
      '```html\n<html><body><main style="position:fixed;inset:0">fullscreen</main></body></html>\n```',
      'fullscreen',
      scriptPolicy,
      [],
      { renderShell: 'content' },
    )

    expect(result.document).toContain("data.type!=='SRL_FRAME_LAYOUT_READY'")
    expect(result.document).toContain('data.viewportBound===true&&hostViewportHeight>0')
    expect(result.document).toContain("data.type==='SRL_HOST_VIEWPORT_HEIGHT'")
    expect(result.document).not.toContain('applyInitialHeight')
    expect(result.document).not.toContain('setTimeout(broadcast')
  })

  it('injects TavernHelper message/script iframe dependencies and runtime bridges', () => {
    const result = buildRichContentPreview(
      '```html\n<html><body><i class="fa fa-home"></i><div class="p-4">helper</div></body></html>\n```',
      'helper',
      scriptPolicy,
      [{ id: 'mvu', source: 'character', name: 'mvu', content: 'Mvu.get("stat_data")' }],
      {
        renderShell: 'content',
        vendorLibs: {
          fontAwesomeCss: '.fa{font-family:"Font Awesome 7 Free"}',
          jquery: 'window.jQuery=window.$=function(){}',
          jqueryUi: 'window.jQuery.ui={audit:true}',
          jqueryUiTouchPunch: 'window.jQuery.ui.touchPunch=true',
          lodash: 'window._={}',
          vue: 'window.Vue={}',
          vueRouter: 'window.VueRouter={}',
        },
      },
    )
    const srcdoc = readFrontendSrcdoc(result.document)

    expect(srcdoc).toContain('Font Awesome 7 Free')
    expect(srcdoc).toContain('window.jQuery.ui={audit:true}')
    expect(srcdoc).toContain('window.jQuery.ui.touchPunch=true')
    expect(srcdoc).toContain('window.log=window.log||')
    expect(result.document).toContain('__SRL_RENDER_COMPAT_HOST__')
    expect(result.document).toContain('formatAsDisplayedMessage')
    expect(result.document).not.toContain('window.Mvu={')
    expect(result.compatibilityDiagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          capability: 'mvu.opening-preview',
          implementationStatus: 'UNSUPPORTED',
          parityStatus: 'UNSUPPORTED_HOST_BOUND',
        }),
      ]),
    )
  })
})
