/** @vitest-environment jsdom */
import { describe, expect, it } from 'vitest'
import { runAssistantPageScript } from './ProductAssistantScript'

describe('assistant page script opt-in runtime', () => {
  it('executes asynchronous JavaScript in the current page and returns a JSON-safe value', async () => {
    const value = await runAssistantPageScript(
      'await Promise.resolve(); return { title: document.title, answer: 6 * 7 }',
      new AbortController().signal,
    )
    expect(value).toMatchObject({ title: document.title, answer: 42 })
  })
  it('rejects empty or oversized scripts and honors an already-aborted run', async () => {
    const signal = AbortSignal.abort()
    await expect(runAssistantPageScript('', new AbortController().signal)).rejects.toThrow(
      '不能为空',
    )
    await expect(runAssistantPageScript('return 1', signal)).rejects.toThrow()
    await expect(
      runAssistantPageScript('x'.repeat(30_001), new AbortController().signal),
    ).rejects.toThrow('超过30000字')
  })
  it('refuses oversized and non-serializable results instead of injecting them into model history', async () => {
    await expect(
      runAssistantPageScript('return "x".repeat(16001)', new AbortController().signal),
    ).rejects.toThrow('超过16000字')
    await expect(runAssistantPageScript('return 1n', new AbortController().signal)).rejects.toThrow(
      '无法序列化',
    )
  })
})
