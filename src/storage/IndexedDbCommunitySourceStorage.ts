import type { AppDatabase } from '../database/AppDatabase'
import Dexie from 'dexie'

import {
  decodeCommunitySource,
  decodeCommunitySourceMessage,
  decodeCommunitySourceSummary,
  decodeResourceSourceBinding,
  encodeCommunitySource,
  encodeCommunitySourceMessage,
  encodeResourceSourceBinding,
  type CommunitySourceJsonVaultCodec,
} from '../services/CommunitySourceVaultCodec'
import type { VaultService } from '../services/VaultService'
import {
  isEncryptedCommunitySource,
  isEncryptedCommunitySourceMessage,
  isEncryptedResourceSourceBinding,
  toCommunitySourceSummary,
  type CommunitySource,
  type CommunitySourceBackupData,
  type CommunitySourceMessage,
  type CommunitySourceSummary,
  type ResourceSourceBinding,
  type StoredCommunitySource,
  type StoredCommunitySourceMessage,
  type StoredResourceSourceBinding,
} from '../types/CommunitySource'
import { isEncryptedResourceSummary, type EncryptedValue } from '../types/Vault'
import type { CommunitySourceStorage } from './CommunitySourceStorage'
import { isResourceGalleryImage } from '../types/ResourceGallery'
import {
  collectCommunitySourceLocalAssetIds,
  sanitizeCommunitySourceAttachmentRefs,
} from '../services/CommunitySourceAttachmentArchive'
import { isAndroidNativeAppDatabaseActive, runAndroidNativeRead } from './AndroidNativeDexieCore'
import {
  decodeAppDatabaseValue,
  encodeAppDatabaseKey,
  isEncodedBlobValue,
} from './AndroidAppDatabaseMigration'
import { nativeAppDatabase } from './NativeAppDatabaseBridge'
import type { StoredResourceSummary } from '../types/Vault'

const MIGRATION_BATCH_SIZE = 24

type CommunityVaultMode = 'plain' | 'encrypted'

function clone<T>(value: T): T {
  return structuredClone(value)
}

export class IndexedDbCommunitySourceStorage implements CommunitySourceStorage {
  private readonly database: AppDatabase
  private readonly vault: VaultService
  private readonly codec: CommunitySourceJsonVaultCodec

  constructor(database: AppDatabase, vault: VaultService) {
    this.database = database
    this.vault = vault
    this.codec = {
      protectJson: async (value: unknown): Promise<EncryptedValue> =>
        this.vault.protectBlob(
          new Blob([JSON.stringify(value)], { type: 'application/json;charset=utf-8' }),
        ),
      revealJson: async <T>(value: EncryptedValue): Promise<T> => {
        const blob = await this.vault.revealBlob(value, 'application/json;charset=utf-8')
        return JSON.parse(await blob.text()) as T
      },
    }
  }

  private async encodeSource(source: CommunitySource): Promise<StoredCommunitySource> {
    return this.vault.isEnabled() ? encodeCommunitySource(source, this.codec) : clone(source)
  }

  private async encodeMessage(
    message: CommunitySourceMessage,
  ): Promise<StoredCommunitySourceMessage> {
    return this.vault.isEnabled()
      ? encodeCommunitySourceMessage(message, this.codec)
      : clone(message)
  }

  private async encodeBinding(
    binding: ResourceSourceBinding,
  ): Promise<StoredResourceSourceBinding> {
    return this.vault.isEnabled()
      ? encodeResourceSourceBinding(binding, this.codec)
      : clone(binding)
  }

  async getSource(id: string): Promise<CommunitySource | undefined> {
    const source = await this.database.communitySources.get(id)
    return source ? decodeCommunitySource(source, this.codec) : undefined
  }

  async getSourceSummary(id: string): Promise<CommunitySourceSummary | undefined> {
    const stored = await this.database.communitySources.get(id)
    if (!stored) return undefined
    if (isEncryptedCommunitySource(stored) && !stored.summaryPayload) {
      // 旧 Vault 记录没有小摘要：只在首次目录读取时解密一次完整 source，随后原位补齐。
      const source = await decodeCommunitySource(stored, this.codec)
      await this.database.communitySources.put(await encodeCommunitySource(source, this.codec))
      return toCommunitySourceSummary(source)
    }
    return decodeCommunitySourceSummary(stored, this.codec)
  }

