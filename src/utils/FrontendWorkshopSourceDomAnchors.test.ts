import { JSDOM, VirtualConsole } from 'jsdom'
import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import deepSea from '../templates/FrontendWorkshopDeepSea.html?raw'
import { createFrontendWorkshopSourceDocument } from '../types/FrontendWorkshopSourceDocument'
import { AppDatabase } from '../database/AppDatabase'
import { IndexedDbFrontendWorkshopSourceDocumentStorage } from '../storage/IndexedDbFrontendWorkshopSourceDocumentStorage'
import { FrontendWorkshopSourceDocumentService } from '../services/FrontendWorkshopSourceDocumentService'
import { FrontendWorkshopSourcePatchService } from '../services/FrontendWorkshopSourcePatchService'
import { FrontendWorkshopSourceHistoryService } from '../services/FrontendWorkshopSourceHistoryService'
import { analyzeFrontendWorkshopSource } from './FrontendWorkshopSourceAnalysis'
import { mapFrontendWorkshopRuntimeDomSnapshot } from './FrontendWorkshopRuntimeDomProvenance'
import { resolveFrontendWorkshopSourceSelection } from './FrontendWorkshopSourceSelection'
import { projectFrontendWorkshopSourceDomAnchors } from './FrontendWorkshopSourceDomAnchors'
import {
  createFrontendWorkshopSourceRuntimeInstance,
  FRONTEND_WORKSHOP_SOURCE_RUNTIME_EVENTS as events,
  FRONTEND_WORKSHOP_SOURCE_RUNTIME_PROTOCOL as protocol,
  type FrontendWorkshopSourceRuntimeDomSnapshot,
} from './FrontendWorkshopSourceRuntime'

async function render(authorSource: string) {
  const source = createFrontendWorkshopSourceDocument('anchored-source', authorSource, 100)
  const runtime = createFrontendWorkshopSourceRuntimeInstance(source, {
    sourceMapping: true,
    instanceId: 'instance-a',
    runtimeNonce: 'nonce-a',
  })
  const messages: Array<Record<string, unknown>> = []
  const dom = new JSDOM(runtime.childDocument, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole: new VirtualConsole(),
    beforeParse(win) {
      win.postMessage = (data: Record<string, unknown>) => {
        messages.push(data)
      }
    },
  })
  await new Promise<void>((resolve) =>
    dom.window.addEventListener('load', () => resolve(), { once: true }),
  )
  const snapshot = () => {
    dom.window.dispatchEvent(
      new dom.window.MessageEvent('message', {
        source: dom.window as unknown as Window,
        data: {
          protocol,
          type: events.domSnapshotRequest,
          projectId: source.projectId,
          sourceRevision: source.revision,
          instanceId: 'instance-a',
          runtimeNonce: 'nonce-a',
          requestId: 'test',
        },
      }),
    )
    return messages
      .filter((message) => message.type === events.domSnapshot)
      .at(-1) as unknown as FrontendWorkshopSourceRuntimeDomSnapshot
  }
  return { source, runtime, dom, snapshot }
}

