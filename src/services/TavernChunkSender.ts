import {
  TAVERN_BRIDGE_CHUNK_SIZE,
  TAVERN_BRIDGE_DEFAULT_IN_FLIGHT_CHUNKS,
  TAVERN_BRIDGE_MAX_IN_FLIGHT_CHUNKS,
  TAVERN_BRIDGE_MIN_IN_FLIGHT_CHUNKS,
} from './TavernBridgeProtocol'
interface Chunk {
  requestId: string
  transferId: string
  index: number
  data: ArrayBuffer
}
/** Owns the chunk window and its ACK timers; teardown cancels every waiter. */
export class TavernChunkSender {
  private readonly chunkAcks = new Map<
    string,
    { resolve: () => void; reject: (error: Error) => void }
  >()
  private readonly post: (chunk: Chunk) => Promise<void>
  constructor(post: (chunk: Chunk) => Promise<void>) {
    this.post = post
  }
  acknowledge(transferId: string, index: unknown): void {
    const key = transferId + ':' + String(index)
    const pending = this.chunkAcks.get(key)
    this.chunkAcks.delete(key)
    pending?.resolve()
  }
  cancel(error: Error): void {
    for (const pending of this.chunkAcks.values()) pending.reject(error)
    this.chunkAcks.clear()
  }
  private sendChunkAndWait(
    payload: {
      requestId: string
      transferId: string
      index: number
      data: ArrayBuffer
    },
    signal?: AbortSignal,
  ): Promise<void> {
    const key = `${payload.transferId}:${payload.index}`
    if (signal?.aborted)
      return Promise.reject(signal.reason ?? new DOMException('任务已取消', 'AbortError'))
    return new Promise((resolve, reject) => {
      const finish = (callback: () => void): void => {
        window.clearTimeout(timer)
        signal?.removeEventListener('abort', abort)
        this.chunkAcks.delete(key)
        callback()
      }
      const abort = (): void =>
        finish(() => reject(signal?.reason ?? new DOMException('任务已取消', 'AbortError')))
      const timer = window.setTimeout(() => {
        finish(() => reject(new Error('文件分块确认超时')))
      }, 90_000)
      this.chunkAcks.set(key, {
        resolve: () => finish(resolve),
        reject: (error) => finish(() => reject(error)),
      })
      signal?.addEventListener('abort', abort, { once: true })
      try {
        void this.post(payload).catch((error) => {
          finish(() => reject(error))
        })
      } catch (error) {
        finish(() => reject(error))
      }
    })
  }

  async send(
    file: Blob,
    requestId: string,
    transferId: string,
    onAck?: (uploadedBytes: number) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    const pending = new Set<Promise<void>>()
    let inFlightLimit = TAVERN_BRIDGE_DEFAULT_IN_FLIGHT_CHUNKS
    let fastAckStreak = 0
    let uploadedBytes = 0
    const adjustWindow = (elapsedMs: number): void => {
      if (elapsedMs < 350 && inFlightLimit < TAVERN_BRIDGE_MAX_IN_FLIGHT_CHUNKS) {
        fastAckStreak += 1
        if (fastAckStreak >= inFlightLimit * 2) {
          inFlightLimit += 1
          fastAckStreak = 0
        }
        return
      }
      fastAckStreak = 0
      if (elapsedMs > 1_500 && inFlightLimit > TAVERN_BRIDGE_MIN_IN_FLIGHT_CHUNKS) {
        inFlightLimit -= 1
      }
    }
    try {
      for (
        let offset = 0, index = 0;
        offset < file.size;
        offset += TAVERN_BRIDGE_CHUNK_SIZE, index += 1
      ) {
        if (signal?.aborted) throw signal.reason ?? new DOMException('任务已取消', 'AbortError')
        const data = await file.slice(offset, offset + TAVERN_BRIDGE_CHUNK_SIZE).arrayBuffer()
        const byteLength = data.byteLength
        const sentAt = performance.now()
        const ack = this.sendChunkAndWait({ requestId, transferId, index, data }, signal).then(
          () => {
            adjustWindow(performance.now() - sentAt)
            uploadedBytes += byteLength
            onAck?.(Math.min(uploadedBytes, file.size))
          },
        )
        pending.add(ack)
        ack.then(
          () => pending.delete(ack),
          () => pending.delete(ack),
        )
        if (pending.size >= inFlightLimit) await Promise.race(pending)
      }
      await Promise.all([...pending])
    } catch (error) {
      await Promise.allSettled([...pending])
      throw error
    }
  }
}
