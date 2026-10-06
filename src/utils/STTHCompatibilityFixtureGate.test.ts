/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { createFrontendWorkshopSourceDocument } from '../types/FrontendWorkshopSourceDocument'
import { diagnoseFrontendWorkshopSourceCompatibility } from '../services/FrontendWorkshopSourceCompatibilityDiagnosticsService'
import { createFrontendWorkshopSourceRuntimeInstance } from './FrontendWorkshopSourceRuntime'
import { detectVendorLibNeeds } from './PreviewVendorLibs'
import {
  buildRenderCompatibilityChildAdapter,
  buildRenderCompatibilityHostRuntime,
  createRenderCompatibilityContextFromPreviewSession,
  RENDER_COMPATIBILITY_EVENTS,
  RENDER_COMPATIBILITY_PROTOCOL,
  RENDER_COMPATIBILITY_TAVERN_EVENTS,
  type PreviewSessionContext,
} from './RenderCompatibilityRuntime'
import { buildRichContentPreview, replacePreviewMacros } from './RichContentPreview'

const policy = { allowRemoteResources: false, allowScripts: true }

interface FixtureHost {
  invoke(name: string, args?: unknown[], meta?: Record<string, unknown>): unknown
  subscribe(
    type: string,
    listener: (...args: unknown[]) => unknown,
    owner: object,
    once?: boolean,
  ): { stop(): void }
  emit(type: string, args?: unknown[]): Promise<void>
  transitionSwipe(target: number): Promise<boolean>
  teardown(): void
}

function currentHost(): FixtureHost | undefined {
  return (
    window as unknown as {
      __SRL_RENDER_COMPAT_HOST__?: FixtureHost
    }
  ).__SRL_RENDER_COMPAT_HOST__
}

function evaluateHost(session: PreviewSessionContext, expectedFrameCount = 0): FixtureHost {
  const runtimeSource = buildRenderCompatibilityHostRuntime(
    createRenderCompatibilityContextFromPreviewSession(session),
    expectedFrameCount,
  )
    .replace(/^<script>/u, '')
    .replace(/<\/script>$/u, '')
  window.eval(runtimeSource)
  const host = currentHost()
  if (!host) throw new Error('fixture host did not mount')
  return host
}

afterEach(() => {
  currentHost()?.teardown()
  vi.restoreAllMocks()
})