describe('Editor-only parser anchors', () => {
  it('writes and undoes only the selected text through the existing History and storage owners', async () => {
    const { source, dom, snapshot } = await render(
      '<p>Original</p><p>Keep</p><script>document.body.dataset.ready="yes"</script>',
    )
    const database = new AppDatabase(`anchor-history-${crypto.randomUUID()}`)
    try {
      const documents = new FrontendWorkshopSourceDocumentService(
        new IndexedDbFrontendWorkshopSourceDocumentStorage(database),
      )
      const history = new FrontendWorkshopSourceHistoryService(
        documents,
        new FrontendWorkshopSourcePatchService(documents),
      )
      await documents.saveAuthorSource(source.projectId, source.authorSource, { now: 100 })
      const analysis = analyzeFrontendWorkshopSource(source)
      const capture = snapshot()
      const node = capture.nodes.find((entry) => entry.tagName === 'p')!
      const mapping = mapFrontendWorkshopRuntimeDomSnapshot(source, analysis, capture)
      const selection = resolveFrontendWorkshopSourceSelection(
        source,
        analysis,
        {
          ...capture,
          ...node,
          tagName: 'p',
          rect: { x: 0, y: 0, width: 1, height: 1 },
        },
        mapping.nodes.find((entry) => entry.runtimeNodeId === node.runtimeNodeId),
      )
      expect(selection.exactTextTarget).toBeDefined()
      const result = await history.applyAndRecord(
        {
          projectId: source.projectId,
          sourceRevision: source.revision,
          edits: [
            {
              target: selection.exactTextTarget!,
              expectedText: 'Original',
              replacement: '修改成功',
            },
          ],
        },
        { label: '修改选中文字' },
      )
      expect(result.document.authorSource).toBe(source.authorSource.replace('Original', '修改成功'))
      const undone = await history.undo(source.projectId)
      expect(undone?.authorSource).toBe(source.authorSource)
      expect((await documents.get(source.projectId))?.authorSource).toBe(source.authorSource)
    } finally {
      dom.window.dispatchEvent(new dom.window.Event('pagehide'))
      dom.window.close()
      await database.delete()
    }
  })
  it('maps id-less authored elements beside scripts and duplicate ids, preserving source and final preview', async () => {
    const html =
      '<h1>Hello</h1><p id="same">One</p><p id="same">Two</p><img src="data:,x"><button>Open</button><script>document.querySelector("h1").style.opacity="1"</script>'
    const { source, dom, snapshot } = await render(html)
    try {
      const analysis = analyzeFrontendWorkshopSource(source)
      const capture = snapshot()
      const mapping = mapFrontendWorkshopRuntimeDomSnapshot(source, analysis, capture)
      const nodes = capture.nodes.filter((node) =>
        ['h1', 'p', 'img', 'button'].includes(node.tagName ?? ''),
      )
      expect(nodes).toHaveLength(5)
      for (const node of nodes) {
        const mapped = mapping.nodes.find((entry) => entry.runtimeNodeId === node.runtimeNodeId)!
        expect(mapped.mappingConfidence).toBe('exact')
        const selection = resolveFrontendWorkshopSourceSelection(
          source,
          analysis,
          {
            ...capture,
            runtimeNodeId: node.runtimeNodeId,
            treeScope: node.treeScope,
            tagName: node.tagName!,
            rect: { x: 0, y: 0, width: 1, height: 1 },
          },
          mapped,
        )
        expect(selection.sourceRange).toBeDefined()
        if (node.tagName === 'p') expect(selection.exactTextTarget).toBeDefined()
      }
      expect(source.authorSource).toBe(html)
      expect(createFrontendWorkshopSourceRuntimeInstance(source).childDocument).toContain(
        `\n${html}\n</body>`,
      )
      expect(dom.window.document.querySelector('h1')!.outerHTML).toBe(
        '<h1 style="opacity: 1;">Hello</h1>',
      )
    } finally {
      dom.window.dispatchEvent(new dom.window.Event('pagehide'))
      dom.window.close()
    }
  })

  it('does not give copied markers to clones or replacements, including synchronous mutations before the observer runs', async () => {
    const { source, dom, snapshot } =
      await render(`<section><p class="original">Original</p></section><i>Replaced</i><script>
      const original=document.querySelector('p'); const clone=original.cloneNode(true); clone.className='clone'; document.body.append(clone);
      const old=document.querySelector('i'); old.replaceWith(old.cloneNode(true));
      document.body.append(original);
    </script>`)
    try {
      const capture = snapshot()
      const paragraphs = capture.nodes.filter((node) => node.tagName === 'p')
      expect(paragraphs).toHaveLength(2)
      expect(paragraphs.filter((node) => node.sourceEntityId)).toHaveLength(1)
      expect(capture.nodes.find((node) => node.tagName === 'i')?.sourceEntityId).toBeUndefined()
      const original = dom.window.document.querySelector('.original')!
      original.remove()
      dom.window.document.body.append(original.cloneNode(true))
      const later = snapshot()
      expect(
        later.nodes.filter((node) => node.tagName === 'p').every((node) => !node.sourceEntityId),
      ).toBe(true)
      const stale = { ...source, revision: source.revision + 1 }
      expect(
        mapFrontendWorkshopRuntimeDomSnapshot(
          stale,
          analyzeFrontendWorkshopSource(stale),
          capture,
        ).nodes.every((node) => !node.sourceEntityId),
      ).toBe(true)
    } finally {
      dom.window.dispatchEvent(new dom.window.Event('pagehide'))
      dom.window.close()
    }
  })

  it('handles the actual DS template headings, image, paragraphs and buttons without changing its script', async () => {
    const { source, dom, snapshot } = await render(deepSea)
    try {
      const capture = snapshot()
      const mapping = mapFrontendWorkshopRuntimeDomSnapshot(
        source,
        analyzeFrontendWorkshopSource(source),
        capture,
      )
      for (const tag of ['h1', 'img', 'p', 'button']) {
        const nodes = capture.nodes.filter((node) => node.tagName === tag)
        expect(nodes.length).toBeGreaterThan(0)
        for (const node of nodes)
          expect(
            mapping.nodes.find((entry) => entry.runtimeNodeId === node.runtimeNodeId)?.provenance
              .kind,
          ).toBe('static-source')
      }
      expect(dom.window.document.querySelector('h1')!.textContent).toContain('沈砚潮')
      expect(source.authorSource).toBe(deepSea)
    } finally {
      dom.window.dispatchEvent(new dom.window.Event('pagehide'))
      dom.window.close()
    }
  })

  it('leaves raw text, template contents, unknown syntax and author attributes intact', () => {
    const source =
      '<textarea><p>raw</p></textarea><template><p>cloned later</p></template><p title="a > b">ok</p><img src=x/><script>"<h1>text</h1>"</script>'
    const projection = projectFrontendWorkshopSourceDomAnchors(source, 'data-test-anchor')
    expect(projection.anchors.map((anchor) => anchor.tagName)).toEqual(['textarea', 'p', 'img'])
    expect(projection.html).toContain('<template><p>cloned later</p></template>')
    expect(projection.html).toContain('<img data-test-anchor="2" src=x/>')
    expect(projection.html).toContain('<script>"<h1>text</h1>"</script>')
  })
})
