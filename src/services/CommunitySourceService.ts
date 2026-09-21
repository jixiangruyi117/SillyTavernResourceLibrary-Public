import type { CommunitySourceStorage } from '../storage/CommunitySourceStorage'
import {
  COMMUNITY_SOURCE_ATTACHMENT_LOCAL_STATE,
  COMMUNITY_SOURCE_MESSAGE_KIND,
  COMMUNITY_SOURCE_MESSAGE_REMOTE_STATE,
  COMMUNITY_SOURCE_PLATFORM,
  COMMUNITY_SOURCE_REFRESH_MODE,
  COMMUNITY_SOURCE_REMOTE_STATE,
  createCommunitySourceId,
  createCommunitySourceMessageId,
  createDiscordSourceKey,
  createResourceSourceBindingId,
  toCommunitySourceSummary,
  type CommunitySource,
  type CommunitySourceBackupData,
  type CommunitySourceMessage,
  type CommunitySourceMessageKind,
  type CommunitySourceRemoteState,
  type CommunitySourceSummary,
  type DiscordAttachmentMeta,
  type DiscordCapture,
  type DiscordSourceRemoteScanCursor,
  type ResourceCommunitySourceSummary,
  type ResourceCommunitySourceView,
  type ResourceSourceBinding,
} from '../types/CommunitySource'
import {
  clean,
  normalizeStringList,
  normalizeMessageIds,
  safeHttpUrl,
  normalizeAttachments,
  hashIdentity,
  messageKeyHash,
  normalizeCapture,
  makeRevision,
  attachmentIdentityMatches,
  withMessageSummary,
  sourceSummaryMatches,
} from './CommunitySourceCapture'

const AUTO_LOCAL_ATTACHMENT_BYTES = 8 * 1024 * 1024

const MAX_MANUAL_LOCAL_ATTACHMENT_BYTES = 64 * 1024 * 1024

const ATTACHMENT_DOWNLOAD_TIMEOUT_MS = 15_000

const MAX_IGNORED_REMOTE_MESSAGE_IDS = 128

type DiscordRefreshSyncState = {
  remoteScanCursor?: DiscordSourceRemoteScanCursor
  savedMessageCheckCursor?: string
}

type CommunitySourceAssetStore = {
  put(
    blob: Blob,
    options: {
      source: 'remote'
      remoteUrl?: string
      vaultProtected?: boolean
    },
  ): Promise<{ assetId: string }>
  getBlob(assetId: string): Promise<Blob | undefined>
}

export class CommunitySourceService {
  private readonly storage: CommunitySourceStorage
  private readonly assetStore?: CommunitySourceAssetStore

  constructor(storage: CommunitySourceStorage, assetStore?: CommunitySourceAssetStore) {
    this.storage = storage
    this.assetStore = assetStore
  }

  private async getSourceSummary(sourceId: string): Promise<CommunitySourceSummary | undefined> {
    if (this.storage.getSourceSummary) return this.storage.getSourceSummary(sourceId)
    const source = await this.storage.getSource(sourceId)
    return source ? toCommunitySourceSummary(source) : undefined
  }

  async listSummariesForResource(resourceId: string): Promise<ResourceCommunitySourceSummary[]> {
    const bindings = await this.storage.listBindingsForResource(resourceId)
    const summaries = await Promise.all(
      bindings.map(async (binding) => {
        const source = await this.getSourceSummary(binding.sourceId)
        return source ? { source, binding } : undefined
      }),
    )
    return summaries
      .flatMap((summary) => (summary ? [summary] : []))
      .sort((left, right) => right.source.updatedAt - left.source.updatedAt)
  }

  async getForResource(
    resourceId: string,
    sourceId: string,
  ): Promise<ResourceCommunitySourceView | undefined> {
    const binding = (await this.storage.listBindingsForResource(resourceId)).find(
      (candidate) => candidate.sourceId === sourceId,
    )
    if (!binding) return undefined
    const source = await this.storage.getSource(sourceId)
    if (!source) return undefined
    const messages = await this.storage.listMessages(sourceId)
    const summarized = withMessageSummary(source, messages)
    if (!sourceSummaryMatches(source, messages)) await this.storage.putSource(summarized)
    return { source: summarized, messages, binding }
  }

