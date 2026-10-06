import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'

import { createFrontendWorkshopSourceDocument } from '../types/FrontendWorkshopSourceDocument'
import { createFrontendWorkshopSourceRuntimeInstance } from './FrontendWorkshopSourceRuntime'
import { buildRenderCompatibilityChildAdapter } from './RenderCompatibilityRuntime'

describe('FrontendWorkshop Source Runtime security boundary', () => {
  it('forwards greeting navigation only from the active child and binds the current identity', () => {
    const runtime = createFrontendWorkshopSourceRuntimeInstance(
      createFrontendWorkshopSourceDocument('greeting-bridge', '<main>intro</main>', 1),
      { instanceId: 'greeting-instance', runtimeNonce: 'greeting-nonce' },
    )
    const bridge = [...runtime.hostDocument.matchAll(/<script>([\s\S]*?)<\/script>/g)]
      .map((match) => match[1])
      .find((script) =>
        script?.includes('const frame=document.getElementById(identity.iframeName)'),
      )!
    const dom = new JSDOM('<iframe id="TH-message--0--0"></iframe>', { runScripts: 'outside-only' })
    const messages: unknown[] = []
    dom.window.postMessage = (message: unknown) => {
      messages.push(message)
    }
    dom.window.eval(bridge)
    const data = { protocol: 'srl-render-compat-v1', type: 'SRL_GREETING_NAVIGATE', target: 2 }
    dom.window.dispatchEvent(new dom.window.MessageEvent('message', { source: null, data }))
    expect(messages).toHaveLength(0)
    dom.window.dispatchEvent(
      new dom.window.MessageEvent('message', {
        source: dom.window.document.querySelector('iframe')!.contentWindow,
        data,
      }),
    )
    expect(messages).toEqual([
      expect.objectContaining({
        protocol: 'srl-fw-source-runtime-v1',
        type: 'SRL_FW_SOURCE_GREETING_NAVIGATE',
        target: 2,
        projectId: 'greeting-bridge',
        sourceRevision: 1,
        instanceId: 'greeting-instance',
        runtimeNonce: 'greeting-nonce',
      }),
    ])
    dom.window.close()
  })

  it('keeps the outer iframe opaque while self-hosting the controlled compatibility surface', () => {
    const source = createFrontendWorkshopSourceDocument(
      'security-boundary',
      '<main id="author">author</main>',
      100,
    )
    const runtime = createFrontendWorkshopSourceRuntimeInstance(source, {
      instanceId: 'security-instance',
      runtimeNonce: 'security-nonce',
      iframeName: 'TH-message--security--0',
      vendorLibs: {
        lodash: 'window._={fixture:true}',
        showdown: 'window.showdown={fixture:true}',
        vendorGlobals: 'window.YAML={fixture:true};window.z={fixture:true}',
      },
    })

    expect(runtime.sandbox).toContain('allow-scripts')
    expect(runtime.sandbox).not.toContain('allow-same-origin')

    expect(runtime.childDocument).toContain('window.__SRL_RENDER_COMPAT_HOST__')
    expect(runtime.childDocument).toContain('window._={fixture:true}')
    expect(runtime.childDocument).toContain('window.showdown={fixture:true}')
    expect(runtime.childDocument).toContain('window.YAML={fixture:true};window.z={fixture:true}')

    expect(runtime.childDocument).not.toContain('window.parent.__SRL_RENDER_COMPAT_HOST__')
    expect(runtime.childDocument).not.toContain('window.parent.document')
    expect(runtime.childDocument).not.toContain('window._=window.parent._')
    expect(runtime.childDocument).not.toContain('window.showdown=window.parent.showdown')
    expect(runtime.childDocument).not.toContain('window.YAML=window.parent.YAML')
    expect(runtime.childDocument).not.toContain('window.z=window.parent.z')

    const outerBeforeSrcdoc = runtime.hostDocument.slice(
      0,
      runtime.hostDocument.indexOf('frame.srcdoc='),
    )
    expect(outerBeforeSrcdoc).not.toContain('__SRL_RENDER_COMPAT_HOST__')
    expect(outerBeforeSrcdoc).not.toContain('window._={fixture:true}')
  })

  it('keeps parent-host semantics as the default for existing Resource Preview adapters', () => {
    const defaultAdapter = buildRenderCompatibilityChildAdapter()
    const sourceAdapter = buildRenderCompatibilityChildAdapter(undefined, { hostScope: 'self' })

    expect(defaultAdapter).toContain('const host=window.parent.__SRL_RENDER_COMPAT_HOST__')
    expect(defaultAdapter).toContain('window.parent.document')
    expect(defaultAdapter).toContain('parent.postMessage({protocol:host.protocol')

    expect(sourceAdapter).toContain('const host=window.__SRL_RENDER_COMPAT_HOST__')
    expect(sourceAdapter).toContain('window.postMessage({protocol:host.protocol')
    expect(sourceAdapter).not.toContain('window.parent.__SRL_RENDER_COMPAT_HOST__')
    expect(sourceAdapter).not.toContain('window.parent.document')
  })
})
