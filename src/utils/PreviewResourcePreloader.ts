import {
  downloadNativePreviewAsset,
  isNativePreviewAssetAvailable,
} from '../services/NativePreviewAsset'
import { resolveAndroidHttpResponseUrl } from './AndroidHttpInterceptor'

const MAX_PREVIEW_RESOURCE_BYTES = 12 * 1024 * 1024
const MAX_PREVIEW_TOTAL_BYTES = 40 * 1024 * 1024
const PREVIEW_RESOURCE_CONCURRENCY = 4
const PREVIEW_RESOURCE_TIMEOUT_MS = 20_000
const MAX_PREVIEW_SRCDOC_DEPTH = 4
const CSS_URL_PATTERN = /url\(\s*(['"]?)([^'"()]+)\1\s*\)/gi
const CSS_IMPORT_PATTERN = /@import\s+(?:url\(\s*)?(['"])([^'"]+)\1\s*\)?/gi

export interface PreviewResourceProgress {
  total: number
  completed: number
  failed: number
  activeUrl?: string
}

export interface PreviewResourcePreloadResult {
  document: string
  total: number
  loaded: number
  failedUrls: string[]
  failures: PreviewResourceFailure[]
  release: () => void
}

export interface PreviewResourceFailure {
  url: string
  reason: string
}

export interface PreviewResourcePreloadOptions {
  signal?: AbortSignal
}

interface DownloadedPreviewResource {
  blob?: Blob
  cssText?: string
  resourceUrl?: string
  size: number
  resolvedUrl: string
  isCss: boolean
}

class PreviewResourceBudget {
  private usedBytes = 0

  reserve(bytes: number): void {
    if (bytes > MAX_PREVIEW_TOTAL_BYTES - this.usedBytes) {
      throw new Error('资源超过预下载总大小限制')
    }
    this.usedBytes += bytes
  }

  release(bytes: number): void {
    this.usedBytes = Math.max(0, this.usedBytes - bytes)
  }

  get remainingBytes(): number {
    return MAX_PREVIEW_TOTAL_BYTES - this.usedBytes
  }
}

function createAbortError(): DOMException {
  return new DOMException('资源预下载已取消', 'AbortError')
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw createAbortError()
}

function isRemoteResourceUrl(value: string, baseUrl?: string): string | undefined {
  const trimmed = value.trim()
  if (!trimmed || trimmed.startsWith('#')) return undefined
  try {
    const url = new URL(trimmed, baseUrl)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : undefined
  } catch {
    return undefined
  }
}

function readCssUrls(value: string, baseUrl?: string): string[] {
  const urls = new Set<string>()
  for (const pattern of [CSS_URL_PATTERN, CSS_IMPORT_PATTERN]) {
    pattern.lastIndex = 0
    for (const match of value.matchAll(pattern)) {
      const url = isRemoteResourceUrl(match[2] ?? '', baseUrl)
      if (url) urls.add(url)
    }
  }
  return [...urls]
}

function readSrcsetUrls(value: string, baseUrl?: string): string[] {
  return value
    .split(',')
    .map((candidate) => candidate.trim().split(/\s+/, 1)[0] ?? '')
    .map((candidate) => isRemoteResourceUrl(candidate, baseUrl))
    .filter((url): url is string => Boolean(url))
}

function resolveDocumentBase(document: Document, fallback?: string): string | undefined {
  const baseHref = document.querySelector('base[href]')?.getAttribute('href')
  return isRemoteResourceUrl(baseHref ?? '', fallback) ?? fallback
}

function readDefaultDocumentBase(): string | undefined {
  return typeof document === 'undefined' ? undefined : document.baseURI
}

function isStylesheetLink(element: HTMLLinkElement): boolean {
  return element.rel.toLowerCase().split(/\s+/).includes('stylesheet')
}

function forEachPreviewResourceAttribute(
  document: Document,
  callback: (element: Element, attribute: string) => void,
): void {
  for (const element of Array.from(
    document.querySelectorAll(
      'img[src], audio[src], video[src], source[src], track[src], input[type="image"][src]',
    ),
  )) {
    callback(element, 'src')
  }
  for (const element of Array.from(document.querySelectorAll('video[poster]'))) {
    callback(element, 'poster')
  }
  for (const element of Array.from(document.querySelectorAll('link[href]'))) {
    if (element instanceof HTMLLinkElement && isStylesheetLink(element)) callback(element, 'href')
  }
}

function collectPreviewRemoteResourceUrlsInto(
  documentSource: string,
  urls: Set<string>,
  dataUrlResources: Set<string>,
  fallbackBase: string | undefined,
  depth: number,
): void {
  if (typeof DOMParser === 'undefined') return
  const document = new DOMParser().parseFromString(documentSource, 'text/html')
  const documentBase = resolveDocumentBase(document, fallbackBase)
  const add = (value: string | null) => {
    const url = isRemoteResourceUrl(value ?? '', documentBase)
    if (!url) return
    urls.add(url)
    if (depth > 0) dataUrlResources.add(url)
  }

  forEachPreviewResourceAttribute(document, (element, attribute) =>
    add(element.getAttribute(attribute)),
  )
  for (const element of Array.from(document.querySelectorAll('[srcset]'))) {
    for (const url of readSrcsetUrls(element.getAttribute('srcset') ?? '', documentBase)) add(url)
  }
  for (const element of Array.from(document.querySelectorAll('[style], style'))) {
    const css =
      element instanceof HTMLStyleElement
        ? (element.textContent ?? '')
        : (element.getAttribute('style') ?? '')
    for (const url of readCssUrls(css, documentBase)) add(url)
  }
  if (depth < MAX_PREVIEW_SRCDOC_DEPTH) {
    for (const frame of Array.from(document.querySelectorAll('iframe[srcdoc]'))) {
      collectPreviewRemoteResourceUrlsInto(
        frame.getAttribute('srcdoc') ?? '',
        urls,
        dataUrlResources,
        documentBase,
        depth + 1,
      )
    }
  }
}

export function collectPreviewRemoteResourceUrls(documentSource: string): string[] {
  const urls = new Set<string>()
  collectPreviewRemoteResourceUrlsInto(
    documentSource,
    urls,
    new Set<string>(),
    readDefaultDocumentBase(),
    0,
  )
  return [...urls]
}

function collectPreviewRemoteResources(documentSource: string): {
  urls: string[]
  dataUrlResources: Set<string>
} {
  const urls = new Set<string>()
  const dataUrlResources = new Set<string>()
  collectPreviewRemoteResourceUrlsInto(
    documentSource,
    urls,
    dataUrlResources,
    readDefaultDocumentBase(),
    0,
  )
  return { urls: [...urls], dataUrlResources }
}

function resourceFailureReason(error: unknown): string {
  return error instanceof Error && error.message ? error.message : '资源下载失败'
}

function isCssResource(url: string, contentType: string): boolean {
  return contentType.toLowerCase().includes('text/css') || /\.css(?:$|[?#])/i.test(url)
}

async function readResponseBlob(
  response: Response,
  budget: PreviewResourceBudget,
  signal?: AbortSignal,
): Promise<{ blob: Blob; size: number }> {
  if (!response.body) {
    const blob = await response.blob()
    if (blob.size > MAX_PREVIEW_RESOURCE_BYTES) throw new Error('资源超过预下载大小限制')
    budget.reserve(blob.size)
    return { blob, size: blob.size }
  }

  const reader = response.body.getReader()
  const chunks: ArrayBuffer[] = []
  let size = 0
  try {
    while (true) {
      throwIfAborted(signal)
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      size += value.byteLength
      if (size > MAX_PREVIEW_RESOURCE_BYTES) throw new Error('资源超过预下载大小限制')
      budget.reserve(value.byteLength)
      const copy = new Uint8Array(value.byteLength)
      copy.set(value)
      chunks.push(copy.buffer)
    }
    return {
      blob: new Blob(chunks, { type: response.headers.get('content-type') ?? '' }),
      size,
    }
  } catch (error) {
    budget.release(size)
    await reader.cancel().catch(() => undefined)
    throw error
  }
}

async function downloadPreviewResource(
  url: string,
  budget: PreviewResourceBudget,
  signal?: AbortSignal,
): Promise<DownloadedPreviewResource> {
  throwIfAborted(signal)
  const isDocumentOriginResource = (() => {
    if (typeof window === 'undefined') return false
    try {
      return new URL(url).origin === window.location.origin
    } catch {
      return false
    }
  })()
  // Capacitor 会把应用域名映射到 APK 内的 public 资源。同源素材必须经 WebView
  // 读取；若交给 OkHttp，会绕过这层映射并错误地请求线上站点。
  if (isNativePreviewAssetAvailable() && !isDocumentOriginResource) {
    const downloaded = await downloadNativePreviewAsset(url, MAX_PREVIEW_RESOURCE_BYTES)
    throwIfAborted(signal)
    if (downloaded.size > budget.remainingBytes) throw new Error('资源超过预下载总大小限制')
    budget.reserve(downloaded.size)
    return {
      size: downloaded.size,
      resolvedUrl: downloaded.resolvedUrl,
      isCss: isCssResource(downloaded.resolvedUrl, downloaded.contentType),
      cssText: downloaded.text,
      resourceUrl: downloaded.resourceUrl,
    }
  }
  const controller = new AbortController()
  let timedOut = false
  const abortFromParent = () => controller.abort()
  signal?.addEventListener('abort', abortFromParent, { once: true })
  const timeoutId = window.setTimeout(() => {
    timedOut = true
    controller.abort()
  }, PREVIEW_RESOURCE_TIMEOUT_MS)
  try {
    const response = await fetch(url, {
      credentials: 'omit',
      referrer: typeof document === 'undefined' ? undefined : document.baseURI,
      referrerPolicy: 'strict-origin-when-cross-origin',
      signal: controller.signal,
    })
    if (!response.ok) throw new Error(`资源请求失败（${response.status}）`)
    const declaredSize = Number(response.headers.get('content-length') ?? 0)
    if (declaredSize > MAX_PREVIEW_RESOURCE_BYTES || declaredSize > budget.remainingBytes) {
      throw new Error('资源超过预下载大小限制')
    }
    const downloaded = await readResponseBlob(response, budget, signal)
    return {
      ...downloaded,
      resolvedUrl: resolveAndroidHttpResponseUrl(url, response.url),
      isCss: isCssResource(url, response.headers.get('content-type') ?? ''),
    }
  } catch (error) {
    if (signal?.aborted) throw createAbortError()
    if (timedOut) throw new Error('资源下载超时', { cause: error })
    throw error
  } finally {
    window.clearTimeout(timeoutId)
    signal?.removeEventListener('abort', abortFromParent)
  }
}

function rewriteCssUrls(
  value: string,
  resources: ReadonlyMap<string, string>,
  baseUrl?: string,
): string {
  const replace = (match: string, _quote: string, rawUrl: string) => {
    const resolvedUrl = isRemoteResourceUrl(rawUrl, baseUrl)
    if (!resolvedUrl) return match
    return `url("${resources.get(resolvedUrl) ?? resolvedUrl}")`
  }
  return value
    .replace(CSS_URL_PATTERN, replace)
    .replace(CSS_IMPORT_PATTERN, (match, _quote, rawUrl: string) => {
      const resolvedUrl = isRemoteResourceUrl(rawUrl, baseUrl)
      return resolvedUrl ? `@import url("${resources.get(resolvedUrl) ?? resolvedUrl}")` : match
    })
}

function rewritePreviewDocumentResources(
  documentSource: string,
  resources: ReadonlyMap<string, string>,
  fallbackBase = readDefaultDocumentBase(),
  depth = 0,
): string {
  if (typeof DOMParser === 'undefined') return documentSource
  const document = new DOMParser().parseFromString(documentSource, 'text/html')
  const documentBase = resolveDocumentBase(document, fallbackBase)
  const rewriteAttribute = (element: Element, attribute: string) => {
    const rawUrl = element.getAttribute(attribute)
    const resolvedUrl = rawUrl ? isRemoteResourceUrl(rawUrl, documentBase) : undefined
    if (resolvedUrl) element.setAttribute(attribute, resources.get(resolvedUrl) ?? resolvedUrl)
  }

  forEachPreviewResourceAttribute(document, rewriteAttribute)
  for (const element of Array.from(document.querySelectorAll('[srcset]'))) {
    const value = element.getAttribute('srcset') ?? ''
    element.setAttribute(
      'srcset',
      value.replace(
        /([^,\s]+)(\s+\d+(?:\.\d+)?[wx])?/g,
        (_match, rawUrl: string, descriptor = '') => {
          const resolvedUrl = isRemoteResourceUrl(rawUrl, documentBase)
          return `${(resolvedUrl && (resources.get(resolvedUrl) ?? resolvedUrl)) || rawUrl}${descriptor}`
        },
      ),
    )
  }
  for (const element of Array.from(document.querySelectorAll('[style], style'))) {
    if (element instanceof HTMLStyleElement)
      element.textContent = rewriteCssUrls(element.textContent ?? '', resources, documentBase)
    else
      element.setAttribute(
        'style',
        rewriteCssUrls(element.getAttribute('style') ?? '', resources, documentBase),
      )
  }
  if (depth < MAX_PREVIEW_SRCDOC_DEPTH) {
    for (const frame of Array.from(document.querySelectorAll('iframe[srcdoc]'))) {
      frame.setAttribute(
        'srcdoc',
        rewritePreviewDocumentResources(
          frame.getAttribute('srcdoc') ?? '',
          resources,
          documentBase,
          depth + 1,
        ),
      )
    }
  }
  return `<!doctype html>${document.documentElement.outerHTML}`
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  const chunkSize = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
  }
  return `data:${blob.type || 'application/octet-stream'};base64,${btoa(binary)}`
}

/**
 * 在主页面受控下载可公开访问的展示素材，成功后以内存 data URL 交给隔离预览。
 * 失败项不会静默吞掉：调用方可据 failedUrls 明确提示跨域、404、超时或大小限制。
 */
export async function preloadPreviewDocumentResources(
  documentSource: string,
  onProgress?: (progress: PreviewResourceProgress) => void,
  options: PreviewResourcePreloadOptions = {},
): Promise<PreviewResourcePreloadResult> {
  const collected = collectPreviewRemoteResources(documentSource)
  const urls = collected.urls
  const dataUrlResources = collected.dataUrlResources
  const queuedUrls = new Set(urls)
  const downloadedResources = new Map<string, DownloadedPreviewResource>()
  const failures = new Map<string, string>()
  const budget = new PreviewResourceBudget()
  let completed = 0
  let nextIndex = 0
  const report = (activeUrl?: string) =>
    onProgress?.({ total: urls.length, completed, failed: failures.size, activeUrl })
  const enqueue = (url: string, requiresDataUrl = false) => {
    if (requiresDataUrl) dataUrlResources.add(url)
    if (queuedUrls.has(url)) return
    queuedUrls.add(url)
    urls.push(url)
  }

  report()
  const worker = async () => {
    while (nextIndex < urls.length) {
      throwIfAborted(options.signal)
      const index = nextIndex++
      const url = urls[index]
      if (!url) continue
      let downloaded: DownloadedPreviewResource | undefined
      try {
        downloaded = await downloadPreviewResource(url, budget, options.signal)
        downloadedResources.set(url, downloaded)
        if (downloaded.isCss) {
          for (const nestedUrl of readCssUrls(
            downloaded.cssText ?? (await downloaded.blob?.text()) ?? '',
            downloaded.resolvedUrl,
          )) {
            enqueue(nestedUrl, dataUrlResources.has(url))
          }
        }
      } catch (error) {
        if (options.signal?.aborted) throw error
        if (downloaded) budget.release(downloaded.size)
        downloadedResources.delete(url)
        failures.set(url, resourceFailureReason(error))
      } finally {
        completed += 1
        report(url)
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(PREVIEW_RESOURCE_CONCURRENCY, urls.length) }, worker),
  )

  const resourceUrls = new Map<string, string>()
  const objectUrls = new Set<string>()
  const buildResourceUrl = async (
    url: string,
    visiting = new Set<string>(),
  ): Promise<string | undefined> => {
    const cached = resourceUrls.get(url)
    if (cached) return cached
    const downloaded = downloadedResources.get(url)
    if (!downloaded || visiting.has(url)) return undefined
    if (!downloaded.isCss && downloaded.resourceUrl && !dataUrlResources.has(url)) {
      resourceUrls.set(url, downloaded.resourceUrl)
      return downloaded.resourceUrl
    }
    const nextVisiting = new Set(visiting).add(url)
    let blob = downloaded.blob
    if (!blob && downloaded.resourceUrl) {
      const response = await fetch(downloaded.resourceUrl, { signal: options.signal })
      if (!response.ok) throw new Error(`本地资源读取失败（${response.status}）`)
      blob = await response.blob()
    }
    if (downloaded.isCss) {
      const css = downloaded.cssText ?? (await blob?.text()) ?? ''
      for (const nestedUrl of readCssUrls(css, downloaded.resolvedUrl)) {
        await buildResourceUrl(nestedUrl, nextVisiting)
      }
      blob = new Blob([rewriteCssUrls(css, resourceUrls, downloaded.resolvedUrl)], {
        type: blob?.type || 'text/css',
      })
    }
    if (!blob) return undefined
    if (dataUrlResources.has(url)) {
      const dataUrl = await blobToDataUrl(blob)
      resourceUrls.set(url, dataUrl)
      return dataUrl
    }
    const objectUrl = URL.createObjectURL(blob)
    objectUrls.add(objectUrl)
    resourceUrls.set(url, objectUrl)
    return objectUrl
  }
  for (const url of urls) {
    try {
      await buildResourceUrl(url)
    } catch (error) {
      const downloaded = downloadedResources.get(url)
      if (downloaded) budget.release(downloaded.size)
      downloadedResources.delete(url)
      failures.set(url, resourceFailureReason(error))
    }
  }
  const failedInDocumentOrder = urls.filter((url) => failures.has(url))
  return {
    document: rewritePreviewDocumentResources(documentSource, resourceUrls),
    total: urls.length,
    loaded: resourceUrls.size,
    failedUrls: failedInDocumentOrder,
    failures: failedInDocumentOrder.map((url) => ({
      url,
      reason: failures.get(url) ?? '资源下载失败',
    })),
    release: () => {
      for (const objectUrl of objectUrls) URL.revokeObjectURL(objectUrl)
      objectUrls.clear()
    },
  }
}
