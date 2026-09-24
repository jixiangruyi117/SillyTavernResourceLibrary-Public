import buildInfo from '../build-info.json' with { type: 'json' }
import { CLOUD_PROXY_ERRORS, resolveCloudTarget } from '../server-shared/CloudProxyProtocol.mjs'
import { json } from './WorkerHttp.js'

const CLOUD_PROXY_HEADERS = [
  'accept',
  'authorization',
  'content-type',
  'depth',
  'destination',
  'if-match',
  'if-none-match',
  'overwrite',
  'range',
  'x-github-api-version',
]

const CLOUD_PROXY_RESPONSE_HEADERS = [
  'accept-ranges',
  'content-disposition',
  'content-length',
  'content-range',
  'content-type',
  'etag',
  'last-modified',
  'location',
  'retry-after',
  'x-accepted-github-permissions',
  'x-github-request-id',
  'x-ratelimit-limit',
  'x-ratelimit-remaining',
  'x-ratelimit-reset',
  'x-ratelimit-resource',
  'x-ratelimit-used',
]

const CLOUD_PROXY_MAX_BODY_BYTES = 64 * 1024 * 1024

export function buildCloudProxyRequestHeaders(source, provider) {
  const headers = new Headers()
  for (const name of CLOUD_PROXY_HEADERS) {
    const value = source.get(name)
    if (value) headers.set(name, value)
  }
  // GitHub REST 明确拒绝没有有效 User-Agent 的请求。浏览器直连会自动携带，
  // 但 Worker 重建请求头后必须显式补回，不能依赖运行时默认值。
  if (provider === 'github') {
    headers.set('user-agent', `SillyTavern-Resource-Library/${buildInfo.webVersion}`)
  }
  return headers
}

export function buildCloudProxyResponseHeaders(source) {
  const headers = new Headers()
  for (const name of CLOUD_PROXY_RESPONSE_HEADERS) {
    const value = source.get(name)
    if (value) headers.set(name, value)
  }
  headers.set('x-srl-cloud-proxy', '1')
  return headers
}

export function markCloudProxyResponse(response) {
  const headers = new Headers(response.headers)
  headers.set('x-srl-cloud-proxy', '1')
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

export async function handleCloudProxy(request, env, pathname) {
  if (pathname === '/api/cloud/health' && request.method === 'GET')
    return json({ ok: true, service: 'srl-cloud-proxy-cloudflare' })

  const match = pathname.match(/^\/api\/cloud\/proxy\/(github|koofr)$/)
  if (!match) return json({ code: 'NOT_FOUND', message: '云端代理接口不存在' }, 404)
  const target = resolveCloudTarget(match[1], new URL(request.url).searchParams.get('url'))
  if (!target) return json(CLOUD_PROXY_ERRORS.invalidTarget, 400)

  const headers = buildCloudProxyRequestHeaders(request.headers, match[1])
  const hasBody = !['GET', 'HEAD'].includes(request.method)
  const declaredLength = Number(
    request.headers.get('x-srl-content-length') ?? request.headers.get('content-length') ?? 0,
  )
  if (
    hasBody &&
    (!Number.isSafeInteger(declaredLength) ||
      declaredLength < 0 ||
      declaredLength > CLOUD_PROXY_MAX_BODY_BYTES)
  ) {
    return json(
      {
        code: 'CLOUD_REQUEST_TOO_LARGE',
        message: '单次云端请求不能超过 64 MiB，请使用自动分卷上传',
      },
      declaredLength > CLOUD_PROXY_MAX_BODY_BYTES ? 413 : 400,
    )
  }
  let body
  if (hasBody) {
    body = await request.arrayBuffer()
    if (declaredLength && body.byteLength !== declaredLength) {
      return json(
        {
          code: 'CLOUD_CONTENT_LENGTH_MISMATCH',
          message: '云端上传内容长度不一致，请重试当前分卷',
        },
        400,
      )
    }
  }
  let upstream
  try {
    upstream = await fetch(target, {
      method: request.method,
      headers,
      // ArrayBuffer lets the runtime send a fixed Content-Length. GitHub's
      // release-asset endpoint rejects chunked uploads with “Bad Content-Length”.
      body,
      // GitHub 下载附件时会跳转到带签名的 release-assets 地址。必须在 Worker
      // 内跟随，否则浏览器会离开同源中转并再次触发 CORS。
      redirect: 'follow',
      signal: request.signal,
    })
  } catch {
    return json(
      {
        code: 'CLOUD_UPSTREAM_UNREACHABLE',
        message: `${match[1] === 'github' ? 'GitHub' : 'Koofr'} 上游暂时无法连接，请稍后重试`,
      },
      502,
    )
  }
  const responseHeaders = buildCloudProxyResponseHeaders(upstream.headers)
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  })
}
