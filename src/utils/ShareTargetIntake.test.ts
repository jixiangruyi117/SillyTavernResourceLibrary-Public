/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest'

import { clearShareTargetQuery, takeSharedFiles } from './ShareTargetIntake'

type StoredEntry = Response

function createFakeCaches(initial: Record<string, Record<string, StoredEntry>>) {
  const stores = new Map<string, Map<string, StoredEntry>>(
    Object.entries(initial).map(([name, entries]) => [name, new Map(Object.entries(entries))]),
  )
  return {
    keys: async () => Array.from(stores.keys()),
    open: async (name: string) => {
      if (!stores.has(name)) stores.set(name, new Map())
      const store = stores.get(name)!
      return {
        match: async (key: string) => store.get(key),
        put: async (key: string, value: StoredEntry) => void store.set(key, value),
        delete: async (key: string) => store.delete(key),
      }
    },
    delete: async (name: string) => stores.delete(name),
    has: (name: string) => stores.has(name),
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('takeSharedFiles', () => {
  it('从暂存缓存还原文件并在取走后删除缓存', async () => {
    window.history.pushState(null, '', '/?share-target=intake-1')
    const fake = createFakeCaches({
      'srl-share-intake': {
        '/srl-shared/intake-1/manifest': new Response(
          JSON.stringify({ files: [{ name: '角色卡.png', type: 'image/png' }] }),
        ),
        // 保持 Blob 与 jsdom File 属于同一 realm，避免 Node Response 产生跨 realm Blob。
        '/srl-shared/intake-1/0': {
          blob: async () => new Blob(['png-bytes'], { type: 'image/png' }),
        } as Response,
      },
    })
    vi.stubGlobal('caches', fake)

    const files = await takeSharedFiles()

    expect(files).toHaveLength(1)
    expect(files[0].name).toBe('角色卡.png')
    expect(files[0].type).toBe('image/png')
    expect(await files[0].text()).toBe('png-bytes')
    expect(fake.has('srl-share-intake')).toBe(true)
  })

  it('没有暂存缓存时返回空数组', async () => {
    vi.stubGlobal('caches', createFakeCaches({}))
    expect(await takeSharedFiles()).toEqual([])
  })

  it('缓存存在但缺当前 intake manifest 时不误删其他待处理分享', async () => {
    const fake = createFakeCaches({ 'srl-share-intake': {} })
    vi.stubGlobal('caches', fake)
    expect(await takeSharedFiles()).toEqual([])
    expect(fake.has('srl-share-intake')).toBe(true)
  })

  it('浏览器不支持 Cache Storage 时静默返回空', async () => {
    vi.stubGlobal('caches', undefined)
    expect(await takeSharedFiles()).toEqual([])
  })
})

describe('clearShareTargetQuery', () => {
  it('只在带 share-target 参数时改写地址', () => {
    const replaceState = vi.spyOn(window.history, 'replaceState')
    window.history.pushState(null, '', '/?share-target=received')
    clearShareTargetQuery()
    expect(replaceState).toHaveBeenCalledWith(null, '', '/')

    replaceState.mockClear()
    window.history.pushState(null, '', '/')
    clearShareTargetQuery()
    expect(replaceState).not.toHaveBeenCalled()
  })
})
