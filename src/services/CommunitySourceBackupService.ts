import {
  COMMUNITY_SOURCE_ATTACHMENT_LOCAL_STATE,
  COMMUNITY_SOURCE_MESSAGE_KIND,
  COMMUNITY_SOURCE_MESSAGE_REMOTE_STATE,
  COMMUNITY_SOURCE_PLATFORM,
  COMMUNITY_SOURCE_REFRESH_MODE,
  COMMUNITY_SOURCE_REMOTE_STATE,
  createResourceSourceBindingId,
  type CommunitySource,
  type CommunitySourceBackupData,
  type CommunitySourceMessage,
  type CommunitySourceRevision,
  type ResourceSourceBinding,
} from '../types/CommunitySource'
import { isRecord } from '../utils/UnknownValue'

const MESSAGE_KINDS = new Set(Object.values(COMMUNITY_SOURCE_MESSAGE_KIND))
const REMOTE_STATES = new Set<string>(Object.values(COMMUNITY_SOURCE_REMOTE_STATE))
const REFRESH_MODES = new Set<string>(Object.values(COMMUNITY_SOURCE_REFRESH_MODE))
const MESSAGE_REMOTE_STATES = new Set<string>(Object.values(COMMUNITY_SOURCE_MESSAGE_REMOTE_STATE))
const ATTACHMENT_LOCAL_STATES = new Set<string>(
  Object.values(COMMUNITY_SOURCE_ATTACHMENT_LOCAL_STATE),
)
const SHA256_PATTERN = /^[0-9a-f]{64}$/iu
const DISCORD_SNOWFLAKE_PATTERN = /^\d{5,32}$/u

function isHttpUrl(value: unknown): value is string {
  if (typeof value !== 'string' || !value) return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:'
  } catch {
    return false
  }
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === 'string'
}

function isOptionalSnowflake(value: unknown): value is string | undefined {
  return value === undefined || (typeof value === 'string' && DISCORD_SNOWFLAKE_PATTERN.test(value))
}

function isRemoteScanCursor(value: unknown): boolean {
  if (!isRecord(value)) return false
  if (
    !isOptionalSnowflake(value.lastSeenMessageId) ||
    !isOptionalSnowflake(value.pendingBeforeMessageId) ||
    !isOptionalSnowflake(value.pendingHighWaterMessageId)
  ) {
    return false
  }
  const hasPending =
    value.pendingBeforeMessageId !== undefined || value.pendingHighWaterMessageId !== undefined
  if (hasPending) {
    return (
      typeof value.lastSeenMessageId === 'string' &&
      typeof value.pendingBeforeMessageId === 'string' &&
      typeof value.pendingHighWaterMessageId === 'string'
    )
  }
  return typeof value.lastSeenMessageId === 'string'
}

function isOptionalFiniteNumber(value: unknown): value is number | undefined {
  return value === undefined || (typeof value === 'number' && Number.isFinite(value))
}

function isOptionalNonNegativeInteger(value: unknown): value is number | undefined {
  return value === undefined || (typeof value === 'number' && Number.isInteger(value) && value >= 0)
}

function isAttachment(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    Boolean(value.id) &&
    typeof value.name === 'string' &&
    typeof value.size === 'number' &&
    Number.isFinite(value.size) &&
    value.size >= 0 &&
    isHttpUrl(value.url) &&
    (value.proxyUrl === undefined || isHttpUrl(value.proxyUrl)) &&
    isOptionalString(value.contentType) &&
    isOptionalFiniteNumber(value.width) &&
    isOptionalFiniteNumber(value.height) &&
    isOptionalString(value.localAssetId) &&
    (value.localState === undefined ||
      (typeof value.localState === 'string' && ATTACHMENT_LOCAL_STATES.has(value.localState)))
  )
}

