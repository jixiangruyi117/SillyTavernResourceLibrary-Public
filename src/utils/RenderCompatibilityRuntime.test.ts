/** @vitest-environment jsdom */

import { describe, expect, it, vi } from 'vitest'

import { formatSillyTavernMessage } from './SillyTavernMessageFormatter'
import {
  buildRenderCompatibilityChildAdapter,
  buildRenderCompatibilityHostRuntime,
  createRenderCompatibilityContext,
  extractRenderCompatibilityCharacterVariables,
  isRenderCompatibilityDiagnostic,
  RENDER_COMPATIBILITY_EVENTS,
  RENDER_COMPATIBILITY_PROTOCOL,
  RENDER_COMPATIBILITY_TAVERN_EVENTS,
} from './RenderCompatibilityRuntime'

describe('SRL Render Compatibility Runtime contract', () => {
  it('stores the unique formatter output instead of installing another formatter', () => {
    const source = '**正文**'
    const formatted = formatSillyTavernMessage(source).html
    const context = createRenderCompatibilityContext({
      greetings: [source],
      formattedGreetings: [formatted],
      greetingIndex: 0,
    })
    const runtime = buildRenderCompatibilityHostRuntime(context, 1)

    expect(runtime).toContain(
      JSON.stringify(formatted).replaceAll('<', '\\u003c').replaceAll('>', '\\u003e'),
    )
    expect(runtime).toContain('formatAsDisplayedMessage')
    expect(runtime).not.toContain('showdown')
    expect(runtime).not.toContain('window.Mvu=')
  })

  it('exposes one constrained adapter for messages, swipes, variables and events', () => {
    const adapter = buildRenderCompatibilityChildAdapter()

    expect(adapter).toContain('__SRL_RENDER_COMPAT_HOST__')
    expect(adapter).toContain('getChatMessages')
    expect(adapter).toContain('setChatMessages')
    expect(adapter).toContain('setChatMessage')
    expect(adapter).toContain('eventOn')
    expect(adapter).toContain('eventOnce')
    expect(adapter).toContain('eventEmit')
    expect(adapter).toContain('initializeGlobal')
    expect(adapter).toContain('waitGlobalInitialized')
    expect(adapter).toContain('errorCatched')
    expect(adapter).not.toContain('indexedDB')
  })

  it('validates structured capability diagnostics for S10 consumers', () => {
    expect(
      isRenderCompatibilityDiagnostic({
        capability: 'chat.messages',
        implementationStatus: 'PARTIAL',
        parityStatus: 'UNVERIFIED',
        source: 'preview-session',
        callCount: 2,
        failureReason: 'single-message session',
        impact: 'message ids above zero are unavailable',
      }),
    ).toBe(true)
    expect(
      isRenderCompatibilityDiagnostic({
        capability: 'chat.messages',
        implementationStatus: 'PARTIAL',
        parityStatus: 'VERIFIED',
        source: 'preview-session',
        callCount: 1,
      }),
    ).toBe(false)
    expect(
      isRenderCompatibilityDiagnostic({
        capability: 'message.format',
        implementationStatus: 'IMPLEMENTED',
        parityStatus: 'VERIFIED',
        parityEvidence: [
          {
            kind: 'BLACK_BOX',
            reference: 'SillyTavern',
            version: '1.18.0',
            locator: 'fixture:message-format-1',
          },
        ],
        source: 'SillyTavernMessageFormatter',
        callCount: 1,
      }),
    ).toBe(true)
  })

  it('keeps implementation evidence separate from real reference parity', () => {
    const context = createRenderCompatibilityContext({
      greetings: ['一'],
      formattedGreetings: ['<p>一</p>'],
      greetingIndex: 0,
    })

    expect(context.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          capability: 'events.preview-session',
          implementationStatus: 'IMPLEMENTED',
          parityStatus: 'UNVERIFIED',
        }),
        expect.objectContaining({
          capability: 'chat.swipes',
          implementationStatus: 'IMPLEMENTED',
          parityStatus: 'UNVERIFIED',
        }),
        expect.objectContaining({
          capability: 'message.format',
          implementationStatus: 'PARTIAL',
          parityStatus: 'UNVERIFIED',
        }),
      ]),
    )
  })

  it('mutates only the disposable session and emits one real swipe transition', async () => {
    const context = createRenderCompatibilityContext({
      greetings: ['一', '二'],
      formattedGreetings: ['<p>一</p>', '<p>二</p>'],
      greetingIndex: 0,
      charName: '测试角色',
    })
    const source = buildRenderCompatibilityHostRuntime(context, 0)
      .replace(/^<script>/u, '')
      .replace(/<\/script>$/u, '')
    window.eval(source)

    const host = (
      window as unknown as {
        __SRL_RENDER_COMPAT_HOST__: {
          invoke: (name: string, args?: unknown[]) => unknown
          subscribe: (type: string, listener: (...args: unknown[]) => void, owner: object) => void
          diagnostics: () => Array<{ capability: string; callCount: number }>
        }
      }
    ).__SRL_RENDER_COMPAT_HOST__
    const swipes: unknown[][] = []
    const updated: unknown[][] = []
    const rendered: unknown[][] = []
    host.subscribe('message_swiped', (...args) => swipes.push(args), window)
    host.subscribe('message_updated', (...args) => updated.push(args), window)
    host.subscribe('character_message_rendered', (...args) => rendered.push(args), window)

    await host.invoke('setChatMessages', [[{ message_id: 0, swipe_id: 1 }]])
    window.dispatchEvent(
      new MessageEvent('message', {
        data: {
          protocol: RENDER_COMPATIBILITY_PROTOCOL,
          type: RENDER_COMPATIBILITY_EVENTS.swipeTransition,
          target: 1,
          rendered: '<p>二</p>',
        },
        source: window,
      }),
    )
    await vi.waitFor(() => expect(rendered).toEqual([[0]]))
    const [message] = host.invoke('getChatMessages', ['0']) as Array<{
      swipe_id: number
      message: string
    }>

    expect(message).toMatchObject({ swipe_id: 1, message: '二' })
    expect(swipes).toEqual([[0]])
    expect(updated).toEqual([])
    expect(rendered).toEqual([[0]])
    expect(host.invoke('formatAsDisplayedMessage', ['二'])).toBe('<p>二</p>')
    expect(host.diagnostics()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ capability: 'chat.swipes', callCount: 1 }),
      ]),
    )
  })

  it('honors TavernHelper 4.9.3 setChatMessages refresh events and returns detached snapshots', async () => {
    const context = createRenderCompatibilityContext({
      greetings: ['开场'],
      formattedGreetings: ['<p>开场</p>'],
      greetingIndex: 0,
      swipesData: [{ hp: 10 }],
    })
    const source = buildRenderCompatibilityHostRuntime(context, 0)
      .replace(/^<script>/u, '')
      .replace(/<\/script>$/u, '')
    window.eval(source)
    const host = (
      window as unknown as {
        __SRL_RENDER_COMPAT_HOST__: {
          invoke: (name: string, args?: unknown[]) => unknown
          subscribe: (type: string, listener: (...args: unknown[]) => void, owner: object) => void
        }
      }
    ).__SRL_RENDER_COMPAT_HOST__
    const rendered: unknown[][] = []
    const updated: unknown[][] = []
    const changed: unknown[][] = []
    host.subscribe('character_message_rendered', (...args) => rendered.push(args), window)
    host.subscribe('message_updated', (...args) => updated.push(args), window)
    host.subscribe('chat_id_changed', (...args) => changed.push(args), window)

    const snapshot = host.invoke('getChatMessages', [0, { include_swipes: true }]) as Array<{
      swipes_data: Array<{ hp: number }>
    }>
    snapshot[0].swipes_data[0].hp = 999
    expect(host.invoke('getChatMessages', [0])).toEqual([
      expect.objectContaining({ data: { hp: 10 } }),
    ])

    await host.invoke('setChatMessages', [
      [{ message_id: 0, data: { hp: 11 } }],
      { refresh: 'none' },
    ])
    expect(rendered).toEqual([])
    expect(updated).toEqual([])
    expect(host.invoke('getChatMessages', [0])).toEqual([
      expect.objectContaining({ data: { hp: 11 } }),
    ])

    await host.invoke('setChatMessages', [
      [{ message_id: 0, data: { hp: 12 } }],
      { refresh: 'affected' },
    ])
    expect(rendered).toEqual([[0]])
    expect(updated).toEqual([])
    expect(changed).toEqual([])

    await host.invoke('setChatMessages', [
      [{ message_id: 0, data: { hp: 13 } }],
      { refresh: 'all' },
    ])
    expect(rendered).toEqual([[0]])
    expect(updated).toEqual([])
    expect(changed).toEqual([[]])
  })

  it('maps the TavernHelper 4.9.3 single-floor range and filter contract', () => {
    const context = createRenderCompatibilityContext({
      greetings: ['开场'],
      formattedGreetings: ['<p>开场</p>'],
      greetingIndex: 0,
      swipesData: [{ hp: 10 }],
      swipesInfo: [{ source: 'opening' }],
      charName: '角色',
    })
    const source = buildRenderCompatibilityHostRuntime(context, 0)
      .replace(/^<script>/u, '')
      .replace(/<\/script>$/u, '')
    window.eval(source)
    const host = (
      window as unknown as {
        __SRL_RENDER_COMPAT_HOST__: {
          invoke: (name: string, args?: unknown[]) => unknown
          getInitializedGlobal: (name: string) => unknown
          transitionSwipe: (target: number, notifyParent?: boolean, rendered?: string) => unknown
        }
      }
    ).__SRL_RENDER_COMPAT_HOST__

    for (const range of [0, -1, '0', '-1', '0-0', '0-{{lastMessageId}}']) {
      expect(host.invoke('getChatMessages', [range])).toEqual([
        expect.objectContaining({
          message_id: 0,
          role: 'assistant',
          is_hidden: false,
          message: '开场',
          data: { hp: 10 },
          extra: { source: 'opening' },
          swipe_id: 0,
          swipes: ['开场'],
          swipes_data: [{ hp: 10 }],
        }),
      ])
    }
    expect(host.invoke('getChatMessages', ['invalid'])).toEqual([])
    expect(host.invoke('getChatMessages', [0, { role: 'user' }])).toEqual([])
    expect(host.invoke('getChatMessages', [0, { role: 'assistant' }])).toHaveLength(1)
    expect(host.invoke('getChatMessages', [0, { hide_state: 'hidden' }])).toEqual([])
    expect(host.invoke('getChatMessages', [0, { include_swipes: true }])).toEqual([
      expect.objectContaining({
        swipe_id: 0,
        swipes: ['开场'],
        swipes_data: [{ hp: 10 }],
        swipes_info: [{ source: 'opening' }],
      }),
    ])
  })

  it('keeps message, data and info isolated per preview swipe', async () => {
    const context = createRenderCompatibilityContext({
      greetings: ['一', '二'],
      formattedGreetings: ['<p>一</p>', '<p>二</p>'],
      greetingIndex: 0,
      swipesData: [{ hp: 1 }, { hp: 2 }],
      swipesInfo: [{ tag: 'a' }, { tag: 'b' }],
    })
    const source = buildRenderCompatibilityHostRuntime(context, 0)
      .replace(/^<script>/u, '')
      .replace(/<\/script>$/u, '')
    window.eval(source)
    const host = (
      window as unknown as {
        __SRL_RENDER_COMPAT_HOST__: {
          invoke: (name: string, args?: unknown[]) => unknown
          getInitializedGlobal: (name: string) => unknown
          transitionSwipe: (
            target: number,
            notifyParent?: boolean,
            rendered?: string,
          ) => Promise<boolean>
        }
      }
    ).__SRL_RENDER_COMPAT_HOST__

    await host.invoke('setChatMessages', [[{ message_id: 0, message: '一改', data: { hp: 11 } }]])
    await host.invoke('setChatMessages', [[{ message_id: 0, swipe_id: 1 }]])
    await host.transitionSwipe(1, false, '<p>二</p>')
    expect(host.invoke('getChatMessages', [0])).toEqual([
      expect.objectContaining({ message: '二', data: { hp: 2 }, extra: { tag: 'b' } }),
    ])
    await host.invoke('setChatMessage', [{ message: '二改', data: { hp: 22 } }, 0])
    expect(host.invoke('getChatMessages', [0, { include_swipes: true }])).toEqual([
      expect.objectContaining({
        swipe_id: 1,
        swipes: ['一改', '二改'],
        swipes_data: [{ hp: 11 }, { hp: 22 }],
        swipes_info: [{ tag: 'a' }, { tag: 'b' }],
      }),
    ])

    await host.invoke('setChatMessage', [
      { message: '一指定', data: { hp: 111 } },
      0,
      { swipe_id: 0 },
    ])
    await host.transitionSwipe(0, false, '<p>一指定</p>')
    expect(host.invoke('getChatMessages', [0])).toEqual([
      expect.objectContaining({ message: '一指定', data: { hp: 111 }, swipe_id: 0 }),
    ])
    expect(host.invoke('getChatMessages', [0, { include_swipes: true }])).toEqual([
      expect.objectContaining({
        swipes: ['一指定', '二改'],
        swipes_data: [{ hp: 111 }, { hp: 22 }],
      }),
    ])
  })

  it('reads current and legacy TavernHelper character variable sources without guessing', () => {
    expect(
      extractRenderCompatibilityCharacterVariables({
        extensions: {
          tavern_helper: [
            ['scripts', []],
            ['variables', { affinity: 7 }],
          ],
          TavernHelper_characterScriptVariables: { affinity: 1 },
        },
      }),
    ).toEqual({ affinity: 7 })
    expect(
      extractRenderCompatibilityCharacterVariables({
        extensions: { TavernHelper_characterScriptVariables: { legacy: true } },
      }),
    ).toEqual({ legacy: true })
  })

  it('keeps explicit variable scopes and rejects unavailable or unknown types', () => {
    const context = createRenderCompatibilityContext({
      greetings: ['一', '二'],
      formattedGreetings: ['一', '二'],
      greetingIndex: 1,
      swipesData: [{ page: 1 }, { page: 2 }],
      characterData: {
        extensions: { tavern_helper: { variables: { characterOnly: 3, shared: 'character' } } },
      },
    })
    const source = buildRenderCompatibilityHostRuntime(context, 0)
      .replace(/^<script>/u, '')
      .replace(/<\/script>$/u, '')
    window.eval(source)
    const host = (
      window as unknown as {
        __SRL_RENDER_COMPAT_HOST__: {
          invoke: (name: string, args?: unknown[], meta?: Record<string, unknown>) => unknown
        }
      }
    ).__SRL_RENDER_COMPAT_HOST__
    const scriptMeta = {
      scriptId: 'status-script',
      scriptData: { scriptOnly: 4, shared: 'script' },
      frameName: 'TH-script--状态栏--status-script',
    }
    const messageMeta = { frameName: 'TH-message--0--0' }

    expect(host.invoke('getVariables', [{ type: 'character' }], messageMeta)).toEqual({
      characterOnly: 3,
      shared: 'character',
    })
    expect(host.invoke('getVariables', [{ type: 'script' }], scriptMeta)).toEqual({
      scriptOnly: 4,
      shared: 'script',
    })
    expect(host.invoke('getVariables', [{ type: 'message', message_id: -1 }], messageMeta)).toEqual(
      {
        page: 2,
      },
    )
    expect(() =>
      host.invoke('getVariables', [{ type: 'message', message_id: 1 }], messageMeta),
    ).toThrow(/outside/u)
    expect(() => host.invoke('getVariables', [{ type: 'preset' }], messageMeta)).toThrow(
      /unavailable/u,
    )
    expect(() =>
      host.invoke('getVariables', [{ type: 'extension', extension_id: 'x' }], messageMeta),
    ).toThrow(/extension host/u)
    expect(() => host.invoke('getVariables', [{ type: 'mystery' }], messageMeta)).toThrow(
      /Unknown variable type/u,
    )

    host.invoke(
      'replaceVariables',
      [{ shared: 'chat', chatOnly: 5 }, { type: 'chat' }],
      messageMeta,
    )
    expect(host.invoke('getAllVariables', [], messageMeta)).toEqual({
      characterOnly: 3,
      shared: 'chat',
      chatOnly: 5,
      page: 2,
    })
    expect(host.invoke('getAllVariables', [], scriptMeta)).toEqual({
      characterOnly: 3,
      shared: 'chat',
      scriptOnly: 4,
      chatOnly: 5,
    })
  })

  it('distinguishes message and companion-script iframe context', () => {
    const context = createRenderCompatibilityContext({
      greetings: ['开场'],
      formattedGreetings: ['开场'],
      greetingIndex: 0,
    })
    const source = buildRenderCompatibilityHostRuntime(context, 0)
      .replace(/^<script>/u, '')
      .replace(/<\/script>$/u, '')
    window.eval(source)
    const host = (
      window as unknown as {
        __SRL_RENDER_COMPAT_HOST__: {
          invoke: (name: string, args?: unknown[], meta?: Record<string, unknown>) => unknown
        }
      }
    ).__SRL_RENDER_COMPAT_HOST__
    const messageMeta = { frameName: 'TH-message--0--3' }
    const scriptMeta = { scriptId: 'companion', frameName: 'TH-script--伴随脚本--companion' }

    expect(host.invoke('getIframeName', [], messageMeta)).toBe('TH-message--0--3')
    expect(host.invoke('getCurrentMessageId', [], messageMeta)).toBe(0)
    expect(host.invoke('getMessageId', ['TH-message--0--3'], messageMeta)).toBe(0)
    expect(host.invoke('getScriptId', [], scriptMeta)).toBe('companion')
    expect(() => host.invoke('getCurrentMessageId', [], scriptMeta)).toThrow(/message iframe/u)
    expect(() => host.invoke('getMessageId', [], scriptMeta)).toThrow(/outside a message iframe/u)
    expect(() => host.invoke('getScriptId', [], messageMeta)).toThrow(/script iframe/u)
  })

  it('shares initialized globals within one PreviewSession and clears them on teardown', async () => {
    const context = createRenderCompatibilityContext({
      greetings: ['开场'],
      formattedGreetings: ['开场'],
      greetingIndex: 0,
    })
    const source = buildRenderCompatibilityHostRuntime(context, 0)
      .replace(/^<script>/u, '')
      .replace(/<\/script>$/u, '')
    window.eval(source)
    const host = (
      window as unknown as {
        __SRL_RENDER_COMPAT_HOST__: {
          invoke: (name: string, args?: unknown[], meta?: Record<string, unknown>) => unknown
          getInitializedGlobal: (name: string) => unknown
          teardown: () => void
        }
      }
    ).__SRL_RENDER_COMPAT_HOST__
    const waiting = host.invoke('waitGlobalInitialized', ['SharedStatus'], {
      frameName: 'TH-message--0--0',
    }) as Promise<unknown>
    const value = { ready: true }

    expect(
      host.invoke('initializeGlobal', ['SharedStatus', value], {
        scriptId: 'producer',
        frameName: 'TH-script--producer--producer',
      }),
    ).toBeUndefined()
    await expect(waiting).resolves.toBeUndefined()
    await expect(
      host.invoke('waitGlobalInitialized', ['SharedStatus'], {
        frameName: 'TH-message--0--1',
      }),
    ).resolves.toBeUndefined()
    expect(host.getInitializedGlobal('SharedStatus')).toBe(value)

    host.teardown()
    expect(host.getInitializedGlobal('SharedStatus')).toBeUndefined()
    expect(() =>
      host.invoke('waitGlobalInitialized', ['SharedStatus'], {
        frameName: 'TH-message--0--1',
      }),
    ).toThrow('Preview host has been disposed')
  })

  it('keeps MVU opening state aligned with the active preview swipe', async () => {
    const first = {
      initialized_lorebooks: { card: ['base'] },
      stat_data: { hp: 10 },
      display_data: { hp: 10 },
      delta_data: {},
      schema: { type: 'object', properties: { hp: { type: 'number' } } },
    }
    const second = {
      initialized_lorebooks: { card: [] },
      stat_data: { hp: 20 },
      display_data: { hp: 20 },
      delta_data: {},
      schema: { type: 'object', properties: { hp: { type: 'number' } } },
    }
    const context = createRenderCompatibilityContext({
      greetings: ['一', '二'],
      formattedGreetings: ['<p>一</p>', '<p>二</p>'],
      greetingIndex: 0,
      swipesData: [first, second],
      mvuRecognized: true,
    })
    const source = buildRenderCompatibilityHostRuntime(context, 0)
      .replace(/^<script>/u, '')
      .replace(/<\/script>$/u, '')
    window.eval(source)
    const host = (
      window as unknown as {
        __SRL_RENDER_COMPAT_HOST__: {
          invoke: (name: string, args?: unknown[]) => unknown
          getInitializedGlobal: (name: string) => unknown
          transitionSwipe: (target: number, notifyParent?: boolean, rendered?: string) => unknown
        }
      }
    ).__SRL_RENDER_COMPAT_HOST__
    const directMvu = host.getInitializedGlobal('Mvu') as {
      getCurrentMvuData: () => typeof first
    }
    await expect(host.invoke('waitGlobalInitialized', ['Mvu'])).resolves.toBeUndefined()
    const mvu = host.getInitializedGlobal('Mvu') as {
      getCurrentMvuData: () => typeof first
      replaceCurrentMvuData: (data: typeof first) => Promise<typeof first>
      getMvuVariable: (data: typeof first, path: string) => unknown
    }

    expect(directMvu).toBe(mvu)
    expect(mvu.getCurrentMvuData().stat_data).toEqual({ hp: 10 })
    expect(mvu.getMvuVariable(mvu.getCurrentMvuData(), 'hp')).toBe(10)
    expect(
      (host.invoke('getChatMessages', ['0']) as Array<{ data: typeof first }>)[0]?.data,
    ).toEqual(mvu.getCurrentMvuData())

    await host.invoke('setChatMessages', [[{ message_id: 0, swipe_id: 1 }]])
    await host.transitionSwipe(1, false, '<p>二</p>')
    expect(mvu.getCurrentMvuData().stat_data).toEqual({ hp: 20 })
    expect(
      (host.invoke('getChatMessages', ['0']) as Array<{ data: typeof second }>)[0]?.data,
    ).toEqual(mvu.getCurrentMvuData())

    const replacement = structuredClone(second)
    replacement.stat_data.hp = 25
    await mvu.replaceCurrentMvuData(replacement)
    expect(mvu.getCurrentMvuData().stat_data).toEqual({ hp: 25 })
    await host.invoke('setChatMessages', [[{ message_id: 0, swipe_id: 0 }]])
    await host.transitionSwipe(0, false, '<p>一</p>')
    expect(mvu.getCurrentMvuData().stat_data).toEqual({ hp: 10 })
  })

  it('does not fabricate MVU APIs when no opening state is recognized', () => {
    const context = createRenderCompatibilityContext({
      greetings: ['普通开场'],
      formattedGreetings: ['<p>普通开场</p>'],
      greetingIndex: 0,
    })
    const source = buildRenderCompatibilityHostRuntime(context, 0)
      .replace(/^<script>/u, '')
      .replace(/<\/script>$/u, '')
    window.eval(source)
    const host = (
      window as unknown as {
        __SRL_RENDER_COMPAT_HOST__: {
          invoke: (name: string, args?: unknown[]) => unknown
          getInitializedGlobal: (name: string) => unknown
        }
      }
    ).__SRL_RENDER_COMPAT_HOST__

    expect(() => host.invoke('getMvuData')).toThrow(/Unsupported host capability/u)
    expect(host.getInitializedGlobal('Mvu')).toBeUndefined()
  })

  it('keeps formatAsDisplayedMessage synchronous and never leaks a Promise into DOM APIs', () => {
    const context = createRenderCompatibilityContext({
      greetings: ['登记开场'],
      formattedGreetings: ['<p>登记开场</p>'],
      greetingIndex: 0,
    })
    const source = buildRenderCompatibilityHostRuntime(context, 0)
      .replace(/^<script>/u, '')
      .replace(/<\/script>$/u, '')
    window.eval(source)
    const host = (
      window as unknown as {
        __SRL_RENDER_COMPAT_HOST__: {
          invoke: (name: string, args?: unknown[], meta?: Record<string, unknown>) => unknown
        }
      }
    ).__SRL_RENDER_COMPAT_HOST__

    const registered = host.invoke('formatAsDisplayedMessage', ['登记开场'])
    const dynamic = host.invoke('formatAsDisplayedMessage', [
      '**动态**',
      { message_id: 'last_char' },
    ])
    const target = document.createElement('div')
    target.innerHTML = dynamic as string
    target.insertAdjacentHTML('beforeend', dynamic as string)

    expect(registered).toBe('<p>登记开场</p>')
    expect(typeof registered).toBe('string')
    expect(dynamic).toBe('**动态**')
    expect(typeof dynamic).toBe('string')
    expect(dynamic).not.toBeInstanceOf(Promise)
    expect(target.innerHTML).not.toContain('[object Promise]')
    expect(() =>
      host.invoke('formatAsDisplayedMessage', ['用户消息', { message_id: 'last_user' }]),
    ).toThrow(/No user message/u)
    expect(host.invoke('retrieveDisplayedMessage', [0])).toBe(0)
  })

  it('emits MESSAGE_SWIPED once from an in-session swipe transition', async () => {
    const context = createRenderCompatibilityContext({
      greetings: ['开场一', '开场二'],
      formattedGreetings: ['<p>开场一</p>', '<p>开场二</p>'],
      renderedGreetings: ['<p>开场一</p>', '<p>开场二</p>'],
      greetingIndex: 0,
    })
    document.body.innerHTML = '<div data-srl-preview-message-content><p>开场一</p></div>'
    const source = buildRenderCompatibilityHostRuntime(context, 0)
      .replace(/^<script>/u, '')
      .replace(/<\/script>$/u, '')
    window.eval(source)
    const host = (
      window as unknown as {
        __SRL_RENDER_COMPAT_HOST__: {
          subscribe: (type: string, listener: (...args: unknown[]) => void, owner: string) => void
          context: () => { chat: Array<{ swipe_id: number }> }
        }
      }
    ).__SRL_RENDER_COMPAT_HOST__
    const observed: unknown[][] = []
    host.subscribe(
      RENDER_COMPATIBILITY_TAVERN_EVENTS.MESSAGE_SWIPED,
      (...args) => observed.push(args),
      'test',
    )

    window.dispatchEvent(
      new MessageEvent('message', {
        data: {
          protocol: RENDER_COMPATIBILITY_PROTOCOL,
          type: RENDER_COMPATIBILITY_EVENTS.swipeTransition,
          target: 1,
        },
        source: window,
      }),
    )
    await Promise.resolve()
    await Promise.resolve()

    expect(observed).toEqual([[0]])
    expect(host.context().chat[0]?.swipe_id).toBe(1)
    expect(document.querySelector('[data-srl-preview-message-content]')?.textContent).toBe('开场二')
  })
})
