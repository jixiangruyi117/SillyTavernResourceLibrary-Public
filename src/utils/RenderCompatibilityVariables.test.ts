/** @vitest-environment jsdom */

import { describe, expect, it } from 'vitest'

import {
  buildRenderCompatibilityChildAdapter,
  buildRenderCompatibilityHostRuntime,
  createRenderCompatibilityContext,
} from './RenderCompatibilityRuntime'

describe('RenderCompatibility TavernHelper variable helpers', () => {
  it('exposes insertOrAssignVariables through the child TavernHelper facade', () => {
    expect(buildRenderCompatibilityChildAdapter()).toContain('insertOrAssignVariables')
  })

  it('recursively assigns provided keys while preserving unrelated disposable variables', () => {
    const context = createRenderCompatibilityContext({
      greetings: ['开场'],
      formattedGreetings: ['<p>开场</p>'],
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
        }
      }
    ).__SRL_RENDER_COMPAT_HOST__

    host.invoke('replaceVariables', [
      {
        keep: { value: 1 },
        replace: { old: true },
      },
      { type: 'chat' },
    ])

    const patch = {
      replace: { next: true },
      added: { nested: 2 },
    }
    const result = host.invoke('insertOrAssignVariables', [patch, { type: 'chat' }]) as Record<
      string,
      unknown
    >

    patch.added.nested = 99
    ;(result.added as { nested: number }).nested = 88

    expect(host.invoke('getVariables', [{ type: 'chat' }])).toEqual({
      keep: { value: 1 },
      replace: { old: true, next: true },
      added: { nested: 2 },
    })
  })
})
