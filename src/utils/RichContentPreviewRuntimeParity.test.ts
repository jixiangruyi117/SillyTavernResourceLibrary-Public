/** @vitest-environment jsdom */

import { describe, expect, it } from 'vitest'

import { buildRichContentPreview } from './RichContentPreview'

const scriptPolicy = { allowRemoteResources: true, allowScripts: true }

function readFrontendSrcdoc(documentSource: string): string {
  const body = new DOMParser().parseFromString(documentSource, 'text/html').body
  return body.querySelector<HTMLIFrameElement>('div.TH-render iframe')?.getAttribute('srcdoc') ?? ''
}

describe('RichContentPreview shared compatibility runtime', () => {
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