  /** 兼容其它调用方；高频来源目录必须使用 listSummariesForResource。 */
  async listForResource(resourceId: string): Promise<ResourceCommunitySourceView[]> {
    const summaries = await this.listSummariesForResource(resourceId)
    const views: ResourceCommunitySourceView[] = []
    for (const summary of summaries) {
      const view = await this.getForResource(resourceId, summary.source.id)
      if (view) views.push(view)
    }
    return views
  }

  async listPendingSources(
    limit = 30,
  ): Promise<Array<{ source: CommunitySource; messages: CommunitySourceMessage[] }>> {
    const sources = await this.storage.listUnboundSources(limit)
    const views: Array<{ source: CommunitySource; messages: CommunitySourceMessage[] }> = []
    for (const source of sources) {
      views.push({ source, messages: await this.storage.listMessages(source.id) })
    }
    return views
  }

  async findDiscordSourceForCapture(captureInput: DiscordCapture): Promise<
    | {
        source: CommunitySource
        messages: CommunitySourceMessage[]
        bindings: ResourceSourceBinding[]
      }
    | undefined
  > {
    const capture = normalizeCapture(captureInput)
    const sourceKeyHash = await hashIdentity(createDiscordSourceKey(capture))
    const source = await this.storage.getSourceByKeyHash(sourceKeyHash)
    if (!source) return undefined
    const [messages, bindings] = await Promise.all([
      this.storage.listMessages(source.id),
      this.storage.listBindingsForSource(source.id),
    ])
    return { source, messages, bindings }
  }

  async getSourceUsage(sourceId: string): Promise<ResourceSourceBinding[]> {
    return this.storage.listBindingsForSource(sourceId)
  }

  async getAttachmentBlob(assetId: string): Promise<Blob | undefined> {
    return this.assetStore?.getBlob(assetId)
  }

