import {
  RESOURCE_INSTALL_TARGET,
  RESOURCE_LINK_PURPOSE,
  RESOURCE_LINK_TRUST_MODE,
  type ResourceInstallTarget,
  type ResourceLink,
} from '../types/Resource'
import { isRecord } from '../utils/UnknownValue'

export interface GitHubResourceInspection {
  status: 'identified' | 'described' | 'unavailable'
  fullName: string
  name: string
  summary: string
  repositoryDescription: string
  readmeExcerpt: string
  readmeHeadings: string[]
  topics: string[]
  homepage: string
  author: string
  license?: string
  updatedAt?: string
  defaultBranch: string
  archived: boolean
  latestRelease?: {
    name: string
    tagName: string
    publishedAt: string
    prerelease: boolean
    assets: Array<{ name: string; downloadUrl: string; size: number }>
  }
  manifest?: {
    displayName: string
    description: string
    version: string
    author: string
    minimumClientVersion: string
    requires: string[]
    optional: string[]
  }
  installTarget: ResourceInstallTarget
  trustMode: typeof RESOURCE_LINK_TRUST_MODE.METADATA_SNAPSHOT
  evidence: string[]
  warning?: string
}

export interface GitHubReadmeDocument {
  markdown: string
  ref: string
  fileName: 'README.md' | 'readme.md'
}

export type GitHubResourceInspector = (
  link: ResourceLink,
) => Promise<GitHubResourceInspection | undefined>

interface GitHubRepositoryResponse {
  full_name?: unknown
  name?: unknown
  description?: unknown
  homepage?: unknown
  topics?: unknown
  default_branch?: unknown
  pushed_at?: unknown
  updated_at?: unknown
  archived?: unknown
  owner?: { login?: unknown }
  license?: { spdx_id?: unknown; name?: unknown }
  message?: unknown
}

interface GitHubReleaseResponse {
  name?: unknown
  tag_name?: unknown
  published_at?: unknown
  prerelease?: unknown
  assets?: Array<{ name?: unknown; browser_download_url?: unknown; size?: unknown }>
}

interface RawRepositoryFiles {
  ref: string
  readme: ReturnType<typeof summarizeGitHubReadme>
  manifest?: GitHubResourceInspection['manifest']
}

const README_FILE_NAMES = ['README.md', 'readme.md'] as const

function readString(value: unknown, limit = 600): string {
  return typeof value === 'string' ? value.trim().slice(0, limit) : ''
}

function readStringArray(value: unknown, limit = 20): string[] {
  if (!Array.isArray(value)) return []
  return Array.from(
    new Set(
      value.flatMap((item) => (typeof item === 'string' && item.trim() ? [item.trim()] : [])),
    ),
  ).slice(0, limit)
}

