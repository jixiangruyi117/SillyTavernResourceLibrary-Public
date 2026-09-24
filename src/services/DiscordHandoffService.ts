import { normalizeDiscordWorkerBaseUrl } from './DiscordSourceConnectionService'
import type { DiscordAttachmentMeta, DiscordCapture } from '../types/CommunitySource'

export interface DiscordHandoffRequest {
  workerUrl: string
  token: string
}

function readString(
  record: Record<string, unknown>,
  key: string,
  required = false,
): string | undefined {
  const value = record[key]
  const result = typeof value === 'string' ? value.trim() : ''
  if (required && !result) throw new Error(`Discord handoff 缺少 ${key}`)
  return result || undefined
}

function readAttachment(value: unknown): DiscordAttachmentMeta | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const id = readString(record, 'id', true)!
  const name = readString(record, 'name', true)!
  const url = readString(record, 'url', true)!
  const size = typeof record.size === 'number' && Number.isFinite(record.size) ? record.size : 0
  return {
    id,
    name,
    url,
    size,
    proxyUrl: readString(record, 'proxyUrl'),
    contentType: readString(record, 'contentType'),
    width:
      typeof record.width === 'number' && Number.isFinite(record.width) ? record.width : undefined,
    height:
      typeof record.height === 'number' && Number.isFinite(record.height)
        ? record.height
        : undefined,
  }
}

export function parseDiscordCapture(value: unknown): DiscordCapture {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Discord handoff 内容无效')
  }
  const record = value as Record<string, unknown>
  const canonicalUrl = readString(record, 'canonicalUrl', true)!
  let parsedUrl: URL
  try {
    parsedUrl = new URL(canonicalUrl)
  } catch {
    throw new Error('Discord 原消息链接无效')
  }
  if (parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'http:') {
    throw new Error('Discord 原消息链接无效')
  }

  const embeds = Array.isArray(record.embeds)
    ? record.embeds.flatMap((item) =>
        item && typeof item === 'object' && !Array.isArray(item)
          ? [structuredClone(item as Record<string, unknown>)]
          : [],
      )
    : []
  const attachments = Array.isArray(record.attachments)
    ? record.attachments.flatMap((item) => {
        const attachment = readAttachment(item)
        return attachment ? [attachment] : []
      })
    : []

  return {
    guildId: readString(record, 'guildId'),
    guildName: readString(record, 'guildName'),
    channelId: readString(record, 'channelId', true)!,
    channelName: readString(record, 'channelName'),
    threadId: readString(record, 'threadId'),
    messageId: readString(record, 'messageId', true)!,
    starterMessageId: readString(record, 'starterMessageId'),
    isStarter: record.isStarter === true,
    canonicalUrl: parsedUrl.toString(),
    authorId: readString(record, 'authorId', true)!,
    authorName: readString(record, 'authorName', true)!,
    authorBot: record.authorBot === true,
    content: typeof record.content === 'string' ? record.content : '',
    timestamp: readString(record, 'timestamp', true)!,
    editedTimestamp: readString(record, 'editedTimestamp'),
    title: readString(record, 'title'),
    forumTags: Array.isArray(record.forumTags)
      ? Array.from(
          new Set(record.forumTags.filter((item): item is string => typeof item === 'string')),
        )
      : [],
    embeds,
    attachments,
  }
}

export function normalizeDiscordHandoffRequest(
  value: DiscordHandoffRequest,
): DiscordHandoffRequest | undefined {
  const workerUrl = normalizeDiscordWorkerBaseUrl(value.workerUrl)
  const token = value.token.trim()
  if (!workerUrl || !/^[A-Za-z0-9_-]{30,160}$/u.test(token)) return undefined
  return { workerUrl, token }
}

export function readDiscordHandoffFromLocation(
  location: Location = window.location,
): DiscordHandoffRequest | undefined {
  const params = new URLSearchParams(location.search)
  const workerUrl = params.get('discordWorker') ?? ''
  const token = params.get('discordHandoff') ?? ''
  return normalizeDiscordHandoffRequest({ workerUrl, token })
}

export function clearDiscordHandoffFromLocation(): void {
  const url = new URL(window.location.href)
  if (!url.searchParams.has('discordWorker') && !url.searchParams.has('discordHandoff')) return
  url.searchParams.delete('discordWorker')
  url.searchParams.delete('discordHandoff')
  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`)
}

export async function consumeDiscordHandoff(
  value: DiscordHandoffRequest,
  signal?: AbortSignal,
): Promise<DiscordCapture> {
  const request = normalizeDiscordHandoffRequest(value)
  if (!request) throw new Error('Discord 临时链接无效')
  const response = await fetch(
    `${request.workerUrl}/handoff/${encodeURIComponent(request.token)}`,
    {
      method: 'GET',
      cache: 'no-store',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      signal,
    },
  )
  if (!response.ok) {
    if (response.status === 404 || response.status === 409) {
      throw new Error('这条 Discord 临时链接已过期或已经领取')
    }
    throw new Error(`无法从 Worker 领取消息（HTTP ${response.status}）`)
  }
  const payload = (await response.json()) as { capture?: unknown }
  return parseDiscordCapture(payload.capture)
}
