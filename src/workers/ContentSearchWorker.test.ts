import { afterEach, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetModules()
})
it('上锁清空索引后，尚未结束的 Blob 读取不能复活私密缓存或返回旧结果', async () => {
  const worker = {
    onmessage: undefined as unknown as (event: { data: unknown }) => Promise<void>,
    postMessage: vi.fn(),
  }
  vi.stubGlobal('self', worker)
  await import('./ContentSearchWorker')
  let release!: (value: string) => void
  const pending = worker.onmessage({
    data: {
      type: 'search',
      requestId: 1,
      query: 'secret',
      items: [
        {
          id: 'a',
          contentHash: 'h',
          blob: {
            text: () =>
              new Promise<string>((resolve) => {
                release = resolve
              }),
          },
        },
      ],
    },
  })
  await worker.onmessage({ data: { type: 'reset' } })
  release('secret')
  await pending
  expect(worker.postMessage).not.toHaveBeenCalled()
  await worker.onmessage({
    data: { type: 'search', requestId: 2, query: 'secret', items: [{ id: 'a', contentHash: 'h' }] },
  })
  expect(worker.postMessage).toHaveBeenCalledWith({
    type: 'result',
    requestId: 2,
    matchedIds: [],
    indexedHashes: [],
  })
})
