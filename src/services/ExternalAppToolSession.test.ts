import { afterEach, describe, expect, it, vi } from 'vitest'
import { ExternalAppToolSession } from './ExternalAppToolSession'
import type { ExternalAppToolDescriptor } from '../types/ExternalApp'
const tool: ExternalAppToolDescriptor = {
  id: 'com.example.tool/note',
  appId: 'com.example.tool',
  appName: '笔记',
  fingerprint: 'abc',
  available: true,
  name: 'note',
  title: '笔记',
  description: '记录笔记',
  version: '1.0.0',
  apiVersion: 'srl-app-tools@1',
  permissions: ['app.storage'],
  parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
}
const setup = () => {
  const session = new ExternalAppToolSession()
  const port = { postMessage: vi.fn() }
  session.connect(port, 'nonce')
  return { session, port }
}
afterEach(() => vi.useRealTimers())
describe('custom tool MessagePort lifecycle', () => {
  it('waits for registration on the real connected port and resolves only a matching nonce/id', async () => {
    const { session, port } = setup()
    const pending = session.invoke(tool, '{}', new AbortController().signal)
    session.handle({ type: 'srl:tools-ready', nonce: 'wrong', names: ['note'] })
    expect(port.postMessage).not.toHaveBeenCalled()
    session.handle({ type: 'srl:tools-ready', nonce: 'nonce', names: ['other'] })
    expect(port.postMessage).not.toHaveBeenCalled()
    session.handle({ type: 'srl:tools-ready', nonce: 'nonce', names: ['note'] })
    expect(port.postMessage).toHaveBeenCalledOnce()
    const id = port.postMessage.mock.calls[0]![0].id
    session.handle({ type: 'srl:tools-ready', nonce: 'nonce', names: ['note'] })
    session.handle({ type: 'srl:tool-result', nonce: 'wrong', id, ok: true, result: '42' })
    session.handle({ type: 'srl:tool-result', nonce: 'nonce', id: 'wrong', ok: true, result: '42' })
    session.handle({ type: 'srl:tool-result', nonce: 'nonce', id, ok: true, result: '{"count":2}' })
    await expect(pending).resolves.toEqual({ count: 2 })
    expect(session.activeTool).toBeUndefined()
    session.close()
  })
  it('allows invocation before the first handshake but rejects reloads, concurrent calls and stale responses', async () => {
    const session = new ExternalAppToolSession()
    const pending = session.invoke(tool, '{}', new AbortController().signal)
    const rejection = expect(pending).rejects.toThrow('重载')
    const port = { postMessage: vi.fn() }
    session.connect(port, 'first')
    session.handle({ type: 'srl:tools-ready', nonce: 'first', names: ['note'] })
    await expect(session.invoke(tool, '{}', new AbortController().signal)).rejects.toThrow(
      '正在运行',
    )
    session.connect(port, 'second')
    await rejection
    session.handle({ type: 'srl:tool-result', nonce: 'first', id: 'old', ok: true, result: '42' })
    expect(session.activeTool).toBeUndefined()
    session.close()
  })
  it('cancels immediately without replaying or pretending to undo side effects', async () => {
    const { session, port } = setup()
    session.handle({ type: 'srl:tools-ready', nonce: 'nonce', names: ['note'] })
    const controller = new AbortController()
    const pending = session.invoke(tool, '{}', controller.signal)
    const rejection = expect(pending).rejects.toThrow('已执行的操作保留')
    controller.abort()
    await rejection
    expect(port.postMessage.mock.lastCall![0].type).toBe('srl:tool-cancel')
    expect(session.activeTool).toBeUndefined()
  })
  it('ends missing registrations at the documented budget and rejects malformed outputs without raw errors', async () => {
    vi.useFakeTimers()
    const { session, port } = setup()
    const pending = session.invoke(tool, '{}', new AbortController().signal)
    const rejection = expect(pending).rejects.toThrow('60秒')
    await vi.advanceTimersByTimeAsync(60_000)
    await rejection
    session.handle({ type: 'srl:tools-ready', nonce: 'nonce', names: ['note'] })
    const next = session.invoke(tool, '{}', new AbortController().signal)
    const malformed = expect(next).rejects.toThrow('JSON 无效')
    session.handle({
      type: 'srl:tool-result',
      nonce: 'nonce',
      id: port.postMessage.mock.lastCall![0].id,
      ok: true,
      result: 'PRIVATE_SECRET',
    })
    await malformed
    session.close()
  })
})