function stripMarkdown(value: string): string {
  return value
    .replace(/<!--([\s\S]*?)-->/g, ' ')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[`*_~>#|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function summarizeGitHubReadme(markdown: string): {
  excerpt: string
  headings: string[]
} {
  const headings = Array.from(
    new Set(
      markdown.split(/\r?\n/u).flatMap((line) => {
        const match = line.match(/^#{1,3}\s+(.+)$/u)
        const heading = match ? stripMarkdown(match[1] ?? '') : ''
        return heading ? [heading.slice(0, 80)] : []
      }),
    ),
  ).slice(0, 12)

  const paragraphs = markdown
    .replace(/^---\s*[\s\S]*?^---\s*$/mu, ' ')
    .replace(/^#{1,6}\s+.*$/gmu, ' ')
    .split(/\r?\n\s*\r?\n/u)
    .map(stripMarkdown)
    .filter(
      (paragraph) =>
        paragraph.length >= 12 &&
        !/^https?:\/\//iu.test(paragraph) &&
        !/^(build|npm|pnpm|yarn|license|stars?|downloads?)\b/iu.test(paragraph),
    )
  return { excerpt: (paragraphs[0] ?? '').slice(0, 600), headings }
}

function readManifest(value: unknown): GitHubResourceInspection['manifest'] | undefined {
  if (!isRecord(value)) return undefined
  const displayName = readString(value.display_name, 120)
  const script = readString(value.js, 240)
  if (!displayName || !script) return undefined
  return {
    displayName,
    description: readString(value.description, 600),
    version: readString(value.version, 80),
    author: readString(value.author, 120),
    minimumClientVersion: readString(value.minimum_client_version, 80),
    requires: readStringArray(value.requires),
    optional: readStringArray(value.optional),
  }
}

async function fetchGitHub(
  fetchImpl: typeof fetch,
  url: string,
  accept: string,
): Promise<Response> {
  return fetchImpl(url, {
    method: 'GET',
    headers: {
      Accept: accept,
      'X-GitHub-Api-Version': '2022-11-28',
    },
    cache: 'no-store',
  })
}

async function fetchRawText(fetchImpl: typeof fetch, url: string): Promise<string> {
  const response = await fetchImpl(url, {
    method: 'GET',
    headers: { Accept: 'text/plain' },
    cache: 'no-store',
  })
  if (!response.ok) return ''

  if (!response.body) return response.text()

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      total += value.byteLength
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }

  const output = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(output)
}

async function readLatestGitHubRelease(
  fetchImpl: typeof fetch,
  owner: string,
  repo: string,
): Promise<GitHubResourceInspection['latestRelease']> {
  const response = await fetchGitHub(
    fetchImpl,
    `https://api.github.com/repos/${owner}/${repo}/releases/latest`,
    'application/vnd.github+json',
  )
  if (!response.ok) return undefined
  const release = (await response.json().catch(() => ({}))) as GitHubReleaseResponse
  const tagName = readString(release.tag_name, 160)
  if (!tagName) return undefined
  const assets = Array.isArray(release.assets)
    ? release.assets.flatMap((asset) => {
        const name = readString(asset.name, 180)
        const downloadUrl = readString(asset.browser_download_url, 1200)
        const size = Number(asset.size)
        return name && downloadUrl && Number.isFinite(size) && size >= 0
          ? [{ name, downloadUrl, size }]
          : []
      })
    : []
  return {
    name: readString(release.name, 200) || tagName,
    tagName,
    publishedAt: readString(release.published_at, 80),
    prerelease: release.prerelease === true,
    assets: assets.slice(0, 8),
  }
}

export async function readGitHubReadme(
  link: ResourceLink,
  defaultBranch = '',
  fetchImpl: typeof fetch = fetch,
): Promise<GitHubReadmeDocument | undefined> {
  const github = link.github
  if (!github?.owner || !github.repo) return undefined
  const owner = encodeURIComponent(github.owner)
  const repo = encodeURIComponent(github.repo)
  for (const ref of uniqueRefs(link, defaultBranch)) {
    const rawBase = `https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(ref)}`
    for (const fileName of README_FILE_NAMES) {
      const markdown = await fetchRawText(fetchImpl, `${rawBase}/${fileName}`)
      if (markdown) return { markdown, ref, fileName }
    }
  }
  return undefined
}

async function readRawRepositoryFiles(
  fetchImpl: typeof fetch,
  owner: string,
  repo: string,
  refs: string[],
): Promise<RawRepositoryFiles> {
  for (const ref of refs) {
    const encodedRef = encodeURIComponent(ref)
    const rawBase = `https://raw.githubusercontent.com/${owner}/${repo}/${encodedRef}`
    const [readmeText, lowercaseReadmeText, manifestText] = await Promise.all([
      fetchRawText(fetchImpl, `${rawBase}/README.md`).catch(() => ''),
      fetchRawText(fetchImpl, `${rawBase}/readme.md`).catch(() => ''),
      fetchRawText(fetchImpl, `${rawBase}/manifest.json`).catch(() => ''),
    ])
    const readme = summarizeGitHubReadme(readmeText || lowercaseReadmeText)
    let manifest: GitHubResourceInspection['manifest'] | undefined
    if (manifestText) {
      try {
        manifest = readManifest(JSON.parse(manifestText))
      } catch {
        manifest = undefined
      }
    }
    if (readme.excerpt || readme.headings.length > 0 || manifest) {
      return { ref, readme, manifest }
    }
  }
  return { ref: refs[0] ?? '', readme: { excerpt: '', headings: [] } }
}

