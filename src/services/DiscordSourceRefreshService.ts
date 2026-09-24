import {
  COMMUNITY_SOURCE_MESSAGE_REMOTE_STATE,
  type CommunitySourceMessage,
  type DiscordAttachmentMeta,
  type DiscordCapture,
  type DiscordSourceRemoteScanCursor,
  type ResourceCommunitySourceView,
} from '../types/CommunitySource'
import { parseDiscordCapture } from './DiscordHandoffService'
import { loadDiscordSourceConnectionSettings } from './DiscordSourceSettingsService'

const MAX_SAVED_MESSAGE_HEALTH_IDS = 12
const DISCORD_SNOWFLAKE_PATTERN = /^\d{5,32}$/u

export type DiscordSourceRefreshChangeType = 'new' | 'changed' | 'missing' | 'restored'

export interface DiscordSourceRefreshChange {
  messageId: string
  type: DiscordSourceRefreshChangeType
  authorName: string
  authorBot: boolean
  summary: string
  contentChanged?: boolean
  embedsChanged?: boolean
  attachmentsChanged?: boolean
}

export interface DiscordSourceRefreshDiff {
  hasChanges: boolean
  newMessages: number
  changedMessages: number
  missingMessages: number
  restoredMessages: number
  contentChanges: number
  embedChanges: number
  attachmentChanges: number
  sourceMetadataChanges: number
  changes: DiscordSourceRefreshChange[]
}

export interface DiscordSourceRefreshSyncState {
  remoteScanCursor?: DiscordSourceRemoteScanCursor
  savedMessageCheckCursor?: string
}

export type DiscordSourceUncheckableReason = 'bot_access' | 'forbidden' | 'read_failed'
export type DiscordSourceReadStage = 'channel' | 'starter' | 'messages' | 'saved_messages'

export interface DiscordSourceUncheckableResult {
  state: 'uncheckable'
  reason: DiscordSourceUncheckableReason
  stage: DiscordSourceReadStage
}

export type DiscordSourceRemoteReadResult =
  | {
      state: 'available'
      captures: DiscordCapture[]
      missingMessageIds: string[]
      diff: DiscordSourceRefreshDiff
      syncState: DiscordSourceRefreshSyncState
      rateLimited: boolean
      retryAfterMs?: number
    }
  | {
      state: 'unavailable'
      reason: 'not_found'
      stage: 'channel' | 'starter'
    }
  | DiscordSourceUncheckableResult

export type DiscordSourceInitialReadResult =
  | { state: 'available'; captures: DiscordCapture[]; missingMessageIds: string[] }
  | { state: 'unavailable'; reason: 'not_found'; stage: 'channel' | 'starter' }
  | DiscordSourceUncheckableResult

export interface DiscordMessageUrlParts {
  guildId?: string
  channelId: string
  messageId: string
}

interface SourceReadResponse {
  state?: unknown
  reason?: unknown
  stage?: unknown
  captures?: unknown
  missingMessageIds?: unknown
  scanCursor?: unknown
}

interface SourceReadRequest {
  guildId?: string
  channelId: string
  threadId?: string
  starterMessageId?: string
  savedMessageIds: string[]
  scanMessageIds?: string[]
  scanCursor?: DiscordSourceRemoteScanCursor
}

interface SourceReadAvailable {
  state: 'available'
  captures: DiscordCapture[]
  missingMessageIds: string[]
  scanCursor?: DiscordSourceRemoteScanCursor
}

type SourceReadResult =
  | SourceReadAvailable
  | { state: 'unavailable'; reason: 'not_found'; stage: 'channel' | 'starter' }
  | DiscordSourceUncheckableResult

interface SavedMessageCheckResponse {
  state?: unknown
  reason?: unknown
  stage?: unknown
  captures?: unknown
  missingMessageIds?: unknown
  checkedMessageIds?: unknown
  rateLimited?: unknown
  retryAfterMs?: unknown
}

type SavedMessageCheckResult =
  | {
      state: 'available'
      captures: DiscordCapture[]
      missingMessageIds: string[]
      checkedMessageIds: string[]
      rateLimited: boolean
      retryAfterMs?: number
    }
  | DiscordSourceUncheckableResult

