import { tavernHttpFetch } from './TavernHttpTransport'
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
  onmessage: ((event: { data: unknown }) => void | Promise<void>) | null = null
  onerror: ((error: unknown) => void) | null = null
  onrecovery: ((recovering: boolean) => void) | null = null
  private readonly relayBase: string
  private readonly session: { code: string; token: string; reliableDelivery?: boolean }
  private closed = false
  private sendChain = Promise.resolve()
  private readonly abort = new AbortController()
  private acknowledgements: string[] = []
  private readonly delivered = new Set<string>()
  private retrying = 0

  constructor(
    relayBase: string,
    session: { code: string; token: string; reliableDelivery?: boolean },
  ) {
    this.relayBase = relayBase
    this.session = session
  }

  start(): void {
    void this.poll()
  }

  postMessage(message: unknown): Promise<void> {
    if (this.closed) return Promise.reject(new Error('设备码中继已经关闭'))
    const task = this.sendChain.then(async () => {
      await this.request('messages', {
        code: this.session.code,
        token: this.session.token,
        message: encodeRelayPayload(message),
        ...(this.session.reliableDelivery ? { messageId: crypto.randomUUID() } : {}),
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
    if (this.closed) return Promise.reject(new Error('设备码中继已经关闭'))
    return this.request('messages', {
      code: this.session.code,
      token: this.session.token,
      message: encodeRelayPayload(message),
      ...(this.session.reliableDelivery ? { messageId: crypto.randomUUID() } : {}),
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
    this.abort.abort()
    void this.request('close', { code: this.session.code, token: this.session.token }, true).catch(
      () => {},
    )
  }

  private async poll(): Promise<void> {
    while (!this.closed) {
      try {
        const result = (await this.request('poll', {
          code: this.session.code,
          token: this.session.token,
          reliableDelivery: this.session.reliableDelivery === true,
          acknowledgements: this.acknowledgements,
        })) as { closed?: boolean; messages?: unknown[]; deliveryIds?: string[] } | undefined
        if (result?.closed) throw new Error('设备码中继已关闭')
        if (this.closed) return
        this.acknowledgements = []
        for (const [index, message] of (result?.messages ?? []).entries()) {
          const id = result?.deliveryIds?.[index]
          if (!id || !this.delivered.has(id))
            await this.onmessage?.({ data: decodeRelayPayload(message) })
          if (id) {
            this.delivered.add(id)
            this.acknowledgements.push(id)
            if (this.delivered.size > 4096)
              this.delivered.delete(this.delivered.values().next().value!)
          }
        }
      } catch (error) {
        if (!this.closed) this.onerror?.(error)
        this.closed = true
      }
    }
  }

  private async request(
    path: string,
    body: Record<string, unknown>,
    keepalive = false,
  ): Promise<unknown> {
    let recovering = false
    try {
      for (let attempt = 0; ; attempt++) {
        try {
          return await this.requestOnce(path, body, keepalive)
        } catch (error) {
          const status = (error as { status?: number }).status
          const temporary =
            status === undefined
              ? error instanceof TypeError
              : [408, 429, 500, 502, 503, 504].includes(status)
          // Old relays delete on poll and cannot deduplicate POST: replay only after negotiation.
          if (
            keepalive ||
            this.closed ||
            !this.session.reliableDelivery ||
            !temporary ||
            attempt >= 3
          )
            throw error
          if (!recovering) {
            recovering = true
            this.retrying++
            this.onrecovery?.(true)
          }
          await new Promise<void>((resolve, reject) => {
            const aborted = () => {
              clearTimeout(timer)
              reject(new DOMException('已断开', 'AbortError'))
            }
            const timer = setTimeout(() => {
              this.abort.signal.removeEventListener('abort', aborted)
              resolve()
            }, [500, 1500, 3000][attempt])
            this.abort.signal.addEventListener('abort', aborted, { once: true })
          })
        }
      }
    } finally {
      if (recovering && --this.retrying === 0 && !this.closed) this.onrecovery?.(false)
    }
  }

  private async requestOnce(
    path: string,
    body: Record<string, unknown>,
    keepalive: boolean,
  ): Promise<unknown> {
    const endpoint = new URL(path, this.relayBase)
    const response = await tavernHttpFetch(endpoint.href, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
      mode: 'cors',
      keepalive,
      ...(keepalive ? {} : { signal: this.abort.signal }),
    })
    if (!response.ok) {
      const detail = (await response.json().catch(() => ({}))) as {
        error?: string
        message?: string
      }
      throw Object.assign(
        new Error(
          detail.error || detail.message || `设备码中继请求失败（HTTP ${response.status}）`,
        ),
        { status: response.status },
      )
    }
    return response.status === 204 ? undefined : response.json()
  }
}