function uniqueRefs(link: ResourceLink, defaultBranch: string): string[] {
  const requestedRef = link.versionRef?.value.trim() ?? ''
  return Array.from(new Set([requestedRef, defaultBranch, 'main', 'master'].filter(Boolean)))
}

export async function inspectGitHubResource(
  link: ResourceLink,
  fetchImpl: typeof fetch = fetch,
): Promise<GitHubResourceInspection | undefined> {
  const github = link.github
  if (!github?.owner || !github.repo) return undefined
  const owner = encodeURIComponent(github.owner)
  const repo = encodeURIComponent(github.repo)
  const fallbackName = `${github.owner}/${github.repo}`
  const repositoryUrl = `https://api.github.com/repos/${owner}/${repo}`

  let repositoryResponse: Response | undefined
  try {
    repositoryResponse = await fetchGitHub(fetchImpl, repositoryUrl, 'application/vnd.github+json')
  } catch {
    repositoryResponse = undefined
  }

  let repository: GitHubRepositoryResponse = {}
  if (repositoryResponse?.ok) {
    repository = (await repositoryResponse.json().catch(() => ({}))) as GitHubRepositoryResponse
  }
  const defaultBranch = readString(repository.default_branch, 160)
  const fullName = readString(repository.full_name, 200) || fallbackName
  const repositoryDescription = readString(repository.description)
  const [rawFiles, latestRelease] = await Promise.all([
    readRawRepositoryFiles(fetchImpl, owner, repo, uniqueRefs(link, defaultBranch)),
    repositoryResponse?.ok
      ? readLatestGitHubRelease(fetchImpl, owner, repo).catch(() => undefined)
      : Promise.resolve(undefined),
  ])
  const summary = rawFiles.manifest?.description || repositoryDescription || rawFiles.readme.excerpt
  const hasRepositoryMetadata = repositoryResponse?.ok === true
  const evidence = [
    ...(hasRepositoryMetadata ? ['GitHub 仓库元数据'] : []),
    ...(rawFiles.readme.excerpt || rawFiles.readme.headings.length > 0 ? ['README'] : []),
    ...(rawFiles.manifest ? ['SillyTavern manifest.json'] : []),
  ]

  let warning: string | undefined
  if (!hasRepositoryMetadata && evidence.length > 0) {
    warning = 'GitHub 仓库接口不可用，当前说明来自公开 README/manifest。'
  } else if (!hasRepositoryMetadata) {
    const detail = repositoryResponse
      ? ((await repositoryResponse.json().catch(() => ({}))) as GitHubRepositoryResponse)
      : {}
    const rateLimited = repositoryResponse?.status === 403 || repositoryResponse?.status === 429
    warning = rateLimited
      ? 'GitHub 公开接口已限流，且没有读取到公开 README/manifest；链接仍会保留。'
      : readString(detail.message, 240) || '无法读取 GitHub 仓库内容；链接仍会保留。'
  }

  return {
    status: rawFiles.manifest ? 'identified' : evidence.length > 0 ? 'described' : 'unavailable',
    fullName,
    name: rawFiles.manifest?.displayName || readString(repository.name, 160) || fullName,
    summary,
    repositoryDescription,
    readmeExcerpt: rawFiles.readme.excerpt,
    readmeHeadings: rawFiles.readme.headings,
    topics: readStringArray(repository.topics),
    homepage: readString(repository.homepage, 500),
    author: readString(repository.owner?.login, 120) || github.owner,
    license:
      readString(repository.license?.spdx_id, 80) || readString(repository.license?.name, 160),
    updatedAt: readString(repository.pushed_at, 80) || readString(repository.updated_at, 80),
    defaultBranch: defaultBranch || rawFiles.ref,
    archived: repository.archived === true,
    ...(latestRelease ? { latestRelease } : {}),
    manifest: rawFiles.manifest,
    installTarget:
      rawFiles.manifest && link.purpose === RESOURCE_LINK_PURPOSE.REPOSITORY
        ? RESOURCE_INSTALL_TARGET.SILLYTAVERN_EXTENSION
        : RESOURCE_INSTALL_TARGET.NONE,
    trustMode: RESOURCE_LINK_TRUST_MODE.METADATA_SNAPSHOT,
    evidence,
    warning,
  }
}
