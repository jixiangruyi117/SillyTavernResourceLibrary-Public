/** @vitest-environment jsdom */

import { describe, expect, it } from 'vitest'

import {
  buildRenderCompatibilityHostRuntime,
  createRenderCompatibilityContextFromPreviewSession,
  RENDER_COMPATIBILITY_EVENTS,
  RENDER_COMPATIBILITY_PROTOCOL,
  RENDER_COMPATIBILITY_TAVERN_EVENTS,
} from './RenderCompatibilityRuntime'

describe('RenderCompatibilityRuntime Tavern event coverage', () => {
  it('emits first-message selection and forwards host MESSAGE_UPDATED without inventing it', async () => {
    const context = createRenderCompatibilityContextFromPreviewSession({
      character: {
        name: 'fixture-character',
        data: { id: 'fixture-character' },
      },
      messages: {
        greetings: ['fixture-first-message'],
        formattedGreetings: ['<p>fixture-first-message</p>'],
        activeSwipe: 0,
      },
    })
    const runtimeSource = buildRenderCompatibilityHostRuntime(context, 1)
      .replace(/^<script>/u, '')
      .replace(/<\/script>$/u, '')
    window.eval(runtimeSource)

    const host = (
      window as unknown as {
        __SRL_RENDER_COMPAT_HOST__: {
          invoke: (name: string, args?: unknown[], meta?: Record<string, unknown>) => unknown
          subscribe: (
            type: string,
            listener: (...args: unknown[]) => unknown,
            owner: object,
            once?: boolean,
          ) => { stop: () => void }
          emit: (type: string, args?: unknown[]) => Promise<void>
          teardown: () => void
        }
      }
    ).__SRL_RENDER_COMPAT_HOST__
    const owner = {}
    const lifecycle: string[] = []
    const updatedMessageIds: number[] = []

    host.subscribe(
      RENDER_COMPATIBILITY_TAVERN_EVENTS.CHARACTER_FIRST_MESSAGE_SELECTED,
      (...args: unknown[]) => {
        const eventArgs = args[0] as {
          input: string
          output: string
          character: Record<string, unknown>
        }
        lifecycle.push(`first:${eventArgs.input}`)
        expect(eventArgs.character).toEqual({ id: 'fixture-character' })
        eventArgs.output = 'fixture-first-message-overridden'
      },
      owner,
    )
    host.subscribe(
      RENDER_COMPATIBILITY_TAVERN_EVENTS.CHARACTER_MESSAGE_RENDERED,
      (...args: unknown[]) => lifecycle.push(`rendered:${Number(args[0])}`),
      owner,
    )
    host.subscribe(
      RENDER_COMPATIBILITY_TAVERN_EVENTS.MESSAGE_UPDATED,
      (...args: unknown[]) => updatedMessageIds.push(Number(args[0])),
      owner,
    )

    window.dispatchEvent(
      new MessageEvent('message', {
        data: {
          protocol: RENDER_COMPATIBILITY_PROTOCOL,
          type: RENDER_COMPATIBILITY_EVENTS.frameReady,
          frameId: 'fixture-frame',
        },
      }),
    )
    await new Promise<void>((resolve) => setTimeout(resolve, 0))

    expect(lifecycle).toEqual(['first:fixture-first-message', 'rendered:0'])
    expect(host.invoke('getChatMessages', [0])).toEqual([
      expect.objectContaining({ message: 'fixture-first-message-overridden' }),
    ])

    await host.invoke(
      'setChatMessages',
      [[{ message_id: 0, message: 'fixture-updated-message' }], { refresh: 'none' }],
      { frameName: 'TH-message--0--0' },
    )
    expect(updatedMessageIds).toEqual([])
    await host.emit(RENDER_COMPATIBILITY_TAVERN_EVENTS.MESSAGE_UPDATED, [0])
    expect(updatedMessageIds).toEqual([0])
    expect(host.invoke('getChatMessages', [0])).toEqual([
      expect.objectContaining({ message: 'fixture-updated-message' }),
    ])

    host.teardown()
  })
})
