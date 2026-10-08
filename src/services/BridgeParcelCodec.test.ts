// SRL-PUBLIC-SYNC: BEGIN REPLACE id=bridge-parcel-codec-tests
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createParcel, readParcel, removeParcel } from './BridgeParcelCodec.mjs'
import { createChatArchive, readChatArchive } from './TavernChatArchiveCodec.mjs'

function mailbox() {
  const values = new Map<string, unknown>()
  const parcels = new Map<
    string,
    { chunks: number; size: number; sealed: boolean; received: number }
  >()
  let nextCode = 0
  const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(input, init)
    const action = new URL(request.url).pathname.split('/').at(-1)
    const headers = request.headers
    const body = ['upload'].includes(action!) ? undefined : await request.json().catch(() => ({}))
    const code = action === 'upload' ? headers.get('x-srl-parcel-code') : body.code
    const parcel = code ? parcels.get(code) : undefined
    if (action === 'create') {
      const id = (++nextCode).toString(16).padStart(64, '0')
      const metadata = { chunks: body.chunks, size: body.size, sealed: false, received: 0 }
      parcels.set(id, metadata)
      values.set(`parcel:${id}:meta`, metadata)
      return Response.json({ code: id, expiresAt: Date.now() + 30 * 60 * 1000 })
    }
    if (action === 'remove' && code) {
      parcels.delete(code)
      for (const key of values.keys()) if (key.startsWith(`parcel:${code}:`)) values.delete(key)
      return new Response(null, { status: 204 })
    }
    if (!parcel || !code) return Response.json({ message: '暂存不存在或已过期' }, { status: 410 })
    if (action === 'upload') {
      const index = Number(headers.get('x-srl-parcel-index'))
      values.set(`parcel:${code}:${index}`, await request.arrayBuffer())
      parcel.received++
      return new Response(null, { status: 204 })
    }
    if (action === 'seal') {
      parcel.sealed = true
      return Response.json({ expiresAt: Date.now() + 30 * 60 * 1000 })
    }
    if (!parcel.sealed) return Response.json({ message: '发送端尚未完成上传' }, { status: 409 })
    if (action === 'info') return Response.json({ size: parcel.size, chunks: parcel.chunks })
    if (action === 'download') {
      const bytes = values.get(`parcel:${code}:${body.index}`)
      return bytes ? new Response(bytes as ArrayBuffer) : new Response(null, { status: 404 })
    }
    return Response.json({ message: '暂存操作不存在' }, { status: 404 })
  })
  vi.stubGlobal('fetch', fetcher)
  return { values, fetcher }
}
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})
describe('encrypted deferred Tavern parcels', () => {
  it('bounds authenticated compressed content by its declared original size', async () => {
    const { values } = mailbox()
    const parcel = await createParcel('https://srl.test', [
      { file: new File(['chat '.repeat(180000)], 'chat.json'), kind: 'chat', displayName: 'chat' },
    ])
    const [, code, keyText] = parcel.ticket.split('.')
    const key = await crypto.subtle.importKey(
      'raw',
      Uint8Array.from(atob(keyText!.replace(/-/g, '+').replace(/_/g, '/') + '='), (char) =>
        char.charCodeAt(0),
      ),
      'AES-GCM',
      false,
      ['encrypt', 'decrypt'],
    )
    const storedKey = [...values.keys()].find((key) => /^parcel:[a-f0-9]+:0$/.test(key))!
    const chunk = new Uint8Array(values.get(storedKey) as ArrayBuffer)
    const algorithm = {
      name: 'AES-GCM',
      iv: chunk.slice(0, 12),
      additionalData: new TextEncoder().encode(`${code}/0/1`),
    }
    const plain = new Uint8Array(await crypto.subtle.decrypt(algorithm, key, chunk.slice(12)))
    const headerSize = new DataView(plain.buffer).getUint32(0)
    const header = new TextDecoder().decode(plain.slice(4, 4 + headerSize))
    const changed = new TextEncoder().encode(header.replace('"rawSize":900000', '"rawSize":100000'))
    expect(changed.byteLength).toBe(headerSize)
    plain.set(changed, 4)
    const encrypted = await crypto.subtle.encrypt(algorithm, key, plain)
    const modified = new Uint8Array(chunk.byteLength)
    modified.set(chunk.slice(0, 12))
    modified.set(new Uint8Array(encrypted), 12)
    values.set(storedKey, modified.buffer)
    await expect(readParcel('https://srl.test', parcel.ticket)).rejects.toThrow('超过声明大小')
  })
  it('compresses before encryption, reads old tickets and preserves 255-character filenames', async () => {
    const { values } = mailbox()
    const file = new File(['chat '.repeat(180000)], 'a'.repeat(250) + '.json')
    const files = [{ file, kind: 'chat' as const, displayName: 'chat' }]
    const compressed = await createParcel('https://srl.test', files)
    expect(compressed.ticket.startsWith('SRL2.')).toBe(true)
    const compressedMeta = [...values.values()].find(
      (value) => typeof value === 'object' && value && 'chunks' in value && 'received' in value,
    ) as { chunks: number }
    expect(compressedMeta.chunks).toBe(1)
    const [received] = await readParcel('https://srl.test', compressed.ticket)
    expect(received!.file.name).toBe(file.name)
    expect(await received!.file.text()).toBe(await file.text())
    const old = await createParcel('https://srl.test', files, undefined, { compression: false })
    expect(old.ticket.startsWith('SRL1.')).toBe(true)
    expect(await (await readParcel('https://srl.test', old.ticket))[0]!.file.text()).toBe(
      await file.text(),
    )
    await expect(
      readParcel('https://srl.test', compressed.ticket.replace('SRL2.', 'SRL1.')),
    ).rejects.toThrow('格式')
  })
  it('retains the chat archive kind and both binary originals across encrypted deferred transfer', async () => {
    mailbox()
    const archive = createChatArchive(
      new File(['PNG bytes'], 'a.png'),
      new File(['{"mes":"原文"}\r\n'], '夜雨.jsonl'),
      'a.png',
    )
    const sent = await createParcel('https://srl.test', [
      { file: archive, kind: 'chat', displayName: '夜雨' },
    ])
    const [received] = await readParcel('https://srl.test', sent.ticket)
    expect(received?.kind).toBe('chat')
    const parts = await readChatArchive(received!.file)
    expect(await parts.card.text()).toBe('PNG bytes')
    expect(await parts.chat.text()).toBe('{"mes":"原文"}\r\n')
  })
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
  // Worker-side expiry and capacity are tested in the independent SRL-Worker-Public repository.
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
      { fetcher: delayed, compression: false },
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
// SRL-PUBLIC-SYNC: END REPLACE id=bridge-parcel-codec-tests
