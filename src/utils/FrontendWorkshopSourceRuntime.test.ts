import { describe, expect, it } from 'vitest'

import { createFrontendWorkshopSourceDocument } from '../types/FrontendWorkshopSourceDocument'
import {
  createFrontendWorkshopSourceRuntimeInstance,
  FRONTEND_WORKSHOP_SOURCE_RUNTIME_DOM_SNAPSHOT_MAX_NODES,
  FRONTEND_WORKSHOP_SOURCE_RUNTIME_EVENTS,
  FRONTEND_WORKSHOP_SOURCE_RUNTIME_PROTOCOL,
  isFrontendWorkshopSourceRuntimeDomSelection,
  isFrontendWorkshopSourceRuntimeDomSnapshot,
} from './FrontendWorkshopSourceRuntime'

const rawSource = [
  '  <odd-profile-widget data-x="1">',
  '<style>.x{position:fixed;top:7px;background:url(http://example.test/a.png)}</style>',
  '<button onclick="window.__clicked=(window.__clicked||0)+1">go</button>',
  "<script>customElements.define('odd-profile-widget',class extends HTMLElement{});window.__data='data:text/plain,ok'</script>",
  '</odd-profile-widget>  ',
].join('\r\n')

function sourceDocument() {
  return createFrontendWorkshopSourceDocument('project-source-runtime', rawSource, 100)
}

