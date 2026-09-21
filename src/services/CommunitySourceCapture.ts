import {
  COMMUNITY_SOURCE_MESSAGE_REMOTE_STATE,
  createCommunitySourceId,
  type CommunitySource,
  type CommunitySourceMessage,
  type CommunitySourceRevision,
  type DiscordAttachmentMeta,
  type DiscordCapture,
} from '../types/CommunitySource'
import { hashBytes } from './HashService'

function localMessagePreview(message: CommunitySourceMessage): string | undefined {
  const content = message.content.replace(/\s+/g, ' ').trim()
  return content ? content.slice(0, 240) : undefined
}

export function clean(value: string | undefined, maxLength: number): string | undefined {
  const result = value?.trim().slice(0, maxLength)
  return result || undefined
}

export function normalizeStringList(values: string[] | undefined, maxItems = 64): string[] {
  return Array.from(new Set((values ?? []).map((value) => value.trim()).filter(Boolean))).slice(
    0,
    maxItems,
  )
}

export function normalizeMessageIds(
  values: readonly string[] | undefined,
  maxItems: number,
): string[] {
  return Array.from(new Set((values ?? []).map((value) => value.trim()).filter(Boolean))).slice(
    -maxItems,
  )
}

export function safeHttpUrl(value: string | undefined): string | undefined {
  if (!value) return undefined
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'https:' || parsed.protocol === 'http:'
      ? parsed.toString()
      : undefined
  } catch {
    return undefined
  }
}

export function normalizeAttachments(
  values: DiscordAttachmentMeta[] | undefined,
): DiscordAttachmentMeta[] {
  if (!Array.isArray(values)) return []
  return values.flatMap((attachment) => {
    const id = attachment?.id?.trim()
    const name = attachment?.name?.trim()
    const url = safeHttpUrl(attachment?.url)
    if (!id || !name || !url) return []
    const size = Number.isFinite(attachment.size) && attachment.size >= 0 ? attachment.size : 0
    const proxyUrl = safeHttpUrl(attachment.proxyUrl)
    return [
      {
        id: id.slice(0, 128),
        name: name.slice(0, 500),
        size,
        url,
        ...(proxyUrl ? { proxyUrl } : {}),
        ...(clean(attachment.contentType, 200)
          ? { contentType: clean(attachment.contentType, 200) }
          : {}),
        ...(Number.isFinite(attachment.width) ? { width: attachment.width } : {}),
        ...(Number.isFinite(attachment.height) ? { height: attachment.height } : {}),
      },
    ]
  })
}

export async function hashIdentity(value: string): Promise<string> {
  return hashBytes(new TextEncoder().encode(value))
}

export async function messageKeyHash(sourceId: string, messageId: string): Promise<string> {
  return hashIdentity(`${sourceId}\0${messageId}`)
}

export function normalizeCapture(capture: DiscordCapture): DiscordCapture {
  const channelId = capture.channelId.trim()
  const messageId = capture.messageId.trim()
  const canonicalUrl = capture.canonicalUrl.trim()
  const authorId = capture.authorId.trim()
  const authorName = capture.authorName.trim()
  if (!channelId || !messageId || !canonicalUrl || !authorId || !authorName) {
    throw new Error('Discord 来源数据不完整')
  }
  const parsedUrl = safeHttpUrl(canonicalUrl)
  if (!parsedUrl) throw new Error('Discord 原消息链接无效')

  return {
    guildId: clean(capture.guildId, 64),
    guildName: clean(capture.guildName, 200),
    channelId: channelId.slice(0, 64),
    channelName: clean(capture.channelName, 200),
    threadId: clean(capture.threadId, 64),
    messageId: messageId.slice(0, 64),
    starterMessageId: clean(capture.starterMessageId, 64),
    isStarter: capture.isStarter === true,
    canonicalUrl: parsedUrl,
    authorId: authorId.slice(0, 64),
    authorName: authorName.slice(0, 160),
    authorBot: capture.authorBot === true,
    // 正文只做类型清洗，不做长度截断。列表预览必须在 UI 层处理。
    content: typeof capture.content === 'string' ? capture.content : '',
    timestamp: capture.timestamp,
    editedTimestamp: clean(capture.editedTimestamp, 80),
    title: clean(capture.title, 500),
    forumTags: normalizeStringList(capture.forumTags),
    embeds: Array.isArray(capture.embeds) ? structuredClone(capture.embeds) : [],
    // Worker 输入永远不能携带 localAssetId/localState；本机字段只由 SRL 自己生成。
    attachments: normalizeAttachments(capture.attachments),
  }
}

export function makeRevision(
  source: CommunitySource,
  messages: readonly CommunitySourceMessage[],
  createdAt: number,
): CommunitySourceRevision {
  return {
    id: createCommunitySourceId(),
    createdAt,
    source: {
      canonicalUrl: source.canonicalUrl,
      title: source.title,
      starterMessageId: source.starterMessageId,
      starterAuthorId: source.starterAuthorId,
      starterAuthorName: source.starterAuthorName,
      forumTags: structuredClone(source.forumTags),
      updatedAt: source.updatedAt,
    },
    messages: structuredClone([...messages]),
  }
}

export function attachmentIdentityMatches(
  local: DiscordAttachmentMeta,
  remote: DiscordAttachmentMeta,
): boolean {
  return (
    local.id === remote.id &&
    local.name === remote.name &&
    local.size === remote.size &&
    (local.contentType ?? '') === (remote.contentType ?? '')
  )
}

export function withMessageSummary(
  source: CommunitySource,
  messages: readonly CommunitySourceMessage[],
): CommunitySource {
  const latest = [...messages].sort((left, right) => left.capturedAt - right.capturedAt).at(-1)
  return {
    ...source,
    messageCount: messages.length,
    missingMessageCount: messages.filter(
      (message) => message.remoteState === COMMUNITY_SOURCE_MESSAGE_REMOTE_STATE.MISSING,
    ).length,
    latestMessagePreview: latest ? localMessagePreview(latest) : undefined,
  }
}

export function sourceSummaryMatches(
  source: CommunitySource,
  messages: readonly CommunitySourceMessage[],
): boolean {
  const summarized = withMessageSummary(source, messages)
  return (
    source.messageCount === summarized.messageCount &&
    source.missingMessageCount === summarized.missingMessageCount &&
    source.latestMessagePreview === summarized.latestMessagePreview
  )
}
