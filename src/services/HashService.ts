import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import { computeWorkerPool } from '../core/ComputeWorkerPool'

const WEB_CRYPTO_LIMIT = 4 * 1024 * 1024

interface HashWorkerResponse {
  id: string
  hash?: string
  error?: string
}

interface PendingHash {
  resolve: (hash: string) => void
  reject: (error: Error) => void
}

class HashWorkerClient {
  private worker?: Worker
  private readonly pending = new Map<string, PendingHash>()

  private getWorker(): Worker | undefined {
    if (this.worker) return this.worker
    if (typeof Worker === 'undefined') return undefined
    try {
      const worker = new Worker(new URL('../workers/HashWorker.ts', import.meta.url), {
        type: 'module',
      })
      worker.addEventListener('message', (event: MessageEvent<HashWorkerResponse>) => {
        const pending = this.pending.get(event.data.id)
        if (!pending) return
        this.pending.delete(event.data.id)
        if (event.data.hash) pending.resolve(event.data.hash)
        else pending.reject(new Error(event.data.error || '哈希 Worker 未返回结果'))
      })
      worker.addEventListener('error', () => {
        for (const pending of this.pending.values()) pending.reject(new Error('哈希 Worker 已停止'))
        this.pending.clear()
        worker.terminate()
        if (this.worker === worker) this.worker = undefined
      })
      this.worker = worker
      return worker
    } catch {
      return undefined
    }
  }

  hash(blob: Blob): Promise<string> | undefined {
    const worker = this.getWorker()
    if (!worker) return undefined
    const id = crypto.randomUUID()
    return new Promise<string>((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      worker.postMessage({ id, blob })
    })
  }
}

const workerClient = new HashWorkerClient()

function arrayBufferToHex(digest: ArrayBuffer): string {
  return bytesToHex(new Uint8Array(digest))
}

async function hashBlobIncrementally(blob: Blob): Promise<string> {
  const hash = sha256.create()
  const reader = blob.stream().getReader()
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    hash.update(value)
  }
  return bytesToHex(hash.digest())
}

export async function hashBytes(bytes: Uint8Array): Promise<string> {
  if (bytes.byteLength <= WEB_CRYPTO_LIMIT) {
    const owned = new Uint8Array(bytes.byteLength)
    owned.set(bytes)
    return arrayBufferToHex(await crypto.subtle.digest('SHA-256', owned.buffer))
  }
  const hash = sha256.create()
  const chunkSize = 1024 * 1024
  for (let offset = 0; offset < bytes.byteLength; offset += chunkSize) {
    hash.update(bytes.subarray(offset, Math.min(bytes.byteLength, offset + chunkSize)))
  }
  return bytesToHex(hash.digest())
}

export async function hashBlob(blob: Blob): Promise<string> {
  if (blob.size <= WEB_CRYPTO_LIMIT) {
    return arrayBufferToHex(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))
  }
  return computeWorkerPool.run('hash', () => workerClient.hash(blob) ?? hashBlobIncrementally(blob))
}

export async function hashFile(file: File): Promise<string> {
  return hashBlob(file)
}

export async function hashReadableStream(
  stream: ReadableStream<Uint8Array>,
  options: { maxBytes?: number; onChunk?: (chunkBytes: number, totalBytes: number) => void } = {},
): Promise<{ hash: string; size: number }> {
  const hash = sha256.create()
  const reader = stream.getReader()
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (options.maxBytes !== undefined && size > options.maxBytes) {
        await reader.cancel('stream exceeds maximum size')
        throw new Error('流式内容超过允许的大小')
      }
      hash.update(value)
      options.onChunk?.(value.byteLength, size)
    }
  } finally {
    reader.releaseLock()
  }
  return { hash: bytesToHex(hash.digest()), size }
}
