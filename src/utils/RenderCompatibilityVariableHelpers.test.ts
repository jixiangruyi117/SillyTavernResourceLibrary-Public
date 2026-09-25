/** @vitest-environment jsdom */

import { describe, expect, it } from 'vitest'

import {
  buildRenderCompatibilityChildAdapter,
  buildRenderCompatibilityHostRuntime,
  createRenderCompatibilityContextFromPreviewSession,
} from './RenderCompatibilityRuntime'

function evaluateFixtureHost() {
  const runtime = buildRenderCompatibilityHostRuntime(
    createRenderCompatibilityContextFromPreviewSession({
      messages: { greetings: ['fixture-message'], activeSwipe: 0 },
      variables: {
        chat: {
          counter: 1,
          nested: { keep: true, replace: 'before' },
          removable: { child: 1 },
        },
        message: [{ state: 'ready' }],
      },
    }),
    0,
  )
    .replace(/^<script>/u, '')
    .replace(/<\/script>$/u, '')

  window.eval(runtime)
  return (
    window as unknown as {
      __SRL_RENDER_COMPAT_HOST__: {
        invoke: (name: string, args?: unknown[], meta?: Record<string, unknown>) => unknown
      }
    }
  ).__SRL_RENDER_COMPAT_HOST__
}

describe('RenderCompatibilityRuntime variable helper coverage', () => {
  it('exposes only the real archived floor and protects its saved snapshot from writes', () => {
    const runtime = buildRenderCompatibilityHostRuntime(
      createRenderCompatibilityContextFromPreviewSession({}),
      0,
      {
        message_id: 7,
        last_message_id: 9,
        name: '角色',
        role: 'assistant',
        is_hidden: false,
        message: '正文',
        data: { stat_data: { n: 12 } },
        extra: {},
        swipe_id: 1,
      },
    )
    window.eval(runtime.replace(/^<script>/u, '').replace(/<\/script>$/u, ''))
    const host = (
      window as unknown as {
        __SRL_RENDER_COMPAT_HOST__: { invoke: (name: string, args?: unknown[]) => unknown }
      }
    ).__SRL_RENDER_COMPAT_HOST__
    expect(host.invoke('getCurrentMessageId')).toBe(7)
    expect(host.invoke('getChatMessages', [7])).toEqual([
      expect.objectContaining({ message_id: 7, data: { stat_data: { n: 12 } } }),
    ])
    expect(host.invoke('getChatMessages', [0])).toEqual([])
    expect(host.invoke('getChatMessages', ['0-{{lastMessageId}}'])).toHaveLength(1)
    expect(host.invoke('getVariables', [{ type: 'message', message_id: 7 }])).toEqual({
      stat_data: { n: 12 },
    })
    expect(() => host.invoke('getVariables', [{ type: 'chat' }])).toThrow('snapshot')
    expect(() => host.invoke('setChatMessage', [{ message: 'rewrite' }, 7])).toThrow('read-only')
  })

  it('updates a selected scope with synchronous and asynchronous updateVariablesWith callbacks', async () => {
    const host = evaluateFixtureHost()

    expect(
      host.invoke('updateVariablesWith', [
        (value: Record<string, unknown>) => ({ ...value, counter: 2 }),
        { type: 'chat' },
      ]),
    ).toEqual(expect.objectContaining({ counter: 2 }))

    await expect(
      host.invoke('updateVariablesWith', [
        async (value: Record<string, unknown>) => ({ ...value, counter: 3 }),
        { type: 'chat' },
      ]),
    ).resolves.toEqual(expect.objectContaining({ counter: 3 }))
    expect(host.invoke('getVariables', [{ type: 'chat' }])).toEqual(
      expect.objectContaining({ counter: 3 }),
    )
  })

  it('keeps insertVariables non-overwriting while insertOrAssignVariables recursively overwrites', () => {
    const host = evaluateFixtureHost()

    host.invoke('insertVariables', [
      { counter: 99, added: 'fixture', nested: { keep: false, inserted: true } },
      { type: 'chat' },
    ])
    expect(host.invoke('getVariables', [{ type: 'chat' }])).toEqual({
      counter: 1,
      added: 'fixture',
      nested: { keep: true, replace: 'before', inserted: true },
      removable: { child: 1 },
    })

    host.invoke('insertOrAssignVariables', [
      { counter: 4, nested: { replace: 'after' } },
      { type: 'chat' },
    ])
    expect(host.invoke('getVariables', [{ type: 'chat' }])).toEqual({
      counter: 4,
      added: 'fixture',
      nested: { keep: true, replace: 'after', inserted: true },
      removable: { child: 1 },
    })
  })

  it('deletes nested paths and reports whether a deletion occurred', () => {
    const host = evaluateFixtureHost()

    expect(host.invoke('deleteVariable', ['removable.child', { type: 'chat' }])).toEqual({
      variables: {
        counter: 1,
        nested: { keep: true, replace: 'before' },
        removable: {},
      },
      delete_occurred: true,
    })
    expect(host.invoke('deleteVariable', ['removable.missing', { type: 'chat' }])).toEqual({
      variables: {
        counter: 1,
        nested: { keep: true, replace: 'before' },
        removable: {},
      },
      delete_occurred: false,
    })
    expect(() => host.invoke('deleteVariable', ['__proto__.polluted', { type: 'chat' }])).toThrow(
      /invalid/u,
    )
  })

  it('exports the helpers through the existing child TavernHelper adapter', () => {
    const adapter = buildRenderCompatibilityChildAdapter()
    expect(adapter).toContain(
      "updateVariablesWith:(...args)=>invoke('updateVariablesWith',...args)",
    )
    expect(adapter).toContain("insertVariables:(...args)=>invoke('insertVariables',...args)")
    expect(adapter).toContain("deleteVariable:(...args)=>invoke('deleteVariable',...args)")
  })
})
