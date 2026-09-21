import type { AppDatabase } from '../database/AppDatabase'
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
import type { EncryptedValue } from '../types/Vault'
import type { CommunitySourceStorage } from './CommunitySourceStorage'

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

  async putBinding(binding: ResourceSourceBinding): Promise<void> {
    await this.database.resourceSourceBindings.put(await this.encodeBinding(binding))
  }

  async deleteBinding(id: string): Promise<void> {
    await this.database.resourceSourceBindings.delete(id)
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
