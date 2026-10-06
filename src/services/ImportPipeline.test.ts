import { describe, expect, it, vi } from 'vitest'
import { ImportPipeline } from './ImportPipeline'

describe('ImportPipeline', () => {
  it('memoizes hash, parser and derived products without caching a whole ArrayBuffer', async () => {
    const file = new File(['resource'], 'card.json', { type: 'application/json' })
    const context = new ImportPipeline().intake<{ name: string }>(file)
    const parser = vi.fn(async () => ({ name: 'card' }))
    const derived = vi.fn(async () => 'thumbnail-id')
    const originalArrayBuffer = file.arrayBuffer.bind(file)
    file.arrayBuffer = vi.fn(originalArrayBuffer)

    await Promise.all([
      context.hash(),
      context.hash(),
      context.parse(parser),
      context.parse(parser),
    ])
    await Promise.all([
      context.remember('thumbnail:tiny', derived),
      context.remember('thumbnail:tiny', derived),
    ])

    expect(parser).toHaveBeenCalledOnce()
    expect(derived).toHaveBeenCalledOnce()
    expect(file.arrayBuffer).toHaveBeenCalledOnce()
    expect(context.snapshot().completed).toEqual(
      expect.arrayContaining(['validate', 'hash', 'parse']),
    )
  })
})
