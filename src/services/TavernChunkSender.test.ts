import { afterEach, expect, it, vi } from 'vitest'
import { TavernChunkSender } from './TavernChunkSender'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})
it('counts bytes before MessagePort transfers detach buffers', async () => {
  vi.stubGlobal('window', { setTimeout, clearTimeout })
  const progress: number[] = []
  const sender = new TavernChunkSender(async (chunk) => {
    structuredClone(chunk.data, { transfer: [chunk.data] })
    queueMicrotask(() => sender.acknowledge(chunk.transferId, chunk.index))
  })
  await sender.send(new Blob([new Uint8Array(256 * 1024 + 7)]), 'request', 'transfer', (bytes) =>
    progress.push(bytes),
  )
  expect(progress.at(-1)).toBe(256 * 1024 + 7)
})
it('connection teardown rejects ACK waiters immediately and clears their timers', async () => {
  vi.useFakeTimers()
  vi.stubGlobal('window', { setTimeout, clearTimeout })
  let posted!: () => void
  const ready = new Promise<void>((resolve) => {
    posted = resolve
  })
  const sender = new TavernChunkSender(async () => {
    posted()
  })
  const task = sender.send(new Blob(['payload']), 'request', 'transfer')
  const failure = expect(task).rejects.toThrow('已断开')
  await ready
  sender.cancel(new Error('已断开'))
  await failure
  expect(vi.getTimerCount()).toBe(0)
})
