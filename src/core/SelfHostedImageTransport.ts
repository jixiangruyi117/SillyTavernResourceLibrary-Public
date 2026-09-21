import { Capacitor, CapacitorHttp, registerPlugin } from '@capacitor/core'

import { transferNativeStream } from './NativeStreamTransfer'

interface NativeUploadResult {
  status: number
  headers?: Record<string, string>
  body?: string
}

interface NativeSelfHostedUploadPlugin {
  beginSelfHostedImageUpload(options: {
    url: string
    fileName: string
    mimeType: string
    size: number
    authorization?: string
  }): Promise<{ token: string }>
  appendImageUpload(options: { token: string; data: string }): Promise<void>
  commitImageUpload(options: { token: string }): Promise<NativeUploadResult>
  abortImageUpload(options: { token: string }): Promise<void>
}

export interface SelfHostedImageUploadOptions {
  blob: Blob
  fileName: string
  authorization?: string
  signal?: AbortSignal
}

export interface SelfHostedImageDeleteOptions {
  authorization: string
  signal?: AbortSignal
}

const nativeUpload = registerPlugin<NativeSelfHostedUploadPlugin>('NativeHostedUpload')

function isNativeApp(): boolean {
  return Capacitor.isNativePlatform()
}

function browserSafeHeaders(headers: Record<string, string> | undefined): Headers {
  const safe = new Headers()
  for (const [name, value] of Object.entries(headers ?? {})) {
    if (/^set-cookie2?$/iu.test(name)) continue
    safe.append(name, value)
  }
  return safe
}

function responseBody(data: unknown, status: number, headers: Headers): BodyInit | null {
  if ([204, 205, 304].includes(status) || data == null) return null
  if (typeof data === 'string') return data
  if (!headers.has('content-type')) headers.set('content-type', 'application/json')
  return JSON.stringify(data)
}

async function streamNativeUpload(
  blob: Blob,
  signal: AbortSignal | undefined,
  begin: () => Promise<{ token: string }>,
): Promise<Response> {
  let token = ''
  try {
    token = (await begin()).token
    const transferred = await transferNativeStream(blob, {
      signal,
      totalBytes: blob.size,
      append: (data) => nativeUpload.appendImageUpload({ token, data }),
    })
    if (transferred !== blob.size) throw new Error('图床图片原生暂存大小不一致')
    const result = await nativeUpload.commitImageUpload({ token })
    token = ''
    const headers = browserSafeHeaders(result.headers)
    return new Response(result.body ?? '', { status: result.status, headers })
  } catch (error) {
    if (token) await nativeUpload.abortImageUpload({ token }).catch(() => undefined)
    throw error
  }
}

function validateUploadUrl(url: URL): void {
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) {
    throw new TypeError('自建图床只允许无 URL 凭据的 HTTPS 地址')
  }
}

function validateDeleteUrl(url: URL): void {
  validateUploadUrl(url)
  if (!url.pathname.startsWith('/api/manage/delete/')) {
    throw new TypeError('自建图床删除只允许标准图片删除接口')
  }
}

export async function selfHostedImageUpload(
  request: typeof fetch,
  url: URL,
  options: SelfHostedImageUploadOptions,
): Promise<Response> {
  validateUploadUrl(url)
  if (!isNativeApp()) {
    const formData = new FormData()
    formData.set('file', options.blob, options.fileName)
    return request(url, {
      method: 'POST',
      headers: options.authorization ? { Authorization: options.authorization } : undefined,
      body: formData,
      signal: options.signal,
    })
  }
  return streamNativeUpload(options.blob, options.signal, () =>
    nativeUpload.beginSelfHostedImageUpload({
      url: url.toString(),
      fileName: options.fileName,
      mimeType: options.blob.type || 'application/octet-stream',
      size: options.blob.size,
      ...(options.authorization ? { authorization: options.authorization } : {}),
    }),
  )
}

export async function selfHostedImageDelete(
  request: typeof fetch,
  url: URL,
  options: SelfHostedImageDeleteOptions,
): Promise<Response> {
  validateDeleteUrl(url)
  if (!isNativeApp()) {
    return request(url, {
      method: 'DELETE',
      headers: { Authorization: options.authorization },
      signal: options.signal,
    })
  }
  const result = await CapacitorHttp.request({
    url: url.toString(),
    method: 'DELETE',
    headers: { Authorization: options.authorization, Accept: 'application/json' },
    connectTimeout: 20_000,
    readTimeout: 45_000,
    responseType: 'text',
  })
  const headers = browserSafeHeaders(result.headers)
  return new Response(responseBody(result.data, result.status, headers), {
    status: result.status,
    headers,
  })
}