  async saveDiscordCapture(
    captureInput: DiscordCapture,
    options: {
      resourceId?: string
      kind?: CommunitySourceMessageKind
      note?: string
      /** 首次整帖读取可先落正文，再在后台串行缓存附件。 */
      deferAttachmentLocalization?: boolean
    } = {},
  ): Promise<ResourceCommunitySourceView> {
    const capture = normalizeCapture(captureInput)
    const sourceKeyHash = await hashIdentity(createDiscordSourceKey(capture))
    const now = Date.now()
    let source = await this.storage.getSourceByKeyHash(sourceKeyHash)

    if (!source) {
      source = {
        id: createCommunitySourceId(),
        platform: COMMUNITY_SOURCE_PLATFORM.DISCORD,
        sourceKeyHash,
        guildId: capture.guildId,
        guildName: capture.guildName,
        channelId: capture.channelId,
        channelName: capture.channelName,
        threadId: capture.threadId,
        starterMessageId:
          capture.isStarter || capture.starterMessageId
            ? (capture.starterMessageId ?? capture.messageId)
            : undefined,
        canonicalUrl: capture.canonicalUrl,
        title: capture.title,
        starterAuthorId: capture.isStarter ? capture.authorId : undefined,
        starterAuthorName: capture.isStarter ? capture.authorName : undefined,
        forumTags: normalizeStringList(capture.forumTags),
        createdAt: now,
        updatedAt: now,
      }
    } else {
      source = {
        ...source,
        guildId: source.guildId ?? capture.guildId,
        guildName: capture.guildName ?? source.guildName,
        channelId: source.channelId || capture.channelId,
        channelName: capture.channelName ?? source.channelName,
        threadId: source.threadId ?? capture.threadId,
        canonicalUrl: capture.isStarter ? capture.canonicalUrl : source.canonicalUrl,
        title: capture.title ?? source.title,
        forumTags: normalizeStringList([...source.forumTags, ...(capture.forumTags ?? [])]),
        ignoredRemoteMessageIds: normalizeMessageIds(
          (source.ignoredRemoteMessageIds ?? []).filter(
            (messageId) => messageId !== capture.messageId,
          ),
          MAX_IGNORED_REMOTE_MESSAGE_IDS,
        ),
        updatedAt: now,
      }
      if (capture.isStarter) {
        source.starterMessageId = capture.messageId
        source.starterAuthorId = capture.authorId
        source.starterAuthorName = capture.authorName
      } else if (!source.starterMessageId && capture.starterMessageId) {
        source.starterMessageId = capture.starterMessageId
      }
    }

    const sourceId = source.id
    await this.storage.putSource(source)

    const keyHash = await messageKeyHash(sourceId, capture.messageId)
    const existingMessage = await this.storage.getMessage(sourceId, keyHash)
    const inferredKind: CommunitySourceMessageKind =
      options.kind ??
      (capture.isStarter || capture.messageId === source.starterMessageId
        ? COMMUNITY_SOURCE_MESSAGE_KIND.STARTER
        : source.starterAuthorId && capture.authorId === source.starterAuthorId
          ? COMMUNITY_SOURCE_MESSAGE_KIND.AUTHOR_UPDATE
          : COMMUNITY_SOURCE_MESSAGE_KIND.SELECTED_COMMENT)
    const attachments = options.deferAttachmentLocalization
      ? this.prepareDeferredAttachments(
          capture.attachments ?? [],
          existingMessage?.attachments ?? [],
        )
      : await this.localizeAttachments(
          capture.attachments ?? [],
          existingMessage?.attachments ?? [],
          AUTO_LOCAL_ATTACHMENT_BYTES,
        )
    const message: CommunitySourceMessage = {
      id: createCommunitySourceMessageId(sourceId, keyHash),
      sourceId,
      messageKeyHash: keyHash,
      messageId: capture.messageId,
      kind: options.kind ?? existingMessage?.kind ?? inferredKind,
      authorId: capture.authorId,
      authorName: capture.authorName,
      authorBot: capture.authorBot === true,
      content: capture.content,
      embeds: structuredClone(capture.embeds ?? []),
      attachments,
      canonicalUrl: capture.canonicalUrl,
      timestamp: capture.timestamp,
      editedTimestamp: capture.editedTimestamp,
      remoteState: existingMessage?.remoteState,
      lastRemoteCheckedAt: existingMessage?.lastRemoteCheckedAt,
      capturedAt: existingMessage?.capturedAt ?? now,
      updatedAt: now,
    }
    await this.storage.putMessage(message)

    let binding: ResourceSourceBinding
    if (options.resourceId) {
      const existingBinding = (await this.storage.listBindingsForResource(options.resourceId)).find(
        (candidate) => candidate.sourceId === sourceId,
      )
      binding =
        existingBinding ??
        ({
          id: createResourceSourceBindingId(options.resourceId, sourceId),
          resourceId: options.resourceId,
          sourceId,
          note: clean(options.note, 2_000),
          createdAt: now,
        } satisfies ResourceSourceBinding)
      if (!existingBinding) await this.storage.putBinding(binding)
    } else {
      binding = {
        id: '',
        resourceId: '',
        sourceId,
        createdAt: now,
      }
    }

    const messages = await this.storage.listMessages(sourceId)
    source = withMessageSummary(source, messages)
    await this.storage.putSource(source)
    return { source, messages, binding }
  }

  async localizeSavedMessageAttachments(sourceId: string, messageId: string): Promise<void> {
    if (!this.assetStore) return
    const keyHash = await messageKeyHash(sourceId, messageId)
    const message = await this.storage.getMessage(sourceId, keyHash)
    if (!message?.attachments.length) return
    const attachments = await this.localizeAttachments(
      message.attachments,
      message.attachments,
      AUTO_LOCAL_ATTACHMENT_BYTES,
    )
    await this.storage.putMessage({ ...message, attachments, updatedAt: Date.now() })
  }

  async localizeSavedMessagesAttachments(
    sourceId: string,
    messageIds: readonly string[],
  ): Promise<void> {
    // 跨消息也串行，避免多个 8 MB 附件在移动端同时 response.blob()。
    for (const messageId of Array.from(new Set(messageIds))) {
      await this.localizeSavedMessageAttachments(sourceId, messageId)
    }
  }

  async bindSource(resourceId: string, sourceId: string, note?: string): Promise<void> {
    const source = await this.storage.getSource(sourceId)
    if (!source) throw new Error('社区来源不存在')
    const existing = (await this.storage.listBindingsForResource(resourceId)).some(
      (binding) => binding.sourceId === sourceId,
    )
    if (existing) return
    await this.storage.putBinding({
      id: createResourceSourceBindingId(resourceId, sourceId),
      resourceId,
      sourceId,
      note: clean(note, 2_000),
      createdAt: Date.now(),
    })
  }

