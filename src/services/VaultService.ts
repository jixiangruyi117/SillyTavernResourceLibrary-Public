import type { AppDatabase } from '../database/AppDatabase'
import type { AssetRecord } from '../types/Asset'
import {
  clearNativeResourceFiles,
  mirrorNativeResourceFile,
  readNativeResourceObject,
} from '../storage/NativeResourceFileMirror'
import { hydrateResourceFromIndexedDb } from '../storage/ResourceStorageClone'
import {
  normalizeResource,
  toResourceListSummary,
  toResourceSummary,
  type BackupRecord,
  type Category,
  type Resource,
  type ResourceSummary,
} from '../types/Resource'
import {
  isEncryptedCategory,
  isEncryptedResource,
  isEncryptedResourceSummary,
  isNativeBackedResource,
  type EncryptedCategoryRecord,
  type EncryptedResourceRecord,
  type EncryptedValue,
  type StoredCategory,
  type StoredResource,
  type StoredResourceSummary,
  type VaultConfig,
  type VaultStatus,
} from '../types/Vault'

const VAULT_SETTING_ID = 'local-vault'
const VAULT_MIGRATION_SETTING_ID = 'local-vault-migration'
const VAULT_VERSION = 1
const KEY_ITERATIONS = 310_000
const VERIFIER_TEXT = 'srl-local-vault-verifier-v1'
const MIGRATION_BATCH_SIZE = 10

type VaultMode = 'plain' | 'encrypted'
type VaultMigrationTable = 'resources' | 'versions' | 'categories' | 'snapshots' | 'assets'

interface VaultMigrationJob {
  jobId: string
  sourceMode: VaultMode
  targetMode: VaultMode
  table: VaultMigrationTable
  lastPrimaryKey?: string
  processed: number
  total: number
  status: 'running' | 'failed'
  startedAt: number
  updatedAt: number
  lastError?: string
}

const MIGRATION_TABLES: VaultMigrationTable[] = [
  'resources',
  'versions',
  'categories',
  'snapshots',
  'assets',
]

type ResourcePayload = Omit<
  Resource,
  'id' | 'contentHash' | 'versionGroupId' | 'originalBlob' | 'thumbnailBlob'
>
type CategoryPayload = Omit<Category, 'id'>

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

function copyBuffer(data: ArrayBuffer): ArrayBuffer {
  const copy = new Uint8Array(data.byteLength)
  copy.set(new Uint8Array(data))
  return copy.buffer
}

function isVaultProtectedAsset(asset: AssetRecord): boolean {
  return asset.vaultProtected === true || asset.source === 'thumbnail'
}

function isVaultConfig(value: unknown): value is VaultConfig {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  const verifier = record.verifier as Record<string, unknown> | undefined
  if (!verifier) return false
  return (
    record.version === VAULT_VERSION &&
    typeof record.iterations === 'number' &&
    typeof record.salt === 'string' &&
    typeof verifier.iv === 'string' &&
    verifier.data instanceof Blob
  )
}

export class VaultLockedError extends Error {
  constructor() {
    super('本地保险库已锁定，请先输入密码解锁')
  }
}

export class VaultService {
  private readonly database: AppDatabase
  private config?: VaultConfig
  private key?: CryptoKey

  constructor(database: AppDatabase) {
    this.database = database
  }

  async initialize(): Promise<VaultStatus> {
    const setting = await this.database.settings.get(VAULT_SETTING_ID)
    this.config = isVaultConfig(setting?.value) ? setting.value : undefined
    this.key = undefined
    return this.getStatus()
  }

  getStatus(): VaultStatus {
    return { enabled: Boolean(this.config), locked: Boolean(this.config) && !this.key }
  }

  isEnabled(): boolean {
    return Boolean(this.config)
  }

