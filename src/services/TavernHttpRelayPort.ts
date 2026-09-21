import { LOCAL_TAVERN_ORIGIN } from './LanDirectService'

export const LOCAL_TAVERN_RELAY_BASE = `${LOCAL_TAVERN_ORIGIN}/api/plugins/srl-bridge/`

export function bytesToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  }
  return btoa(binary)
}

export function base64ToBuffer(value: string): ArrayBuffer {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes.buffer
}

export function encodeRelayPayload(value: unknown): unknown {
  if (value instanceof ArrayBuffer) return { __srlBuffer: bytesToBase64(value) }
  if (Array.isArray(value)) return value.map(encodeRelayPayload)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, encodeRelayPayload(item)]),
    )
  }
  return value
}

export function decodeRelayPayload(value: unknown): unknown {
  if (
    value &&
    typeof value === 'object' &&
    '__srlBuffer' in value &&
    typeof value.__srlBuffer === 'string'
  ) {
    return base64ToBuffer(value.__srlBuffer)
  }
  if (Array.isArray(value)) return value.map(decodeRelayPayload)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, decodeRelayPayload(item)]),
    )
  }
  return value
}

export class TavernHttpRelayPort {
  onmessage: ((event: { data: unknown }) => void) | null = null
  onerror: ((error: unknown) => void) | null = null
  private readonly relayBase: string
  private readonly session: { code: string; token: string }
  private closed = false
  private sendChain = Promise.resolve()

  constructor(relayBase: string, session: { code: string; token: string }) {
    this.relayBase = relayBase
    this.session = session
  }

  start(): void {
    void this.poll()
  }

  postMessage(message: unknown): Promise<void> {
    if (this.closed) return Promise.reject(new Error('本机中继已经关闭'))
    const task = this.sendChain.then(async () => {
      await this.request('messages', {
        code: this.session.code,
        token: this.session.token,
        message: encodeRelayPayload(message),
      })
    })
    this.sendChain = task.catch((error) => {
      if (!this.closed) this.onerror?.(error)
    })
    return task
  }

  /**
   * 文件块已有 index、ACK 和发送端窗口控制；不应再被控制消息队列串行化。
   * file-start/file-end 仍通过 postMessage 保持严格顺序。
   */
  postFileChunk(message: unknown): Promise<void> {
    if (this.closed) return Promise.reject(new Error('本机中继已经关闭'))
    return this.request('messages', {
      code: this.session.code,
      token: this.session.token,
      message: encodeRelayPayload(message),
    })
      .then(() => undefined)
      .catch((error) => {
        if (!this.closed) this.onerror?.(error)
        throw error
      })
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    void this.request('close', { code: this.session.code, token: this.session.token }).catch(
      () => {},
    )
  }

  private async poll(): Promise<void> {
    while (!this.closed) {
      try {
        const result = (await this.request('poll', {
          code: this.session.code,
          token: this.session.token,
        })) as { closed?: boolean; messages?: unknown[] } | undefined
        if (result?.closed) throw new Error('本机中继已关闭')
        for (const message of result?.messages ?? []) {
          this.onmessage?.({ data: decodeRelayPayload(message) })
        }
      } catch (error) {
        if (!this.closed) this.onerror?.(error)
        this.closed = true
      }
    }
  }

  private async request(path: string, body: Record<string, unknown>): Promise<unknown> {
    const endpoint = new URL(path, this.relayBase)
    const response = await fetch(endpoint.href, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
      mode: 'cors',
    })
    if (!response.ok) {
      const detail = (await response.json().catch(() => ({}))) as { error?: string }
      throw new Error(detail.error || `本机中继请求失败（HTTP ${response.status}）`)
    }
    return response.status === 204 ? undefined : response.json()
  }
}
