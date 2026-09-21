import { Unzip, UnzipInflate } from 'fflate'
import { createImageThumbnail } from '../utils/createImageThumbnail'
import { createFolderCoverDataUrl, normalizeFolderCoverUrl } from '../utils/FolderCover'
import type { PhoneIcon } from '../types/PersonalResource'
import { resolveAndroidHttpResponseUrl } from '../utils/AndroidHttpInterceptor'

const MAX_IMAGE = 3 * 1024 * 1024
const MAX_TEXT = 1024 * 1024
const localOrigin = 'https://source.invalid/'
const mime = (path: string) =>
  ({
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    webp: 'image/webp',
    svg: 'image/svg+xml',
    ico: 'image/x-icon',
  })[path.split('.').at(-1)!.toLowerCase()]

export async function preparePhoneIcon(blob: Blob): Promise<string> {
  if (!blob.size || blob.size > MAX_IMAGE) throw new Error('图标图片须小于 3 MB')
  // ImageBitmap does not decode SVG in all browsers; image-element decoding still does.
  const thumbnail =
    (await createImageThumbnail(blob, { maxEdge: 192 })) ?? (await rasterizePhoneIcon(blob))
  if (!thumbnail) throw new Error('这张图片无法解析，请换成 PNG、JPG 或 WebP')
  return createFolderCoverDataUrl(new File([thumbnail], 'icon.webp', { type: thumbnail.type }))
}

async function rasterizePhoneIcon(blob: Blob): Promise<Blob | undefined> {
  const url = URL.createObjectURL(blob)
  try {
    const image = new Image()
    image.src = url
    await image.decode()
    if (!image.naturalWidth || !image.naturalHeight) return undefined
    const scale = Math.min(1, 192 / Math.max(image.naturalWidth, image.naturalHeight))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
    const context = canvas.getContext('2d')
    if (!context) return undefined
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    return await new Promise<Blob | undefined>((resolve) =>
      canvas.toBlob((value) => resolve(value ?? undefined), 'image/png'),
    )
  } catch {
    return undefined
  } finally {
    URL.revokeObjectURL(url)
  }
}

export async function readIconResponse(response: Response, limit: number): Promise<Blob> {
  if (!response.ok || !response.body) throw new Error('无法读取图标来源')
  const reader = response.body.getReader()
  const chunks: BlobPart[] = []
  let size = 0
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      size += value.length
      if (size > limit) throw new Error('图标来源超过大小限制')
      chunks.push(new Uint8Array(value))
    }
  } finally {
    await reader.cancel()
    reader.releaseLock()
  }
  return new Blob(chunks, { type: response.headers.get('content-type')?.split(';')[0] || '' })
}

function webUrl(value: string, base?: string): string {
  const url = new URL(value, base)
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password)
    throw new Error('图标来源须为不含账号密码的 HTTP/HTTPS 地址')
  return url.href
}
function iconUrls(values: string[], base: string): string[] {
  return values.flatMap((value) => {
    try {
      return value.trim() ? [webUrl(value, base)] : []
    } catch {
      return []
    }
  })
}
async function fetchBlob(url: string, limit: number, signal?: AbortSignal) {
  return readIconResponse(
    await fetch(webUrl(url), { credentials: 'omit', referrerPolicy: 'no-referrer', signal }),
    limit,
  )
}

async function remoteIcon(url: string, signal?: AbortSignal): Promise<string> {
  try {
    return await preparePhoneIcon(await fetchBlob(url, MAX_IMAGE, signal))
  } catch {
    signal?.throwIfAborted()
    // Displayable cross-origin images need not permit canvas/fetch access.
    const safe = normalizeFolderCoverUrl(url)
    return new Promise((resolve, reject) => {
      const image = new Image()
      image.referrerPolicy = 'no-referrer'
      const abort = () => {
        image.src = ''
        cleanup()
        reject(new DOMException('图标读取已取消', 'AbortError'))
      }
      const cleanup = () => {
        signal?.removeEventListener('abort', abort)
        image.onload = null
        image.onerror = null
      }
      image.onload = () => {
        const valid = image.naturalWidth
        cleanup()
        if (valid) resolve(safe)
        else reject(new Error('图片无效'))
      }
      image.onerror = () => {
        cleanup()
        reject(new Error('图片无法读取'))
      }
      signal?.addEventListener('abort', abort, { once: true })
      image.src = safe
    })
  }
}

