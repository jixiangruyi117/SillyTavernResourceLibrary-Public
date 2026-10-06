import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'
import { createFrontendWorkshopSourceDocument } from '../types/FrontendWorkshopSourceDocument'
import {
  createFrontendWorkshopSourceRuntimeInstance,
  FRONTEND_WORKSHOP_SOURCE_RUNTIME_EVENTS as events,
  FRONTEND_WORKSHOP_SOURCE_RUNTIME_PROTOCOL as protocol,
} from './FrontendWorkshopSourceRuntime'

describe('Source element list selection protocol', () => {
  it('selects only live listed nodes from the current trusted parent and runtime', () => {
    const source = createFrontendWorkshopSourceDocument(
      'selection-test',
      '<h1 id="title">人物介绍</h1>',
      100,
    )
    const runtime = createFrontendWorkshopSourceRuntimeInstance(source, {
      instanceId: 'selection-a',
      runtimeNonce: 'nonce-a',
    })
    const dom = new JSDOM(source.authorSource, { runScripts: 'outside-only' })
    const win = dom.window
    const messages: Array<Record<string, unknown>> = []
    win.postMessage = (message: Record<string, unknown>) => {
      messages.push(message)
    }
    win.HTMLElement.prototype.scrollIntoView = () => {}
    const lifecycle = [...runtime.childDocument.matchAll(/<script>([\s\S]*?)<\/script>/g)]
      .map((match) => match[1])
      .find((script) => script?.includes('const selectableDomNodes=new Map()'))
    expect(lifecycle).toBeTruthy()
    win.eval(lifecycle!)
    const identity = {
      protocol,
      projectId: source.projectId,
      sourceRevision: source.revision,
      instanceId: 'selection-a',
      runtimeNonce: 'nonce-a',
    }
    const send = (type: string, extra: Record<string, unknown> = {}, trusted = true) =>
      win.dispatchEvent(
        new win.MessageEvent('message', {
          source: trusted ? (win as unknown as Window) : null,
          data: { ...identity, type, ...extra },
        }),
      )
    send(events.domSnapshotRequest, { requestId: 'list' })
    const snapshot = messages.find((message) => message.type === events.domSnapshot)!
    const node = (
      snapshot.nodes as Array<{ elementId?: string; runtimeNodeId: string; label?: string }>
    ).find((item) => item.elementId === 'title')!
    expect(node.label).toBe('人物介绍')
    const selections = () => messages.filter((message) => message.type === events.domSelection)
    send(events.domSelectRequest, { runtimeNodeId: node.runtimeNodeId })
    expect(selections()).toHaveLength(0)
    send(events.domSelectionMode, { enabled: true })
    send(events.domSelectRequest, { runtimeNodeId: node.runtimeNodeId }, false)
    send(events.domSelectRequest, { runtimeNodeId: node.runtimeNodeId, runtimeNonce: 'old' })
    expect(selections()).toHaveLength(0)
    send(events.domSelectRequest, { runtimeNodeId: node.runtimeNodeId })
    expect(selections()).toHaveLength(1)
    expect(selections()[0]).toMatchObject({ elementId: 'title', tagName: 'h1' })
    win.document.getElementById('title')!.remove()
    send(events.domSelectRequest, { runtimeNodeId: node.runtimeNodeId })
    expect(selections()).toHaveLength(1)
    win.dispatchEvent(new win.Event('pagehide'))
    dom.window.close()
  })
})
