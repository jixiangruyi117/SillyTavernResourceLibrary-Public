import { afterEach, describe, expect, it, vi } from 'vitest'
import { createParcel, readParcel, removeParcel } from './BridgeParcelCodec.mjs'
import { handleParcel, cleanupParcels } from '../../cloudflare/BridgeParcels.js'

function mailbox() {
  const values = new Map<string, unknown>()
  const storage = {
    async get(key: string) {
      return structuredClone(values.get(key))
    },
    async put(key: string, value: unknown) {
      values.set(key, structuredClone(value))
    },
    async delete(key: string) {
      values.delete(key)
    },
    async transaction<T>(fn: (store: unknown) => Promise<T>) {
      return fn(storage)
    },
  }
  const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) =>
    handleParcel(new Request(url, init), storage, 'test-device'),
  )
  vi.stubGlobal('fetch', fetcher)
  return { storage, values, fetcher }
}
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})
describe('encrypted deferred Tavern parcels', () => {
  it('transfers binary files across chunks, then permits deletion without exposing the plaintext or decryption key', async () => {
    const { values, fetcher } = mailbox()
    const content = 'PRIVATE-WORLD-BOOK-'.repeat(30000)
    const payload = [
      {
        file: new File([content], 'world.json', { type: 'application/json' }),
        kind: 'worldBook' as const,
        displayName: 'world',
      },
    ]
    const created = await createParcel('https://srl.test', payload)
    const fetched = await readParcel('https://srl.test', created.ticket)
    expect(await fetched[0]!.file.text()).toBe(content)
    expect(fetched[0]!.kind).toBe('worldBook')
    expect(fetched[0]!.operationId).toBe(
      (await readParcel('https://srl.test', created.ticket))[0]!.operationId,
    )
    const stored = JSON.stringify([...values.values()])
    expect(stored).not.toContain('PRIVATE-WORLD')
    expect(stored).not.toContain(created.ticket.split('.')[2])
    expect(fetcher.mock.calls.some(([, init]) => init?.body instanceof Blob)).toBe(true)
    await removeParcel('https://srl.test', created.ticket)
    await expect(removeParcel('https://srl.test', created.ticket)).resolves.toBeUndefined()
    await expect(readParcel('https://srl.test', created.ticket)).rejects.toThrow('过期')
  })
  it('rejects a wrong encryption key and modified or reordered ciphertext before returning any file', async () => {
    const { values } = mailbox()
    const created = await createParcel('https://srl.test', [
      { file: new File(['secret'], 'a.json'), kind: 'theme', displayName: 'a' },
    ])
    await expect(
      readParcel('https://srl.test', created.ticket.replace(/\.[^.]+$/, '.' + 'A'.repeat(43))),
    ).rejects.toThrow('口令错误')
    const key = [...values.keys()].find((key) => /^parcel:[a-f0-9]+:0$/.test(key))!
    const bytes = new Uint8Array(values.get(key) as ArrayBuffer)
    bytes[15] = bytes[15]! ^ 1
    values.set(key, bytes.buffer)
    await expect(readParcel('https://srl.test', created.ticket)).rejects.toThrow('数据损坏')
  })
  it('expires incomplete uploads and enforces per-device capacity before allocating more storage', async () => {
    const { storage, values } = mailbox()
    const create = () =>
      handleParcel(
        new Request('https://srl.test/parcels/create', {
          method: 'POST',
          body: JSON.stringify({ size: 40, chunks: 1 }),
        }),
        storage,
        'one',
      )
    for (let index = 0; index < 4; index++) expect((await create()).status).toBe(200)
    expect((await create()).status).toBe(429)
    await cleanupParcels(storage, Date.now() + 31 * 60 * 1000)
    expect([...values.keys()]).toEqual(['parcel-index'])
    expect((await create()).status).toBe(200)
  })
})

describe('parcel recovery and throughput', () => {
  it('pipelines up to four binary chunks and restores out-of-order downloads without corruption', async () => {
    const { fetcher } = mailbox()
    let active = 0,
      maximum = 0
    const delayed: typeof fetch = async (url, init) => {
      const chunk = /\/(upload|download)$/.test(String(url))
      if (chunk) {
        active++
        maximum = Math.max(maximum, active)
        await new Promise((resolve) => setTimeout(resolve, 12))
      }
      try {
        return await fetcher(url, init)
      } finally {
        if (chunk) active--
      }
    }
    const payload = new File(['abcd'.repeat(400000)], 'large.json')
    const outgoing = await createParcel(
      'https://srl.test',
      [{ file: payload, kind: 'theme', displayName: 'large' }],
      undefined,
      { fetcher: delayed },
    )
    const received = await readParcel('https://srl.test', outgoing.ticket, undefined, {
      fetcher: delayed,
    })
    expect(maximum).toBe(4)
    expect(await received[0]!.file.text()).toBe(await payload.text())
  })
  it('cancels a hung request promptly and does not retry it', async () => {
    const abort = new AbortController()
    const fetcher = vi.fn(
      (_url, init: RequestInit = {}) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal!.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          )
        }),
    )
    const promise = readParcel(
      'https://srl.test',
      'SRL1.' + 'a'.repeat(64) + '.' + 'A'.repeat(43),
      undefined,
      { fetcher, signal: abort.signal },
    )
    const assertion = expect(promise).rejects.toThrow('取消')
    abort.abort()
    await assertion
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it('stops a network request that never responds instead of leaving the UI busy forever', async () => {
    vi.useFakeTimers()
    const fetcher = vi.fn(
      (_url, init: RequestInit = {}) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal!.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          )
        }),
    )
    const promise = readParcel(
      'https://srl.test',
      'SRL1.' + 'a'.repeat(64) + '.' + 'A'.repeat(43),
      undefined,
      { fetcher },
    )
    const assertion = expect(promise).rejects.toThrow('长时间没有响应')
    await vi.advanceTimersByTimeAsync(45000)
    await assertion
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
})