describe('ST/TH anonymous compatibility fixture gate', () => {
  it('fixture-basic-html runs through Resource and Workshop preview owners', () => {
    const source =
      '<main class="fixture-basic-html"><script>document.body.dataset.ready="true"</script></main>'
    const resource = buildRichContentPreview(
      `\`\`\`html\n${source}\n\`\`\``,
      'fixture-basic-html',
      policy,
      [],
      { renderShell: 'content' },
    )
    const workshop = createFrontendWorkshopSourceRuntimeInstance(
      createFrontendWorkshopSourceDocument('fixture-basic-html', source, 100),
      { instanceId: 'fixture-instance', runtimeNonce: 'fixture-nonce' },
    )
    expect(resource.document).toContain('fixture-basic-html')
    expect(workshop.childDocument).toContain(source)
  })

  it('fixture-macro-status remains a Resource preprocessing concern', () => {
    expect(
      replacePreviewMacros('{{char}} / {{user}}', {
        charName: 'fixture-character',
        userName: 'fixture-user',
      }),
    ).toBe('fixture-character / fixture-user')
  })

  it('fixture-regex-placeholder runs Macro then Character Regex before the shared Formatter', () => {
    const resource = buildRichContentPreview(
      '{{char}} <fixture-placeholder>state</fixture-placeholder>',
      'fixture-regex-placeholder',
      policy,
      [],
      {
        renderShell: 'content',
        macroCharName: 'fixture-character',
        displayRegexRules: [
          {
            id: 'fixture-regex',
            name: 'fixture-regex-placeholder',
            find: '/<fixture-placeholder>([\\s\\S]*?)<\\/fixture-placeholder>/g',
            replace: '<section data-fixture-regex="$1">{{char}}:$1</section>',
            phase: 'markdown',
          },
        ],
      },
    )

    expect(resource.document).toContain('data-fixture-regex="state"')
    expect(resource.document).toContain('fixture-character:state')
    expect(resource.document).not.toContain('<fixture-placeholder>')
  })

  it('fixture-swipe-state uses the shared PreviewSession runtime without Source injection', () => {
    const source = '<main class="fixture-swipe-state">ready</main>'
    const runtime = createFrontendWorkshopSourceRuntimeInstance(
      createFrontendWorkshopSourceDocument('fixture-swipe-state', source, 100),
      {
        instanceId: 'fixture-instance',
        runtimeNonce: 'fixture-nonce',
        previewSessionContext: {
          messages: {
            greetings: ['fixture-a', 'fixture-b'],
            activeSwipe: 1,
            swipesData: [{ value: 1 }, { value: 2 }],
          },
        },
      },
    )
    expect(source).not.toContain('fixture-a')
    expect(runtime.childDocument).toContain('"greetingIndex":1')
  })

  it('fixture-companion-script keeps lifecycle ownership in the existing Runtime', () => {
    const runtime = createFrontendWorkshopSourceRuntimeInstance(
      createFrontendWorkshopSourceDocument(
        'fixture-companion-script',
        '<script>window.addEventListener("pagehide",()=>{})</script>',
        100,
      ),
      { instanceId: 'fixture-instance', runtimeNonce: 'fixture-nonce' },
    )
    expect(runtime.childDocument).toContain('SRL_FW_SOURCE_MOUNT')
    expect(runtime.childDocument).toContain('SRL_FW_SOURCE_PAGEHIDE')
  })

  it('fixture-mobile-viewport reports overflow locally and keeps parity unverified', () => {
    const report = diagnoseFrontendWorkshopSourceCompatibility(
      createFrontendWorkshopSourceDocument(
        'fixture-mobile-viewport',
        '<style>.panel{width:900px;height:100vh}</style>',
        100,
      ),
    )
    expect(report.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ category: 'mobile-overflow', severity: 'warning' }),
        expect.objectContaining({ category: 'viewport', severity: 'warning' }),
      ]),
    )
  })

  it('fixture-event-state uses the existing event owner for on, once, off, emit and runtime events', async () => {
    vi.spyOn(document, 'readyState', 'get').mockReturnValue('loading')
    const host = evaluateHost(
      {
        character: { data: { id: 'fixture-character' } },
        messages: { greetings: ['fixture-a', 'fixture-b'], activeSwipe: 0 },
      },
      1,
    )
    const adapter = buildRenderCompatibilityChildAdapter()
    const observed: string[] = []
    const owner = {}
    const persistent = (payload: unknown) => observed.push(`persistent:${String(payload)}`)
    host.subscribe('fixture_custom_event', persistent, owner)
    host.subscribe(
      'fixture_custom_event',
      (payload) => observed.push(`once:${String(payload)}`),
      owner,
      true,
    )
    host.subscribe(
      RENDER_COMPATIBILITY_TAVERN_EVENTS.APP_READY,
      () => observed.push('runtime:app-ready'),
      owner,
    )
    host.subscribe(
      RENDER_COMPATIBILITY_TAVERN_EVENTS.MESSAGE_SWIPED,
      (messageId) => observed.push(`runtime:swiped:${Number(messageId)}`),
      owner,
    )

    document.dispatchEvent(new Event('DOMContentLoaded'))
    await host.emit('fixture_custom_event', ['a'])
    await host.emit('fixture_custom_event', ['b'])
    host.invoke('eventOff', ['fixture_custom_event', persistent])
    await host.emit('fixture_custom_event', ['c'])
    await host.transitionSwipe(1)

    expect(Object.keys(RENDER_COMPATIBILITY_TAVERN_EVENTS)).toEqual(
      expect.arrayContaining([
        'APP_READY',
        'MESSAGE_SWIPED',
        'MESSAGE_UPDATED',
        'CHARACTER_MESSAGE_RENDERED',
        'CHARACTER_FIRST_MESSAGE_SELECTED',
      ]),
    )
    expect(adapter).toContain('eventOn:')
    expect(adapter).toContain('eventOnce:')
    expect(adapter).toContain('eventOff:')
    expect(adapter).toContain('eventEmit:')
    expect(observed).toEqual([
      'runtime:app-ready',
      'persistent:a',
      'once:a',
      'persistent:b',
      'runtime:swiped:0',
    ])
  })

  it('fixture-variable-state keeps one canonical message truth and covers every supported scope helper', async () => {
    const canonicalMessage = [{ state: 'fixture-message', nested: { value: 1 } }]
    const host = evaluateHost({
      messages: {
        greetings: ['fixture-message'],
        swipesData: canonicalMessage,
      },
      variables: {
        global: { globalValue: 1 },
        character: { characterValue: 1 },
        chat: { chatValue: 1 },
        message: canonicalMessage,
      },
      mvu: { recognized: false, swipesData: canonicalMessage },
    })
    const messageMeta = { frameName: 'TH-message--0--0' }
    const scriptMeta = {
      frameName: 'TH-script--fixture-script',
      scriptId: 'fixture-script',
      scriptData: { scriptValue: 1 },
    }

    expect(host.invoke('getVariables', [{ type: 'message' }], messageMeta)).toEqual(
      canonicalMessage[0],
    )
    expect(host.invoke('getAllVariables', [], messageMeta)).toEqual(
      expect.objectContaining({
        globalValue: 1,
        characterValue: 1,
        chatValue: 1,
        state: 'fixture-message',
      }),
    )
    expect(host.invoke('replaceVariables', [{ globalValue: 2 }, { type: 'global' }])).toEqual({
      globalValue: 2,
    })
    await expect(
      host.invoke('updateVariablesWith', [
        async (value: Record<string, number>) => ({ ...value, chatValue: 2 }),
        { type: 'chat' },
      ]),
    ).resolves.toEqual({ chatValue: 2 })
    host.invoke('insertVariables', [{ characterValue: 99, inserted: true }, { type: 'character' }])
    expect(host.invoke('getVariables', [{ type: 'character' }])).toEqual({
      characterValue: 1,
      inserted: true,
    })
    host.invoke('insertOrAssignVariables', [
      { nested: { value: 2, added: true } },
      { type: 'message' },
    ])
    expect(host.invoke('deleteVariable', ['nested.value', { type: 'message' }])).toEqual({
      variables: { state: 'fixture-message', nested: { added: true } },
      delete_occurred: true,
    })
    host.invoke(
      'insertOrAssignVariables',
      [{ scriptValue: 2, added: true }, { type: 'script' }],
      scriptMeta,
    )
    expect(host.invoke('getVariables', [{ type: 'script' }], scriptMeta)).toEqual({
      scriptValue: 2,
      added: true,
    })

    expect(() =>
      createRenderCompatibilityContextFromPreviewSession({
        messages: { greetings: ['fixture-message'], swipesData: [{ source: 'messages' }] },
        variables: { message: [{ source: 'variables' }] },
        mvu: { recognized: false, swipesData: [{ source: 'mvu' }] },
      }),
    ).toThrow(/conflict/u)
  })

  it('fixture-vendor-state uses shared detection and injects each selected vendor once', () => {
    const source =
      '<main class="flex"><i class="fa-solid fa-check"></i><script>$("main").draggable();Vue.createApp({});_.clone({});</script></main>'
    const needs = detectVendorLibNeeds(source)
    const runtime = createFrontendWorkshopSourceRuntimeInstance(
      createFrontendWorkshopSourceDocument('fixture-vendor-state', source, 100),
      {
        instanceId: 'fixture-instance',
        runtimeNonce: 'fixture-nonce',
        vendorLibs: {
          jquery: 'window.__fixtureJquery=(window.__fixtureJquery||0)+1',
          jqueryUi: 'window.__fixtureJqueryUi=(window.__fixtureJqueryUi||0)+1',
          lodash: 'window.__fixtureLodash=(window.__fixtureLodash||0)+1',
          vue: 'window.__fixtureVue=(window.__fixtureVue||0)+1',
          tailwind: 'window.__fixtureTailwind=(window.__fixtureTailwind||0)+1',
          fontAwesomeCss: '.fixture-vendor-state{display:block}',
        },
      },
    )

    expect(needs).toEqual(
      expect.objectContaining({
        jquery: true,
        jqueryUi: true,
        lodash: true,
        vue: true,
        tailwind: true,
        fontAwesome: true,
      }),
    )
    for (const marker of [
      '__fixtureJquery=',
      '__fixtureJqueryUi=',
      '__fixtureVue=',
      '__fixtureTailwind=',
    ]) {
      expect(runtime.childDocument.split(marker)).toHaveLength(2)
    }
    expect(runtime.hostDocument.split('__fixtureLodash=')).toHaveLength(2)
  })

  it('fixture-remount-state disposes the old Runtime identity before a new mount', async () => {
    const oldHost = evaluateHost({ messages: { greetings: ['fixture-old'] } })
    const oldEvents: string[] = []
    oldHost.subscribe('fixture-remount', () => oldEvents.push('old'), {})
    window.dispatchEvent(new PageTransitionEvent('pagehide'))

    expect(() => oldHost.invoke('getLastMessageId')).toThrow(/disposed/u)
    const nextHost = evaluateHost({ messages: { greetings: ['fixture-new'] } })
    await nextHost.emit('fixture-remount')
    expect(oldEvents).toEqual([])
    expect(nextHost.invoke('getChatMessages', [0])).toEqual([
      expect.objectContaining({ message: 'fixture-new' }),
    ])
  })

  it('fixture-cleanup-state releases Source observers, queued work and disposable state', () => {
    const runtime = createFrontendWorkshopSourceRuntimeInstance(
      createFrontendWorkshopSourceDocument(
        'fixture-cleanup-state',
        '<main>fixture-cleanup-state</main>',
        100,
      ),
      { instanceId: 'fixture-instance', runtimeNonce: 'fixture-nonce' },
    )
    expect(runtime.childDocument).toContain('resizeObserver?.disconnect?.()')
    expect(runtime.childDocument).toContain('cancelAnimationFrame(heightFrame)')
    expect(runtime.childDocument).toContain('clearTimeout(heightTimer)')
    expect(runtime.childDocument).toContain('delete window.__SRL_FW_SOURCE_RUNTIME__')
    expect(runtime.hostDocument).toContain("window.removeEventListener('message',handleMessage)")
    expect(runtime.hostDocument).toContain("frame.removeEventListener('load',handleFrameLoad)")
  })

  it('fixture-global-cleanup removes host and child injected globals on pagehide', () => {
    evaluateHost({ messages: { greetings: ['fixture-global-cleanup'] } })
    expect(currentHost()).toBeDefined()
    expect((window as unknown as { tavern_events?: unknown }).tavern_events).toBeDefined()
    window.dispatchEvent(new PageTransitionEvent('pagehide'))
    expect(currentHost()).toBeUndefined()
    expect((window as unknown as { tavern_events?: unknown }).tavern_events).toBeUndefined()

    const adapter = buildRenderCompatibilityChildAdapter()
    expect(adapter).toContain("'TavernHelper','tavern_helper','SillyTavern','__SRL_SCRIPT_META__'")
    expect(adapter).toContain('for(const name of [...injectedGlobals,...exposedGlobals])')
    expect(adapter).toContain('delete window[name]')
  })

  it('fixture-listener-cleanup detaches owned listeners and the host message listener', async () => {
    const host = evaluateHost({ messages: { greetings: ['fixture-listener-cleanup'] } })
    const observed: string[] = []
    const owner = {}
    host.subscribe('fixture-listener-cleanup', () => observed.push('received'), owner)
    host.teardown()

    await host.emit('fixture-listener-cleanup')
    window.dispatchEvent(
      new MessageEvent('message', {
        data: {
          protocol: RENDER_COMPATIBILITY_PROTOCOL,
          type: RENDER_COMPATIBILITY_EVENTS.frameReady,
          frameId: 'fixture-after-cleanup',
        },
      }),
    )
    expect(observed).toEqual([])
    expect(currentHost()).toBeUndefined()
  })

  it('fixture-message-update forwards the formal host event payload without inventing one for setChatMessages', async () => {
    const host = evaluateHost({ messages: { greetings: ['fixture-before'] } })
    const payloads: number[] = []
    host.subscribe(
      RENDER_COMPATIBILITY_TAVERN_EVENTS.MESSAGE_UPDATED,
      (messageId) => payloads.push(Number(messageId)),
      {},
    )
    await host.invoke(
      'setChatMessages',
      [[{ message_id: 0, message: 'fixture-after' }], { refresh: 'none' }],
      { frameName: 'TH-message--0--0' },
    )
    expect(payloads).toEqual([])
    await host.emit(RENDER_COMPATIBILITY_TAVERN_EVENTS.MESSAGE_UPDATED, [0])
    expect(payloads).toEqual([0])
  })

  it('fixture-first-message-selected emits mutable payload before CHARACTER_MESSAGE_RENDERED', async () => {
    const host = evaluateHost(
      {
        character: { data: { id: 'fixture-character' } },
        messages: { greetings: ['fixture-first-message'] },
      },
      1,
    )
    const observed: string[] = []
    host.subscribe(
      RENDER_COMPATIBILITY_TAVERN_EVENTS.CHARACTER_FIRST_MESSAGE_SELECTED,
      (payload) => {
        const event = payload as { input: string; output: string }
        observed.push(`selected:${event.input}`)
        event.output = 'fixture-selected-output'
      },
      {},
    )
    host.subscribe(
      RENDER_COMPATIBILITY_TAVERN_EVENTS.CHARACTER_MESSAGE_RENDERED,
      (messageId) => observed.push(`rendered:${Number(messageId)}`),
      {},
    )
    window.dispatchEvent(
      new MessageEvent('message', {
        data: {
          protocol: RENDER_COMPATIBILITY_PROTOCOL,
          type: RENDER_COMPATIBILITY_EVENTS.frameReady,
          frameId: 'fixture-first-message-selected',
        },
      }),
    )
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    expect(observed).toEqual(['selected:fixture-first-message', 'rendered:0'])
    expect(host.invoke('getChatMessages', [0])).toEqual([
      expect.objectContaining({ message: 'fixture-selected-output' }),
    ])
  })
})
