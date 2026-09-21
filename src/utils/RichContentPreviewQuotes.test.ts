/** @vitest-environment jsdom */

import { describe, expect, it } from 'vitest'

import { buildRichContentPreview } from './RichContentPreview'

const staticPolicy = { allowRemoteResources: false, allowScripts: false }

function readOuterBody(documentSource: string): HTMLElement {
  return new DOMParser().parseFromString(documentSource, 'text/html').body
}

describe('RichContentPreview quote rendering parity', () => {
  it('keeps SillyTavern q markup but suppresses browser-generated extra quotes like upstream CSS', () => {
    const result = buildRichContentPreview('\u201c\u5582\u3002\u201d', 'quote', staticPolicy, [], {
      renderShell: 'content',
    })

    expect(readOuterBody(result.document).querySelector('.mes_text')?.innerHTML).toContain(
      '<q>\u201c\u5582\u3002\u201d</q>',
    )
    expect(result.document).toContain(
      ".mes q::before,.mes q::after,.mes_text q::before,.mes_text q::after{content:''}",
    )
  })

  it('reposts outer preview height when measured child layout changes', () => {
    const result = buildRichContentPreview(
      '```html\n<html><body><main style="min-height:100vh">screen</main></body></html>\n```',
      'height',
      { allowRemoteResources: true, allowScripts: true },
      [],
      { renderShell: 'content' },
    )

    expect(result.document).toContain("event.data?.type==='SRL_VIEWPORT_HEIGHT'")
    expect(result.document).toContain(
      "parent.postMessage({type:'SRL_FRAME_LAYOUT_READY',viewportBound},'*')",
    )
    expect(result.document).toContain(
      "if(frame.dataset.srlViewportBound==='true')frame.contentWindow?.postMessage({type:'SRL_VIEWPORT_HEIGHT',height:hostViewportHeight},'*')",
    )
    expect(result.document).toContain(
      "window.addEventListener('message',event=>{if(event.data?.type==='SRL_FRAME_LAYOUT_READY')queue()})",
    )
  })
})
