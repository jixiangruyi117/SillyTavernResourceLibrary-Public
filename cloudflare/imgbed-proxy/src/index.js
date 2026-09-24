/* global Headers, Response, URL, URLSearchParams, fetch */

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024
const METHODS = new Set(['GET', 'HEAD', 'POST', 'DELETE', 'OPTIONS'])
const REQUEST_HEADERS = ['accept', 'authorization', 'content-type', 'if-none-match', 'range']
const RESPONSE_HEADERS = [
  'cache-control',
  'content-disposition',
  'content-length',
  'content-type',
  'etag',
  'last-modified',
]
const UPLOAD_QUERY = new Set([
  'authCode',
  'autoRetry',
  'returnFormat',
  'uploadChannel',
  'uploadFolder',
  'uploadNameType',
])

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...headers,
    },
  })
}

function configuredOrigins(value) {
  return new Set(
    String(value ?? '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
  )
}

function corsHeaders(origin) {
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET, HEAD, POST, DELETE, OPTIONS',
    'access-control-allow-headers': 'Authorization, Content-Type, Accept, Range, If-None-Match',
    'access-control-max-age': '86400',
    vary: 'Origin',
  }
}

function allowedRoute(pathname, method) {
  if (pathname === '/upload' && method === 'POST') return 'upload'
  if (pathname.startsWith('/file/') && ['GET', 'HEAD'].includes(method)) return 'file'
  if (pathname.startsWith('/api/manage/delete/') && method === 'DELETE') return 'delete'
  return null
}

function targetUrl(pathname, search, route, origin) {
  const target = new URL(origin)
  if (
    target.protocol !== 'https:' ||
    target.username ||
    target.password ||
    target.pathname !== '/' ||
    target.search ||
    target.hash
  )
    return null
  if (pathname.includes('\\') || pathname.includes('\0')) return null
  target.pathname = pathname
  target.search = ''
  if (route === 'upload') {
    const incoming = new URLSearchParams(search)
    for (const key of UPLOAD_QUERY) {
      for (const value of incoming.getAll(key)) target.searchParams.append(key, value)
    }
  }
  return target
}

function rewriteFileReference(value, upstreamOrigin, workerOrigin) {
  if (typeof value !== 'string') return value
  try {
    const url = new URL(value)
    if (url.origin !== upstreamOrigin || !url.pathname.startsWith('/file/')) return value
    return new URL(`${url.pathname}${url.search}`, workerOrigin).toString()
  } catch {
    return value
  }
}

async function rewriteUploadResponse(response, upstreamOrigin, workerOrigin, headers) {
  if (!response.ok || !response.headers.get('content-type')?.includes('application/json'))
    return null
  let payload
  try {
    payload = await response.json()
  } catch {
    return null
  }
  const entries = Array.isArray(payload) ? payload : [payload]
  for (const entry of entries) {
    if (entry && typeof entry === 'object' && !Array.isArray(entry) && 'src' in entry) {
      entry.src = rewriteFileReference(entry.src, upstreamOrigin, workerOrigin)
    }
  }
  return json(payload, response.status, headers)
}

export async function handleRequest(request, env, fetchImpl = fetch) {
  const requestUrl = new URL(request.url)
  const origin = request.headers.get('origin') ?? ''
  const origins = configuredOrigins(env.ALLOWED_ORIGINS)
  if (!origin || !origins.has(origin)) return json({ error: 'Origin is not allowed' }, 403)
  const cors = corsHeaders(origin)

  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
  if (!METHODS.has(request.method)) return json({ error: 'Method is not allowed' }, 405, cors)

  const route = allowedRoute(requestUrl.pathname, request.method)
  if (!route) return json({ error: 'Route is not available' }, 404, cors)

  const originConfig = String(env.IMGBED_ORIGIN ?? '').trim()
  let upstream
  try {
    upstream = targetUrl(requestUrl.pathname, requestUrl.search, route, originConfig)
  } catch {
    upstream = null
  }
  if (!upstream) return json({ error: 'Configure an HTTPS ImgBed origin' }, 503, cors)
  const upstreamOrigin = upstream.origin

  if (
    route !== 'file' &&
    !request.headers.has('authorization') &&
    !upstream.searchParams.has('authCode')
  ) {
    return json({ error: 'ImgBed authorization is required for writes' }, 401, cors)
  }

  const headers = new Headers()
  for (const name of REQUEST_HEADERS) {
    const value = request.headers.get(name)
    if (value) headers.set(name, value)
  }

  let body
  if (route === 'upload') {
    const declaredSize = Number(request.headers.get('content-length') ?? 0)
    if (declaredSize > MAX_UPLOAD_BYTES) return json({ error: 'Upload exceeds 10 MiB' }, 413, cors)
    body = await request.arrayBuffer()
    if (body.byteLength > MAX_UPLOAD_BYTES)
      return json({ error: 'Upload exceeds 10 MiB' }, 413, cors)
  }

  let response
  try {
    response = await fetchImpl(upstream, {
      method: request.method,
      headers,
      ...(body ? { body } : {}),
      redirect: 'manual',
      signal: request.signal,
    })
  } catch {
    return json({ error: 'ImgBed upstream is unavailable' }, 502, cors)
  }

  const responseHeaders = new Headers(cors)
  for (const name of RESPONSE_HEADERS) {
    const value = response.headers.get(name)
    if (value) responseHeaders.set(name, value)
  }
  if (route === 'upload') {
    const rewritten = await rewriteUploadResponse(
      response.clone(),
      upstreamOrigin,
      requestUrl.origin,
      cors,
    )
    if (rewritten) return rewritten
  }
  const responseBody =
    request.method === 'HEAD' || [204, 304].includes(response.status) ? null : response.body
  return new Response(responseBody, {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders,
  })
}

export default {
  fetch(request, env) {
    return handleRequest(request, env)
  },
}