  async enable(password: string): Promise<void> {
    if (this.config) throw new Error('本地加密已开启')
    this.validatePassword(password)
    // Native-backed cloud restores may have no IndexedDB original. Keep native objects
    // until every current/history record has been encrypted and committed.
    const salt = crypto.getRandomValues(new Uint8Array(16))
    const key = await this.deriveKey(password, salt, KEY_ITERATIONS)
    const config: VaultConfig = {
      version: VAULT_VERSION,
      iterations: KEY_ITERATIONS,
      salt: bytesToBase64(salt),
      verifier: await this.encryptBytes(new TextEncoder().encode(VERIFIER_TEXT), key),
    }
    const job = await this.createMigrationJob('plain', 'encrypted')
    await this.database.transaction('rw', this.database.settings, async () => {
      await this.database.settings.put({
        id: VAULT_SETTING_ID,
        value: config,
        updatedAt: Date.now(),
      })
      await this.saveMigrationJob(job)
    })
    // Publish the enabled state only after its recoverable config/checkpoint is durable.
    this.config = config
    this.key = key
    await this.runMigration(job, key)
  }

  async unlock(password: string): Promise<void> {
    const config = this.config
    if (!config) return
    const key = await this.deriveKey(password, base64ToBytes(config.salt), config.iterations)
    try {
      const verifier = await this.decryptBytes(config.verifier, key)
      if (new TextDecoder().decode(verifier) !== VERIFIER_TEXT) throw new Error()
    } catch {
      throw new Error('密码不正确')
    }
    this.key = key
    const migration = await this.readMigrationJob()
    if (migration) {
      await this.runMigration(migration, key)
      return
    }
    // v0.0.60 could leave plaintext thumbnail assets behind an already-enabled vault.
    // Create an asset-first resumable job before the unlocked library becomes available.
    if (await this.hasMigrationRemainder('encrypted')) {
      const assetJob = await this.createMigrationJob('plain', 'encrypted')
      assetJob.table = 'assets'
      assetJob.lastPrimaryKey = undefined
      assetJob.processed = 0
      await this.saveMigrationJob(assetJob)
      await this.runMigration(assetJob, key)
    } else {
      // Recover pre-existing vaults that completed encryption but left plaintext mirrors.
      await clearNativeResourceFiles()
    }
  }

  lock(): void {
    if (this.config) this.key = undefined
  }

  async disable(): Promise<void> {
    const key = this.requireKey()
    const existing = await this.readMigrationJob()
    const job =
      existing?.targetMode === 'plain'
        ? existing
        : await this.createMigrationJob('encrypted', 'plain')
    await this.saveMigrationJob(job)
    await this.runMigration(job, key)
  }

  async encodeResource(resource: Resource): Promise<StoredResource> {
    if (!this.config) return resource
    return this.encryptResourceWithKey(resource, this.requireKey())
  }

  async decodeResource(resource: StoredResource): Promise<Resource> {
    if (isNativeBackedResource(resource)) return this.materializeNativeResource(resource)
    if (!isEncryptedResource(resource)) return hydrateResourceFromIndexedDb(resource)
    return this.decryptResourceWithKey(resource, this.requireKey())
  }

  async encodeResourceSummary(resource: ResourceSummary): Promise<StoredResourceSummary> {
    if (!this.config) return resource
    return this.encryptResourceSummaryWithKey(resource, this.requireKey())
  }

  private async encryptResourceSummaryWithKey(
    resource: ResourceSummary,
    key: CryptoKey,
  ): Promise<StoredResourceSummary> {
    const { id, contentHash, versionGroupId, thumbnailBlob, ...payload } = resource
    return {
      id,
      contentHash,
      versionGroupId,
      updatedAt: resource.updatedAt,
      encrypted: true,
      payload: await this.encryptBytes(new TextEncoder().encode(JSON.stringify(payload)), key),
      thumbnail: thumbnailBlob
        ? await this.encryptBytes(new Uint8Array(await thumbnailBlob.arrayBuffer()), key)
        : undefined,
    }
  }