  async getSourceByKeyHash(sourceKeyHash: string): Promise<CommunitySource | undefined> {
    const source = await this.database.communitySources
      .where('sourceKeyHash')
      .equals(sourceKeyHash)
      .first()
    return source ? decodeCommunitySource(source, this.codec) : undefined
  }

  async putSource(source: CommunitySource): Promise<void> {
    await this.database.communitySources.put(await this.encodeSource(source))
  }

  async putSourceWithMessages(
    source: CommunitySource,
    messages: readonly CommunitySourceMessage[],
  ): Promise<void> {
    const storedSource = await this.encodeSource(source)
    const storedMessages: StoredCommunitySourceMessage[] = []
    for (const message of messages) storedMessages.push(await this.encodeMessage(message))
    await this.database.transaction(
      'rw',
      this.database.communitySources,
      this.database.communitySourceMessages,
      async () => {
        await this.database.communitySources.put(storedSource)
        if (storedMessages.length)
          await this.database.communitySourceMessages.bulkPut(storedMessages)
      },
    )
  }

  async replaceSourceWithMessages(
    source: CommunitySource,
    messages: readonly CommunitySourceMessage[],
  ): Promise<void> {
    const storedSource = await this.encodeSource(source)
    const storedMessages: StoredCommunitySourceMessage[] = []
    for (const message of messages) storedMessages.push(await this.encodeMessage(message))
    await this.database.transaction(
      'rw',
      this.database.communitySources,
      this.database.communitySourceMessages,
      async () => {
        const existingIds = await this.database.communitySourceMessages
          .where('sourceId')
          .equals(source.id)
          .primaryKeys()
        if (existingIds.length) await this.database.communitySourceMessages.bulkDelete(existingIds)
        await this.database.communitySources.put(storedSource)
        if (storedMessages.length)
          await this.database.communitySourceMessages.bulkPut(storedMessages)
      },
    )
  }

  async deleteSource(id: string): Promise<void> {
    await this.database.transaction(
      'rw',
      this.database.communitySources,
      this.database.communitySourceMessages,
      this.database.resourceSourceBindings,
      async () => {
        const [messages, bindings] = await Promise.all([
          this.database.communitySourceMessages.where('sourceId').equals(id).primaryKeys(),
          this.database.resourceSourceBindings.where('sourceId').equals(id).primaryKeys(),
        ])
        if (messages.length) await this.database.communitySourceMessages.bulkDelete(messages)
        if (bindings.length) await this.database.resourceSourceBindings.bulkDelete(bindings)
        await this.database.communitySources.delete(id)
      },
    )
  }

  async listUnboundSources(limit = 30): Promise<CommunitySource[]> {
    const requested = Math.min(100, Math.max(1, Math.round(limit)))
    const pageSize = Math.min(32, Math.max(12, requested))
    const result: CommunitySource[] = []
    let offset = 0

    while (result.length < requested) {
      const batch = await this.database.communitySources
        .orderBy('updatedAt')
        .reverse()
        .offset(offset)
        .limit(pageSize)
        .toArray()
      if (!batch.length) break
      offset += batch.length

      for (const stored of batch) {
        const binding = await this.database.resourceSourceBindings
          .where('sourceId')
          .equals(stored.id)
          .first()
        if (binding) continue
        result.push(await decodeCommunitySource(stored, this.codec))
        if (result.length >= requested) break
      }
      if (batch.length < pageSize) break
    }

    return result
  }

  async countUnboundSources(): Promise<number> {
    const sourceKeys = await this.database.communitySources.toCollection().primaryKeys()
    const unboundSourceIds = new Set(
      sourceKeys.filter((key): key is string => typeof key === 'string'),
    )
    const bindingSourceKeys = await this.database.resourceSourceBindings.orderBy('sourceId').keys()
    for (const key of bindingSourceKeys) {
      if (typeof key === 'string') unboundSourceIds.delete(key)
    }
    return unboundSourceIds.size
  }

  async listMessages(sourceId: string): Promise<CommunitySourceMessage[]> {
    const messages = await this.database.communitySourceMessages
      .where('sourceId')
      .equals(sourceId)
      .sortBy('capturedAt')
    const decoded: CommunitySourceMessage[] = []
    for (const message of messages)
      decoded.push(await decodeCommunitySourceMessage(message, this.codec))
    return decoded
  }

