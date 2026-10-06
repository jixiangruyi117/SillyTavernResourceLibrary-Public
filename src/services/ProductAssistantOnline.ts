import { normalizeAssistantDirectoryQuery, readAssistantOffset } from './ProductAssistantTools'

export const DEFAULT_ASSISTANT_GITHUB_REPOSITORY =
  'https://github.com/jixiangruyi117/SillyTavernResourceLibrary-Public'
export function assistantPublicUrl(value: string): URL {
  const url = new URL(value)
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.port ||
    !url.hostname.includes('.') ||
    /^\[|^[\d.]+$|^0x/iu.test(url.hostname) ||
    /(?:^|\.)(?:localhost|local|internal|lan|home|test|invalid)$/iu.test(url.hostname) ||
    [...url.searchParams.keys()].some((key) =>
      /token|key|secret|password|signature|credential|auth|^code$/iu.test(key),
    )
  )
    throw new Error('只允许无凭据的公开HTTPS地址')
  url.hash = ''
  return url
}

interface GitHubTarget {
  owner: string
  repo: string
  path: string
  ref: string
  source: string
}
const encodedPath = (value: string) => value.split('/').map(encodeURIComponent).join('/')
/** Only construct fixed GitHub API requests; never follow response download URLs. */
export function assistantGitHubTarget(args: Record<string, string>): GitHubTarget {
  const url = assistantPublicUrl(args.url?.trim() || DEFAULT_ASSISTANT_GITHUB_REPOSITORY)
  if (!['github.com', 'api.github.com', 'raw.githubusercontent.com'].includes(url.hostname))
    throw new Error('现在仅支持 GitHub 公开仓库、目录或文件链接；普通网页读取已移除')
  if ([...url.searchParams.keys()].some((key) => key !== 'ref'))
    throw new Error('GitHub 链接仅允许 ref 参数，不接受其它访问参数')
  const parts = url.pathname
    .split('/')
    .filter(Boolean)
    .map((part) => decodeURIComponent(part))
  if (url.hostname === 'api.github.com' && parts.shift() !== 'repos')
    throw new Error('请使用 GitHub 仓库链接或 contents API 链接')
  const owner = parts.shift() || '',
    repo = (parts.shift() || '').replace(/\.git$/u, '')
  if (
    !/^[A-Za-z0-9-]{1,100}$/u.test(owner) ||
    !/^[A-Za-z0-9_.-]{1,100}$/u.test(repo) ||
    ['.', '..'].includes(repo)
  )
    throw new Error('GitHub 仓库地址无效')
  let ref = args.ref?.trim() || url.searchParams.get('ref') || '',
    path = ''
  if (url.hostname === 'api.github.com') {
    if (parts.length && parts.shift() !== 'contents')
      throw new Error('只允许 GitHub contents 只读接口')
    path = parts.join('/')
  } else if (url.hostname === 'raw.githubusercontent.com' || parts.length) {
    if (url.hostname === 'github.com' && !['tree', 'blob'].includes(parts.shift() || ''))
      throw new Error('请使用仓库首页、tree 目录或 blob 文件链接')
    if (!ref) ref = parts.shift() || ''
    else {
      const refParts = ref.split('/')
      // Explicit ref resolves branches containing slashes without guessing.
      if (refParts.every((part, index) => parts[index] === part)) parts.splice(0, refParts.length)
      else if (parts[0] === ref) parts.shift()
      else if (args.path === undefined)
        throw new Error('链接分支不明确，请用仓库首页并明确指定 ref 和 path')
    }
    path = parts.join('/')
  }
  if (args.path !== undefined) path = args.path.trim().replace(/^\/+|\/+$/gu, '')
  if (
    path.split('/').some((part) => ['.', '..'].includes(part)) ||
    path.includes('\\') ||
    [...(path + ref)].some((char) => char.charCodeAt(0) < 32) ||
    path.length > 1500 ||
    ref.length > 200
  )
    throw new Error('GitHub 文件路径或分支无效')
  return { owner, repo, path, ref, source: `https://github.com/${owner}/${repo}` }
}
function githubQuota(response: Response): Record<string, unknown> {
  const integer = (name: string) => {
    const value = response.headers.get(name)
    return value !== null && /^\d+$/u.test(value) && Number.isSafeInteger(Number(value))
      ? Number(value)
      : undefined
  }
  const reset = integer('x-ratelimit-reset')
  return {
    limit: integer('x-ratelimit-limit'),
    remaining: integer('x-ratelimit-remaining'),
    ...(reset !== undefined && reset < 8_640_000_000_000
      ? { resetsAt: new Date(reset * 1000).toISOString() }
      : {}),
  }
}
async function githubResponse(
  url: string,
  signal: AbortSignal,
  fetcher: typeof fetch,
  token: string,
  accept: string,
) {
  signal.throwIfAborted()
  let response: Response
  try {
    response = await fetcher(url, {
      signal,
      credentials: 'omit',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
      headers: {
        Accept: accept,
        'X-GitHub-Api-Version': '2026-03-10',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    })
  } catch {
    signal.throwIfAborted()
    throw new Error('GitHub API 请求未完成，请检查网络或跨域访问；没有自动重试')
  }
  const quota = githubQuota(response)
  if (!response.ok) {
    await response.body?.cancel()
    if (response.status === 401)
      throw new Error('GitHub 令牌未通过认证（HTTP 401），请在助手设置中核对令牌；没有自动重试')
    if (response.status === 403 || response.status === 429)
      throw new Error(
        quota.remaining === 0
          ? `GitHub API 请求额度已用完${quota.resetsAt ? `，重置时间 ${quota.resetsAt}` : ''}；可配置 GitHub 令牌提高额度，没有自动重试`
          : `GitHub 限制请求或访问权限不足（HTTP ${response.status}）；请稍后或核对令牌权限，没有自动重试`,
      )
    if (response.status === 404)
      throw new Error(
        'GitHub 未返回目标（HTTP 404），请核对公开仓库、分支与路径；不能据此断言仓库私有，没有自动重试',
      )
    throw new Error(`GitHub API 返回 HTTP ${response.status}，未取得目标内容；没有自动重试`)
  }
  return { response, quota }
}
async function githubJson(
  url: string,
  signal: AbortSignal,
  fetcher: typeof fetch,
  token: string,
  accept = 'application/vnd.github+json',
) {
  const { response, quota } = await githubResponse(url, signal, fetcher, token, accept)
  if (!response.body) throw new Error('GitHub 返回空资料')
  const reader = response.body.getReader(),
    decoder = new TextDecoder('utf-8', { fatal: true })
  let text = ''
  try {
    while (true) {
      signal.throwIfAborted()
      const chunk = await reader.read()
      if (chunk.done) break
      text += decoder.decode(chunk.value, { stream: true })
    }
    text += decoder.decode()
    return { data: JSON.parse(text) as unknown, quota }
  } finally {
    await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
}
async function githubRaw(url: string, signal: AbortSignal, fetcher: typeof fetch, token: string) {
  const { response, quota } = await githubResponse(
    url,
    signal,
    fetcher,
    token,
    'application/vnd.github.raw+json',
  )
  const text = new TextDecoder('utf-8', { fatal: true }).decode(await response.arrayBuffer())
  return { text, quota }
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('GitHub 返回资料格式无效')
  return value as Record<string, unknown>
}
/** Public repository data only. Token belongs to GitHub, never to the model or old Reader. */
export async function readAssistantOnline(
  args: Record<string, string>,
  signal: AbortSignal,
  fetcher: typeof fetch = globalThis.fetch,
  githubToken = '',
): Promise<Record<string, unknown>> {
  const token = githubToken.trim()
  if ((token && !/^(?:github_pat_|ghp_)[A-Za-z0-9_]+$/u.test(token)) || githubToken.length > 4096)
    throw new Error('GitHub 令牌格式无效；请使用 GitHub 访问令牌，不能使用模型或旧网页读取密钥')
  const target = assistantGitHubTarget(args)
  const offset = readAssistantOffset(args.offset)
  const query = normalizeAssistantDirectoryQuery(args.query)
  const base = `https://api.github.com/repos/${target.owner}/${target.repo}`
  const metadata = object((await githubJson(base, signal, fetcher, token)).data)
  if (
    metadata.private !== false ||
    metadata.visibility === 'private' ||
    metadata.visibility === 'internal'
  )
    throw new Error('只允许读取公开 GitHub 仓库，未读取私有仓库内容')
  const ref =
    target.ref || (typeof metadata.default_branch === 'string' ? metadata.default_branch : '')
  if (!ref) throw new Error('GitHub 未返回默认分支，请明确指定 ref')
  const endpoint = `${base}/contents${target.path ? `/${encodedPath(target.path)}` : ''}?ref=${encodeURIComponent(ref)}`
  const result = await githubJson(
    endpoint,
    signal,
    fetcher,
    token,
    'application/vnd.github.object+json',
  )
  const common = {
    reader: 'https://api.github.com',
    repository: target.source,
    ref,
    path: target.path,
    fetchedAt: new Date().toISOString(),
    quota: result.quota,
  }
  if (Array.isArray(result.data)) {
    const directoryEntries = result.data.map((item) => {
      const value = object(item)
      if (typeof value.path !== 'string' || typeof value.type !== 'string')
        throw new Error('GitHub 目录资料格式无效')
      return { path: value.path, type: value.type, size: value.size, sha: value.sha }
    })
    const terms = query.split(' ').filter(Boolean)
    const entries = directoryEntries.filter((entry) => {
      const name = entry.path.split('/').at(-1)!.toLowerCase()
      return terms.every((term) => name.includes(term))
    })
    if (offset > entries.length) throw new Error('目录偏移超出范围')
    return {
      ...common,
      kind: 'directory',
      source: `${target.source}/tree/${encodeURIComponent(ref)}${target.path ? `/${encodedPath(target.path)}` : ''}`,
      entries: entries.slice(offset),
      offset,
      nextOffset: null,
      totalEntries: entries.length,
      directoryTotalEntries: directoryEntries.length,
      query,
      possiblyTruncated: directoryEntries.length >= 1000,
      complete: offset === 0 && directoryEntries.length < 1000,
    }
  }
  if (query) throw new Error('query仅用于目录文件名筛选；读取文件请去掉query')
  const file = object(result.data)
  if (file.type !== 'file')
    throw new Error('该目标不是可读取的文本文件（可能是符号链接或子模块），未取得源码正文')
  let text: string
  let sourceQuota = result.quota
  if (file.encoding === 'none') {
    const raw = await githubRaw(endpoint, signal, fetcher, token)
    text = raw.text
    sourceQuota = raw.quota
  } else if (file.encoding === 'base64' && typeof file.content === 'string') {
    try {
      const decoded = atob(file.content.replace(/\s/gu, ''))
      text = new TextDecoder('utf-8', { fatal: true }).decode(
        Uint8Array.from(decoded, (char) => char.charCodeAt(0)),
      )
    } catch {
      throw new Error('该文件不是有效的 UTF-8 文本，未读取二进制文件')
    }
  } else {
    throw new Error('GitHub 未返回可读取的 UTF-8 文本')
  }
  if (text.includes('\u0000')) throw new Error('不支持二进制文件')
  if (offset > text.length) throw new Error('源码片段超出正文范围')
  const end = text.length
  return {
    ...common,
    quota: sourceQuota,
    kind: 'file',
    source: `${target.source}/blob/${encodeURIComponent(ref)}/${encodedPath(target.path)}`,
    sha: file.sha,
    text: text.slice(offset, end),
    offset,
    nextOffset: end < text.length ? end : null,
    totalCharacters: text.length,
    complete: offset === 0 && end >= text.length,
  }
}