  async decodeResourceSummary(resource: StoredResourceSummary): Promise<ResourceSummary> {
    if (!isEncryptedResourceSummary(resource)) return resource
    const payload = JSON.parse(
      new TextDecoder().decode(await this.decryptBytes(resource.payload, this.requireKey())),
    ) as ResourcePayload
    const thumbnailBlob = resource.thumbnail
      ? new Blob([await this.decryptBytes(resource.thumbnail, this.requireKey())], {
          type: 'image/webp',
        })
      : undefined
    return {
      id: resource.id,
      contentHash: resource.contentHash,
      versionGroupId: resource.versionGroupId,
      ...payload,
      thumbnailBlob,
    }
  }

  async encodeCategory(category: Category): Promise<StoredCategory> {
    if (!this.config) return category
    return this.encryptCategoryWithKey(category, this.requireKey())
  }

  async decodeCategory(category: StoredCategory): Promise<Category> {
    if (!isEncryptedCategory(category)) return category
    return this.decryptCategoryWithKey(category, this.requireKey())
  }

  async protectBlob(blob: Blob): Promise<EncryptedValue> {
    return this.encryptBytes(new Uint8Array(await blob.arrayBuffer()), this.requireKey())
  }

  async revealBlob(value: EncryptedValue, type: string): Promise<Blob> {
    return new Blob([await this.decryptBytes(value, this.requireKey())], { type })
  }

  async getMigrationStatus(): Promise<VaultMigrationJob | undefined> {
    const job = await this.readMigrationJob()
    return job ? structuredClone(job) : undefined
  }

  private async createMigrationJob(
    sourceMode: VaultMode,
    targetMode: VaultMode,
  ): Promise<VaultMigrationJob> {
    const [resources, versions, categories, snapshots, assets] = await Promise.all([
      this.database.resources.count(),
      this.database.resourceVersions.count(),
      this.database.categories.count(),
      this.database.backupRecords.count(),
      this.database.assets.count(),
    ])
    const now = Date.now()
    return {
      jobId: crypto.randomUUID(),
      sourceMode,
      targetMode,
      table: 'resources',
      processed: 0,
      total: resources + versions + categories + snapshots + assets,
      status: 'running',
      startedAt: now,
      updatedAt: now,
    }
  }

  private async readMigrationJob(): Promise<VaultMigrationJob | undefined> {
    const setting = await this.database.settings.get(VAULT_MIGRATION_SETTING_ID)
    const value = setting?.value as Partial<VaultMigrationJob> | undefined
    if (
      !value ||
      typeof value.jobId !== 'string' ||
      (value.targetMode !== 'plain' && value.targetMode !== 'encrypted') ||
      !MIGRATION_TABLES.includes(value.table as VaultMigrationTable)
    ) {
      return undefined
    }
    return value as VaultMigrationJob
  }

  private async saveMigrationJob(job: VaultMigrationJob): Promise<void> {
    await this.database.settings.put({
      id: VAULT_MIGRATION_SETTING_ID,
      value: job,
      updatedAt: job.updatedAt,
    })
  }

  private storedSummary(resource: StoredResource): StoredResourceSummary {
    if (isNativeBackedResource(resource)) {
      const { nativeOriginal: _nativeOriginal, ...summary } = resource
      return summary
    }
    if (!isEncryptedResource(resource)) return toResourceSummary(resource)
    return {
      id: resource.id,
      contentHash: resource.contentHash,
      versionGroupId: resource.versionGroupId,
      updatedAt: resource.updatedAt,
      encrypted: true,
      payload: resource.payload,
      thumbnail: resource.thumbnail,
    }
  }

