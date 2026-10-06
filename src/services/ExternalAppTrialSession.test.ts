/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ExternalAppTrialSession } from './ExternalAppTrialSession'
import type { ExternalAppPermission } from '../types/ExternalApp'

function setup(permissions: ExternalAppPermission[] = ['app.storage']) {
  const port = {
    onmessage: undefined as undefined | ((event: { data: unknown }) => void),
    start: vi.fn(),
    close: vi.fn(),
    postMessage: vi.fn(),
  }
  vi.stubGlobal(
    'MessageChannel',
    class {
      port1 = port
      port2 = {}
    },
  )
  const options = {
    permissions: () => permissions,
    active: () => true,
    running: vi.fn(),
    diagnostic: vi.fn(),
    notify: vi.fn(),
    loading: vi.fn(),
  }
  const trial = new ExternalAppTrialSession(options)
  const target = { postMessage: vi.fn() }
  trial.connect(target as unknown as Window)
  const nonce = target.postMessage.mock.calls[0]![0].nonce
  let sequence = 0
  const send = (method: string, payload: unknown = {}, override = {}) => {
    port.onmessage!({
      data: {
        type: 'srl:request',
        nonce,
        sequence: ++sequence,
        id: `r${sequence}`,
        method,
        payload,
        ...override,
      },
    })
    return port.postMessage.mock.lastCall?.[0]
  }
  return { trial, port, target, options, send, nonce }
}
afterEach(() => vi.unstubAllGlobals())
describe('shared installation-free APP trial bridge', () => {
  it('matches test receipts to the current nonce/call and rejects pending checks on close', async () => {
    const { trial, port, nonce } = setup()
    const result = trial.check(
      { action: 'text', selector: '#status', expected: '已保存' },
      new AbortController().signal,
    )
    const call = port.postMessage.mock.lastCall![0]
    expect(call.type).toBe('srl:trial-step')
    port.onmessage!({
      data: { type: 'srl:trial-result', id: call.id, nonce: 'wrong', passed: true },
    })
    port.onmessage!({ data: { type: 'srl:trial-result', id: call.id, nonce, passed: false } })
    expect(await result).toBe(false)
    const pending = trial.check(
      { action: 'value', selector: '#status', expected: '保留' },
      new AbortController().signal,
    )
    const rejected = expect(pending).rejects.toThrow('关闭')
    trial.disconnect()
    await rejected
  })
  it('keeps data only in memory and clears it on disconnect; never allows host resource/file/device RPC', () => {
    const { trial, send, port } = setup()
    expect(send('storage.set', { key: 'days', value: [1] }).ok).toBe(true)
    expect(send('storage.get', { key: 'days' }).value).toEqual([1])
    for (const method of ['resources.list', 'files.pick', 'device.vibrate', 'network.fetch'])
      expect(send(method).ok).toBe(false)
    trial.disconnect()
    expect(port.close).toHaveBeenCalledOnce()
  })
  it('rejects missing storage permission before mutation, invalid nonce/replayed sequence and stale port', () => {
    const { send, port, trial, options } = setup([])
    expect(send('storage.set', { key: 'private', value: 'denied' }).ok).toBe(false)
    options.permissions = () => ['app.storage']
    expect(send('storage.get', { key: 'private' }).value).toBeNull()
    const count = port.postMessage.mock.calls.length
    send('storage.set', {}, { nonce: 'wrong' })
    send('storage.get', {}, { sequence: 1 })
    expect(port.postMessage).toHaveBeenCalledTimes(count)
    trial.disconnect()
    send('storage.get')
    expect(port.postMessage).toHaveBeenCalledTimes(count)
  })
  it('returns an immediate rejection for cyclic/oversized values and permits updating a full trial map', () => {
    const { send } = setup()
    for (let i = 0; i < 10; i++)
      expect(send('storage.set', { key: `${i}`, value: i }).ok).toBe(true)
    expect(send('storage.set', { key: '0', value: 50 }).ok).toBe(true)
    expect(send('storage.get', { key: '0' }).value).toBe(50)
    expect(send('storage.set', { key: 'new', value: 5 }).ok).toBe(false)
    const cyclic: { self?: unknown } = {}
    cyclic.self = cyclic
    expect(send('storage.set', { key: '0', value: cyclic }).ok).toBe(false)
    expect(send('storage.set', { key: '0', value: 'x'.repeat(102401) }).ok).toBe(false)
  })
})
