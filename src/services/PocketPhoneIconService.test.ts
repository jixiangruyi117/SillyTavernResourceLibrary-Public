/** @vitest-environment jsdom */
import { afterEach, expect, it, vi } from 'vitest'
import { strToU8, zipSync } from 'fflate'
import {
  htmlIconReferences,
  manifestIconReferences,
  preparePhoneIcon,
  readPhoneSourceZip,
  sourcePhoneIcon,
  websitePhoneIcon,
} from './PocketPhoneIconService'
import { parsePersonalResource } from '../types/PersonalResource'

vi.mock('../utils/createImageThumbnail', () => ({
  createImageThumbnail: async (blob: Blob) =>
    blob.size ? new Blob(['icon'], { type: 'image/webp' }) : undefined,
}))
vi.mock('../utils/FolderCover', async (load) => ({
  ...(await load<object>()),
  createFolderCoverDataUrl: async () => 'data:image/webp;base64,aWNvbg==',
}))
afterEach(() => vi.unstubAllGlobals())

function responseAt(body: string, url: string) {
  const response = new Response(body)
  Object.defineProperty(response, 'url', { value: url })
  return response
}
it('unwraps Android response URLs before resolving website icons', async () => {
  const page = 'https://phone.example/app/'
  const fetcher = vi.fn(async (url: string) =>
    url === page
      ? responseAt(
          '<link rel="icon" href="/brand.png">',
          `https://localhost/_capacitor_http_interceptor_?u=${encodeURIComponent(page)}`,
        )
      : new Response('image'),
  )
  vi.stubGlobal('fetch', fetcher)
  await websitePhoneIcon(page)
  expect(fetcher.mock.calls.map(([url]) => url)).toContain('https://phone.example/brand.png')
  expect(fetcher.mock.calls.some(([url]) => url.includes('localhost'))).toBe(false)
})
it('discovers a public manifest behind a login page and uses the redirected manifest base', async () => {
  const fetcher = vi.fn(async (url: string) => {
    if (url === 'https://phone.example/') return responseAt('<title>解锁</title>', url)
    if (url === 'https://phone.example/manifest.json')
      return responseAt('{"icons":[{"src":"logo.png"}]}', 'https://cdn.example/pwa/app.json')
    if (url === 'https://cdn.example/pwa/logo.png') return new Response('image')
    return new Response('', { status: 404 })
  })
  vi.stubGlobal('fetch', fetcher)
  await expect(websitePhoneIcon('https://phone.example/')).resolves.toMatchObject({
    source: 'website',
  })
  expect(fetcher.mock.calls.map(([url]) => url)).toContain('https://cdn.example/pwa/logo.png')
})
it('can display a conventional PWA icon when cross-origin HTML and manifest reads are blocked', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new Error('CORS')
    }),
  )
  vi.stubGlobal(
    'Image',
    class {
      naturalWidth = 192
      onload?: () => void
      onerror?: () => void
      set src(value: string) {
        queueMicrotask(() =>
          value === 'https://phone.example/icon-192.png' ? this.onload?.() : this.onerror?.(),
        )
      }
    },
  )
  await expect(websitePhoneIcon('https://phone.example/')).resolves.toMatchObject({
    dataUrl: 'https://phone.example/icon-192.png',
  })
})
it('ignores unsupported declarations individually instead of losing valid icons', () => {
  const refs = htmlIconReferences(
    '<link rel="icon" href="data:image/png;base64,eA=="><link rel="icon" href="good.png"><link rel="MANIFEST alternate" href="app.json">',
    'https://phone.example/',
  )
  expect(refs.icons).toEqual(['https://phone.example/good.png'])
  expect(refs.manifest).toBe('app.json')
  expect(
    manifestIconReferences(
      '{"icons":[null,{"src":"javascript:bad"},{"src":"valid.png"}]}',
      'https://phone.example/app.json',
    ),
  ).toEqual(['https://phone.example/valid.png'])
})
it.each([
  ['project/public/manifest.json', '{"icons":[{"src":"/logo.png"}]}', 'project/public/logo.png'],
  ['project/index.html', '<link rel="icon" href="/logo.svg">', 'project/public/logo.svg'],
  ['project/index.html', '<link rel="icon" href="/logo.png">', 'project/logo.png'],
  ['project/index.html', '<title>app</title>', 'project/assets/icon-192x192.png'],
  ['project/index.html', '<title>app</title>', 'project/src/app/icon.svg'],
])(
  'reads a source icon using its project/public root or icon file convention: %s %s %s',
  async (page, text, icon) => {
    const files = new Map([
      [page, new Blob([text])],
      [icon, new Blob(['image'])],
    ])
    await expect(sourcePhoneIcon(files, 'source')).resolves.toMatchObject({ source: 'source' })
  },
)
it('resolves PWA and touch icons relative to their own document and manifest', () => {
  const refs = htmlIconReferences(
    '<base href="/app/"><link rel="manifest" href="pwa.webmanifest"><link rel="apple-touch-icon" href="touch.png">',
    'https://example.com/start',
  )
  expect(refs.icons).toEqual(['https://example.com/app/touch.png'])
  expect(
    manifestIconReferences(
      '{"icons":[{"src":"small.png","sizes":"32x32"},{"src":"large.png","sizes":"192x192"}]}',
      'https://example.com/app/pwa.webmanifest',
    )[0],
  ).toBe('https://example.com/app/large.png')
})
it('reads source folders and ZIP declarations without executing scripts or fetching remote files', async () => {
  const fetcher = vi.fn()
  vi.stubGlobal('fetch', fetcher)
  const files = new Map<string, Blob>([
    [
      'site/index.html',
      new Blob(['<script>throw Error("never")</script><link rel="icon" href="icon.png">']),
    ],
    ['site/icon.png', new Blob(['png'], { type: 'image/png' })],
  ])
  expect((await sourcePhoneIcon(files, 'attachment')).source).toBe('source')
  const zip = new File(
    [
      new Uint8Array(
        zipSync({
          'site/index.html': strToU8('<link rel="icon" href="icon.png">'),
          'site/icon.png': strToU8('png'),
        }),
      ),
    ],
    'source.zip',
  )
  expect((await sourcePhoneIcon(await readPhoneSourceZip(zip), 'zip')).dataUrl).toMatch(
    /^data:image/,
  )
  expect(fetcher).not.toHaveBeenCalled()
  await expect(
    sourcePhoneIcon(
      new Map([['index.html', new Blob(['<link rel="icon" href="https://remote/icon.png">'])]]),
      'a',
    ),
  ).rejects.toThrow('未找到')
})
it('does not advertise missing, malformed, oversized or unsafe icons', async () => {
  await expect(preparePhoneIcon(new Blob([new Uint8Array(3 * 1024 * 1024 + 1)]))).rejects.toThrow(
    '3 MB',
  )
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new Error('cors')
    }),
  )
  vi.stubGlobal(
    'Image',
    class {
      onerror?: () => void
      set src(_value: string) {
        queueMicrotask(() => this.onerror?.())
      }
    },
  )
  await expect(websitePhoneIcon('https://example.com/')).rejects.toThrow('跨域')
  const document = {
    format: 'srl-personal-resource',
    version: 1,
    kind: 'pocketPhone',
    name: 'phone',
    text: '',
    url: '',
    fields: [],
    attachments: [],
  }
  expect(() =>
    parsePersonalResource({
      ...document,
      icons: [{ source: 'website', origin: 'url', dataUrl: 'javascript:alert(1)' }],
    }),
  ).toThrow('图标')
  expect(() => parsePersonalResource({ ...document, iconSource: 'apk' })).toThrow('不存在')
})