export function htmlIconReferences(html: string, base: string) {
  const document = new DOMParser().parseFromString(html, 'text/html')
  const links = [...document.querySelectorAll('link[href]')]
  const baseHref = document.querySelector('base[href]')?.getAttribute('href')
  const root = baseHref ? iconUrls([baseHref], base)[0] || base : base
  return {
    icons: links
      .filter((link) =>
        /(?:^|\s)(?:icon|apple-touch-icon)(?:\s|$)/i.test(link.getAttribute('rel') || ''),
      )
      .sort(
        (a, b) =>
          Number(b.getAttribute('rel')?.includes('apple')) -
          Number(a.getAttribute('rel')?.includes('apple')),
      )
      .flatMap((link) => iconUrls([link.getAttribute('href')!], root)),
    manifest: links
      .find((link) => /(?:^|\s)manifest(?:\s|$)/i.test(link.getAttribute('rel') || ''))
      ?.getAttribute('href'),
    root,
  }
}
export function manifestIconReferences(text: string, base: string): string[] {
  const manifest: unknown = JSON.parse(text)
  if (
    !manifest ||
    typeof manifest !== 'object' ||
    !('icons' in manifest) ||
    !Array.isArray(manifest.icons)
  )
    return []
  return manifest.icons
    .filter(
      (icon): icon is { src: string; sizes?: string } =>
        !!icon && typeof icon === 'object' && typeof icon.src === 'string',
    )
    .sort((a, b) => (parseInt(b.sizes || '') || 0) - (parseInt(a.sizes || '') || 0))
    .slice(0, 8)
    .flatMap((icon) => iconUrls([icon.src], base))
}

export async function websitePhoneIcon(url: string, signal?: AbortSignal): Promise<PhoneIcon> {
  const page = webUrl(url)
  let pageBase = page
  let candidates: string[] = []
  let declaredManifest: string | undefined
  try {
    const response = await fetch(page, {
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      signal,
    })
    pageBase = webUrl(resolveAndroidHttpResponseUrl(page, response.url))
    const refs = htmlIconReferences(
      await (await readIconResponse(response, MAX_TEXT)).text(),
      pageBase,
    )
    candidates = refs.icons
    declaredManifest = refs.manifest ? iconUrls([refs.manifest], refs.root)[0] : undefined
  } catch {
    signal?.throwIfAborted()
    /* A site may expose its conventional icon even when its HTML cannot be read. */
  }
  // Some password gates omit link tags while leaving their PWA manifest public.
  const manifests = declaredManifest
    ? [declaredManifest]
    : iconUrls(['manifest.json', 'manifest.webmanifest'], pageBase)
  for (const manifestUrl of manifests) {
    try {
      const response = await fetch(manifestUrl, {
        signal,
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
      })
      const icons = manifestIconReferences(
        await (await readIconResponse(response, MAX_TEXT)).text(),
        resolveAndroidHttpResponseUrl(manifestUrl, response.url),
      )
      candidates.unshift(...icons)
      if (icons.length) break
    } catch {
      signal?.throwIfAborted()
      /* A blocked or absent manifest must not replace the website's declared icons. */
    }
  }
  candidates.push(
    ...iconUrls(
      [
        '/apple-touch-icon.png',
        '/favicon.ico',
        '/favicon.svg',
        '/icon-192.png',
        '/icon-512.png',
        '/icon.png',
      ],
      pageBase,
    ),
  )
  for (const candidate of [...new Set(candidates)].slice(0, 10)) {
    try {
      return {
        source: 'website',
        origin: url,
        dataUrl: await remoteIcon(candidate, signal),
      }
    } catch {
      signal?.throwIfAborted()
      /* Try the next declared icon, not arbitrary page images. */
    }
  }
  throw new Error('未读取到网址图标，站点可能不允许跨域读取；可导入图片或使用可读取的图片直链')
}
export async function directPhoneIcon(url: string): Promise<PhoneIcon> {
  return {
    source: 'url',
    origin: webUrl(url),
    dataUrl: await remoteIcon(url),
  }
}