  async getStarterMessage(sourceId: string): Promise<CommunitySourceMessage | undefined> {
    const message = await this.database.communitySourceMessages
      .where('[sourceId+kind]')
      .equals([sourceId, 'starter'])
      .first()
    return message ? decodeCommunitySourceMessage(message, this.codec) : undefined
  }

  async getMessage(
    sourceId: string,
    messageKeyHash: string,
  ): Promise<CommunitySourceMessage | undefined> {
    const message = await this.database.communitySourceMessages
      .where('[sourceId+messageKeyHash]')
      .equals([sourceId, messageKeyHash])
      .first()
    return message ? decodeCommunitySourceMessage(message, this.codec) : undefined
  }

  async putMessage(message: CommunitySourceMessage): Promise<void> {
    await this.database.communitySourceMessages.put(await this.encodeMessage(message))
  }

  async deleteMessage(id: string): Promise<void> {
    await this.database.communitySourceMessages.delete(id)
  }

  async listBindingsForResource(resourceId: string): Promise<ResourceSourceBinding[]> {
    const bindings = await this.database.resourceSourceBindings
      .where('resourceId')
      .equals(resourceId)
      .sortBy('createdAt')
    const decoded: ResourceSourceBinding[] = []
    for (const binding of bindings)
      decoded.push(await decodeResourceSourceBinding(binding, this.codec))
    return decoded
  }

  async listBoundResourceIds(): Promise<string[]> {
    // Safari/WebKit can reject `nextunique` cursors with `Unable to open cursor`.
    // Read the ordinary index keys and deduplicate in memory instead.
    const keys = await this.database.resourceSourceBindings.orderBy('resourceId').keys()
    return [...new Set(keys.filter((key): key is string => typeof key === 'string'))]
  }

  async listBindingsForSource(sourceId: string): Promise<ResourceSourceBinding[]> {
    const bindings = await this.database.resourceSourceBindings
      .where('sourceId')
      .equals(sourceId)
      .sortBy('createdAt')
    const decoded: ResourceSourceBinding[] = []
    for (const binding of bindings)
      decoded.push(await decodeResourceSourceBinding(binding, this.codec))
    return decoded
  }

  async listRecentAutoBindings(limit = 100): Promise<ResourceSourceBinding[]> {
    const requested = Math.min(200, Math.max(1, Math.round(limit)))
    // Only inspect a bounded recent window; manual bindings are filtered after decode.
    const recent = await this.database.resourceSourceBindings
      .orderBy('createdAt')
      .reverse()
      .limit(Math.min(500, requested * 5))
      .toArray()
    const decoded: ResourceSourceBinding[] = []
    for (const binding of recent) {
      const value = await decodeResourceSourceBinding(binding, this.codec)
      if (value.autoBindingRule) decoded.push(value)
      if (decoded.length >= requested) break
    }
    return decoded
  }

  async putBinding(binding: ResourceSourceBinding): Promise<void> {
    await this.database.resourceSourceBindings.put(await this.encodeBinding(binding))
  }

  async putSourceWithBinding(
    source: CommunitySource,
    binding: ResourceSourceBinding,
  ): Promise<void> {
    const storedSource = await this.encodeSource(source)
    const storedBinding = await this.encodeBinding(binding)
    await this.database.transaction(
      'rw',
      this.database.communitySources,
      this.database.resourceSourceBindings,
      async () => {
        await this.database.communitySources.put(storedSource)
        await this.database.resourceSourceBindings.put(storedBinding)
      },
    )
  }

  async deleteBinding(id: string): Promise<void> {
    await this.database.resourceSourceBindings.delete(id)
  }

