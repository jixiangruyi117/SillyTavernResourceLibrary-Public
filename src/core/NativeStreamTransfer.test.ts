import { describe, expect, it, vi } from 'vitest'

import { transferNativeStream } from './NativeStreamTransfer'

describe('NativeStreamTransfer', () => {
  it('streams bounded Base64 chunks without materializing the whole Blob', async () => {
    const source = new Blob([new Uint8Array(900_000).map((_, index) => index % 251)])
    Object.defineProperty(source, 'arrayBuffer', {
      value: vi.fn(() => Promise.reject(new Error('whole arrayBuffer is forbidden'))),
    })
    const chunks: Uint8Array[] = []
    const progress: number[] = []
    let measuredBytes = 0

    const bytes = await transferNativeStream(source, {
      chunkBytes: 128 * 1024,
      append: async (data) => {
        chunks.push(Uint8Array.from(atob(data), (value) => value.charCodeAt(0)))
      },
      onProgress: (state) => progress.push(state.transferredBytes),
      onChunkMetrics: (metrics) => {
        measuredBytes += metrics.bytes
        expect(metrics.encodeMs).toBeGreaterThanOrEqual(0)
        expect(metrics.transferMs).toBeGreaterThanOrEqual(0)
      },
    })

    expect(bytes).toBe(source.size)
    expect(chunks.length).toBeGreaterThan(2)
    expect(Math.max(...chunks.map((chunk) => chunk.byteLength))).toBeLessThanOrEqual(128 * 1024)
    expect(progress.at(-1)).toBe(source.size)
    expect(measuredBytes).toBe(source.size)
  })

  it('honors AbortSignal between native writes', async () => {
    const controller = new AbortController()
    let writes = 0
    await expect(
      transferNativeStream(new Blob([new Uint8Array(300_000)]), {
        chunkBytes: 64 * 1024,
        signal: controller.signal,
        append: async () => {
          writes += 1
          controller.abort(new Error('cancelled'))
        },
      }),
    ).rejects.toThrow('cancelled')
    expect(writes).toBe(1)
  })
})