function isCommunitySourceMessage(value: unknown): value is CommunitySourceMessage {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    Boolean(value.id) &&
    typeof value.sourceId === 'string' &&
    Boolean(value.sourceId) &&
    typeof value.messageKeyHash === 'string' &&
    SHA256_PATTERN.test(value.messageKeyHash) &&
    typeof value.messageId === 'string' &&
    Boolean(value.messageId) &&
    typeof value.kind === 'string' &&
    MESSAGE_KINDS.has(value.kind as CommunitySourceMessage['kind']) &&
    typeof value.authorId === 'string' &&
    Boolean(value.authorId) &&
    typeof value.authorName === 'string' &&
    (value.authorBot === undefined || typeof value.authorBot === 'boolean') &&
    typeof value.content === 'string' &&
    Array.isArray(value.embeds) &&
    value.embeds.every(isRecord) &&
    Array.isArray(value.attachments) &&
    value.attachments.every(isAttachment) &&
    isHttpUrl(value.canonicalUrl) &&
    typeof value.timestamp === 'string' &&
    Boolean(value.timestamp) &&
    isOptionalString(value.editedTimestamp) &&
    (value.remoteState === undefined ||
      (typeof value.remoteState === 'string' && MESSAGE_REMOTE_STATES.has(value.remoteState))) &&
    isOptionalFiniteNumber(value.lastRemoteCheckedAt) &&
    typeof value.capturedAt === 'number' &&
    Number.isFinite(value.capturedAt) &&
    typeof value.updatedAt === 'number' &&
    Number.isFinite(value.updatedAt)
  )
}

function isRevision(value: unknown, sourceId: string): value is CommunitySourceRevision {
  if (!isRecord(value) || !isRecord(value.source)) return false
  if (
    typeof value.id !== 'string' ||
    !value.id ||
    typeof value.createdAt !== 'number' ||
    !Number.isFinite(value.createdAt) ||
    !isHttpUrl(value.source.canonicalUrl) ||
    !isOptionalString(value.source.title) ||
    !isOptionalString(value.source.starterMessageId) ||
    !isOptionalString(value.source.starterAuthorId) ||
    !isOptionalString(value.source.starterAuthorName) ||
    !isStringArray(value.source.forumTags) ||
    typeof value.source.updatedAt !== 'number' ||
    !Number.isFinite(value.source.updatedAt) ||
    !Array.isArray(value.messages) ||
    !value.messages.every(isCommunitySourceMessage)
  ) {
    return false
  }

  const messages = value.messages as CommunitySourceMessage[]
  if (messages.some((message) => message.sourceId !== sourceId)) return false
  const ids = new Set(messages.map((message) => message.id))
  const keyHashes = new Set(messages.map((message) => message.messageKeyHash))
  return ids.size === messages.length && keyHashes.size === messages.length
}

function isCommunitySource(value: unknown): value is CommunitySource {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    !value.id ||
    value.platform !== COMMUNITY_SOURCE_PLATFORM.DISCORD ||
    typeof value.sourceKeyHash !== 'string' ||
    !SHA256_PATTERN.test(value.sourceKeyHash) ||
    !isOptionalString(value.guildId) ||
    !isOptionalString(value.guildName) ||
    typeof value.channelId !== 'string' ||
    !value.channelId ||
    !isOptionalString(value.channelName) ||
    !isOptionalString(value.threadId) ||
    !isOptionalString(value.starterMessageId) ||
    !isHttpUrl(value.canonicalUrl) ||
    !isOptionalString(value.title) ||
    !isOptionalString(value.starterAuthorId) ||
    !isOptionalString(value.starterAuthorName) ||
    !isStringArray(value.forumTags) ||
    !isOptionalNonNegativeInteger(value.messageCount) ||
    !isOptionalNonNegativeInteger(value.missingMessageCount) ||
    !isOptionalString(value.latestMessagePreview) ||
    (value.remoteState !== undefined &&
      (typeof value.remoteState !== 'string' || !REMOTE_STATES.has(value.remoteState))) ||
    (value.discordRefreshMode !== undefined &&
      (typeof value.discordRefreshMode !== 'string' ||
        !REFRESH_MODES.has(value.discordRefreshMode))) ||
    (value.hasRemoteUpdate !== undefined && typeof value.hasRemoteUpdate !== 'boolean') ||
    !isOptionalFiniteNumber(value.lastCheckedAt) ||
    (value.remoteScanCursor !== undefined && !isRemoteScanCursor(value.remoteScanCursor)) ||
    !isOptionalSnowflake(value.savedMessageCheckCursor) ||
    (value.ignoredRemoteMessageIds !== undefined &&
      !isStringArray(value.ignoredRemoteMessageIds)) ||
    typeof value.createdAt !== 'number' ||
    !Number.isFinite(value.createdAt) ||
    typeof value.updatedAt !== 'number' ||
    !Number.isFinite(value.updatedAt)
  ) {
    return false
  }

  if (value.revisions !== undefined) {
    if (!Array.isArray(value.revisions)) return false
    const sourceId = value.id
    const revisions = value.revisions as unknown[]
    if (!revisions.every((revision) => isRevision(revision, sourceId))) return false
    const revisionIds = new Set(
      revisions.map((revision) => (revision as CommunitySourceRevision).id),
    )
    if (revisionIds.size !== revisions.length) return false
  }

  return true
}