/** Only bounded icon/manifest files are inflated; source scripts are never executed. */
export async function readPhoneSourceZip(file: File): Promise<Map<string, Blob>> {
  if (file.size > 256 * 1024 * 1024) throw new Error('源码包过大，跳过图标提取')
  const result = new Map<string, Blob>()
  let total = 0
  let count = 0
  const zip = new Unzip((entry) => {
    if (++count > 20000) throw new Error('源码文件过多，跳过图标提取')
    if (!/\.(?:html?|json|webmanifest|png|jpe?g|webp|svg|ico)$/i.test(entry.name)) return
    if (entry.name.split(/[\\/]/).includes('..')) throw new Error('源码包路径无效')
    const parts: BlobPart[] = []
    let size = 0
    entry.ondata = (error, bytes, final) => {
      if (error) throw error
      size += bytes.length
      total += bytes.length
      if (size > MAX_IMAGE || total > 16 * 1024 * 1024)
        throw new Error('源码图标候选过大，跳过提取')
      parts.push(new Uint8Array(bytes))
      if (final) result.set(entry.name, new Blob(parts, { type: mime(entry.name) || 'text/plain' }))
    }
    entry.start()
  })
  zip.register(UnzipInflate)
  for (let offset = 0; offset < file.size; offset += 32768)
    zip.push(
      new Uint8Array(await file.slice(offset, offset + 32768).arrayBuffer()),
      offset + 32768 >= file.size,
    )
  return result
}

export async function sourcePhoneIcon(
  files: Map<string, Blob>,
  origin: string,
): Promise<PhoneIcon> {
  files = new Map(
    [...files].map(([path, blob]) => [path.replaceAll('\\', '/').replace(/^\.\//, ''), blob]),
  )
  const candidates: string[] = []
  const read = (url: string, context = ''): [string, Blob] | undefined => {
    const path = new URL(url)
    if (path.origin !== new URL(localOrigin).origin) return undefined
    const relative = decodeURIComponent(path.pathname.slice(1))
    if (files.has(relative)) return [relative, files.get(relative)!]
    // An archive wrapper is not a URL prefix; public/static contents are served at the site root.
    const parts = context.split('/').slice(0, -1)
    for (let length = parts.length; length >= 0; length--) {
      const parent = parts.slice(0, length).join('/')
      for (const folder of ['public', 'static', '']) {
        const name = [parent, folder, relative].filter(Boolean).join('/')
        if (files.has(name)) return [name, files.get(name)!]
      }
    }
    return undefined
  }
  const add = (urls: string[], context: string) => {
    for (const url of urls) {
      const entry = read(url, context)
      if (entry) candidates.push(entry[0])
    }
  }
  for (const [path, blob] of files) {
    if (blob.size > MAX_TEXT) continue
    const base = new URL(path, localOrigin).href
    if (/\.(?:html?|webmanifest|json)$/i.test(path)) {
      try {
        if (/\.html?$/i.test(path)) {
          const refs = htmlIconReferences(await blob.text(), base)
          add(refs.icons, path)
          if (refs.manifest) {
            const url = new URL(refs.manifest, refs.root).href
            const manifest = read(url, path)
            if (manifest && manifest[1].size <= MAX_TEXT)
              add(
                manifestIconReferences(
                  await manifest[1].text(),
                  new URL(manifest[0], localOrigin).href,
                ),
                manifest[0],
              )
          }
        } else if (/(?:manifest[^/]*\.json|\.webmanifest)$/i.test(path))
          add(manifestIconReferences(await blob.text(), base), path)
      } catch {
        /* Non-manifest JSON and malformed HTML cannot supply an icon. */
      }
    }
  }
  candidates.push(
    ...[...files.keys()].filter((path) =>
      /(?:^|\/)(?:favicon|apple-touch-icon(?:-precomposed)?|icon|apple-icon|android-chrome)(?:[-_]?\d+(?:x\d+)?)?\.(?:png|ico|webp|svg|jpe?g)$/i.test(
        path,
      ),
    ),
  )
  for (const path of [...new Set(candidates)].slice(0, 20)) {
    const blob = files.get(path)
    if (!blob) continue
    try {
      return {
        source: 'source',
        origin,
        dataUrl: await preparePhoneIcon(new Blob([blob], { type: mime(path) || blob.type })),
      }
    } catch {
      /* Unsupported icon encodings are not offered. */
    }
  }
  throw new Error('源码中未找到可解析的图标')
}
