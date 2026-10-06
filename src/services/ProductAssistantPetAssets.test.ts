/** @vitest-environment jsdom */
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import {
  ASSISTANT_PET_ASSET_FILES,
  clearAssistantPetAssets,
  downloadAssistantPetAssets,
  hasDownloadedAssistantPetAssets,
  loadAssistantPetAssets,
} from './ProductAssistantPetAssets'

const objects = new Map<string, { ok: boolean; blob: () => Promise<Blob>; clone: () => unknown }>()
const cache = {
  match: vi.fn(async (request: Request) => objects.get(request.url)),
  put: vi.fn(async (request: Request, response: { ok: boolean }) => {
    objects.set(request.url, response as never)
  }),
  keys: vi.fn(async () => [...objects.keys()].map((url) => new Request(url))),
}
const cacheStorage = {
  open: vi.fn(async () => cache),
  delete: vi.fn(async () => {
    objects.clear()
    return true
  }),
}
beforeEach(() => {
  objects.clear()
  vi.stubGlobal('caches', cacheStorage)
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      const response = {
        ok: true,
        headers: { get: () => 'image/png' },
        blob: async () => new Blob(['pet'], { type: 'image/png' }),
        clone() {
          return this
        },
      }
      return response
    }),
  )
  vi.spyOn(URL, 'createObjectURL').mockImplementation((() => `blob:pet-${Math.random()}`) as never)
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
})
afterEach(async () => {
  await clearAssistantPetAssets()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

it('downloads every pet image only on request and restores them from the dedicated cache', async () => {
  expect(await hasDownloadedAssistantPetAssets()).toBe(false)
  await downloadAssistantPetAssets()
  expect(fetch).toHaveBeenCalledTimes(ASSISTANT_PET_ASSET_FILES.length)
  expect(await hasDownloadedAssistantPetAssets()).toBe(true)
  const assets = await loadAssistantPetAssets()
  expect(Object.keys(assets ?? {})).toHaveLength(ASSISTANT_PET_ASSET_FILES.length)
  expect(await hasDownloadedAssistantPetAssets()).toBe(true)
})

it('deletes a partial download after a failed image and can clear the dedicated cache', async () => {
  vi.mocked(fetch).mockImplementationOnce(
    async () =>
      ({
        ok: false,
        headers: { get: () => 'text/plain' },
      }) as unknown as Response,
  )
  await expect(downloadAssistantPetAssets()).rejects.toThrow('桌宠图片下载失败')
  expect(cacheStorage.delete).toHaveBeenCalled()
  await downloadAssistantPetAssets()
  const assets = await loadAssistantPetAssets()
  await clearAssistantPetAssets()
  expect(await hasDownloadedAssistantPetAssets()).toBe(false)
  expect(URL.revokeObjectURL).toHaveBeenCalledTimes(Object.keys(assets ?? {}).length)
})
