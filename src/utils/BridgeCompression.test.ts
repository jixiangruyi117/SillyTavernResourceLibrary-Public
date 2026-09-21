import { describe, expect, it } from 'vitest'

import {
  BRIDGE_COMPRESS_MIN_BYTES,
  gunzipBlob,
  gzipBlob,
  isCompressibleKind,
  supportsBridgeGzip,
} from './BridgeCompression'

describe('BridgeCompression', () => {
  it('运行环境支持 CompressionStream', () => {
    expect(supportsBridgeGzip()).toBe(true)
  })

  it('JSON 类资源可压缩，角色卡 PNG 不重复压缩', () => {
    expect(isCompressibleKind('worldBook')).toBe(true)
    expect(isCompressibleKind('scriptGlobal')).toBe(true)
    expect(isCompressibleKind('character')).toBe(false)
  })

  it('gzip 往返无损，且对重复性 JSON 有实际压缩率', async () => {
    const entries = Object.fromEntries(
      Array.from({ length: 200 }, (_, index) => [
        index,
        { uid: index, comment: `条目 ${index}`, content: '重复的世界书内容 '.repeat(20) },
      ]),
    )
    const original = new Blob([JSON.stringify({ entries })], { type: 'application/json' })
    expect(original.size).toBeGreaterThan(BRIDGE_COMPRESS_MIN_BYTES)

    const compressed = await gzipBlob(original)
    expect(compressed.size).toBeLessThan(original.size / 3)

    const restored = await gunzipBlob(compressed)
    expect(await restored.text()).toBe(await original.text())
  })
})
