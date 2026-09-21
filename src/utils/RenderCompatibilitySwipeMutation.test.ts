/** @vitest-environment jsdom */

import { describe, expect, it, vi } from 'vitest'

import {
  buildRenderCompatibilityHostRuntime,
  createRenderCompatibilityContext,
  RENDER_COMPATIBILITY_EVENTS,
  RENDER_COMPATIBILITY_PROTOCOL,
} from './RenderCompatibilityRuntime'

describe('RenderCompatibility setChatMessages swipe mutation', () => {
  it('waits for the parent-rendered PreviewSession transition before the TavernHelper promise resolves', async () => {
    const context = createRenderCompatibilityContext({
      greetings: ['开场 A', '开场 B'],
      formattedGreetings: ['<p>开场 A</p>', '<p>开场 B</p>'],
      renderedGreetings: ['<p>开场 A</p>', '<p>开场 B</p>'],
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
          subscribe: (type: string, listener: (...args: unknown[]) => void, owner: object) => void
          context: () => { chat: Array<{ swipe_id: number; message: string }> }
        }
      }
    ).__SRL_RENDER_COMPAT_HOST__

    const swiped: unknown[][] = []
    const rendered: unknown[][] = []
    host.subscribe('message_swiped', (...args) => swiped.push(args), window)
    host.subscribe('character_message_rendered', (...args) => rendered.push(args), window)
    const postMessage = vi.spyOn(window, 'postMessage')

    let settled = false
    const mutation = Promise.resolve(
      host.invoke('setChatMessages', [[{ message_id: 0, swipe_id: 1 }]], {
        frameName: 'TH-message--0--0',
      }),
    ).then(() => {
      settled = true
    })

    await Promise.resolve()
    expect(settled).toBe(false)
    expect(host.context().chat[0]).toMatchObject({ swipe_id: 0, message: '开场 A' })
    expect(swiped).toEqual([])
    expect(rendered).toEqual([])
    expect(postMessage).toHaveBeenCalledWith(
      {
        protocol: RENDER_COMPATIBILITY_PROTOCOL,
        type: RENDER_COMPATIBILITY_EVENTS.greetingNavigate,
        target: 1,
      },
      '*',
    )

    window.dispatchEvent(
      new MessageEvent('message', {
        data: {
          protocol: RENDER_COMPATIBILITY_PROTOCOL,
          type: RENDER_COMPATIBILITY_EVENTS.swipeTransition,
          target: 1,
          rendered: '<p>开场 B</p>',
        },
        source: window,
      }),
    )
    await mutation
    await vi.waitFor(() => expect(rendered).toEqual([[0]]))

    expect(settled).toBe(true)
    expect(host.context().chat[0]).toMatchObject({ swipe_id: 1, message: '开场 B' })
    expect(swiped).toEqual([[0]])
    expect(rendered).toEqual([[0]])
    postMessage.mockRestore()
  })
})