  private async runMigration(job: VaultMigrationJob, key: CryptoKey): Promise<void> {
    job.status = 'running'
    job.lastError = undefined
    await this.saveMigrationJob(job)
    try {
      while (true) {
        const migrated = await this.migrateJobBatch(job, key)
        if (migrated > 0) {
          await new Promise((resolve) => setTimeout(resolve, 0))
          continue
        }

        const tableIndex = MIGRATION_TABLES.indexOf(job.table)
        if (tableIndex < MIGRATION_TABLES.length - 1) {
          job.table = MIGRATION_TABLES[tableIndex + 1]!
          job.lastPrimaryKey = undefined
          job.updatedAt = Date.now()
          await this.saveMigrationJob(job)
          continue
        }

        if (await this.hasMigrationRemainder(job.targetMode)) {
          job.table = 'resources'
          job.lastPrimaryKey = undefined
          job.updatedAt = Date.now()
          await this.saveMigrationJob(job)
          continue
        }

        if (job.targetMode === 'encrypted') {
          // All originals are now durable ciphertext. Leave the checkpoint in place until
          // native cleanup succeeds so an interruption can safely retry after unlocking.
          await clearNativeResourceFiles()
        }

        await this.database.transaction('rw', this.database.settings, async () => {
          await this.database.settings.delete(VAULT_MIGRATION_SETTING_ID)
          if (job.targetMode === 'plain') {
            await this.database.settings.delete(VAULT_SETTING_ID)
          }
        })
        if (job.targetMode === 'plain') {
          this.key = undefined
          this.config = undefined
        }
        return
      }
    } catch (error) {
      job.status = 'failed'
      job.lastError = error instanceof Error ? error.message : '保险库迁移失败'
      job.updatedAt = Date.now()
      await this.saveMigrationJob(job)
      throw error
    }
  }