function stableJson(value: unknown): string {
  return JSON.stringify(value)
}

function attachmentSignature(attachment: DiscordAttachmentMeta): string {
  return stableJson({
    id: attachment.id,
    name: attachment.name,
    size: attachment.size,
    contentType: attachment.contentType ?? '',
    width: attachment.width ?? null,
    height: attachment.height ?? null,
  })
}

function attachmentsSignature(attachments: readonly DiscordAttachmentMeta[]): string {
  return attachments.map(attachmentSignature).sort().join('\n')
}

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  const a = Array.from(new Set(left)).sort()
  const b = Array.from(new Set(right)).sort()
  return stableJson(a) === stableJson(b)
}

function preview(value: string): string {
  const normalized = value.replace(/\s+/gu, ' ').trim()
  if (!normalized) return '无正文'
  return normalized.length > 100 ? `${normalized.slice(0, 100)}…` : normalized
}

function relevantCaptures(
  view: ResourceCommunitySourceView,
  captures: readonly DiscordCapture[],
): DiscordCapture[] {
  const existingIds = new Set(view.messages.map((message) => message.messageId))
  const ignoredIds = new Set(view.source.ignoredRemoteMessageIds ?? [])
  const starterAuthorId =
    view.source.starterAuthorId ??
    captures.find(
      (capture) =>
        capture.isStarter ||
        Boolean(view.source.starterMessageId && capture.messageId === view.source.starterMessageId),
    )?.authorId
  const seen = new Set<string>()
  return captures.filter((capture) => {
    if (seen.has(capture.messageId)) return false
    const relevant =
      existingIds.has(capture.messageId) ||
      capture.isStarter === true ||
      capture.messageId === view.source.starterMessageId ||
      (!ignoredIds.has(capture.messageId) &&
        (Boolean(starterAuthorId && capture.authorId === starterAuthorId) ||
          capture.authorBot === true))
    if (relevant) seen.add(capture.messageId)
    return relevant
  })
}

function messageChanged(
  existing: CommunitySourceMessage,
  capture: DiscordCapture,
): {
  changed: boolean
  content: boolean
  embeds: boolean
  attachments: boolean
} {
  const content =
    existing.content !== capture.content ||
    existing.authorName !== capture.authorName ||
    Boolean(existing.authorBot) !== Boolean(capture.authorBot) ||
    existing.timestamp !== capture.timestamp ||
    (existing.editedTimestamp ?? '') !== (capture.editedTimestamp ?? '')
  const embeds = stableJson(existing.embeds) !== stableJson(capture.embeds ?? [])
  const attachments =
    attachmentsSignature(existing.attachments) !== attachmentsSignature(capture.attachments ?? [])
  return { changed: content || embeds || attachments, content, embeds, attachments }
}

function normalizeMessageIds(value: unknown, maxItems = 64): string[] {
  if (!Array.isArray(value)) return []
  return Array.from(
    new Set(
      value
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter((item) => DISCORD_SNOWFLAKE_PATTERN.test(item)),
    ),
  ).slice(0, maxItems)
}

function normalizeRemoteScanCursor(value: unknown): DiscordSourceRemoteScanCursor | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const readSnowflake = (key: string) => {
    const candidate = typeof record[key] === 'string' ? record[key].trim() : ''
    return DISCORD_SNOWFLAKE_PATTERN.test(candidate) ? candidate : undefined
  }
  const lastSeenMessageId = readSnowflake('lastSeenMessageId')
  const pendingBeforeMessageId = readSnowflake('pendingBeforeMessageId')
  const pendingHighWaterMessageId = readSnowflake('pendingHighWaterMessageId')
  if (!lastSeenMessageId && !pendingBeforeMessageId && !pendingHighWaterMessageId) return undefined
  if (pendingBeforeMessageId || pendingHighWaterMessageId) {
    if (!lastSeenMessageId || !pendingBeforeMessageId || !pendingHighWaterMessageId) {
      return lastSeenMessageId ? { lastSeenMessageId } : undefined
    }
    return { lastSeenMessageId, pendingBeforeMessageId, pendingHighWaterMessageId }
  }
  return lastSeenMessageId ? { lastSeenMessageId } : undefined
}