function isResourceSourceBinding(value: unknown): value is ResourceSourceBinding {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    Boolean(value.id) &&
    typeof value.resourceId === 'string' &&
    Boolean(value.resourceId) &&
    typeof value.sourceId === 'string' &&
    Boolean(value.sourceId) &&
    isOptionalString(value.note) &&
    typeof value.createdAt === 'number' &&
    Number.isFinite(value.createdAt)
  )
}

export function parseCommunitySourceBackupData(value: unknown): CommunitySourceBackupData {
  if (!isRecord(value) || value.version !== 1) throw new Error('社区来源备份版本无效')
  if (!Array.isArray(value.sources) || !value.sources.every(isCommunitySource)) {
    throw new Error('社区来源清单无效')
  }
  if (!Array.isArray(value.messages) || !value.messages.every(isCommunitySourceMessage)) {
    throw new Error('社区来源消息清单无效')
  }
  if (!Array.isArray(value.bindings) || !value.bindings.every(isResourceSourceBinding)) {
    throw new Error('社区来源绑定清单无效')
  }

  const sources = value.sources as CommunitySource[]
  const messages = value.messages as CommunitySourceMessage[]
  const bindings = value.bindings as ResourceSourceBinding[]
  const sourceIds = new Set(sources.map((source) => source.id))
  const sourceKeyHashes = new Set(sources.map((source) => source.sourceKeyHash))
  const messageIds = new Set(messages.map((message) => message.id))
  const messageKeyHashes = new Set(
    messages.map((message) => `${message.sourceId}:${message.messageKeyHash}`),
  )
  const bindingIds = new Set(bindings.map((binding) => binding.id))
  if (sourceIds.size !== sources.length || sourceKeyHashes.size !== sources.length) {
    throw new Error('社区来源备份存在重复来源')
  }
  if (messageIds.size !== messages.length || messageKeyHashes.size !== messages.length) {
    throw new Error('社区来源备份存在重复消息')
  }
  if (bindingIds.size !== bindings.length) throw new Error('社区来源备份存在重复绑定')
  if (messages.some((message) => !sourceIds.has(message.sourceId))) {
    throw new Error('社区来源消息引用了不存在的来源')
  }
  if (bindings.some((binding) => !sourceIds.has(binding.sourceId))) {
    throw new Error('社区来源绑定引用了不存在的来源')
  }

  return structuredClone({ version: 1, sources, messages, bindings })
}

export function remapCommunitySourceBackupBindings(
  data: CommunitySourceBackupData,
  resourceIdMap: ReadonlyMap<string, string>,
): CommunitySourceBackupData {
  const bindings = data.bindings.flatMap((binding) => {
    const resourceId = resourceIdMap.get(binding.resourceId)
    if (!resourceId) return []
    return [
      {
        ...binding,
        id: createResourceSourceBindingId(resourceId, binding.sourceId),
        resourceId,
      },
    ]
  })
  return {
    version: 1,
    sources: structuredClone(data.sources),
    messages: structuredClone(data.messages),
    bindings,
  }
}
