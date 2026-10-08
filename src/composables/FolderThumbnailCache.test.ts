import { afterEach, expect, it, vi } from 'vitest'
import { createFolderThumbnailCache } from './FolderThumbnailCache'
import type { ResourceSummary } from '../types/Resource'

const source = (id: string) => ({ id, contentHash: id, thumbnailAssetId: id }) as ResourceSummary
afterEach(() => vi.restoreAllMocks())

it('bounds retained bytes and entries, without revoking a displayed image', () => {
  const revoke = vi.spyOn(URL, 'revokeObjectURL')
  const cache = createFolderThumbnailCache(2, 4)
  const first = cache.acquire(source('a'), new Blob(['aa']))!
  const second = cache.acquire(source('b'), new Blob(['bb']))!
  second.release()
  const third = cache.acquire(source('c'), new Blob(['cc']))!
  expect(revoke).toHaveBeenCalledWith(second.url)
  expect(revoke).not.toHaveBeenCalledWith(first.url)
  expect(cache.acquire(source('b'))).toBeUndefined()
  const oversized = cache.acquire(source('large'), new Blob(['12345']))!
  oversized.release()
  expect(revoke).toHaveBeenCalledWith(oversized.url)
  expect(cache.acquire(source('large'))).toBeUndefined()
  first.release()
  third.release()
  cache.clear()
  expect(revoke).toHaveBeenCalledWith(first.url)
  expect(revoke).toHaveBeenCalledWith(third.url)
})

it('discards removed or replaced sources and clears late leases exactly once', () => {
  const revoke = vi.spyOn(URL, 'revokeObjectURL')
  const cache = createFolderThumbnailCache()
  const old = cache.acquire(source('a'), new Blob(['a']))!
  cache.prune([{ ...source('a'), thumbnailAssetId: 'replacement' }])
  expect(cache.acquire(source('a'))).toBeUndefined()
  old.release()
  old.release()
  expect(revoke).toHaveBeenCalledExactlyOnceWith(old.url)
  const next = cache.acquire(source('b'), new Blob(['b']))!
  next.release()
  cache.prune([])
  expect(cache.acquire(source('b'))).toBeUndefined()
  expect(revoke).toHaveBeenCalledWith(next.url)
  cache.clear()
})