  async repairInvalidResourceBindings(
    validResourceIds: ReadonlySet<string>,
    galleryVersions: ReadonlyMap<string, number>,
  ): Promise<number> {
    if (this.vault.getStatus().locked) throw new Error('请先解锁保险库，再恢复待整理来源')
    return this.database.transaction(
      'rw',
      this.database.resourceSourceBindings,
      this.database.resources,
      this.database.resourceSummaries,
      async () => {
        const table = this.database.resourceSourceBindings
        // Keep this on a regular cursor direction for Safari/WebKit compatibility.
        const resourceIds = [
          ...new Set(
            (await table.orderBy('resourceId').keys()).filter(
              (key): key is string => typeof key === 'string',
            ),
          ),
        ]
        let removed = 0
        for (const resourceId of resourceIds) {
          if (typeof resourceId !== 'string' || validResourceIds.has(resourceId)) continue
          const exists = await this.database.resources.where('id').equals(resourceId).count()
          if (exists) {
            // A restored/new resource or changed gallery target invalidates the old snapshot.
            const expectedVersion = galleryVersions.get(resourceId)
            const current = await this.database.resourceSummaries.get(resourceId)
            if (expectedVersion === undefined || !current || current.updatedAt !== expectedVersion)
              continue
            const decoded = isEncryptedResourceSummary(current)
              ? await Dexie.waitFor(this.vault.decodeResourceSummary(current))
              : current
            if (!isResourceGalleryImage(decoded)) continue
          }
          if (this.vault.getStatus().locked) throw new Error('保险库已锁定，关联修复尚未完成')
          removed += await table.where('resourceId').equals(resourceId).delete()
        }
        return removed
      },
    )
  }

  async exportAll(): Promise<CommunitySourceBackupData> {
    const [storedSources, storedMessages, storedBindings] = await Promise.all([
      this.database.communitySources.toArray(),
      this.database.communitySourceMessages.toArray(),
      this.database.resourceSourceBindings.toArray(),
    ])
    const sources: CommunitySource[] = []
    const messages: CommunitySourceMessage[] = []
    const bindings: ResourceSourceBinding[] = []
    for (const source of storedSources)
      sources.push(await decodeCommunitySource(source, this.codec))
    for (const message of storedMessages)
      messages.push(await decodeCommunitySourceMessage(message, this.codec))
    for (const binding of storedBindings)
      bindings.push(await decodeResourceSourceBinding(binding, this.codec))
    return { version: 1, sources, messages, bindings }
  }

  private mediaIds(data: CommunitySourceBackupData): Set<string> {
    const ids = new Set<string>()
    const messages = [
      ...data.messages,
      ...data.sources.flatMap((source) =>
        (source.revisions ?? []).flatMap((revision) => revision.messages),
      ),
    ]
    for (const message of messages)
      for (const attachment of message.attachments) {
        if (
          attachment.localAssetId &&
          (/^(image|audio|video)\//iu.test(attachment.contentType ?? '') ||
            /\.(png|jpe?g|webp|gif|avif|bmp|svg|mp4|webm|mov|mp3|wav|ogg|m4a|flac)$/iu.test(
              attachment.name,
            ))
        )
          ids.add(attachment.localAssetId)
      }
    return ids
  }

  async downloadedMediaUsage(): Promise<{ count: number; bytes: number }> {
    const ids = this.mediaIds(await this.exportAll())
    let bytes = 0
    for (const id of ids) bytes += (await this.database.assets.get(id))?.size ?? 0
    return { count: ids.size, bytes }
  }

