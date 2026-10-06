// SRL-PUBLIC-SYNC: BEGIN PUBLIC-ONLY id=worker-url-settings
const PUBLIC_WORKER_BASE_URL_KEY = 'srl.publicWorker.baseUrl.v1'

export function normalizePublicWorkerBaseUrl(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ''

  const candidate = /^[a-z][a-z\d+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
  let url: URL
  try {
    url = new URL(candidate)
  } catch {
    throw new Error('请输入有效的 Worker 域名，例如 your-worker.workers.dev')
  }
  const isLocalHttp =
    url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if (url.protocol !== 'https:' && !isLocalHttp) throw new Error('Worker 地址必须使用 HTTPS')
  if (url.username || url.password || url.search || url.hash)
    throw new Error('Worker 地址不能包含账号、密码、查询参数或片段')
  if (url.pathname !== '/' && url.pathname !== '')
    throw new Error('Worker 地址请填写域名根地址，不要包含路径')
  return url.origin
}

export function loadPublicWorkerBaseUrl(): string {
  try {
    return normalizePublicWorkerBaseUrl(localStorage.getItem(PUBLIC_WORKER_BASE_URL_KEY) ?? '')
  } catch {
    return ''
  }
}

export function savePublicWorkerBaseUrl(value: string): string {
  const normalized = normalizePublicWorkerBaseUrl(value)
  if (normalized) localStorage.setItem(PUBLIC_WORKER_BASE_URL_KEY, normalized)
  else localStorage.removeItem(PUBLIC_WORKER_BASE_URL_KEY)
  return normalized
}

export function publicWorkerEndpoint(path: string): URL {
  const baseUrl = loadPublicWorkerBaseUrl()
  if (!baseUrl) throw new Error('请先在“设置 → 自部署 Worker”中填写 Worker 地址')
  if (!path.startsWith('/')) throw new Error('Worker 接口路径无效')
  const endpoint = new URL(path, baseUrl)
  if (endpoint.origin !== new URL(baseUrl).origin) throw new Error('Worker 接口路径无效')
  return endpoint
}
// SRL-PUBLIC-SYNC: END PUBLIC-ONLY id=worker-url-settings