function inferMissingRequestedIds(
  requestedIds: readonly string[],
  captures: readonly DiscordCapture[],
  bridgeMissingIds: readonly string[],
): string[] {
  const returned = new Set(captures.map((capture) => capture.messageId))
  return Array.from(
    new Set([
      ...bridgeMissingIds.filter((messageId) => !returned.has(messageId)),
      ...requestedIds.filter((messageId) => !returned.has(messageId)),
    ]),
  )
}

function normalizeSourceReadStage(value: unknown): DiscordSourceReadStage | undefined {
  return value === 'channel' ||
    value === 'starter' ||
    value === 'messages' ||
    value === 'saved_messages'
    ? value
    : undefined
}

function normalizeUncheckableReason(value: unknown): DiscordSourceUncheckableReason {
  if (value === 'bot_access' || value === 'forbidden') return value
  return 'read_failed'
}

function normalizeSourceReadPayload(payload: SourceReadResponse): SourceReadResult {
  const stage = normalizeSourceReadStage(payload.stage)
  if (payload.state === 'uncheckable') {
    return {
      state: 'uncheckable',
      reason: normalizeUncheckableReason(payload.reason),
      stage: stage ?? 'channel',
    }
  }
  if (payload.state === 'unavailable') {
    if (payload.reason === 'not_found' && (stage === 'channel' || stage === 'starter')) {
      return { state: 'unavailable', reason: 'not_found', stage }
    }
    // 旧 Bridge 没有失败阶段，且会把 Bot 无权限的 403/404 误写为来源不存在。
    // Fail closed 为不可检查，避免客户端继续持久化假删除状态。
    return {
      state: 'uncheckable',
      reason: payload.reason === 'forbidden' ? 'forbidden' : 'read_failed',
      stage: stage ?? 'channel',
    }
  }
  if (payload.state !== 'available' || !Array.isArray(payload.captures)) {
    throw new Error('Discord Bridge 返回了无法识别的来源数据。')
  }
  return {
    state: 'available',
    captures: payload.captures.map(parseDiscordCapture),
    missingMessageIds: normalizeMessageIds(payload.missingMessageIds, 24),
    scanCursor: normalizeRemoteScanCursor(payload.scanCursor),
  }
}

function normalizeSavedMessageCheckPayload(
  payload: SavedMessageCheckResponse,
): SavedMessageCheckResult {
  if (payload.state === 'uncheckable' || payload.state === 'unavailable') {
    return {
      state: 'uncheckable',
      reason: normalizeUncheckableReason(payload.reason),
      stage: normalizeSourceReadStage(payload.stage) ?? 'saved_messages',
    }
  }
  if (payload.state !== 'available' || !Array.isArray(payload.captures)) {
    throw new Error('Discord Bridge 返回了无法识别的消息检查数据。')
  }
  const retryAfterMs =
    typeof payload.retryAfterMs === 'number' && Number.isFinite(payload.retryAfterMs)
      ? Math.max(0, payload.retryAfterMs)
      : undefined
  return {
    state: 'available',
    captures: payload.captures.map(parseDiscordCapture),
    missingMessageIds: normalizeMessageIds(payload.missingMessageIds, MAX_SAVED_MESSAGE_HEALTH_IDS),
    checkedMessageIds: normalizeMessageIds(payload.checkedMessageIds, MAX_SAVED_MESSAGE_HEALTH_IDS),
    rateLimited: payload.rateLimited === true,
    retryAfterMs,
  }
}

