import { describe, expect, it, vi } from 'vitest'
import {
  assistantPublicUrl,
  assistantGitHubTarget,
  DEFAULT_ASSISTANT_GITHUB_REPOSITORY,
  readAssistantOnline,
} from './ProductAssistantOnline'
const signal = () => new AbortController().signal
const json = (value: unknown, headers?: Record<string, string>) =>
  new Response(JSON.stringify(value), { headers })
const metadata = () => json({ private: false, visibility: 'public', default_branch: 'main' })
const file = (text: string) =>
  json({
    type: 'file',
    encoding: 'base64',
    sha: 'file-sha',
    content: btoa(String.fromCharCode(...new TextEncoder().encode(text))),
  })
const target = { url: 'https://github.com/example/public-repo', path: 'src/main.ts' }
describe('GitHub public repository reading', () => {
  it('defaults to the user-designated public resource-library repository when no URL is supplied', () => {
    expect(assistantGitHubTarget({})).toMatchObject({
      owner: 'jixiangruyi117',
      repo: 'SillyTavernResourceLibrary-Public',
      path: '',
    })
    expect(DEFAULT_ASSISTANT_GITHUB_REPOSITORY).toBe(
      'https://github.com/jixiangruyi117/SillyTavernResourceLibrary-Public',
    )
  })
  it.each([
    'http://example.com',
    'https://127.0.0.1',
    'https://[::1]',
    'https://user:pass@example.com',
    'https://app.local',
    'https://example.com/?token=secret',
    'https://example.com:444',
  ])('rejects non-public or credentialed targets: %s', (url) => {
    expect(() => assistantPublicUrl(url)).toThrow()
  })

  it.each([
    [{ url: 'https://github.com/example/public-repo' }, '', ''],
    [{ url: 'https://github.com/example/public-repo/tree/main/src' }, 'src', 'main'],
    [
      { url: 'https://github.com/example/public-repo/blob/main/src/main.ts#L5' },
      'src/main.ts',
      'main',
    ],
    [
      { url: 'https://raw.githubusercontent.com/example/public-repo/main/src/main.ts' },
      'src/main.ts',
      'main',
    ],
    [
      { url: 'https://api.github.com/repos/example/public-repo/contents/src/main.ts?ref=dev' },
      'src/main.ts',
      'dev',
    ],
    [
      { url: 'https://github.com/example/public-repo', ref: 'feature/new', path: 'src/main.ts' },
      'src/main.ts',
      'feature/new',
    ],
    [
      {
        url: 'https://github.com/example/public-repo/blob/feature/new/src/main.ts',
        ref: 'feature/new',
      },
      'src/main.ts',
      'feature/new',
    ],
  ])('resolves supported targets %j', (args, path, ref) => {
    expect(assistantGitHubTarget(args)).toMatchObject({
      owner: 'example',
      repo: 'public-repo',
      path,
      ref,
    })
  })
  it.each([
    'https://example.com/docs',
    'https://github.com.evil.example/example/public-repo',
    'https://api.github.com/user',
    'https://github.com/example/public-repo/issues',
    'https://github.com/example/public-repo?access_token=secret',
  ])('refuses unsupported targets without requests: %s', async (url) => {
    const fetcher = vi.fn<typeof fetch>()
    await expect(
      readAssistantOnline({ url }, signal(), fetcher, 'github_pat_fixture'),
    ).rejects.toThrow()
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('checks public visibility before requesting contents, sends only fixed-origin authorization and returns full text', async () => {
    const text = '源码中文\n'.repeat(1200)
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(metadata())
      .mockResolvedValueOnce(file(text))
    const result = await readAssistantOnline(target, signal(), fetcher, ' github_pat_fixture ')
    expect(fetcher.mock.calls.map((call) => call[0])).toEqual([
      'https://api.github.com/repos/example/public-repo',
      'https://api.github.com/repos/example/public-repo/contents/src/main.ts?ref=main',
    ])
    for (const [, options] of fetcher.mock.calls)
      expect(options).toMatchObject({
        credentials: 'omit',
        redirect: 'error',
        referrerPolicy: 'no-referrer',
        headers: { Authorization: 'Bearer github_pat_fixture' },
      })
    expect(result).toMatchObject({
      kind: 'file',
      text,
      complete: true,
      nextOffset: null,
      totalCharacters: text.length,
      sha: 'file-sha',
    })
    expect(JSON.stringify(result)).not.toContain('github_pat_fixture')
  })
  it('leaves blank tokens anonymous, reads the full tail after an offset, and encodes slash branches', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(metadata())
      .mockResolvedValueOnce(file('x'.repeat(9000)))
    const result = await readAssistantOnline(
      { ...target, ref: 'feature/new', offset: '4000' },
      signal(),
      fetcher,
      ' ',
    )
    expect(fetcher.mock.calls[0]![1]!.headers).not.toHaveProperty('Authorization')
    expect(fetcher.mock.calls[1]![0]).toContain('ref=feature%2Fnew')
    expect(result).toMatchObject({ offset: 4000, nextOffset: null, complete: false })
    expect(String(result.text)).toBe('x'.repeat(5000))
  })
  it('returns the entire 63343-character file at explicit offset zero, not sixteen fragments', async () => {
    const text = 'x'.repeat(63343)
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(metadata())
      .mockResolvedValueOnce(file(text))
    const receipt = await readAssistantOnline({ ...target, offset: '0' }, signal(), fetcher)
    expect(receipt).toMatchObject({
      text,
      complete: true,
      nextOffset: null,
      totalCharacters: 63343,
      offset: 0,
    })
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
  it('supports an explicit directory tail and ignores untrusted download URLs', async () => {
    const entries = Array.from({ length: 25 }, (_, i) => ({
      type: 'file',
      path: `src/${i}.ts`,
      size: i,
      sha: `sha-${i}`,
      download_url: 'https://evil.example/secret',
    }))
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(metadata())
      .mockResolvedValueOnce(json(entries))
    const result = await readAssistantOnline(
      { ...target, path: 'src', offset: '20' },
      signal(),
      fetcher,
    )
    expect(result).toMatchObject({
      kind: 'directory',
      totalEntries: 25,
      nextOffset: null,
      complete: false,
    })
    expect(result.entries).toHaveLength(5)
    expect(JSON.stringify(result)).not.toContain('evil.example')
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
  it('returns a 261-entry directory in one read rather than twenty-entry pages', async () => {
    const entries = Array.from({ length: 261 }, (_, i) => ({
      type: 'file',
      path: `src/services/Service${i}.ts`,
    }))
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async (url) =>
        String(url).includes('/contents') ? json(entries) : metadata(),
      )
    for (const offset of [undefined, '0']) {
      const result = await readAssistantOnline(
        { ...target, path: 'src/services', ...(offset ? { offset } : {}) },
        signal(),
        fetcher,
      )
      expect(result).toMatchObject({
        totalEntries: 261,
        directoryTotalEntries: 261,
        nextOffset: null,
        complete: true,
      })
      expect(result.entries).toEqual(entries)
    }
    expect(fetcher).toHaveBeenCalledTimes(4)
  })
  it.each(['  TAVERNbridge  Service ', 'tavernbridge service'])(
    'filters late entries before pagination: %s',
    async (query) => {
      const entries = Array.from({ length: 260 }, (_, i) => ({
        type: 'file',
        path: `src/services/Unrelated${i}.ts`,
      }))
      entries.push({ type: 'file', path: 'src/services/TavernBridgeService.ts' })
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(metadata())
        .mockResolvedValueOnce(json(entries))
      const result = await readAssistantOnline(
        { ...target, path: 'src/services', query },
        signal(),
        fetcher,
      )
      expect(result).toMatchObject({
        query: 'tavernbridge service',
        totalEntries: 1,
        directoryTotalEntries: 261,
        nextOffset: null,
        complete: true,
      })
      expect(result.entries).toEqual([
        { type: 'file', path: 'src/services/TavernBridgeService.ts' },
      ])
      expect(fetcher).toHaveBeenCalledTimes(2)
    },
  )
  it('reports no matches and preserves upstream truncation even when filtering returns few entries', async () => {
    const entries = Array.from({ length: 1000 }, (_, i) => ({ type: 'file', path: `src/${i}.ts` }))
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(metadata())
      .mockResolvedValueOnce(json(entries))
    expect(
      await readAssistantOnline({ ...target, path: 'src', query: 'missing' }, signal(), fetcher),
    ).toMatchObject({
      entries: [],
      totalEntries: 0,
      directoryTotalEntries: 1000,
      nextOffset: null,
      complete: false,
      possiblyTruncated: true,
    })
  })
  it('returns matching tails and never matches the parent directory name', async () => {
    const entries = Array.from({ length: 26 }, (_, i) => ({
      type: 'file',
      path: `src/TavernBridge/Service${i}.ts`,
    }))
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async (url) =>
        String(url).includes('/contents') ? json(entries) : metadata(),
      )
    expect(
      await readAssistantOnline(
        { ...target, path: 'src/TavernBridge', query: 'service', offset: '20' },
        signal(),
        fetcher,
      ),
    ).toMatchObject({ totalEntries: 26, offset: 20, nextOffset: null, entries: entries.slice(20) })
    expect(
      await readAssistantOnline(
        { ...target, path: 'src/TavernBridge', query: 'tavernbridge' },
        signal(),
        fetcher,
      ),
    ).toMatchObject({ totalEntries: 0 })
  })
  it('rejects directory queries on files and excessive queries without silently reading different content', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(metadata())
      .mockResolvedValueOnce(file('source'))
    await expect(
      readAssistantOnline({ ...target, query: 'source' }, signal(), fetcher),
    ).rejects.toThrow('query仅用于目录')
    fetcher.mockClear()
    await expect(
      readAssistantOnline({ ...target, query: 'x'.repeat(121) }, signal(), fetcher),
    ).rejects.toThrow('最多120字')
    expect(fetcher).not.toHaveBeenCalled()
  })
  it.each([
    { private: true, visibility: 'private' },
    { private: false, visibility: 'internal' },
    {},
  ])('never requests private/unproven repository contents: %j', async (data) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json(data))
    await expect(
      readAssistantOnline(target, signal(), fetcher, 'github_pat_fixture'),
    ).rejects.toThrow('只允许读取公开')
    expect(fetcher).toHaveBeenCalledOnce()
  })
  it.each([401, 403, 404, 429, 500])(
    'reports HTTP %s without upstream bodies, tokens or automatic retries',
    async (status) => {
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response('github_pat_fixture PRIVATE_URL', { status }))
      const error = await readAssistantOnline(
        target,
        signal(),
        fetcher,
        'github_pat_fixture',
      ).catch((cause: Error) => cause)
      expect(String(error)).toContain('GitHub')
      expect(String(error)).not.toMatch(/github_pat_fixture|PRIVATE_URL/u)
      expect(fetcher).toHaveBeenCalledOnce()
    },
  )
  it('returns actual quota headers and explains exhausted quota', async () => {
    const headers = {
      'x-ratelimit-limit': '5000',
      'x-ratelimit-remaining': '4998',
      'x-ratelimit-reset': '1791060000',
    }
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(metadata())
      .mockResolvedValueOnce(json([], headers))
    expect(
      (await readAssistantOnline({ ...target, path: '' }, signal(), fetcher)).quota,
    ).toMatchObject({
      limit: 5000,
      remaining: 4998,
      resetsAt: new Date(1791060000 * 1000).toISOString(),
    })
    fetcher.mockReset().mockResolvedValue(
      new Response('PRIVATE_BODY', {
        status: 403,
        headers: { ...headers, 'x-ratelimit-remaining': '0' },
      }),
    )
    await expect(readAssistantOnline(target, signal(), fetcher)).rejects.toThrow('额度已用完')
  })
  it.each(['sk-model-key', 'jina-key', 'github_pat_key\r\nExtra: bad'])(
    'never forwards non-GitHub credentials %s',
    async (key) => {
      const fetcher = vi.fn<typeof fetch>()
      await expect(readAssistantOnline(target, signal(), fetcher, key)).rejects.toThrow(
        'GitHub 令牌格式',
      )
      expect(fetcher).not.toHaveBeenCalled()
    },
  )
  it('reads files larger than 1 MiB through GitHub raw content and honors cancellation', async () => {
    const text = '源码'.repeat(600_000)
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(metadata())
      .mockResolvedValueOnce(
        json({ type: 'file', encoding: 'none', size: new TextEncoder().encode(text).length }),
      )
      .mockResolvedValueOnce(new Response(text))
    const result = await readAssistantOnline(target, signal(), fetcher)
    expect(result).toMatchObject({ kind: 'file', text, complete: true })
    expect(fetcher.mock.calls[2]![1]!.headers).toMatchObject({
      Accept: 'application/vnd.github.raw+json',
    })
    const controller = new AbortController()
    controller.abort()
    fetcher.mockClear()
    await expect(readAssistantOnline(target, controller.signal, fetcher)).rejects.toThrow()
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('refuses binary, unsupported and malformed source responses', async () => {
    for (const content of [
      json({ type: 'submodule' }),
      file('bad\u0000binary'),
      json({ type: 'file', encoding: 'base64', content: '/w==' }),
    ]) {
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(metadata())
        .mockResolvedValueOnce(content)
      await expect(readAssistantOnline(target, signal(), fetcher)).rejects.toThrow()
    }
  })
})
