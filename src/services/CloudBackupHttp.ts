import type { CloudBackupProvider } from '../types/CloudBackup'

export const CLOUD_METADATA_TIMEOUT_MS = 45 * 1000

export const CLOUD_TRANSFER_MIN_TIMEOUT_MS = 2 * 60 * 1000

export const CLOUD_TRANSFER_MAX_TIMEOUT_MS = 10 * 60 * 1000

export const CLOUD_TRANSFER_MIN_BYTES_PER_SECOND = 64 * 1024

export interface GitHubErrorDetail {
  message?: string
  errors?: Array<{ code?: string; field?: string; message?: string }>
}

export class CloudRequestTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(
      `云端请求连续 ${Math.round(timeoutMs / 1000)} 秒没有收到响应或新数据，已停止等待；请检查网络后重试`,
    )
    this.name = 'CloudRequestTimeoutError'
  }
}

export function cloudRequestTimeout(init: RequestInit): number {
  if (!(init.body instanceof Blob)) return CLOUD_METADATA_TIMEOUT_MS
  if (/json|gzip/iu.test(init.body.type) || init.body.size <= 2 * 1024 * 1024) {
    return CLOUD_METADATA_TIMEOUT_MS
  }
  return Math.min(
    CLOUD_TRANSFER_MAX_TIMEOUT_MS,
    Math.max(
      CLOUD_TRANSFER_MIN_TIMEOUT_MS,
      Math.ceil(init.body.size / CLOUD_TRANSFER_MIN_BYTES_PER_SECOND) * 1000,
    ),
  )
}

const responseAbort = new WeakMap<Response, (reason: unknown) => void>()

export async function fetchWithDeadline(url: string, init: RequestInit): Promise<Response> {
  const sourceSignal = init.signal
  if (sourceSignal?.aborted) {
    throw sourceSignal.reason ?? new DOMException('云端请求已取消', 'AbortError')
  }
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  let bodyController: ReadableStreamDefaultController<Uint8Array> | undefined
  let ended = false
  let failure: unknown
  let rejectStopped: (reason: unknown) => void = () => undefined
  const stopped = new Promise<never>((_resolve, reject) => (rejectStopped = reject))
  void stopped.catch(() => undefined)
  const cleanup = (): void => {
    ended = true
    if (timer !== undefined) globalThis.clearTimeout(timer)
    sourceSignal?.removeEventListener('abort', abortFromSource)
  }
  const stop = (reason: unknown): void => {
    if (ended) return
    failure = reason
    cleanup()
    rejectStopped(reason)
    controller.abort(reason)
    bodyController?.error(reason)
    // 不等待可能挂起的底层 cancel；已等待中的 read 会立即结束。
    if (reader) void reader.cancel(reason).catch(() => undefined)
  }
  const abortFromSource = (): void =>
    stop(sourceSignal?.reason ?? new DOMException('云端请求已取消', 'AbortError'))
  const armDeadline = (timeoutMs: number): void => {
    if (timer !== undefined) globalThis.clearTimeout(timer)
    timer = globalThis.setTimeout(() => stop(new CloudRequestTimeoutError(timeoutMs)), timeoutMs)
  }
  sourceSignal?.addEventListener('abort', abortFromSource, { once: true })
  armDeadline(cloudRequestTimeout(init))
  try {
    const pending = fetch(url, { ...init, signal: controller.signal })
    void pending.then(
      (response) => {
        if (failure !== undefined) void response.body?.cancel(failure).catch(() => undefined)
      },
      () => undefined,
    )
    const response = await Promise.race([pending, stopped])
    if (!response.body || response.status === 0 || init.method?.toUpperCase() === 'HEAD') {
      cleanup()
      return response
    }
    const binary = /octet-stream|zip/i.test(
      `${new Headers(init.headers).get('Accept') ?? ''} ${response.headers.get('Content-Type') ?? ''}`,
    )
    const bodyTimeoutMs =
      binary || Number(response.headers.get('Content-Length')) > 2 * 1024 * 1024
        ? CLOUD_TRANSFER_MIN_TIMEOUT_MS
        : CLOUD_METADATA_TIMEOUT_MS
    armDeadline(bodyTimeoutMs)
    reader = response.body.getReader()
    const bodyReader = reader
    const stream = new ReadableStream<Uint8Array>(
      {
        start(streamController) {
          bodyController = streamController
        },
        async pull(streamController) {
          try {
            const chunk = await bodyReader.read()
            if (ended) return
            if (chunk.done) {
              cleanup()
              bodyReader.releaseLock()
              streamController.close()
              return
            }
            // 持续收到数据的大下载不因总时长超过固定阈值而被误杀。
            if (chunk.value.byteLength) armDeadline(bodyTimeoutMs)
            streamController.enqueue(chunk.value)
          } catch (error) {
            stop(error)
          }
        },
        cancel(reason) {
          cleanup()
          controller.abort(reason)
          void bodyReader.cancel(reason).catch(() => undefined)
        },
      },
      { highWaterMark: 0 },
    )
    const attachMetadata = (result: Response): Response => {
      // Response(stream) 默认丢失这些只读元数据，保留它们及 clone 的标准行为。
      Object.defineProperties(result, {
        url: { value: response.url },
        redirected: { value: response.redirected },
        type: { value: response.type },
        clone: { value: () => attachMetadata(Response.prototype.clone.call(result)) },
      })
      responseAbort.set(result, stop)
      return result
    }
    return attachMetadata(
      new Response(stream, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      }),
    )
  } catch (error) {
    stop(error)
    cleanup()
    throw failure ?? error
  }
}

