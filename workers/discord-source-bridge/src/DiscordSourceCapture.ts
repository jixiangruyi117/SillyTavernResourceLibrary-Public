import { DiscordCaptureContext, DiscordInteraction, validSnowflake } from './DiscordSourceProtocol'

export const THREAD_CHANNEL_TYPES = new Set([10, 11, 12])

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

export function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

export function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

export function readForumTags(channel?: Record<string, unknown>): string[] {
  if (!channel) return []
  const applied = Array.isArray(channel.applied_tags)
    ? channel.applied_tags.filter((value): value is string => typeof value === 'string')
    : []
  const available = Array.isArray(channel.available_tags)
    ? channel.available_tags.flatMap((value) => {
        const tag = asRecord(value)
        const id = asString(tag?.id)
        const name = asString(tag?.name)
        return id && name ? [{ id, name }] : []
      })
    : []
  const names = new Map(available.map((tag) => [tag.id, tag.name]))
  return applied.flatMap((id) => {
    const name = names.get(id)
    return name ? [name] : []
  })
}

function normalizeAttachments(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    const attachment = asRecord(item)
    if (!attachment) return []
    const id = asString(attachment.id)
    const name = asString(attachment.filename)
    const url = asString(attachment.url)
    if (!id || !name || !url) return []
    return [
      {
        id,
        name,
        size: asNumber(attachment.size) ?? 0,
        url,
        ...(asString(attachment.proxy_url) ? { proxyUrl: asString(attachment.proxy_url) } : {}),
        ...(asString(attachment.content_type)
          ? { contentType: asString(attachment.content_type) }
          : {}),
        ...(asNumber(attachment.width) !== undefined ? { width: asNumber(attachment.width) } : {}),
        ...(asNumber(attachment.height) !== undefined
          ? { height: asNumber(attachment.height) }
          : {}),
      },
    ]
  })
}

export function buildCapture(interaction: DiscordInteraction): Record<string, unknown> {
  const channelId = interaction.channel_id ?? ''
  const targetId = interaction.data?.target_id ?? ''
  const message = interaction.data?.resolved?.messages?.[targetId]
  if (!channelId || !targetId || !message) throw new Error('Discord 没有提供被选中的消息')

  const author = asRecord(message.author)
  const authorId = asString(author?.id)
  const authorName =
    asString(author?.global_name) || asString(author?.username) || asString(message.author_name)
  if (!authorId || !authorName) throw new Error('无法读取消息作者')
  const authorBot = author?.bot === true || Boolean(asString(message.webhook_id))

  const channel = interaction.channel
  const channelType = asNumber(channel?.type)
  const threadId =
    channelType !== undefined && THREAD_CHANNEL_TYPES.has(channelType) ? channelId : undefined
  const starterMessageId = threadId ?? targetId
  const isStarter = targetId === starterMessageId
  const guildPath = interaction.guild_id ?? '@me'
  const canonicalUrl = `https://discord.com/channels/${encodeURIComponent(guildPath)}/${encodeURIComponent(channelId)}/${encodeURIComponent(targetId)}`
  const currentChannelName = asString(channel?.name) || undefined

  return {
    ...(interaction.guild_id ? { guildId: interaction.guild_id } : {}),
    channelId,
    ...(!threadId && currentChannelName ? { channelName: currentChannelName } : {}),
    ...(threadId ? { threadId } : {}),
    starterMessageId,
    isStarter,
    messageId: targetId,
    canonicalUrl,
    authorId,
    authorName,
    authorBot,
    content: typeof message.content === 'string' ? message.content : '',
    timestamp: asString(message.timestamp) || new Date().toISOString(),
    ...(asString(message.edited_timestamp)
      ? { editedTimestamp: asString(message.edited_timestamp) }
      : {}),
    ...(threadId && currentChannelName ? { title: currentChannelName } : {}),
    forumTags: readForumTags(channel),
    embeds: Array.isArray(message.embeds)
      ? message.embeds.filter((value) => Boolean(asRecord(value)))
      : [],
    attachments: normalizeAttachments(message.attachments),
  }
}

export function buildCaptureFromMessage(
  message: Record<string, unknown>,
  context: DiscordCaptureContext,
): Record<string, unknown> | undefined {
  const messageId = asString(message.id)
  if (!validSnowflake(messageId)) return undefined
  const author = asRecord(message.author)
  const authorId = asString(author?.id)
  const authorName =
    asString(author?.global_name) || asString(author?.username) || asString(message.author_name)
  if (!validSnowflake(authorId) || !authorName) return undefined
  const authorBot = author?.bot === true || Boolean(asString(message.webhook_id))
  const guildPath = context.guildId ?? '@me'
  const canonicalUrl = `https://discord.com/channels/${encodeURIComponent(guildPath)}/${encodeURIComponent(context.channelId)}/${encodeURIComponent(messageId)}`
  const isStarter = messageId === context.starterMessageId
  return {
    ...(context.guildId ? { guildId: context.guildId } : {}),
    ...(context.guildName ? { guildName: context.guildName } : {}),
    channelId: context.channelId,
    ...(context.channelName ? { channelName: context.channelName } : {}),
    ...(context.threadId ? { threadId: context.threadId } : {}),
    starterMessageId: context.starterMessageId,
    isStarter,
    messageId,
    canonicalUrl,
    authorId,
    authorName,
    authorBot,
    content: typeof message.content === 'string' ? message.content : '',
    timestamp: asString(message.timestamp) || new Date().toISOString(),
    ...(asString(message.edited_timestamp)
      ? { editedTimestamp: asString(message.edited_timestamp) }
      : {}),
    ...(isStarter && context.title ? { title: context.title } : {}),
    forumTags: isStarter ? context.forumTags : [],
    embeds: Array.isArray(message.embeds)
      ? message.embeds.filter((value) => Boolean(asRecord(value)))
      : [],
    attachments: normalizeAttachments(message.attachments),
  }
}