  async unbindSource(resourceId: string, sourceId: string): Promise<void> {
    await this.storage.deleteBinding(createResourceSourceBindingId(resourceId, sourceId))
  }

  async setMessageKind(
    sourceId: string,
    messageId: string,
    kind: CommunitySourceMessageKind,
  ): Promise<CommunitySourceMessage> {
    const keyHash = await messageKeyHash(sourceId, messageId)
    const message = await this.storage.getMessage(sourceId, keyHash)
    if (!message) throw new Error('已保存的 Discord 消息不存在')
    const updated = { ...message, kind, updatedAt: Date.now() }
    await this.storage.putMessage(updated)
    return updated
  }

  async recordRemoteCheck(
    sourceId: string,
    state: CommunitySourceRemoteState,
    hasRemoteUpdate = false,
    syncState?: DiscordRefreshSyncState,
  ): Promise<CommunitySource> {
    const source = await this.storage.getSource(sourceId)
    if (!source) throw new Error('社区来源不存在')
    const updated: CommunitySource = {
      ...source,
      remoteState: state,
      hasRemoteUpdate: state === COMMUNITY_SOURCE_REMOTE_STATE.AVAILABLE && hasRemoteUpdate,
      lastCheckedAt: Date.now(),
      ...(syncState ?? {}),
    }
    delete updated.discordRefreshMode
    await this.storage.putSource(updated)
    return updated
  }

  async clearRemoteAvailability(sourceId: string): Promise<CommunitySource> {
    const source = await this.storage.getSource(sourceId)
    if (!source) throw new Error('社区来源不存在')
    const updated = { ...source }
    delete updated.remoteState
    delete updated.hasRemoteUpdate
    await this.storage.putSource(updated)
    return updated
  }

  async recordManualRefresh(sourceId: string): Promise<CommunitySource> {
    const source = await this.storage.getSource(sourceId)
    if (!source) throw new Error('社区来源不存在')
    const updated: CommunitySource = {
      ...source,
      discordRefreshMode: COMMUNITY_SOURCE_REFRESH_MODE.MANUAL,
    }
    delete updated.remoteState
    delete updated.hasRemoteUpdate
    await this.storage.putSource(updated)
    return updated
  }

  async recordMessageRemoteCheck(
    sourceId: string,
    presentMessageIds: readonly string[],
    missingMessageIds: readonly string[],
  ): Promise<void> {
    const present = new Set(presentMessageIds)
    const missing = new Set(missingMessageIds)
    const now = Date.now()
    const messages = await this.storage.listMessages(sourceId)
    for (const message of messages) {
      const nextState = missing.has(message.messageId)
        ? COMMUNITY_SOURCE_MESSAGE_REMOTE_STATE.MISSING
        : present.has(message.messageId)
          ? COMMUNITY_SOURCE_MESSAGE_REMOTE_STATE.AVAILABLE
          : undefined
      if (!nextState || (message.remoteState === nextState && message.lastRemoteCheckedAt)) continue
      await this.storage.putMessage({
        ...message,
        remoteState: nextState,
        lastRemoteCheckedAt: now,
        updatedAt: now,
      })
    }
  }

  async ignoreRemoteMessages(
    sourceId: string,
    messageIds: readonly string[],
    syncState?: DiscordRefreshSyncState,
  ): Promise<CommunitySource> {
    const source = await this.storage.getSource(sourceId)
    if (!source) throw new Error('社区来源不存在')
    const ignoredRemoteMessageIds = normalizeMessageIds(
      [...(source.ignoredRemoteMessageIds ?? []), ...messageIds],
      MAX_IGNORED_REMOTE_MESSAGE_IDS,
    )
    const updated: CommunitySource = {
      ...source,
      hasRemoteUpdate: false,
      ignoredRemoteMessageIds,
      ...(syncState ?? {}),
      updatedAt: Date.now(),
    }
    await this.storage.putSource(updated)
    return updated
  }