describe('FrontendWorkshopSourceRuntime', () => {
  it('keeps Author Source byte-for-byte inside the runtime body projection', () => {
    const source = sourceDocument()
    const runtime = createFrontendWorkshopSourceRuntimeInstance(source, {
      instanceId: 'instance-a',
      runtimeNonce: 'nonce-a',
      iframeName: 'TH-message--1--0',
      viewportHeight: 844,
    })

    expect(source.authorSource).toBe(rawSource)
    expect(runtime.childDocument).toContain(`\n${rawSource}\n</body>`)
    expect(runtime.childDocument).toContain('onclick="window.__clicked=(window.__clicked||0)+1"')
    expect(runtime.childDocument).toContain("customElements.define('odd-profile-widget'")
    expect(runtime.childDocument).toContain('position:fixed')
    expect(runtime.childDocument).toContain('http://example.test/a.png')
    expect(runtime.childDocument).toContain('data:text/plain,ok')
  })

  it('owns the host scaffold without promoting it into Source Document truth', () => {
    const source = sourceDocument()
    const runtime = createFrontendWorkshopSourceRuntimeInstance(source, {
      instanceId: 'instance-a',
      runtimeNonce: 'nonce-a',
    })

    expect(source.authorSource.startsWith('<!DOCTYPE html>')).toBe(false)
    expect(runtime.childDocument.startsWith('<!DOCTYPE html>')).toBe(true)
    expect(runtime.childDocument.indexOf(rawSource)).toBeGreaterThan(
      runtime.childDocument.indexOf('<body>'),
    )
    expect(runtime.hostDocument).toContain('FrontendWorkshop Source Runtime')
  })

  it('runs scripts in an isolated sandbox while offline policy blocks only network capability', () => {
    const source = sourceDocument()
    const runtime = createFrontendWorkshopSourceRuntimeInstance(source, {
      instanceId: 'instance-a',
      runtimeNonce: 'nonce-a',
      networkMode: 'offline',
    })

    expect(runtime.sandbox).toContain('allow-scripts')
    expect(runtime.sandbox).not.toContain('allow-same-origin')
    expect(runtime.childDocument).toContain('Content-Security-Policy')
    expect(runtime.childDocument).toContain("connect-src 'none'")
    expect(runtime.childDocument).toContain(rawSource)
  })

  it('host network mode does not rewrite Author Source or inject an SRL network CSP', () => {
    const source = sourceDocument()
    const runtime = createFrontendWorkshopSourceRuntimeInstance(source, {
      instanceId: 'instance-a',
      runtimeNonce: 'nonce-a',
      networkMode: 'host',
    })

    expect(runtime.childDocument).not.toContain('Content-Security-Policy')
    expect(runtime.childDocument).toContain(rawSource)
    expect(source.authorSource).toBe(rawSource)
  })

  it('uses disposable instance identity instead of iframe name as identity', () => {
    const source = sourceDocument()
    const first = createFrontendWorkshopSourceRuntimeInstance(source, {
      instanceId: 'instance-a',
      runtimeNonce: 'nonce-a',
      iframeName: 'TH-message--1--0',
    })
    const second = createFrontendWorkshopSourceRuntimeInstance(source, {
      instanceId: 'instance-b',
      runtimeNonce: 'nonce-b',
      iframeName: 'TH-message--1--0',
    })

    expect(first.iframeName).toBe(second.iframeName)
    expect(first.instanceId).not.toBe(second.instanceId)
    expect(first.runtimeNonce).not.toBe(second.runtimeNonce)
    expect(first.childDocument).toContain('instance-a')
    expect(second.childDocument).toContain('instance-b')
  })

  it('signals frontend-specific mount/pagehide/height lifecycle instead of using load as ready', () => {
    const runtime = createFrontendWorkshopSourceRuntimeInstance(sourceDocument(), {
      instanceId: 'instance-a',
      runtimeNonce: 'nonce-a',
    })

    expect(runtime.childDocument).toContain(FRONTEND_WORKSHOP_SOURCE_RUNTIME_PROTOCOL)
    expect(runtime.childDocument).toContain(FRONTEND_WORKSHOP_SOURCE_RUNTIME_EVENTS.mount)
    expect(runtime.childDocument).toContain(FRONTEND_WORKSHOP_SOURCE_RUNTIME_EVENTS.pagehide)
    expect(runtime.childDocument).toContain(FRONTEND_WORKSHOP_SOURCE_RUNTIME_EVENTS.height)
    expect(runtime.hostDocument).toContain('event.source===frame.contentWindow')
    expect(runtime.hostDocument).toContain('data.runtimeNonce===identity.runtimeNonce')
  })

  it('keeps content sizing scrollbars out of both nested frames without changing viewport scrolling or source', () => {
    const source = sourceDocument()
    const content = createFrontendWorkshopSourceRuntimeInstance(source, { sizingMode: 'content' })
    const viewport = createFrontendWorkshopSourceRuntimeInstance(source, { sizingMode: 'viewport' })
    const rootScrollbarStyle =
      '<style>html{scrollbar-width:none}html::-webkit-scrollbar{display:none}</style>'

    expect(content.childDocument).toContain(rootScrollbarStyle)
    expect(content.hostDocument).toContain('max-width:100%;overflow:hidden;')
    expect(viewport.childDocument).not.toContain(rootScrollbarStyle)
    expect(viewport.hostDocument).toContain('height:100%;overflow:hidden;')
    expect(content.childDocument).toContain(`\n${rawSource}\n</body>`)
    expect(viewport.childDocument).toContain(`\n${rawSource}\n</body>`)
    expect(source.authorSource).toBe(rawSource)
  })

  it('adds an on-demand bounded DOM snapshot channel without rewriting Author Source', () => {
    const runtime = createFrontendWorkshopSourceRuntimeInstance(sourceDocument(), {
      instanceId: 'instance-a',
      runtimeNonce: 'nonce-a',
    })

    expect(runtime.childDocument).toContain(
      FRONTEND_WORKSHOP_SOURCE_RUNTIME_EVENTS.domSnapshotRequest,
    )
    expect(runtime.childDocument).toContain(FRONTEND_WORKSHOP_SOURCE_RUNTIME_EVENTS.domSnapshot)
    expect(runtime.childDocument).toContain(
      `const maxDomNodes=${FRONTEND_WORKSHOP_SOURCE_RUNTIME_DOM_SNAPSHOT_MAX_NODES}`,
    )
    expect(runtime.childDocument).toContain("treeScope:'shadow'")
    expect(runtime.childDocument).toContain('firstSeenSequence')
    expect(runtime.hostDocument).toContain(FRONTEND_WORKSHOP_SOURCE_RUNTIME_EVENTS.domSnapshot)
    expect(runtime.childDocument).toContain(`\n${rawSource}\n</body>`)
  })

  it('adds a controlled selection mode that reuses snapshot runtime node identity', () => {
    const runtime = createFrontendWorkshopSourceRuntimeInstance(sourceDocument(), {
      instanceId: 'instance-a',
      runtimeNonce: 'nonce-a',
    })

    expect(runtime.childDocument).toContain(
      FRONTEND_WORKSHOP_SOURCE_RUNTIME_EVENTS.domSelectionMode,
    )
    expect(runtime.childDocument).toContain(FRONTEND_WORKSHOP_SOURCE_RUNTIME_EVENTS.domSelection)
    expect(runtime.childDocument).toContain(
      'getDomNodeMetadata(node,Math.max(1,domSnapshotSequence+1))',
    )
    expect(runtime.childDocument).toContain("window.addEventListener('click',selectDomNode,true)")
    expect(runtime.childDocument).toContain('event.stopImmediatePropagation()')
    expect(runtime.childDocument).toContain('getBoundingClientRect()')
    expect(runtime.hostDocument).toContain(FRONTEND_WORKSHOP_SOURCE_RUNTIME_EVENTS.domSelection)
    expect(runtime.hostDocument).toContain(FRONTEND_WORKSHOP_SOURCE_RUNTIME_EVENTS.domSelectionMode)
  })

  it('validates runtime DOM snapshots before they enter the parent analysis layer', () => {
    const valid = {
      projectId: 'project-source-runtime',
      sourceRevision: 1,
      instanceId: 'instance-a',
      runtimeNonce: 'nonce-a',
      requestId: 'request-1',
      snapshotSequence: 2,
      nodes: [
        {
          runtimeNodeId: 'runtime-node-1',
          nodeKind: 'element',
          treeScope: 'document',
          firstSeenSequence: 1,
          tagName: 'div',
          elementId: 'hero',
        },
        {
          runtimeNodeId: 'runtime-node-2',
          nodeKind: 'text',
          treeScope: 'document',
          firstSeenSequence: 2,
          parentRuntimeNodeId: 'runtime-node-1',
          textLength: 4,
        },
      ],
      truncated: false,
    }

    expect(isFrontendWorkshopSourceRuntimeDomSnapshot(valid)).toBe(true)
    expect(
      isFrontendWorkshopSourceRuntimeDomSnapshot({
        ...valid,
        nodes: [
          {
            ...valid.nodes[0],
            firstSeenSequence: 3,
          },
        ],
      }),
    ).toBe(false)
    expect(
      isFrontendWorkshopSourceRuntimeDomSnapshot({
        ...valid,
        nodes: Array.from(
          { length: FRONTEND_WORKSHOP_SOURCE_RUNTIME_DOM_SNAPSHOT_MAX_NODES + 1 },
          (_, index) => ({
            runtimeNodeId: `runtime-node-${index}`,
            nodeKind: 'text',
            treeScope: 'document',
            firstSeenSequence: 1,
            textLength: 0,
          }),
        ),
      }),
    ).toBe(false)
  })

  it('validates bounded runtime DOM selections before the Inspector bridge consumes them', () => {
    const valid = {
      projectId: 'project-source-runtime',
      sourceRevision: 1,
      instanceId: 'instance-a',
      runtimeNonce: 'nonce-a',
      runtimeNodeId: 'runtime-node-1',
      treeScope: 'document',
      tagName: 'div',
      elementId: 'hero',
      rect: { x: 10.5, y: -2, width: 120, height: 40 },
    }

    expect(isFrontendWorkshopSourceRuntimeDomSelection(valid)).toBe(true)
    expect(isFrontendWorkshopSourceRuntimeDomSelection({ ...valid, runtimeNodeId: '' })).toBe(false)
    expect(isFrontendWorkshopSourceRuntimeDomSelection({ ...valid, treeScope: 'unknown' })).toBe(
      false,
    )
    expect(
      isFrontendWorkshopSourceRuntimeDomSelection({ ...valid, elementId: 'x'.repeat(1025) }),
    ).toBe(false)
    expect(
      isFrontendWorkshopSourceRuntimeDomSelection({
        ...valid,
        rect: { ...valid.rect, width: Number.POSITIVE_INFINITY },
      }),
    ).toBe(false)
    expect(
      isFrontendWorkshopSourceRuntimeDomSelection({
        ...valid,
        rect: { ...valid.rect, height: -1 },
      }),
    ).toBe(false)
  })

  it('installs per-instance ephemeral storage before Author Source executes', () => {
    const runtime = createFrontendWorkshopSourceRuntimeInstance(sourceDocument(), {
      instanceId: 'instance-a',
      runtimeNonce: 'nonce-a',
    })

    expect(runtime.childDocument.indexOf("install('localStorage')")).toBeLessThan(
      runtime.childDocument.indexOf(rawSource),
    )
    expect(runtime.childDocument.indexOf("install('sessionStorage')")).toBeLessThan(
      runtime.childDocument.indexOf(rawSource),
    )
  })

  it('consumes the same compatibility Host Owner as resource previews', () => {
    const runtime = createFrontendWorkshopSourceRuntimeInstance(sourceDocument(), {
      instanceId: 'instance-a',
      runtimeNonce: 'nonce-a',
    })

    expect(runtime.childDocument).toContain('window.__SRL_RENDER_COMPAT_HOST__')
    expect(runtime.childDocument).not.toContain('window.parent.__SRL_RENDER_COMPAT_HOST__')
    expect(runtime.childDocument).toContain('formatAsDisplayedMessage')
    expect(
      runtime.hostDocument.slice(0, runtime.hostDocument.indexOf('frame.srcdoc=')),
    ).not.toContain('__SRL_RENDER_COMPAT_HOST__')
    expect(runtime.childDocument).not.toContain('window.Mvu=')
    expect(runtime.compatibilityDiagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          capability: 'message.format',
          implementationStatus: 'PARTIAL',
          parityStatus: 'UNVERIFIED',
        }),
        expect.objectContaining({
          capability: 'mvu.opening-preview',
          implementationStatus: 'UNSUPPORTED',
          parityStatus: 'UNSUPPORTED_HOST_BOUND',
        }),
      ]),
    )
  })

  it('injects bridged vendors directly into the opaque-origin author iframe', () => {
    const runtime = createFrontendWorkshopSourceRuntimeInstance(sourceDocument(), {
      instanceId: 'instance-a',
      runtimeNonce: 'nonce-a',
      vendorLibs: {
        lodash: 'window._={direct:true}',
        showdown: 'window.showdown={direct:true}',
        vendorGlobals: 'window.YAML={direct:true};window.z={direct:true}',
      },
    })

    expect(runtime.childDocument).toContain('window._={direct:true}')
    expect(runtime.childDocument).toContain('window.showdown={direct:true}')
    expect(runtime.childDocument).toContain('window.YAML={direct:true};window.z={direct:true}')
    expect(runtime.childDocument).not.toContain('if(window.parent)')
    expect(
      runtime.hostDocument.slice(0, runtime.hostDocument.indexOf('frame.srcdoc=')),
    ).not.toContain('window._={direct:true}')
  })
})