  private async migrateJobBatch(job: VaultMigrationJob, key: CryptoKey): Promise<number> {
    if (job.table === 'resources') {
      const query = job.lastPrimaryKey
        ? this.database.resources.where('id').above(job.lastPrimaryKey)
        : this.database.resources.orderBy('id')
      const source = await query.limit(MIGRATION_BATCH_SIZE).toArray()
      if (!source.length) return 0
      const converted: StoredResource[] = []
      for (const resource of source) {
        converted.push(
          job.targetMode === 'encrypted'
            ? isEncryptedResource(resource)
              ? resource
              : await this.encryptResourceWithKey(
                  isNativeBackedResource(resource)
                    ? await this.materializeNativeResource(resource)
                    : hydrateResourceFromIndexedDb(resource),
                  key,
                )
            : await this.decryptResourceWithKey(resource, key),
        )
      }
      await this.commitResourceBatch(job, converted, false)
      if (job.targetMode === 'plain') {
        for (const resource of converted as Resource[]) {
          await mirrorNativeResourceFile(resource, 'current').catch(() => undefined)
        }
      }
      return source.length
    }

    if (job.table === 'versions') {
      const query = job.lastPrimaryKey
        ? this.database.resourceVersions.where('id').above(job.lastPrimaryKey)
        : this.database.resourceVersions.orderBy('id')
      const source = await query.limit(MIGRATION_BATCH_SIZE).toArray()
      if (!source.length) return 0
      const converted: StoredResource[] = []
      for (const version of source) {
        converted.push(
          job.targetMode === 'encrypted'
            ? isEncryptedResource(version)
              ? version
              : await this.encryptResourceWithKey(
                  isNativeBackedResource(version)
                    ? await this.materializeNativeResource(version)
                    : hydrateResourceFromIndexedDb(version),
                  key,
                )
            : await this.decryptResourceWithKey(version, key),
        )
      }
      await this.commitResourceBatch(job, converted, true)
      if (job.targetMode === 'plain') {
        for (const version of converted as Resource[]) {
          await mirrorNativeResourceFile(version, 'versions').catch(() => undefined)
        }
      }
      return source.length
    }

    if (job.table === 'categories') {
      const query = job.lastPrimaryKey
        ? this.database.categories.where('id').above(job.lastPrimaryKey)
        : this.database.categories.orderBy('id')
      const source = await query.limit(MIGRATION_BATCH_SIZE).toArray()
      if (!source.length) return 0
      const converted: StoredCategory[] = []
      for (const category of source) {
        converted.push(
          job.targetMode === 'encrypted'
            ? isEncryptedCategory(category)
              ? category
              : await this.encryptCategoryWithKey(category, key)
            : await this.decryptCategoryWithKey(category, key),
        )
      }
      this.advanceJob(job, source.at(-1)!.id, source.length)
      await this.database.transaction(
        'rw',
        this.database.categories,
        this.database.settings,
        async () => {
          await this.database.categories.bulkPut(converted)
          await this.saveMigrationJob(job)
        },
      )
      return source.length
    }

    if (job.table === 'assets') {
      const query = job.lastPrimaryKey
        ? this.database.assets.where('assetId').above(job.lastPrimaryKey)
        : this.database.assets.orderBy('assetId')
      const source = await query.limit(MIGRATION_BATCH_SIZE).toArray()
      if (!source.length) return 0
      const records: AssetRecord[] = []
      const files: Array<{ assetId: string; blob: Blob; updatedAt: number }> = []
      const expectsEncrypted = job.targetMode === 'encrypted'
      for (const asset of source) {
        if (!isVaultProtectedAsset(asset)) continue
        const file = await this.database.assetFiles.get(asset.assetId)
        if (!file) {
          records.push({
            ...asset,
            vaultProtected: true,
            encrypted: expectsEncrypted,
            encryptionIv: undefined,
          })
          continue
        }
        if (expectsEncrypted) {
          if (asset.encrypted === true) {
            if (asset.vaultProtected !== true) records.push({ ...asset, vaultProtected: true })
            continue
          }
          const protectedValue = await this.encryptBytes(
            new Uint8Array(await file.blob.arrayBuffer()),
            key,
          )
          records.push({
            ...asset,
            vaultProtected: true,
            encrypted: true,
            encryptionIv: protectedValue.iv,
          })
          files.push({ ...file, blob: protectedValue.data, updatedAt: Date.now() })
          continue
        }
        if (asset.encrypted !== true) {
          if (asset.vaultProtected !== true) records.push({ ...asset, vaultProtected: true })
          continue
        }
        if (!asset.encryptionIv) throw new Error('加密缩略图缺少初始化向量')
        const plaintext = new Blob(
          [await this.decryptBytes({ iv: asset.encryptionIv, data: file.blob }, key)],
          { type: asset.mimeType || 'application/octet-stream' },
        )
        records.push({
          ...asset,
          vaultProtected: true,
          encrypted: false,
          encryptionIv: undefined,
        })
        files.push({ ...file, blob: plaintext, updatedAt: Date.now() })
      }
      this.advanceJob(job, source.at(-1)!.assetId, source.length)
      await this.database.transaction(
        'rw',
        this.database.assets,
        this.database.assetFiles,
        this.database.settings,
        async () => {
          if (records.length) await this.database.assets.bulkPut(records)
          if (files.length) await this.database.assetFiles.bulkPut(files)
          await this.saveMigrationJob(job)
        },
      )
      return source.length
    }

    const query = job.lastPrimaryKey
      ? this.database.backupRecords.where('id').above(job.lastPrimaryKey)
      : this.database.backupRecords.orderBy('id')
    const source = await query.limit(MIGRATION_BATCH_SIZE).toArray()
    if (!source.length) return 0
    const converted: BackupRecord[] = []
    for (const snapshot of source) {
      converted.push(
        job.targetMode === 'encrypted'
          ? await this.encryptSnapshotRecord(snapshot, key)
          : await this.decryptSnapshotRecord(snapshot, key),
      )
    }
    this.advanceJob(job, source.at(-1)!.id, source.length)
    await this.database.transaction(
      'rw',
      this.database.backupRecords,
      this.database.settings,
      async () => {
        await this.database.backupRecords.bulkPut(converted)
        await this.saveMigrationJob(job)
      },
    )
    return source.length
  }