async function postBridgeJson(
  path: string,
  body: unknown,
  signal?: AbortSignal,
): Promise<Response> {
  const settings = loadDiscordSourceConnectionSettings()
  if (!settings.workerBaseUrl || !settings.botToken) {
    throw new Error('请先在来源高级设置中配置并连接你自己的 Discord Bridge。')
  }

  const response = await fetch(`${settings.workerBaseUrl}${path}`, {
    method: 'POST',
    cache: 'no-store',
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
    headers: {
      Authorization: `Bearer ${settings.botToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal,
  })
  if (response.status === 401) {
    throw new Error('Discord Bridge 拒绝了检查请求，请重新保存 Bot Token。')
  }
  if (response.status === 429) {
    throw new Error('Discord 暂时触发限流，请稍后再次检查；本地保存内容不受影响。')
  }
  if (response.status === 404) {
    throw new Error('当前 Discord Bridge 版本还不支持新的来源检查，请先更新并重新部署 Bridge。')
  }
  if (!response.ok) throw new Error(`检查 Discord 来源失败（HTTP ${response.status}）`)
  return response
}

async function postSourceRead(
  body: SourceReadRequest,
  signal?: AbortSignal,
): Promise<SourceReadResult> {
  const response = await postBridgeJson('/source/read', body, signal)
  return normalizeSourceReadPayload((await response.json()) as SourceReadResponse)
}

function compareSnowflakes(left: string, right: string): number {
  const a = BigInt(left)
  const b = BigInt(right)
  return a < b ? -1 : a > b ? 1 : 0
}

function latestSavedMessageId(view: ResourceCommunitySourceView): string | undefined {
  return view.messages
    .map((message) => message.messageId)
    .filter((messageId) => DISCORD_SNOWFLAKE_PATTERN.test(messageId))
    .sort(compareSnowflakes)
    .at(-1)
}

function activeRemoteScanCursor(
  view: ResourceCommunitySourceView,
): DiscordSourceRemoteScanCursor | undefined {
  // revision restore 会清 lastCheckedAt；这种情况下忽略旧 checkpoint，按恢复后的本地消息重新 bootstrap。
  if (view.source.lastCheckedAt !== undefined) {
    const stored = normalizeRemoteScanCursor(view.source.remoteScanCursor)
    if (stored) return stored
  }
  const lastSeenMessageId = latestSavedMessageId(view)
  return lastSeenMessageId ? { lastSeenMessageId } : undefined
}

async function postSavedMessageCheck(
  view: ResourceCommunitySourceView,
  messageIds: readonly string[],
  signal?: AbortSignal,
): Promise<SavedMessageCheckResult> {
  const response = await postBridgeJson(
    '/source/messages/check',
    {
      guildId: view.source.guildId,
      channelId: view.source.channelId,
      threadId: view.source.threadId,
      starterMessageId: view.source.starterMessageId,
      messageIds,
    },
    signal,
  )
  return normalizeSavedMessageCheckPayload((await response.json()) as SavedMessageCheckResponse)
}

function mergeCaptures(...groups: readonly DiscordCapture[][]): DiscordCapture[] {
  const byId = new Map<string, DiscordCapture>()
  for (const group of groups) {
    for (const capture of group) byId.set(capture.messageId, capture)
  }
  return [...byId.values()].sort((left, right) => {
    const leftTime = Date.parse(left.timestamp)
    const rightTime = Date.parse(right.timestamp)
    if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) {
      return leftTime - rightTime
    }
    return BigInt(left.messageId) < BigInt(right.messageId) ? -1 : 1
  })
}

export function selectDiscordSavedMessageHealthCheckIds(
  view: ResourceCommunitySourceView,
  alreadyVerifiedMessageIds: readonly string[],
): string[] {
  const verified = new Set(alreadyVerifiedMessageIds)
  const candidates = view.messages
    .map((message) => message.messageId)
    .filter((messageId) => DISCORD_SNOWFLAKE_PATTERN.test(messageId) && !verified.has(messageId))
    .sort(compareSnowflakes)
  if (!candidates.length) return []

  const storedCursor =
    view.source.lastCheckedAt !== undefined &&
    DISCORD_SNOWFLAKE_PATTERN.test(view.source.savedMessageCheckCursor ?? '')
      ? view.source.savedMessageCheckCursor
      : undefined
  const start = storedCursor
    ? candidates.findIndex((messageId) => compareSnowflakes(messageId, storedCursor) > 0)
    : 0
  const ordered =
    start > 0 ? [...candidates.slice(start), ...candidates.slice(0, start)] : candidates
  return ordered.slice(0, MAX_SAVED_MESSAGE_HEALTH_IDS)
}

export function parseDiscordMessageUrl(value: string): DiscordMessageUrlParts | undefined {
  let url: URL
  try {
    url = new URL(value.trim())
  } catch {
    return undefined
  }
  if (
    !['discord.com', 'www.discord.com', 'ptb.discord.com', 'canary.discord.com'].includes(
      url.hostname,
    )
  ) {
    return undefined
  }
  const match = /^\/channels\/([^/]+)\/(\d+)\/(\d+)\/?$/u.exec(url.pathname)
  if (!match) return undefined
  const guildPart = match[1]
  const channelId = match[2]
  const messageId = match[3]
  if (!channelId || !messageId) return undefined
  return {
    ...(guildPart && guildPart !== '@me' ? { guildId: guildPart } : {}),
    channelId,
    messageId,
  }
}

export function compareDiscordSourceRefresh(
  view: ResourceCommunitySourceView,
  capturesInput: readonly DiscordCapture[],
  missingMessageIdsInput: readonly string[] = [],
): { captures: DiscordCapture[]; missingMessageIds: string[]; diff: DiscordSourceRefreshDiff } {
  const captures = relevantCaptures(view, capturesInput)
  const existingById = new Map(view.messages.map((message) => [message.messageId, message]))
  const missingSet = new Set(
    missingMessageIdsInput.filter((messageId) => existingById.has(messageId)),
  )
  let newMessages = 0
  let changedMessages = 0
  let missingMessages = 0
  let restoredMessages = 0
  let contentChanges = 0
  let embedChanges = 0
  let attachmentChanges = 0
  const changes: DiscordSourceRefreshChange[] = []

  for (const capture of captures) {
    const existing = existingById.get(capture.messageId)
    if (!existing) {
      newMessages += 1
      changes.push({
        messageId: capture.messageId,
        type: 'new',
        authorName: capture.authorName,
        authorBot: capture.authorBot === true,
        summary: preview(capture.content),
      })
      continue
    }
    if (existing.remoteState === COMMUNITY_SOURCE_MESSAGE_REMOTE_STATE.MISSING) {
      restoredMessages += 1
      changes.push({
        messageId: capture.messageId,
        type: 'restored',
        authorName: capture.authorName,
        authorBot: capture.authorBot === true,
        summary: preview(capture.content),
      })
    }
    const changed = messageChanged(existing, capture)
    if (changed.changed) {
      changedMessages += 1
      changes.push({
        messageId: capture.messageId,
        type: 'changed',
        authorName: capture.authorName,
        authorBot: capture.authorBot === true,
        summary: preview(capture.content),
        contentChanged: changed.content,
        embedsChanged: changed.embeds,
        attachmentsChanged: changed.attachments,
      })
    }
    if (changed.content) contentChanges += 1
    if (changed.embeds) embedChanges += 1
    if (changed.attachments) attachmentChanges += 1
  }

  for (const messageId of missingSet) {
    const existing = existingById.get(messageId)
    if (!existing || existing.remoteState === COMMUNITY_SOURCE_MESSAGE_REMOTE_STATE.MISSING)
      continue
    missingMessages += 1
    changes.push({
      messageId,
      type: 'missing',
      authorName: existing.authorName,
      authorBot: existing.authorBot === true,
      summary: preview(existing.content),
    })
  }

  const starter = captures.find(
    (capture) =>
      capture.isStarter ||
      Boolean(view.source.starterMessageId && capture.messageId === view.source.starterMessageId),
  )
  const metadata = starter ?? captures[0]
  let sourceMetadataChanges = 0
  if (starter?.title && starter.title !== view.source.title) sourceMetadataChanges += 1
  if (starter?.forumTags && !sameStringSet(starter.forumTags, view.source.forumTags)) {
    sourceMetadataChanges += 1
  }
  if (metadata?.guildName && metadata.guildName !== view.source.guildName) {
    sourceMetadataChanges += 1
  }
  if (metadata?.channelName && metadata.channelName !== view.source.channelName) {
    sourceMetadataChanges += 1
  }

  const diff: DiscordSourceRefreshDiff = {
    hasChanges:
      newMessages > 0 ||
      changedMessages > 0 ||
      missingMessages > 0 ||
      restoredMessages > 0 ||
      sourceMetadataChanges > 0,
    newMessages,
    changedMessages,
    missingMessages,
    restoredMessages,
    contentChanges,
    embedChanges,
    attachmentChanges,
    sourceMetadataChanges,
    changes,
  }
  return { captures, missingMessageIds: [...missingSet], diff }
}

export async function readDiscordSourceRemote(
  view: ResourceCommunitySourceView,
  signal?: AbortSignal,
): Promise<DiscordSourceRemoteReadResult> {
  const healthMessageIds = selectDiscordSavedMessageHealthCheckIds(view, [])
  const sourceRemote = await postSourceRead(
    {
      guildId: view.source.guildId,
      channelId: view.source.channelId,
      threadId: view.source.threadId,
      starterMessageId: view.source.starterMessageId,
      savedMessageIds: [],
      scanMessageIds: healthMessageIds,
      scanCursor: activeRemoteScanCursor(view),
    },
    signal,
  )
  if (sourceRemote.state !== 'available') return sourceRemote

  const sourceVerified = new Set(sourceRemote.captures.map((capture) => capture.messageId))
  const pendingHealthMessageIds = healthMessageIds.filter(
    (messageId) => !sourceVerified.has(messageId),
  )
  const healthRemote = pendingHealthMessageIds.length
    ? await postSavedMessageCheck(view, pendingHealthMessageIds, signal)
    : ({
        state: 'available',
        captures: [],
        missingMessageIds: [],
        checkedMessageIds: [],
        rateLimited: false,
      } satisfies SavedMessageCheckResult)
  if (healthRemote.state !== 'available') return healthRemote

  const checked = new Set([
    ...healthRemote.checkedMessageIds,
    ...healthMessageIds.filter((messageId) => sourceVerified.has(messageId)),
  ])
  let lastContiguousCheckedMessageId: string | undefined
  for (const messageId of healthMessageIds) {
    if (!checked.has(messageId)) break
    lastContiguousCheckedMessageId = messageId
  }
  const captures = mergeCaptures(sourceRemote.captures, healthRemote.captures)
  const missingMessageIds = Array.from(new Set(healthRemote.missingMessageIds))
  const compared = compareDiscordSourceRefresh(view, captures, missingMessageIds)

  return {
    state: 'available',
    ...compared,
    syncState: {
      remoteScanCursor: sourceRemote.scanCursor,
      savedMessageCheckCursor:
        lastContiguousCheckedMessageId ?? view.source.savedMessageCheckCursor,
    },
    rateLimited: healthRemote.rateLimited,
    ...(healthRemote.retryAfterMs !== undefined ? { retryAfterMs: healthRemote.retryAfterMs } : {}),
  }
}

export async function readDiscordSourceFromUrl(
  value: string,
  signal?: AbortSignal,
): Promise<DiscordSourceInitialReadResult> {
  const parsed = parseDiscordMessageUrl(value)
  if (!parsed) throw new Error('请输入完整的 Discord 消息链接。')
  const remote = await postSourceRead(
    {
      guildId: parsed.guildId,
      channelId: parsed.channelId,
      // 不把用户点中的 reply 冒充首楼。Worker 读取 channel 后会优先识别真实 thread id。
      savedMessageIds: [parsed.messageId],
    },
    signal,
  )
  if (remote.state !== 'available') return remote
  const missingMessageIds = inferMissingRequestedIds(
    [parsed.messageId],
    remote.captures,
    remote.missingMessageIds,
  )
  if (missingMessageIds.includes(parsed.messageId)) {
    throw new Error(
      '你粘贴的这条 Discord 消息已经删除或不可访问，无法保存这条消息。若要保存整个帖子，请改用仍可访问的首楼链接。',
    )
  }
  return {
    state: 'available',
    captures: remote.captures,
    missingMessageIds,
  }
}
