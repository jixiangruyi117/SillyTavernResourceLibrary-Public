import { describe, expect, it } from 'vitest'

import { diagnoseFrontendWorkshopSourceCompatibility } from '../services/FrontendWorkshopSourceCompatibilityDiagnosticsService'
import { createFrontendWorkshopSourceDocument } from '../types/FrontendWorkshopSourceDocument'
import { createFrontendWorkshopSourceRuntimeInstance } from './FrontendWorkshopSourceRuntime'

function source(name: string, authorSource: string) {
  return createFrontendWorkshopSourceDocument(name, authorSource, 100)
}

describe('FrontendWorkshop external source viewport sizing', () => {
  it('scrolls the author container under the comparison pointer before chaining to the page', () => {
    const runtime = createFrontendWorkshopSourceRuntimeInstance(
      source('nested', '<main>page</main>'),
    )
    const script = [...runtime.childDocument.matchAll(/<script>([\s\S]*?)<\/script>/g)].find(
      (match) => match[1]?.includes('const scrollAtPoint='),
    )?.[1]
    const root = {}
    const parent = {}
    const pageScrolls: unknown[] = []
    const scroller = {
      scrollTop: 0,
      scrollLeft: 0,
      scrollHeight: 600,
      clientHeight: 100,
      scrollWidth: 100,
      clientWidth: 100,
      parentElement: root,
      scrollBy({ top }: { top: number }) {
        this.scrollTop = Math.max(0, Math.min(500, this.scrollTop + top))
      },
    }
    let receive = (_event: unknown) => {}
    const window = {
      innerWidth: 100,
      innerHeight: 100,
      addEventListener: (type: string, listener: typeof receive) => {
        if (type === 'message') receive = listener
      },
      scrollBy: (data: unknown) => pageScrolls.push(data),
    }
    const document = {
      readyState: 'loading',
      addEventListener() {},
      scrollingElement: root,
      elementFromPoint: () => scroller,
      documentElement: { style: { setProperty() {} } },
    }
    new Function('window', 'document', 'parent', 'getComputedStyle', script!)(
      window,
      document,
      parent,
      () => ({ overflowX: 'hidden', overflowY: 'auto', overscrollBehaviorY: 'auto' }),
    )
    const data = {
      protocol: runtime.protocol,
      projectId: runtime.projectId,
      sourceRevision: runtime.sourceRevision,
      instanceId: runtime.instanceId,
      runtimeNonce: runtime.runtimeNonce,
      type: 'SRL_FW_SOURCE_SCROLL',
      x: 0.5,
      y: 0.5,
      deltaX: 0,
      deltaY: 300,
    }
    receive({ source: parent, data })
    expect(scroller.scrollTop).toBe(300)
    expect(pageScrolls).toEqual([])
    receive({ source: parent, data })
    expect(scroller.scrollTop).toBe(500)
    expect(pageScrolls).toEqual([{ left: 0, top: 100, behavior: 'instant' }])
    receive({ source: parent, data: { ...data, deltaY: NaN } })
    expect(pageScrolls).toHaveLength(1)
  })
  it('keeps viewport sizing independent from reported content while forwarding only authenticated controls', () => {
    const runtime = createFrontendWorkshopSourceRuntimeInstance(
      source('page', '<main>page</main>'),
      {
        sizingMode: 'viewport',
        instanceId: 'page-instance',
        runtimeNonce: 'nonce',
        viewportHeight: 844,
      },
    )
    const identity = {
      projectId: runtime.projectId,
      sourceRevision: runtime.sourceRevision,
      instanceId: runtime.instanceId,
      runtimeNonce: runtime.runtimeNonce,
      protocol: runtime.protocol,
    }
    const messages: unknown[] = []
    const forwarded: unknown[] = []
    const frame = {
      style: { height: '100%' },
      contentWindow: { postMessage: (data: unknown) => forwarded.push(data) },
      addEventListener() {},
      removeEventListener() {},
    }
    const parent = { postMessage: (data: unknown) => messages.push(data) }
    let receive = (_event: unknown) => {}
    const window = {
      addEventListener: (type: string, listener: typeof receive) => {
        if (type === 'message') receive = listener
      },
      removeEventListener() {},
    }
    const script = [...runtime.hostDocument.matchAll(/<script>([\s\S]*?)<\/script>/g)].find(
      (match) => match[1]?.includes('const forward=new Set'),
    )?.[1]
    new Function('window', 'document', 'parent', script!)(
      window,
      { getElementById: () => frame },
      parent,
    )
    receive({
      source: frame.contentWindow,
      data: { ...identity, type: 'SRL_FW_SOURCE_HEIGHT', height: 33_554_432 },
    })
    expect(frame.style.height).toBe('100%')
    expect(messages).toHaveLength(1)
    const scroll = { ...identity, type: 'SRL_FW_SOURCE_SCROLL', deltaX: 0, deltaY: 100 }
    receive({ source: {}, data: scroll })
    receive({ source: parent, data: { ...scroll, runtimeNonce: 'stale' } })
    expect(forwarded).toEqual([])
    receive({ source: parent, data: scroll })
    expect(forwarded).toEqual([scroll])
    expect(runtime.hostDocument).toContain('height:100%;overflow:hidden;')
  })
  it('boots full-viewport external HTML with a real iframe viewport instead of the old 1px feedback loop', () => {
    const document = source(
      'fixture-full-viewport-html',
      '<main style="min-height:100vh"><div style="position:fixed;inset:0">ready</div></main>',
    )
    const runtime = createFrontendWorkshopSourceRuntimeInstance(document, {
      instanceId: 'instance-viewport',
      runtimeNonce: 'nonce-viewport',
      viewportHeight: 844,
    })

    expect(runtime.hostDocument).toContain(
      'iframe{display:block;width:100%;height:844px;border:0;}',
    )
    expect(runtime.hostDocument).not.toContain(
      'iframe{display:block;width:100%;height:1px;border:0;}',
    )
    expect(runtime.childDocument).toContain(
      "window.addEventListener('load',queueHeight,{once:true})",
    )
    expect(runtime.childDocument).toContain('document.fonts?.ready?.then(queueHeight)')
  })

  it('allows content to shrink below the iframe viewport using the official body measurement', () => {
    const runtime = createFrontendWorkshopSourceRuntimeInstance(
      source('shrink', '<main>hello</main>'),
      { viewportHeight: 844 },
    )
    const script = [...runtime.childDocument.matchAll(/<script>([\s\S]*?)<\/script>/g)].find(
      (match) => match[1]?.includes('const reportHeight='),
    )?.[1]
    expect(script).toBeDefined()
    const heights: number[] = []
    const body = { scrollHeight: 120 }
    let resize = () => undefined as void
    let frame = () => undefined as void
    class Observer {
      constructor(callback: () => void) {
        resize = callback
      }
      observe(target: unknown) {
        expect(target).toBe(body)
      }
      disconnect() {}
    }
    const document = {
      body,
      readyState: 'complete',
      documentElement: { clientHeight: 844, style: { setProperty() {} } },
    }
    const window = { innerHeight: 844, addEventListener() {} }
    const parent = {
      postMessage(data: { type: string; height?: number }) {
        if (data.type === 'SRL_FW_SOURCE_HEIGHT') heights.push(data.height!)
      },
    }
    new Function(
      'window',
      'document',
      'parent',
      'ResizeObserver',
      'requestAnimationFrame',
      script!,
    )(window, document, parent, Observer, (callback: () => void) => {
      frame = callback
      return 1
    })
    frame()
    body.scrollHeight = 40
    resize()
    frame()
    expect(heights).toEqual([120, 40])
  })

  it('keeps browser-only unknown HTML runnable instead of classifying Analyzer uncertainty as an error', () => {
    const report = diagnoseFrontendWorkshopSourceCompatibility(
      source(
        'fixture-browser-only',
        '<fixture-shell><template shadowrootmode="open"><div>ready</div></template></fixture-shell>',
      ),
    )

    expect(
      report.findings.some(
        (finding) => finding.category === 'syntax' && finding.severity === 'error',
      ),
    ).toBe(false)
    expect(report.findings.some((finding) => finding.severity === 'error')).toBe(false)
  })

  it('routes module/build candidates through diagnostics without pretending they are backend-bound', () => {
    const report = diagnoseFrontendWorkshopSourceCompatibility(
      source(
        'fixture-browser-module',
        "import { createApp } from 'vue'; interface ViewState { open: boolean }",
      ),
    )

    expect(report.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ category: 'module-build', severity: 'info' }),
      ]),
    )
    expect(
      report.findings.some(
        (finding) => finding.category === 'external-host' && finding.severity === 'error',
      ),
    ).toBe(false)
  })

  it('fails closed for genuinely backend-bound external source', () => {
    const report = diagnoseFrontendWorkshopSourceCompatibility(
      source(
        'fixture-backend-bound',
        "const fs = require('fs'); navigator.serviceWorker.register('/worker.js')",
      ),
    )

    expect(report.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ category: 'external-host', severity: 'error' }),
      ]),
    )
  })
})