  async applyDiscordRefresh(
    sourceId: string,
    captureInputs: readonly DiscordCapture[],
    options: {
      keepPrevious: boolean
      includeNewMessageIds?: readonly string[]
      missingMessageIds?: readonly string[]
      syncState?: DiscordRefreshSyncState
    },
  ): Promise<{ source: CommunitySource; messages: CommunitySourceMessage[] }> {
    const source = await this.storage.getSource(sourceId)
    if (!source) throw new Error('社区来源不存在')
    const currentMessages = await this.storage.listMessages(sourceId)
    const existingByMessageId = new Map(
      currentMessages.map((message) => [message.messageId, message]),
    )

    const verified: DiscordCapture[] = []
    const seenMessageIds = new Set<string>()
    for (const input of captureInputs) {
      const capture = normalizeCapture(input)
      if (seenMessageIds.has(capture.messageId)) continue
      const captureSourceKeyHash = await hashIdentity(createDiscordSourceKey(capture))
      if (captureSourceKeyHash !== source.sourceKeyHash) continue
      seenMessageIds.add(capture.messageId)
      verified.push(capture)
    }
    if (!verified.length && !(options.missingMessageIds?.length ?? 0)) {
      throw new Error('没有可用于更新的 Discord 内容')
    }

    const starterCapture = verified.find(
      (capture) =>
        capture.isStarter ||
        (source.starterMessageId && capture.messageId === source.starterMessageId),
    )
    const metadataCapture = starterCapture ?? verified[0]
    const starterAuthorId = source.starterAuthorId ?? starterCapture?.authorId
    const ignoredIds = new Set(source.ignoredRemoteMessageIds ?? [])

    const relevant = verified.filter((capture) => {
      if (existingByMessageId.has(capture.messageId)) return true
      if (capture.isStarter || capture.messageId === source.starterMessageId) return true
      if (ignoredIds.has(capture.messageId)) return false
      if (starterAuthorId && capture.authorId === starterAuthorId) return true
      return capture.authorBot === true
    })
    const candidateNewIds = relevant
      .filter((capture) => !existingByMessageId.has(capture.messageId))
      .map((capture) => capture.messageId)
    const selectedNewIds = new Set(options.includeNewMessageIds ?? candidateNewIds)
    const declinedNewIds = candidateNewIds.filter((messageId) => !selectedNewIds.has(messageId))
    const appliedCaptures = relevant.filter(
      (capture) =>
        existingByMessageId.has(capture.messageId) || selectedNewIds.has(capture.messageId),
    )
    if (
      !appliedCaptures.length &&
      !(options.missingMessageIds?.length ?? 0) &&
      !declinedNewIds.length
    ) {
      throw new Error('没有选择要保存的 Discord 更新')
    }

    const now = Date.now()
    const revisions = options.keepPrevious ? structuredClone(source.revisions ?? []) : []
    if (options.keepPrevious) revisions.push(makeRevision(source, currentMessages, now))
    const nextIgnoredIds = new Set(source.ignoredRemoteMessageIds ?? [])
    for (const messageId of selectedNewIds) nextIgnoredIds.delete(messageId)
    for (const messageId of declinedNewIds) nextIgnoredIds.add(messageId)

    let updatedSource: CommunitySource = {
      ...source,
      guildName: metadataCapture?.guildName ?? source.guildName,
      channelName: metadataCapture?.channelName ?? source.channelName,
      remoteState: COMMUNITY_SOURCE_REMOTE_STATE.AVAILABLE,
      hasRemoteUpdate: false,
      lastCheckedAt: now,
      ignoredRemoteMessageIds: normalizeMessageIds(
        [...nextIgnoredIds],
        MAX_IGNORED_REMOTE_MESSAGE_IDS,
      ),
      ...(options.syncState ?? {}),
      revisions,
      updatedAt: now,
    }
    delete updatedSource.discordRefreshMode

    if (starterCapture) {
      updatedSource = {
        ...updatedSource,
        canonicalUrl: starterCapture.canonicalUrl,
        title: starterCapture.title ?? updatedSource.title,
        starterMessageId: starterCapture.messageId,
        starterAuthorId: starterCapture.authorId,
        starterAuthorName: starterCapture.authorName,
        forumTags: normalizeStringList([
          ...updatedSource.forumTags,
          ...(starterCapture.forumTags ?? []),
        ]),
      }
    }

    const refreshedMessages: CommunitySourceMessage[] = []
    for (const capture of appliedCaptures) {
      const existing = existingByMessageId.get(capture.messageId)
      const keyHash = await messageKeyHash(sourceId, capture.messageId)
      const inferredKind: CommunitySourceMessageKind =
        capture.isStarter || capture.messageId === updatedSource.starterMessageId
          ? COMMUNITY_SOURCE_MESSAGE_KIND.STARTER
          : updatedSource.starterAuthorId && capture.authorId === updatedSource.starterAuthorId
            ? COMMUNITY_SOURCE_MESSAGE_KIND.AUTHOR_UPDATE
            : COMMUNITY_SOURCE_MESSAGE_KIND.SELECTED_COMMENT
      refreshedMessages.push({
        id: createCommunitySourceMessageId(sourceId, keyHash),
        sourceId,
        messageKeyHash: keyHash,
        messageId: capture.messageId,
        kind: existing?.kind ?? inferredKind,
        authorId: capture.authorId,
        authorName: capture.authorName,
        authorBot: capture.authorBot === true,
        content: capture.content,
        embeds: structuredClone(capture.embeds ?? []),
        attachments: await this.localizeAttachments(
          capture.attachments ?? [],
          existing?.attachments ?? [],
          AUTO_LOCAL_ATTACHMENT_BYTES,
        ),
        canonicalUrl: capture.canonicalUrl,
        timestamp: capture.timestamp,
        editedTimestamp: capture.editedTimestamp,
        remoteState: COMMUNITY_SOURCE_MESSAGE_REMOTE_STATE.AVAILABLE,
        lastRemoteCheckedAt: now,
        capturedAt: existing?.capturedAt ?? now,
        updatedAt: now,
      })
    }

    const missingIds = new Set(options.missingMessageIds ?? [])
    for (const message of currentMessages) {
      if (!missingIds.has(message.messageId)) continue
      refreshedMessages.push({
        ...message,
        remoteState: COMMUNITY_SOURCE_MESSAGE_REMOTE_STATE.MISSING,
        lastRemoteCheckedAt: now,
        updatedAt: now,
      })
    }

    if (this.storage.putSourceWithMessages) {
      await this.storage.putSourceWithMessages(updatedSource, refreshedMessages)
    } else {
      await this.storage.putSource(updatedSource)
      for (const message of refreshedMessages) await this.storage.putMessage(message)
    }

    const finalMessages = await this.storage.listMessages(sourceId)
    updatedSource = withMessageSummary(updatedSource, finalMessages)
    await this.storage.putSource(updatedSource)
    return { source: updatedSource, messages: finalMessages }
  }