  async clearDownloadedMedia(): Promise<{ count: number; bytes: number; retainedCount: number }> {
    // A single transaction rechecks every reference and publishes remote-only posts together
    // with file removal. Failed decoding or a concurrent native write aborts the whole cleanup.
    return this.database.transaction('rw', this.database.tables, async (transaction) => {
      const data = await Dexie.waitFor(this.exportAll())
      const candidates = this.mediaIds(data)
      const available = collectCommunitySourceLocalAssetIds(data)
      for (const id of candidates) available.delete(id)
      const remoteOnly = sanitizeCommunitySourceAttachmentRefs(data, available)
      const referenced = new Set<string>()
      const visit = (value: unknown): void => {
        if (typeof value === 'string') {
          for (const id of candidates) if (value.includes(id)) referenced.add(id)
        } else if (
          value &&
          typeof value === 'object' &&
          !(value instanceof Blob) &&
          !(value instanceof ArrayBuffer) &&
          !ArrayBuffer.isView(value)
        ) {
          if ('localState' in value && 'url' in value && 'size' in value) {
            if ('localAssetId' in value) visit(value.localAssetId)
            return
          }
          // Unknown ciphertext / native text cannot prove exclusive ownership: retain its assets.
          if (
            isEncodedBlobValue(value) ||
            ('encrypted' in value && value.encrypted === true && 'payload' in value)
          ) {
            for (const id of candidates) referenced.add(id)
          } else for (const child of Object.values(value)) visit(child)
        }
      }
      visit(remoteOnly)
      const skipped = new Set([
        'communitySources',
        'communitySourceMessages',
        'resourceSummaries',
        'resourceListSummaries',
        'resourceVersionSummaries',
        'assetFiles',
      ])
      for (const table of this.database.tables) {
        if (skipped.has(table.name)) continue
        const keys = await table.toCollection().primaryKeys()
        for (const key of keys) {
          let value: unknown = isAndroidNativeAppDatabaseActive()
            ? await table.core.get({
                trans: transaction.idbtrans,
                key,
                loadBinary: false,
              } as Parameters<typeof table.core.get>[0])
            : await table.get(key)
          if (table.name === 'resources' || table.name === 'resourceVersions') {
            const record = value as StoredResourceSummary | undefined
            if (record && isEncryptedResourceSummary(record)) {
              const payload =
                record.payload.data instanceof Blob
                  ? record.payload
                  : await Dexie.waitFor(
                      runAndroidNativeRead(transaction.idbtrans, () =>
                        decodeAppDatabaseValue(
                          record.payload,
                          table.name as 'resources' | 'resourceVersions',
                          encodeAppDatabaseKey(key),
                          nativeAppDatabase,
                        ),
                      ),
                    )
              value = await Dexie.waitFor(
                this.vault.decodeResourceSummary({
                  ...record,
                  payload: payload as typeof record.payload,
                }),
              )
            } else if (record) {
              // Original/thumbnail binary descriptors do not hold references to assetFiles.
              const {
                originalBlob: _original,
                thumbnailBlob: _thumbnail,
                nativeOriginal: _native,
                ...metadata
              } = record as unknown as Record<string, unknown>
              value = metadata
            }
          }
          if (table.name === 'assets' && candidates.has(String(key)) && value) {
            const {
              assetId: _id,
              webStorageRef: _ref,
              ...references
            } = value as Record<string, unknown>
            value = references
          }
          visit(value)
        }
      }
      let count = 0,
        bytes = 0
      for (const id of candidates) {
        const asset = await this.database.assets.get(id)
        if (referenced.has(id) || (asset && asset.source !== 'remote')) continue
        await this.database.assetFiles.delete(id)
        await this.database.assets.delete(id)
        count++
        bytes += asset?.size ?? 0
      }
      for (const source of remoteOnly.sources)
        await this.database.communitySources.put(await Dexie.waitFor(this.encodeSource(source)))
      for (const message of remoteOnly.messages)
        await this.database.communitySourceMessages.put(
          await Dexie.waitFor(this.encodeMessage(message)),
        )
      return { count, bytes, retainedCount: candidates.size - count }
    })
  }

  async mergeAll(data: CommunitySourceBackupData): Promise<void> {
    const sources: StoredCommunitySource[] = []
    const messages: StoredCommunitySourceMessage[] = []
    const bindings: StoredResourceSourceBinding[] = []
    for (const source of data.sources) sources.push(await this.encodeSource(source))
    for (const message of data.messages) messages.push(await this.encodeMessage(message))
    for (const binding of data.bindings) bindings.push(await this.encodeBinding(binding))
    await this.database.transaction(
      'rw',
      this.database.communitySources,
      this.database.communitySourceMessages,
      this.database.resourceSourceBindings,
      async () => {
        if (sources.length) await this.database.communitySources.bulkPut(sources)
        if (messages.length) await this.database.communitySourceMessages.bulkPut(messages)
        if (bindings.length) await this.database.resourceSourceBindings.bulkPut(bindings)
      },
    )
  }