  private async commitResourceBatch(
    job: VaultMigrationJob,
    converted: StoredResource[],
    versions: boolean,
  ): Promise<void> {
    this.advanceJob(job, converted.at(-1)!.id, converted.length)
    const summaries = converted.map((resource) => this.storedSummary(resource))
    const listSummaries = versions
      ? []
      : await Promise.all(
          converted.map(async (resource) => {
            const plain = isEncryptedResource(resource)
              ? await this.decryptResourceWithKey(resource, this.requireKey())
              : resource
            const light = toResourceListSummary(plain)
            return job.targetMode === 'encrypted'
              ? this.encryptResourceSummaryWithKey(light, this.requireKey())
              : light
          }),
        )
    const recordsTable = versions ? this.database.resourceVersions : this.database.resources
    const summariesTable = versions
      ? this.database.resourceVersionSummaries
      : this.database.resourceSummaries
    await this.database.transaction(
      'rw',
      recordsTable,
      summariesTable,
      this.database.resourceListSummaries,
      this.database.settings,
      async () => {
        await recordsTable.bulkPut(converted)
        await summariesTable.bulkPut(summaries)
        if (!versions) await this.database.resourceListSummaries.bulkPut(listSummaries)
        await this.saveMigrationJob(job)
      },
    )
  }

  private advanceJob(job: VaultMigrationJob, lastPrimaryKey: string, count: number): void {
    job.lastPrimaryKey = lastPrimaryKey
    job.processed = Math.min(job.total, job.processed + count)
    job.updatedAt = Date.now()
  }

  private async hasMigrationRemainder(targetMode: VaultMode): Promise<boolean> {
    const expectsEncrypted = targetMode === 'encrypted'
    const [resources, versions, categories, snapshots, assets] = await Promise.all([
      this.database.resources
        .filter((record) => isEncryptedResource(record) !== expectsEncrypted)
        .count(),
      this.database.resourceVersions
        .filter((record) => isEncryptedResource(record) !== expectsEncrypted)
        .count(),
      this.database.categories
        .filter((record) => isEncryptedCategory(record) !== expectsEncrypted)
        .count(),
      this.database.backupRecords
        .filter((record) => Boolean(record.encrypted) !== expectsEncrypted && Boolean(record.blob))
        .count(),
      this.database.assets
        .filter(
          (record) =>
            isVaultProtectedAsset(record) && Boolean(record.encrypted) !== expectsEncrypted,
        )
        .count(),
    ])
    return resources + versions + categories + snapshots + assets > 0
  }

  private validatePassword(password: string): void {
    if (password.length < 8) throw new Error('加密密码至少需要 8 个字符')
  }

  private requireKey(): CryptoKey {
    if (!this.key) throw new VaultLockedError()
    return this.key
  }