  async restoreRevision(
    sourceId: string,
    revisionId: string,
  ): Promise<{ source: CommunitySource; messages: CommunitySourceMessage[] }> {
    const source = await this.storage.getSource(sourceId)
    if (!source) throw new Error('社区来源不存在')
    const target = source.revisions?.find((revision) => revision.id === revisionId)
    if (!target) throw new Error('历史版本不存在')
    const currentMessages = await this.storage.listMessages(sourceId)
    const now = Date.now()
    const rollbackRevision = makeRevision(source, currentMessages, now)
    let restoredSource: CommunitySource = {
      ...source,
      canonicalUrl: target.source.canonicalUrl,
      title: target.source.title,
      starterMessageId: target.source.starterMessageId ?? source.starterMessageId,
      starterAuthorId: target.source.starterAuthorId,
      starterAuthorName: target.source.starterAuthorName,
      forumTags: structuredClone(target.source.forumTags),
      remoteState: undefined,
      hasRemoteUpdate: false,
      lastCheckedAt: undefined,
      remoteScanCursor: undefined,
      savedMessageCheckCursor: undefined,
      revisions: [...(source.revisions ?? []), rollbackRevision],
      updatedAt: now,
    }
    const restoredMessages = target.messages.map((message) => ({
      ...structuredClone(message),
      sourceId,
      remoteState: undefined,
      lastRemoteCheckedAt: undefined,
      updatedAt: now,
    }))
    restoredSource = withMessageSummary(restoredSource, restoredMessages)

    if (this.storage.replaceSourceWithMessages) {
      await this.storage.replaceSourceWithMessages(restoredSource, restoredMessages)
    } else {
      const existing = await this.storage.listMessages(sourceId)
      await this.storage.putSource(restoredSource)
      for (const message of existing) await this.storage.deleteMessage(message.id)
      for (const message of restoredMessages) await this.storage.putMessage(message)
    }
    return { source: restoredSource, messages: restoredMessages }
  }