  async replaceAll(data: CommunitySourceBackupData): Promise<void> {
    const sources: StoredCommunitySource[] = []
    const messages: StoredCommunitySourceMessage[] = []
    const bindings: StoredResourceSourceBinding[] = []
    for (const source of data.sources) sources.push(await this.encodeSource(source))
    for (const message of data.messages) messages.push(await this.encodeMessage(message))
    for (const binding of data.bindings) bindings.push(await this.encodeBinding(binding))
    await this.database.transaction(
      'rw',
      this.database.communitySources,
      this.database.communitySourceMessages,
      this.database.resourceSourceBindings,
      async () => {
        await Promise.all([
          this.database.communitySources.clear(),
          this.database.communitySourceMessages.clear(),
          this.database.resourceSourceBindings.clear(),
        ])
        if (sources.length) await this.database.communitySources.bulkPut(sources)
        if (messages.length) await this.database.communitySourceMessages.bulkPut(messages)
        if (bindings.length) await this.database.resourceSourceBindings.bulkPut(bindings)
      },
    )
  }

  /**
   * Vault 的主资源迁移已经有独立 resumable owner；社区来源保持 feature-local 的幂等小批迁移。
   * 混合明文/密文状态始终可读，因此中断后重复调用会从剩余记录继续，不需要堆第二套 checkpoint。
   */
  async migrateVaultMode(targetMode: CommunityVaultMode): Promise<void> {
    await this.migrateSources(targetMode)
    await this.migrateMessages(targetMode)
    await this.migrateBindings(targetMode)
  }

  private async migrateSources(targetMode: CommunityVaultMode): Promise<void> {
    let lastId = ''
    while (true) {
      const query = lastId
        ? this.database.communitySources.where('id').above(lastId)
        : this.database.communitySources.orderBy('id')
      const batch = await query.limit(MIGRATION_BATCH_SIZE).toArray()
      if (!batch.length) return
      const converted: StoredCommunitySource[] = []
      for (const record of batch) {
        const encrypted = isEncryptedCommunitySource(record)
        if (targetMode === 'encrypted' && encrypted && !record.summaryPayload) {
          converted.push(
            await encodeCommunitySource(
              await decodeCommunitySource(record, this.codec),
              this.codec,
            ),
          )
        } else if ((targetMode === 'encrypted') === encrypted) {
          converted.push(record)
        } else if (targetMode === 'encrypted') {
          converted.push(await encodeCommunitySource(record as CommunitySource, this.codec))
        } else {
          converted.push(await decodeCommunitySource(record, this.codec))
        }
      }
      await this.database.communitySources.bulkPut(converted)
      lastId = batch.at(-1)!.id
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
  }

  private async migrateMessages(targetMode: CommunityVaultMode): Promise<void> {
    let lastId = ''
    while (true) {
      const query = lastId
        ? this.database.communitySourceMessages.where('id').above(lastId)
        : this.database.communitySourceMessages.orderBy('id')
      const batch = await query.limit(MIGRATION_BATCH_SIZE).toArray()
      if (!batch.length) return
      const converted: StoredCommunitySourceMessage[] = []
      for (const record of batch) {
        const encrypted = isEncryptedCommunitySourceMessage(record)
        if ((targetMode === 'encrypted') === encrypted) {
          converted.push(record)
        } else if (targetMode === 'encrypted') {
          converted.push(
            await encodeCommunitySourceMessage(record as CommunitySourceMessage, this.codec),
          )
        } else {
          converted.push(await decodeCommunitySourceMessage(record, this.codec))
        }
      }
      await this.database.communitySourceMessages.bulkPut(converted)
      lastId = batch.at(-1)!.id
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
  }

  private async migrateBindings(targetMode: CommunityVaultMode): Promise<void> {
    let lastId = ''
    while (true) {
      const query = lastId
        ? this.database.resourceSourceBindings.where('id').above(lastId)
        : this.database.resourceSourceBindings.orderBy('id')
      const batch = await query.limit(MIGRATION_BATCH_SIZE).toArray()
      if (!batch.length) return
      const converted: StoredResourceSourceBinding[] = []
      for (const record of batch) {
        const encrypted = isEncryptedResourceSourceBinding(record)
        if ((targetMode === 'encrypted') === encrypted) {
          converted.push(record)
        } else if (targetMode === 'encrypted') {
          converted.push(
            await encodeResourceSourceBinding(record as ResourceSourceBinding, this.codec),
          )
        } else {
          converted.push(await decodeResourceSourceBinding(record, this.codec))
        }
      }
      await this.database.resourceSourceBindings.bulkPut(converted)
      lastId = batch.at(-1)!.id
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
  }
}
