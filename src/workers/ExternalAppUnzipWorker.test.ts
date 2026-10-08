/** @vitest-environment node */
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { zipSync } from 'fflate'

let receive!: (event: MessageEvent) => Promise<void>
const sent = vi.fn()

beforeAll(async () => {
  vi.stubGlobal('self', {
    addEventListener: (_name: string, handler: typeof receive) => {
      receive = handler
    },
    postMessage: sent,
  })
  await import('./ExternalAppUnzipWorker')
})
afterAll(() => vi.unstubAllGlobals())

it.each([
  [128, undefined, true],
  [129, undefined, false],
  [256, 256, true],
  [257, 256, false],
] as const)(
  'enforces total archive entries in the worker: count %i, limit %s',
  async (count, maxFiles, accepted) => {
    sent.mockClear()
    const archive = Object.fromEntries(
      Array.from({ length: count }, (_, index) => [
        index === 0 ? 'manifest.json' : `file-${index}.txt`,
        new Uint8Array([1]),
      ]),
    )
    const bytes = zipSync(archive).slice().buffer
    await receive({ data: { id: 'request', bytes, maxFiles } } as MessageEvent)
    expect(sent).toHaveBeenCalledOnce()
    const result = sent.mock.calls[0]![0]
    expect(result.id).toBe('request')
    if (accepted) {
      expect(Object.keys(result.files)).toHaveLength(count)
      expect(result.error).toBeUndefined()
    } else {
      expect(result.error).toBe('安装包文件数量超过限制')
      expect(result.files).toBeUndefined()
    }
  },
)