  private async deriveKey(
    password: string,
    salt: Uint8Array<ArrayBuffer>,
    iterations: number,
  ): Promise<CryptoKey> {
    const material = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(password),
      'PBKDF2',
      false,
      ['deriveKey'],
    )
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
      material,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    )
  }

  private async encryptBytes(
    data: Uint8Array<ArrayBuffer>,
    key: CryptoKey,
  ): Promise<EncryptedValue> {
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data)
    return { iv: bytesToBase64(iv), data: new Blob([copyBuffer(encrypted)]) }
  }

  private async decryptBytes(value: EncryptedValue, key: CryptoKey): Promise<ArrayBuffer> {
    const encrypted = await value.data.arrayBuffer()
    return crypto.subtle.decrypt({ name: 'AES-GCM', iv: base64ToBytes(value.iv) }, key, encrypted)
  }

  private async encryptResourceWithKey(
    resource: Resource,
    key: CryptoKey,
  ): Promise<EncryptedResourceRecord> {
    resource = normalizeResource(resource)
    const { id, contentHash, versionGroupId, originalBlob, thumbnailBlob, ...payload } = resource
    return {
      id,
      contentHash,
      versionGroupId,
      updatedAt: resource.updatedAt,
      encrypted: true,
      payload: await this.encryptBytes(new TextEncoder().encode(JSON.stringify(payload)), key),
      original: await this.encryptBytes(new Uint8Array(await originalBlob.arrayBuffer()), key),
      thumbnail: thumbnailBlob
        ? await this.encryptBytes(new Uint8Array(await thumbnailBlob.arrayBuffer()), key)
        : undefined,
    }
  }

  private async decryptResourceWithKey(
    resource: StoredResource,
    key: CryptoKey,
  ): Promise<Resource> {
    if (isNativeBackedResource(resource)) return this.materializeNativeResource(resource)
    if (!isEncryptedResource(resource)) return hydrateResourceFromIndexedDb(resource)
    const payload = JSON.parse(
      new TextDecoder().decode(await this.decryptBytes(resource.payload, key)),
    ) as ResourcePayload
    const originalBlob = new Blob([await this.decryptBytes(resource.original, key)], {
      type: payload.mimeType,
    })
    const thumbnailBlob = resource.thumbnail
      ? new Blob([await this.decryptBytes(resource.thumbnail, key)], { type: 'image/webp' })
      : undefined
    return normalizeResource({
      id: resource.id,
      contentHash: resource.contentHash,
      versionGroupId: resource.versionGroupId,
      ...payload,
      originalBlob,
      thumbnailBlob,
    })
  }

  private async materializeNativeResource(
    resource: import('../types/Vault').NativeBackedResourceRecord,
  ): Promise<Resource> {
    const { nativeOriginal, ...record } = resource
    return normalizeResource({
      ...record,
      originalBlob: await readNativeResourceObject(
        nativeOriginal.contentHash,
        nativeOriginal.size,
        resource.mimeType,
      ),
    })
  }

  private async encryptCategoryWithKey(
    category: Category,
    key: CryptoKey,
  ): Promise<EncryptedCategoryRecord> {
    const { id, ...payload } = category
    return {
      id,
      updatedAt: category.updatedAt,
      encrypted: true,
      payload: await this.encryptBytes(new TextEncoder().encode(JSON.stringify(payload)), key),
    }
  }

  private async decryptCategoryWithKey(
    category: StoredCategory,
    key: CryptoKey,
  ): Promise<Category> {
    if (!isEncryptedCategory(category)) return category
    const payload = JSON.parse(
      new TextDecoder().decode(await this.decryptBytes(category.payload, key)),
    ) as CategoryPayload
    return { id: category.id, ...payload }
  }

  private async encryptSnapshotRecord(
    snapshot: BackupRecord,
    key: CryptoKey,
  ): Promise<BackupRecord> {
    if (!snapshot.blob || snapshot.encrypted) return snapshot
    const encrypted = await this.encryptBytes(
      new Uint8Array(await snapshot.blob.arrayBuffer()),
      key,
    )
    return {
      ...snapshot,
      blob: encrypted.data,
      encrypted: true,
      encryptionIv: encrypted.iv,
      size: encrypted.data.size,
    }
  }

  private async decryptSnapshotRecord(
    snapshot: BackupRecord,
    key: CryptoKey,
  ): Promise<BackupRecord> {
    if (!snapshot.blob || !snapshot.encrypted || !snapshot.encryptionIv) return snapshot
    const blob = new Blob(
      [await this.decryptBytes({ iv: snapshot.encryptionIv, data: snapshot.blob }, key)],
      { type: 'application/zip' },
    )
    return {
      ...snapshot,
      blob,
      encrypted: false,
      encryptionIv: undefined,
      size: blob.size,
    }
  }
}