export async function readCloudResponseText(response: Response): Promise<string> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<string>((_resolve, reject) => {
    timer = globalThis.setTimeout(() => {
      const error = new CloudRequestTimeoutError(CLOUD_METADATA_TIMEOUT_MS)
      reject(error)
      responseAbort.get(response)?.(error)
    }, CLOUD_METADATA_TIMEOUT_MS)
  })
  try {
    return await Promise.race([response.text(), timeout])
  } finally {
    if (timer !== undefined) globalThis.clearTimeout(timer)
  }
}

export function isCloudRequestTimeout(error: unknown): error is CloudRequestTimeoutError {
  return error instanceof CloudRequestTimeoutError
}

export async function mapWithConcurrency<T>(
  values: T[],
  concurrency: number,
  task: (value: T) => Promise<void>,
): Promise<void> {
  let nextIndex = 0
  let failed = false
  let firstError: unknown
  const worker = async (): Promise<void> => {
    while (!failed && nextIndex < values.length) {
      const index = nextIndex
      nextIndex += 1
      try {
        await task(values[index]!)
      } catch (error) {
        if (!failed) {
          failed = true
          firstError = error
        }
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(Math.max(1, concurrency), values.length) }, () => worker()),
  )
  if (failed) throw firstError
}

export function readJson<T>(storage: Storage, key: string, fallback: T): T {
  try {
    return JSON.parse(storage.getItem(key) ?? '') as T
  } catch {
    return fallback
  }
}

export function githubError(
  status: number,
  detail: GitHubErrorDetail,
  path = '',
  method = '',
  headers?: Headers,
): Error {
  const reasons = (detail.errors ?? [])
    .map((item) => item.message || [item.field, item.code].filter(Boolean).join(': '))
    .filter(Boolean)
  const reason = reasons.length ? `（${reasons.join('；')}）` : ''
  const action =
    method && path ? `${method} ${path.replace(/repos\/[^/]+\/[^/]+/, 'repos/:owner/:repo')}` : ''
  const remaining = headers?.get('x-ratelimit-remaining')
  const resetAt = Number(headers?.get('x-ratelimit-reset') ?? 0)
  const retryAfter = Number(headers?.get('retry-after') ?? 0)
  const acceptedPermissions = headers?.get('x-accepted-github-permissions')
  const requestId = headers?.get('x-github-request-id')
  let hint = ''
  if (/user.?agent/i.test(detail.message ?? '')) {
    hint = '\nGitHub 没有收到有效的 User-Agent；请更新网页端/CF Worker 后重试。'
  } else if (remaining === '0' && resetAt > 0) {
    hint = `\nGitHub API 额度已用完，可在 ${new Date(resetAt * 1000).toLocaleString('zh-CN')} 后重试。`
  } else if (retryAfter > 0) {
    hint = `\nGitHub 触发了二级限流，请等待约 ${retryAfter} 秒后再试，不要连续点击上传。`
  } else if (status === 403) {
    hint =
      '\n403 常见原因：① 令牌权限不足（Contents 需 Read and write）② 令牌未授权该仓库 ③ 令牌过期 ④ 组织仓库需审批 SSO'
  }
  if (acceptedPermissions) hint += `\nGitHub 声明本接口需要权限：${acceptedPermissions}`
  if (requestId) hint += `\nGitHub 请求编号：${requestId}`
  return Object.assign(
    new Error(
      `${action ? `${action} → ` : ''}${status}${detail.message ? `：${detail.message}` : ''}${reason}${hint}`,
    ),
    { status },
  )
}

export function proxyPayloadTooLargeError(
  body: BodyInit | null | undefined,
  cause?: unknown,
): Error {
  const size = body instanceof Blob ? `本次上传 ${(body.size / 1024 / 1024).toFixed(1)} MiB，` : ''
  return new Error(
    `${size}同源中转拒绝了这次请求（413）。云备份单卷上限为 64 MiB，若服务器 Nginx 的 client_max_body_size 小于该值就会在转发前拒绝；请将其调整为 128m 后重新加载 Nginx。`,
    cause === undefined ? undefined : { cause },
  )
}

export function cloudProxyUnavailableError(cause: unknown): Error {
  return new Error(
    '本站 Koofr 云端中转没有收到响应。请先刷新页面重试；若仍失败，说明当前 Cloudflare/VPS 的 /api/cloud/proxy/koofr 路由或上游连接异常，不是邮箱或应用密码填写错误。',
    { cause },
  )
}

export function friendlyNetworkError(error: unknown, provider: CloudBackupProvider): Error {
  // 413 等已带可执行结论的错误不再套用通用网络文案
  if (error instanceof Error && /（413）/.test(error.message)) return error
  if (error instanceof Error && /Failed to fetch|NetworkError|Load failed/i.test(error.message)) {
    return new Error(
      provider === 'webdav'
        ? 'Koofr 拒绝了普通网页的跨域 WebDAV 请求（CORS）。这通常不是邮箱或应用密码错误：纯浏览器/Netlify 静态版无法直接绕过，需使用 APK 原生网络层或可信的同源后端。'
        : 'GitHub 直连请求没有收到响应。请检查浏览器到 api.github.com / uploads.github.com 的网络、代理、VPN、广告拦截与 DNS；令牌或仓库配置错误通常会返回明确的 401/403/404。',
    )
  }
  return error instanceof Error ? error : new Error('云端操作失败')
}

export function cloudHttpError(message: string, status: number): Error {
  return Object.assign(new Error(message), { status })
}
