export interface DiscordWorkerEndpoints {
  baseUrl: string
  interactionsUrl: string
  healthUrl: string
  registerUrl: string
  statusUrl: string
}

const KNOWN_ENDPOINT_SUFFIXES = [
  '/setup/register',
  '/setup/status',
  '/interactions',
  '/health',
] as const

function looksLikeHost(value: string): boolean {
  return /^[\w.-]+(?::\d+)?(?:\/.*)?$/u.test(value)
}

export function normalizeDiscordWorkerBaseUrl(value: string): string {
  let candidate = value.trim()
  if (!candidate) return ''
  if (!/^https?:\/\//iu.test(candidate) && looksLikeHost(candidate)) {
    candidate = `https://${candidate}`
  }

  try {
    const url = new URL(candidate)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return ''
    if (url.username || url.password) return ''

    url.hash = ''
    url.search = ''

    let pathname = url.pathname.replace(/\/+$/u, '')
    const lowerPath = pathname.toLowerCase()
    const suffix = KNOWN_ENDPOINT_SUFFIXES.find((item) => lowerPath.endsWith(item))
    if (suffix) pathname = pathname.slice(0, -suffix.length).replace(/\/+$/u, '')
    url.pathname = pathname || '/'

    return url.toString().replace(/\/+$/u, '')
  } catch {
    return ''
  }
}

export function getDiscordWorkerEndpoints(value: string): DiscordWorkerEndpoints | undefined {
  const baseUrl = normalizeDiscordWorkerBaseUrl(value)
  if (!baseUrl) return undefined
  return {
    baseUrl,
    interactionsUrl: `${baseUrl}/interactions`,
    healthUrl: `${baseUrl}/health`,
    registerUrl: `${baseUrl}/setup/register`,
    statusUrl: `${baseUrl}/setup/status`,
  }
}
