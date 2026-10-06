import { createImageThumbnail } from '../utils/createImageThumbnail'
import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppDatabase } from '../database/AppDatabase'
import { IndexedDbAssetStore } from '../storage/IndexedDbAssetStore'
import { ThumbnailService } from './ThumbnailService'

vi.mock('../utils/createImageThumbnail', () => ({
  createImageThumbnail: vi.fn(
    async (_blob: Blob, options: { maxEdge: number }) =>
      new Blob([String(options.maxEdge)], { type: 'image/webp' }),
  ),
}))

const databases: AppDatabase[] = []
afterEach(async () => {
  await Promise.all(databases.splice(0).map((database) => database.delete()))
})

describe('ThumbnailService', () => {
  it('stores independent tiny/card/preview assets and reuses each tier', async () => {
    const database = new AppDatabase(`thumbnail-${crypto.randomUUID()}`)
    databases.push(database)
    const assets = new IndexedDbAssetStore(database)
    const service = new ThumbnailService(assets)
    const original = await assets.put(new Blob(['image'], { type: 'image/png' }), {
      source: 'import',
    })

    const tiny = await service.getOrCreate(original.assetId, 'tiny')
    const card = await service.getOrCreate(original.assetId, 'card')
    const repeatedTiny = await service.getOrCreate(original.assetId, 'tiny')

    expect(await tiny?.text()).toBe('128')
    expect(await card?.text()).toBe('320')
    expect(repeatedTiny).toEqual(tiny)
    expect((await assets.get(original.assetId))?.thumbnailRefs).toMatchObject({
      tiny: expect.stringContaining('asset-'),
      card: expect.stringContaining('asset-'),
    })
  })
})

it('shares concurrent generation and releases a failed task for an explicit retry', async () => {
  const database = new AppDatabase(`thumbnail-concurrent-${crypto.randomUUID()}`)
  databases.push(database)
  const assets = new IndexedDbAssetStore(database)
  const service = new ThumbnailService(assets)
  const original = await assets.put(new Blob(['large image'], { type: 'image/png' }), {
    source: 'import',
  })
  vi.mocked(createImageThumbnail).mockClear()
  const [a, b] = await Promise.all([
    service.getOrCreate(original.assetId, 'tiny'),
    service.getOrCreate(original.assetId, 'tiny'),
  ])
  expect(a).toBe(b)
  expect(createImageThumbnail).toHaveBeenCalledTimes(1)
  vi.mocked(createImageThumbnail).mockRejectedValueOnce(new Error('decode failed'))
  await expect(service.getOrCreate(original.assetId, 'preview')).rejects.toThrow('decode failed')
  expect(await (await service.getOrCreate(original.assetId, 'preview'))?.text()).toBe('640')
})
