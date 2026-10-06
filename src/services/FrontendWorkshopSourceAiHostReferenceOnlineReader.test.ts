import { describe, expect, it, vi } from 'vitest'
import { readOnlineHostReferences } from './FrontendWorkshopSourceAiHostReferenceOnlineReader'

const online = {
  maxAdditionalRequests: 1 as const,
  tavernHelperVersion: '4.9.3',
  sillyTavernVersion: '1.18.0',
}
const index = '// new_api\nreadonly discoverNovelFeature: typeof discoverNovelFeature;'

describe('official Host Reference reading', () => {
  it('uses only the explicitly requested file even when its path matches another topic', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('declare const character: string;'))
    await readOnlineHostReferences(['@types/function/raw_character.d.ts#L1'], { online }, fetcher)
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(fetcher.mock.calls[0]?.[0]).toContain('/raw_character.d.ts')
  })
  it('follows line cursors without re-reading the index and reuses version-specific cached files', async () => {
    const data = Array.from({ length: 300 }, (_, n) => `declare const entry${n}: string;`).join(
      '\n',
    )
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => new Response(data))
    const files = new Map<string, string>()
    const cache = {
      get: async (url: string) => files.get(url),
      put: async (url: string, text: string) => {
        files.set(url, text)
      },
    }
    const [first] = await readOnlineHostReferences(
      ['@types/function/new_api.d.ts#L1'],
      { online },
      fetcher,
      cache,
    )
    const info = JSON.parse(first!.references[0]!.content)
    expect(info.nextRequest).toContain('#L')
    const [second] = await readOnlineHostReferences([info.nextRequest], { online }, fetcher, cache)
    const next = JSON.parse(second!.references[0]!.content)
    expect(next.lines[0]).toBe(info.lines[1] + 1)
    expect(second!.references[0]?.cached).toBe(true)
    expect(fetcher).toHaveBeenCalledTimes(1)
    await readOnlineHostReferences(
      ['@types/function/new_api.d.ts#L1'],
      { online: { ...online, tavernHelperVersion: '4.9.4' } },
      fetcher,
      cache,
    )
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
  it('does not access the network without opt-in', async () => {
    const fetcher = vi.fn<typeof fetch>()
    expect(await readOnlineHostReferences(['discoverNovelFeature'], {}, fetcher)).toEqual([
      { request: 'discoverNovelFeature', references: [] },
    ])
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('discovers a symbol absent from the local catalog through the upstream index', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(
        async (url) =>
          new Response(
            String(url).endsWith('index.d.ts')
              ? index
              : 'declare function discoverNovelFeature(): string;',
          ),
      )
    const [entry] = await readOnlineHostReferences(['discoverNovelFeature'], { online }, fetcher)
    const evidence = JSON.parse(entry!.references[0]!.content)
    expect(evidence.text).toContain('discoverNovelFeature()')
    expect(evidence.version).toBe('4.9.3')
    expect(evidence.sourceUrl).toContain('/blob/4.9.3/@types/function/new_api.d.ts#L')
    expect(fetcher).toHaveBeenCalledTimes(2)
    for (const [url, init] of fetcher.mock.calls) {
      expect(String(url)).toMatch(
        /^https:\/\/raw\.githubusercontent\.com\/N0VI028\/JS-Slash-Runner\/4\.9\.3\/@types\//,
      )
      expect(init).toMatchObject({
        credentials: 'omit',
        redirect: 'error',
        referrerPolicy: 'no-referrer',
      })
      expect(init?.headers).toBeUndefined()
      expect(init?.body).toBeUndefined()
    }
  })

  it('reads SillyTavern files independently of the helper index', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('export function getContext() {}'))
    const [entry] = await readOnlineHostReferences(['SillyTavern getContext'], { online }, fetcher)
    expect(entry!.references[0]!.title).toContain('SillyTavern 1.18.0')
    expect(fetcher).toHaveBeenCalledOnce()
    expect(fetcher.mock.calls[0]![0]).toBe(
      'https://raw.githubusercontent.com/SillyTavern/SillyTavern/1.18.0/public/scripts/extensions.js',
    )
  })

  it('does not fetch an arbitrary URL or silently replace a missing version with latest', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 404 }))
    const entries = await readOnlineHostReferences(
      ['https://127.0.0.1/private?secret=abc'],
      { online },
      fetcher,
    )
    expect(entries[0]!.references).toEqual([])
    expect(fetcher.mock.calls.every(([url]) => !String(url).includes('secret'))).toBe(true)
    expect(fetcher).toHaveBeenCalledOnce()
    await expect(
      readOnlineHostReferences(
        ['variables'],
        { online: { ...online, tavernHelperVersion: '../../private' } },
        fetcher,
      ),
    ).rejects.toThrow('版本')
    expect(fetcher).toHaveBeenCalledOnce()
  })

  it('bounds files and marks excerpts incomplete with line provenance', async () => {
    const body = 'type Value = string;\n'.repeat(800) + 'declare function getVariables(): Value;'
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(
        async (url) => new Response(String(url).endsWith('index.d.ts') ? '' : body),
      )
    const entries = await readOnlineHostReferences(
      ['getVariables', 'getVariables', '消息', '角色', '音乐', '预设'],
      { online },
      fetcher,
    )
    const part = JSON.parse(entries[0]!.references[0]!.content)
    expect(part.text).toContain('getVariables')
    expect(part.text.length).toBeLessThanOrEqual(4_000)
    expect(part.partial).toBe(true)
    expect(part.lines[0]).toBeGreaterThan(1)
    expect(entries[0]!.references).toEqual(entries[1]!.references)
    expect(fetcher).toHaveBeenCalledTimes(4)
    expect(entries.at(-1)!.references).toEqual([])
  })

  it('limits streamed bytes even if the server omits Content-Length', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('x'.repeat(160_001)))
    const entries = await readOnlineHostReferences(['getVariables'], { online }, fetcher)
    expect(entries[0]!.references).toEqual([])
    expect(fetcher).toHaveBeenCalledOnce()
  })

  it('propagates cancellation instead of treating it as missing evidence', async () => {
    const controller = new AbortController()
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => {
      controller.abort()
      return new Response(index)
    })
    await expect(
      readOnlineHostReferences(
        ['discoverNovelFeature'],
        { online, signal: controller.signal },
        fetcher,
      ),
    ).rejects.toMatchObject({ name: 'AbortError' })
  })
})