  async saveAttachmentToLocal(
    sourceId: string,
    messageId: string,
    attachmentId: string,
  ): Promise<CommunitySourceMessage> {
    if (!this.assetStore) throw new Error('当前环境没有可用的本地附件存储')
    const keyHash = await messageKeyHash(sourceId, messageId)
    const message = await this.storage.getMessage(sourceId, keyHash)
    if (!message) throw new Error('已保存的 Discord 消息不存在')
    const index = message.attachments.findIndex((attachment) => attachment.id === attachmentId)
    if (index < 0) throw new Error('Discord 附件不存在')
    const target = message.attachments[index]
    const [localized] = await this.localizeAttachments(
      [target],
      [],
      MAX_MANUAL_LOCAL_ATTACHMENT_BYTES,
      true,
    )
    const attachments = [...message.attachments]
    if (localized) attachments[index] = localized
    const updated = { ...message, attachments, updatedAt: Date.now() }
    await this.storage.putMessage(updated)
    if (!localized?.localAssetId) {
      if (target.size > MAX_MANUAL_LOCAL_ATTACHMENT_BYTES) {
        throw new Error('附件超过 64 MB，为避免移动端内存峰值暂不支持直接缓存到本机')
      }
      throw new Error('附件保存到本机失败，请检查网络后重试')
    }
    return updated
  }

  async deleteSavedMessage(
    sourceId: string,
    messageId: string,
    mode: 'message-only' | 'entire-source' = 'message-only',
  ): Promise<void> {
    if (mode === 'entire-source') {
      await this.deleteSource(sourceId)
      return
    }
    const keyHash = await messageKeyHash(sourceId, messageId)
    const message = await this.storage.getMessage(sourceId, keyHash)
    if (!message) return

    const messages = await this.storage.listMessages(sourceId)
    if (messages.length <= 1) {
      const bindings = await this.storage.listBindingsForSource(sourceId)
      if (bindings.length) {
        throw new Error(
          '这是这个 Discord 来源最后一条本地内容，请使用“来源管理”解除关联或永久删除来源。',
        )
      }
      await this.storage.deleteSource(sourceId)
      return
    }

    await this.storage.deleteMessage(message.id)
    const source = await this.storage.getSource(sourceId)
    if (source) {
      await this.storage.putSource(
        withMessageSummary(
          source,
          messages.filter((candidate) => candidate.id !== message.id),
        ),
      )
    }
  }

  async deleteSource(sourceId: string, options: { force?: boolean } = {}): Promise<void> {
    const bindings = await this.storage.listBindingsForSource(sourceId)
    if (bindings.length && options.force !== true) {
      throw new Error(
        `这个 Discord 来源仍被 ${bindings.length} 个资源使用，请先解除关联或确认永久删除。`,
      )
    }
    await this.storage.deleteSource(sourceId)
  }

  exportAll(): Promise<CommunitySourceBackupData> {
    return this.storage.exportAll()
  }

  restoreBackup(data: CommunitySourceBackupData, mode: 'merge' | 'replace'): Promise<void> {
    return mode === 'replace' ? this.storage.replaceAll(data) : this.storage.mergeAll(data)
  }

  replaceAll(data: CommunitySourceBackupData): Promise<void> {
    return this.storage.replaceAll(data)
  }

  private prepareDeferredAttachments(
    remoteAttachments: readonly DiscordAttachmentMeta[],
    existingAttachments: readonly DiscordAttachmentMeta[],
  ): DiscordAttachmentMeta[] {
    const normalized = normalizeAttachments([...remoteAttachments])
    const existingById = new Map(
      existingAttachments.map((attachment) => [attachment.id, attachment]),
    )
    return normalized.map((attachment) => {
      const previous = existingById.get(attachment.id)
      if (previous?.localAssetId && attachmentIdentityMatches(previous, attachment)) {
        return {
          ...attachment,
          localAssetId: previous.localAssetId,
          localState: COMMUNITY_SOURCE_ATTACHMENT_LOCAL_STATE.LOCAL,
        }
      }
      return { ...attachment, localState: COMMUNITY_SOURCE_ATTACHMENT_LOCAL_STATE.REMOTE_ONLY }
    })
  }

