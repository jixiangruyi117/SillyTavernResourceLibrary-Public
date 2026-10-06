import assert from 'node:assert/strict'
import { it } from 'vitest'
import { transferNativeStream } from './NativeStreamTransfer'

it('coalesces 64 KiB inputs into bounded 512 KiB writes without changing any bytes', async () => {
  const source = Uint8Array.from({ length: 2 * 1024 * 1024 + 17 }, (_, i) => i % 251)
  let offset = 0
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= source.length) return controller.close()
      controller.enqueue(source.subarray(offset, offset + 64 * 1024))
      offset += 64 * 1024
    },
  })
  const chunks: Uint8Array[] = []
  const progress: number[] = []
  const size = await transferNativeStream(stream, {
    append: async (data) => {
      chunks.push(Uint8Array.from(atob(data), (value) => value.charCodeAt(0)))
    },
    totalBytes: source.length,
    onProgress: (value) => progress.push(value.transferredBytes),
  })
  assert.equal(size, source.length)
  assert.equal(chunks.length, 5)
  assert.deepEqual(
    chunks.map((item) => item.length),
    [524288, 524288, 524288, 524288, 17],
  )
  assert.deepEqual(Buffer.concat(chunks), Buffer.from(source))
  assert.equal(progress.at(-1), source.length)
})

it('cancels a blocked read even when the source cancellation promise never settles', async () => {
  const controller = new AbortController()
  let cancelled = 0
  const stream = new ReadableStream<Uint8Array>({
    cancel() {
      cancelled += 1
      return new Promise<void>(() => undefined)
    },
  })
  const operation = transferNativeStream(stream, {
    signal: controller.signal,
    append: async () => assert.fail('no write expected'),
  })
  controller.abort(new Error('cancel blocked read'))
  await assert.rejects(operation, /cancel blocked read/)
  assert.equal(cancelled, 1)
  assert.equal(stream.locked, false)
})

it('rejects cancellation during the final write instead of reporting success', async () => {
  const controller = new AbortController()
  await assert.rejects(
    transferNativeStream(new Blob(['small tail']), {
      signal: controller.signal,
      append: async () => controller.abort(new Error('cancel final write')),
    }),
    /cancel final write/,
  )
})

it('rejects a pre-cancelled empty blob and invalid chunk sizes without writing', async () => {
  const controller = new AbortController()
  controller.abort(new Error('already cancelled'))
  const append = async (): Promise<void> => assert.fail('no write expected')
  await assert.rejects(
    transferNativeStream(new Blob(), { signal: controller.signal, append }),
    /already cancelled/,
  )
  for (const chunkBytes of [0, -1, NaN, Infinity, 1.5]) {
    await assert.rejects(transferNativeStream(new Blob(), { append, chunkBytes }), RangeError)
  }
})

it('preserves sequential backpressure for a large single input and a short tail', async () => {
  let active = 0
  let maximum = 0
  let written = 0
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(1_200_007))
      controller.close()
    },
  })
  await transferNativeStream(stream, {
    append: async (value) => {
      active += 1
      maximum = Math.max(maximum, active)
      await Promise.resolve()
      written += atob(value).length
      active -= 1
    },
  })
  assert.equal(maximum, 1)
  assert.equal(written, 1_200_007)
})

it('keeps the non-streaming Blob fallback bounded', async () => {
  const blob = new Blob([new Uint8Array(100_003)])
  Object.defineProperty(blob, 'stream', { value: undefined })
  Object.defineProperty(blob, 'arrayBuffer', { value: () => assert.fail('no whole Blob reads') })
  let bytes = 0
  await transferNativeStream(blob, {
    chunkBytes: 64 * 1024,
    append: async (data) => {
      bytes += atob(data).length
    },
  })
  assert.equal(bytes, blob.size)
})
