export const NATIVE_STREAM_CHUNK_BYTES = 512 * 1024

export interface NativeStreamProgress {
  transferredBytes: number
  totalBytes?: number
}

export interface NativeStreamTransferOptions {
  append(dataBase64: string): Promise<void>
  signal?: AbortSignal
  totalBytes?: number
  chunkBytes?: number
  onProgress?: (progress: NativeStreamProgress) => void
  onChunkMetrics?: (metrics: { bytes: number; encodeMs: number; transferMs: number }) => void
}

function monotonicNow(): number {
  return typeof performance === 'undefined' ? Date.now() : performance.now()
}

export function nativeBytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  }
  return btoa(binary)
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason ?? new DOMException('传输已取消', 'AbortError')
}

/**
 * 所有 legacy Base64 Bridge 共用的有界写入器。合并输入小块后顺序写入一个原生 chunk；
 * 原生插件可逐步改成 content URI/temp file/object ref，而调用方无需再复制分块逻辑。
 */
export async function transferNativeStream(
  source: Blob | ReadableStream<Uint8Array>,
  options: NativeStreamTransferOptions,
): Promise<number> {
  throwIfAborted(options.signal)
  const requestedChunkBytes = options.chunkBytes ?? NATIVE_STREAM_CHUNK_BYTES
  if (!Number.isSafeInteger(requestedChunkBytes) || requestedChunkBytes <= 0) {
    throw new RangeError('原生传输分块大小必须是正整数')
  }
  const chunkBytes = Math.max(64 * 1024, requestedChunkBytes)
  const totalBytes = options.totalBytes ?? (source instanceof Blob ? source.size : undefined)
  let transferredBytes = 0
  const append = async (chunk: Uint8Array): Promise<void> => {
    throwIfAborted(options.signal)
    const encodeStarted = monotonicNow()
    const encoded = nativeBytesToBase64(chunk)
    const encodeMs = monotonicNow() - encodeStarted
    const transferStarted = monotonicNow()
    await options.append(encoded)
    const transferMs = monotonicNow() - transferStarted
    transferredBytes += chunk.byteLength
    options.onChunkMetrics?.({ bytes: chunk.byteLength, encodeMs, transferMs })
    options.onProgress?.({ transferredBytes, totalBytes })
    // 最后一次写入期间取消，也不能被当成成功并进入 commitWrite。
    throwIfAborted(options.signal)
  }

  if (source instanceof Blob && typeof source.stream !== 'function') {
    for (let offset = 0; offset < source.size; offset += chunkBytes) {
      throwIfAborted(options.signal)
      await append(
        new Uint8Array(
          await source.slice(offset, Math.min(source.size, offset + chunkBytes)).arrayBuffer(),
        ),
      )
    }
    throwIfAborted(options.signal)
    return transferredBytes
  }

  const stream = source instanceof Blob ? source.stream() : source
  const reader = stream.getReader()
  const cancelReader = (reason: unknown): void => {
    // 底层 cancel 可能永不 resolve；不能让它阻塞上层取消和临时文件清理。
    void reader.cancel(reason).catch(() => undefined)
  }
  const abort = (): void => cancelReader(options.signal?.reason)
  options.signal?.addEventListener('abort', abort, { once: true })
  const pending = new Uint8Array(chunkBytes)
  let pendingBytes = 0
  try {
    while (true) {
      throwIfAborted(options.signal)
      const { done, value } = await reader.read()
      throwIfAborted(options.signal)
      if (done) break
      for (let offset = 0; offset < value.byteLength;) {
        const length = Math.min(chunkBytes - pendingBytes, value.byteLength - offset)
        pending.set(value.subarray(offset, offset + length), pendingBytes)
        offset += length
        pendingBytes += length
        if (pendingBytes === chunkBytes) {
          await append(pending)
          pendingBytes = 0
        }
      }
    }
    if (pendingBytes) await append(pending.subarray(0, pendingBytes))
    throwIfAborted(options.signal)
    return transferredBytes
  } catch (error) {
    cancelReader(error)
    throw error
  } finally {
    options.signal?.removeEventListener('abort', abort)
    reader.releaseLock()
  }
}