  private async localizeAttachments(
    remoteAttachments: readonly DiscordAttachmentMeta[],
    existingAttachments: readonly DiscordAttachmentMeta[],
    maxBytes: number,
    force = false,
  ): Promise<DiscordAttachmentMeta[]> {
    const normalized = normalizeAttachments([...remoteAttachments])
    if (!this.assetStore) return normalized
    const existingById = new Map(
      existingAttachments.map((attachment) => [attachment.id, attachment]),
    )
    const result: DiscordAttachmentMeta[] = []

    // 串行下载：Discord 单条消息可能有多个接近 8 MB 的附件；并发 response.blob() 会在移动端
    // 叠加峰值内存。这里宁愿略慢，也不同时把多份二进制驻留内存。
    for (const attachment of normalized) {
      const previous = existingById.get(attachment.id)
      if (previous?.localAssetId && attachmentIdentityMatches(previous, attachment)) {
        result.push({
          ...attachment,
          localAssetId: previous.localAssetId,
          localState: COMMUNITY_SOURCE_ATTACHMENT_LOCAL_STATE.LOCAL,
        })
        continue
      }
      if (attachment.size > maxBytes) {
        result.push({
          ...attachment,
          localState: force
            ? COMMUNITY_SOURCE_ATTACHMENT_LOCAL_STATE.FAILED
            : COMMUNITY_SOURCE_ATTACHMENT_LOCAL_STATE.REMOTE_ONLY,
        })
        continue
      }
      try {
        const blob = await this.downloadAttachment(attachment, maxBytes)
        const asset = await this.assetStore.put(blob, {
          source: 'remote',
          remoteUrl: attachment.url,
          vaultProtected: true,
        })
        result.push({
          ...attachment,
          localAssetId: asset.assetId,
          localState: COMMUNITY_SOURCE_ATTACHMENT_LOCAL_STATE.LOCAL,
        })
      } catch {
        if (previous?.localAssetId) {
          result.push({
            ...attachment,
            localAssetId: previous.localAssetId,
            localState: COMMUNITY_SOURCE_ATTACHMENT_LOCAL_STATE.LOCAL,
          })
        } else {
          result.push({
            ...attachment,
            localState: force
              ? COMMUNITY_SOURCE_ATTACHMENT_LOCAL_STATE.FAILED
              : COMMUNITY_SOURCE_ATTACHMENT_LOCAL_STATE.REMOTE_ONLY,
          })
        }
      }
    }
    return result
  }

  private async downloadAttachment(
    attachment: DiscordAttachmentMeta,
    maxBytes: number,
  ): Promise<Blob> {
    const candidates = [safeHttpUrl(attachment.url), safeHttpUrl(attachment.proxyUrl)].filter(
      (value, index, values): value is string => Boolean(value) && values.indexOf(value) === index,
    )
    if (!candidates.length) throw new Error('Discord 附件链接无效')
    if (attachment.size > maxBytes) throw new Error('Discord 附件超过本次本地保存限制')

    let lastError: unknown
    for (const remoteUrl of candidates) {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), ATTACHMENT_DOWNLOAD_TIMEOUT_MS)
      try {
        const response = await fetch(remoteUrl, {
          method: 'GET',
          cache: 'no-store',
          credentials: 'omit',
          referrerPolicy: 'no-referrer',
          signal: controller.signal,
        })
        if (!response.ok) throw new Error(`Discord 附件读取失败（HTTP ${response.status}）`)
        const contentLength = Number(response.headers.get('content-length'))
        if (Number.isFinite(contentLength) && contentLength > maxBytes) {
          throw new Error('Discord 附件超过本次本地保存限制')
        }
        const blob = await response.blob()
        if (blob.size > maxBytes) throw new Error('Discord 附件超过本次本地保存限制')
        return blob.type || !attachment.contentType
          ? blob
          : new Blob([blob], { type: attachment.contentType })
      } catch (error) {
        lastError = error
      } finally {
        clearTimeout(timer)
      }
    }
    throw lastError instanceof Error ? lastError : new Error('Discord 附件读取失败')
  }
}
