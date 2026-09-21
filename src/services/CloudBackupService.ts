import {
  selectCloudResources,
  cloudPlainSecretCopies,
  type PersonalResourceSelection,
} from './PersonalResourceBackup'
import type { ArchivePortableData } from '../types/Backup'
import type {
  CloudBackupConfig,
  CloudBackupContentSelection,
  CloudBackupItem,
  CloudBackupProvider,
  CloudBackupSnapshot,
  CloudBackupStatus,
  GitHubBackupConfig,
} from '../types/CloudBackup'
import type { CategoryService } from './CategoryService'
import { hashCloudBlob, readTransportHash } from './CloudArchiveCodec'
import { CloudBackupConfiguration, STATUS_KEY } from './CloudBackupConfiguration'
import { friendlyNetworkError, isCloudRequestTimeout, readJson } from './CloudBackupHttp'
import { CloudBackupMetricsTracker } from './CloudBackupMetrics'
import {
  LEGACY_RELEASE_TAG,
  RETRY_MS,
  allowsAutomaticBackup,
  canonicalizeFingerprintValue,
  isScheduleDue,
  normalizeContentSelection,
  normalizeProtection,
  normalizeRetention,
  normalizeSchedule,
  structuredPartContainer,
  structuredPartIdentity,
  structuredPartObjectKey,
} from './CloudBackupPolicy'
import { CloudBackupTransport } from './CloudBackupTransport'
import {
  OBJECT_RELEASE_PREFIX,
  SNAPSHOT_RELEASE_TAG,
  type CloudBackupProgressCallback,
  type GitHubAsset,
  type GitHubRelease,
} from './CloudBackupTransportContext'
import {
  createStructuredSnapshot,
  isStructuredSnapshotObjectKey,
  materializeStructuredResource,
  structuredSnapshotArchiveName,
  structuredSnapshotParts,
  type CreatedStructuredSnapshot,
  type StructuredSnapshot,
} from './CloudStructuredSnapshot'
import type { ExportService } from './ExportService'
import {
  cancelActiveNativeCloudTransfer,
  getLatestNativeCloudJob,
  isNativeCloudTransferAvailable,
  restoreNativeStructuredObjects,
  type NativeRestoreObject,
  type NativeRestoreResource,
} from './NativeCloudTransfer'
import type { ResourceService } from './ResourceService'
import {
  listBackupResourceSummaries,
  selectPreparedRestore,
  selectStructuredSnapshot,
} from './BackupRestoreSelection'
import type { RestoreService } from './RestoreService'
import type { ResourceSummary } from '../types/Resource'
export type { CloudBackupProgressCallback } from './CloudBackupTransportContext'

export { readCloudResponseText } from './CloudBackupHttp'

const ORPHAN_CHUNK_GRACE_MS = 24 * 60 * 60 * 1000

export interface GitHubRepositoryInspection {
  fullName: string
  isPrivate: boolean
  canWrite: boolean
}

export class CloudBackupService extends CloudBackupTransport {
  private readonly configuration: CloudBackupConfiguration
  private readonly verifiedPrivateGitHubTargets = new Set<string>()
  private readonly resourceService: ResourceService
  private readonly categoryService: CategoryService
  private readonly exportService: ExportService
  private readonly restoreService: RestoreService
  private readonly portableDataFactory?: (
    selection: CloudBackupContentSelection,
  ) => Promise<ArchivePortableData>
  private readonly portableDataImporter?: (data: ArchivePortableData) => Promise<void>

  constructor(
    resourceService: ResourceService,
    categoryService: CategoryService,
    exportService: ExportService,
    restoreService: RestoreService,
    portableDataFactory?: (selection: CloudBackupContentSelection) => Promise<ArchivePortableData>,
    portableDataImporter?: (data: ArchivePortableData) => Promise<void>,
  ) {
    super()
    this.resourceService = resourceService
    this.categoryService = categoryService
    this.exportService = exportService
    this.restoreService = restoreService
    this.portableDataFactory = portableDataFactory
    this.portableDataImporter = portableDataImporter
    this.configuration = new CloudBackupConfiguration((config, secret) =>
      this.testConnection(config, secret),
    )
  }
  async initializeCredentials(): Promise<void> {
    return this.configuration.initializeCredentials()
  }

  async reconcileNativeJob(): Promise<void> {
    const latest = await getLatestNativeCloudJob().catch(() => null)
    if (!latest || !['completed', 'failed', 'cancelled'].includes(latest.status)) return
    const current = this.getSnapshot().status
    if ((current.lastAttemptAt ?? 0) >= (latest.updatedAt ?? 0)) return
    if (latest.status === 'completed') {
      this.writeStatus({
        provider: latest.provider,
        lastAttemptAt: latest.updatedAt,
        lastSuccessAt: latest.updatedAt,
        lastObjectKey: latest.resultName,
        lastError: undefined,
        lastWarning: undefined,
      })
    } else {
      this.writeStatus({
        provider: latest.provider,
        lastAttemptAt: latest.updatedAt,
        lastError:
          latest.error || (latest.status === 'cancelled' ? '原生云备份已取消' : '原生云备份失败'),
        lastWarning: undefined,
      })
    }
  }

  async cancelActiveNativeBackup(): Promise<boolean> {
    return cancelActiveNativeCloudTransfer()
  }

  async hasActiveNativeBackup(): Promise<boolean> {
    const latest = await getLatestNativeCloudJob().catch(() => null)
    return Boolean(latest && ['staging', 'queued', 'running'].includes(latest.status))
  }
  getSnapshot(): CloudBackupSnapshot {
    return this.configuration.getSnapshot()
  }
  exportPortableSettings(): NonNullable<ArchivePortableData['cloudBackup']> {
    return this.configuration.exportPortableSettings()
  }
  importPortableSettings(value: NonNullable<ArchivePortableData['cloudBackup']>): void {
    return this.configuration.importPortableSettings(value)
  }
  async exportPortableCredentials(): Promise<Partial<Record<CloudBackupProvider, string>>> {
    return this.configuration.exportPortableCredentials()
  }
  async importPortableCredentials(
    value: Partial<Record<CloudBackupProvider, string>>,
  ): Promise<void> {
    return this.configuration.importPortableCredentials(value)
  }
  async saveConfig(
    config: CloudBackupConfig,
    secret: string,
    activate = true,
  ): Promise<CloudBackupSnapshot> {
    return this.configuration.saveConfig(config, secret, activate)
  }
  async clearCredential(provider: CloudBackupProvider): Promise<void> {
    return this.configuration.clearCredential(provider)
  }
  hasCredential(provider: CloudBackupProvider): boolean {
    return this.configuration.hasCredential(provider)
  }

  private githubTargetKey(config: GitHubBackupConfig): string {
    return `${config.owner.trim().toLowerCase()}/${config.repository.trim().toLowerCase()}`
  }

  invalidateGitHubPrivacyVerification(target?: string): void {
    if (target) this.verifiedPrivateGitHubTargets.delete(target.toLowerCase())
    else this.verifiedPrivateGitHubTargets.clear()
  }

  async inspectGitHubRepository(
    config: GitHubBackupConfig,
    secret?: string,
  ): Promise<GitHubRepositoryInspection> {
    await this.initializeCredentials()
    const credential = secret || this.requireSecret(config.provider)
    const response = await this.githubFetch(config, credential, '')
    const repository = (await response.json()) as {
      full_name?: string
      private?: boolean
      permissions?: { push?: boolean }
    }
    if (repository.permissions?.push === false) {
      throw new Error('令牌可以读取仓库，但没有写入权限；请把 Contents 改为 Read and write')
    }
    const inspection = {
      fullName: repository.full_name ?? `${config.owner}/${config.repository}`,
      isPrivate: repository.private === true,
      canWrite: true,
    }
    const target = this.githubTargetKey(config)
    if (inspection.isPrivate) this.verifiedPrivateGitHubTargets.add(target)
    else this.verifiedPrivateGitHubTargets.delete(target)
    return inspection
  }

  async testConnection(config: CloudBackupConfig, secret?: string): Promise<string> {
    await this.initializeCredentials()
    const credential = secret || this.requireSecret(config.provider)
    try {
      const repository = await this.inspectGitHubRepository(config, credential)
      return `已连接 ${repository.fullName}${repository.isPrivate ? '（私有仓库）' : '（公开仓库，建议改为私有）'}`
    } catch (error) {
      if (!secret) await this.invalidateCredentialOnConfirmed401(config.provider, error)
      throw friendlyNetworkError(error, config.provider)
    }
  }

  async createBackup(
    config?: CloudBackupConfig,
    secret?: string,
    onProgress?: CloudBackupProgressCallback,
    respectAutomaticConstraints = false,
  ): Promise<CloudBackupItem> {
    await this.initializeCredentials()
    const resolved = config ?? this.getActiveConfig()
    const credential = secret || this.requireSecret(resolved.provider)
    if (isNativeCloudTransferAvailable()) {
      const latest = await getLatestNativeCloudJob(resolved.provider).catch(() => null)
      if (latest && ['staging', 'queued', 'running'].includes(latest.status)) {
        throw new Error('已有 Android 原生云备份正在继续；不会重新开始整个备份')
      }
    }
    if (this.transportState.activeMetrics)
      throw new Error('已有云备份正在执行，请等待它结束或先取消')
    const metrics = new CloudBackupMetricsTracker()
    this.transportState.activeMetrics = metrics
    this.writeStatus({
      provider: resolved.provider,
      lastAttemptAt: Date.now(),
      lastError: undefined,
      lastWarning: undefined,
    })
    try {
      onProgress?.('正在读取资源与历史版本…')
      const contentSelection = normalizeContentSelection(resolved.contentSelection)
      if (contentSelection.communitySources && resolved.provider === 'github') {
        const target = this.githubTargetKey(resolved)
        if (!this.verifiedPrivateGitHubTargets.has(target)) {
          const repository = await this.inspectGitHubRepository(resolved, credential)
          if (!repository.isPrivate)
            throw new Error(
              `GitHub 仓库 ${repository.fullName} 是公开仓库，已阻止上传本地社区内容。请先把仓库改为 Private，再重新测试连接。`,
            )
        }
      }
      const portableData: ArchivePortableData = await metrics.measure('prepareMs', async () =>
        Promise.resolve(this.portableDataFactory?.(contentSelection)).then(
          (value) => value ?? { version: 1 },
        ),
      )
      if (contentSelection.cloudBackup) portableData.cloudBackup = this.exportPortableSettings()
      if (contentSelection.personalResources?.secret && contentSelection.plaintextSecretCopy) {
        portableData.plaintextSecretCopies = await cloudPlainSecretCopies(
          resolved,
          this.resourceService,
        )
      }
      if (
        typeof this.resourceService.listSummaries === 'function' &&
        typeof this.resourceService.listVersions === 'function'
      ) {
        onProgress?.('正在读取轻量索引，检查本机内容是否变化…')
        const currentResourceCount = (await this.resourceService.listSummaries()).length
        const previousHealth = this.getSnapshot().status
        const suspiciousDrop =
          previousHealth.lastHealthyResourceCount !== undefined &&
          previousHealth.lastHealthyResourceCount > 0 &&
          currentResourceCount <
            Math.max(1, Math.floor(previousHealth.lastHealthyResourceCount * 0.5))
        if (suspiciousDrop && respectAutomaticConstraints) {
          throw new Error(
            `本机资源从上次健康备份的 ${previousHealth.lastHealthyResourceCount} 项骤降到 ${currentResourceCount} 项，已暂停自动备份与旧备份清理，请先检查资源库。`,
          )
        }
        const contentFingerprint = await metrics.measure('hashMs', () =>
          this.createStructuredFingerprint(resolved, portableData),
        )
        const previousStatus = this.getSnapshot().status
        if (
          previousStatus.provider === resolved.provider &&
          previousStatus.lastContentFingerprint === contentFingerprint &&
          previousStatus.lastObjectKey
        ) {
          onProgress?.('本机内容与上次成功备份一致，正在核对远端清单…')
          const reused = await this.reuseUnchangedStructuredBackup(
            resolved,
            credential,
            previousStatus.lastObjectKey,
          )
          if (reused) {
            const lastMetrics = metrics.snapshot(true)
            this.writeStatus({
              provider: resolved.provider,
              lastAttemptAt: Date.now(),
              lastSuccessAt: Date.now(),
              lastObjectKey: reused.objectKey,
              lastSize: reused.size,
              lastContentFingerprint: contentFingerprint,
              lastResourceCount: currentResourceCount,
              lastHealthyObjectKey: suspiciousDrop
                ? previousHealth.lastHealthyObjectKey
                : reused.objectKey,
              lastHealthyResourceCount: suspiciousDrop
                ? previousHealth.lastHealthyResourceCount
                : currentResourceCount,
              lastMetrics,
              lastError: undefined,
              lastWarning: undefined,
            })
            return { ...reused, unchanged: true, metrics: lastMetrics }
          }
          onProgress?.('远端上次清单缺失或不完整，正在重新构建对象快照…')
        }
        const structured = await metrics.measure('objectBuildMs', () =>
          this.buildStructuredBackup(portableData, onProgress, contentSelection.personalResources),
        )
        if (structured.descriptorUpdates?.length) {
          onProgress?.('正在保存可复用的分块描述，下次差量备份将跳过未变大文件扫描…')
          for (const update of structured.descriptorUpdates) {
            await this.resourceService.updateBackupDescriptor(
              update.id,
              update.descriptor,
              update.historical,
            )
          }
        }
        metrics.add('localReadBytes', structured.localReadBytes ?? structured.totalSize)
        const item = await this.uploadGitHubStructuredBackup(
          resolved,
          credential,
          structured,
          onProgress,
          respectAutomaticConstraints,
        )
        let maintenanceWarning: string | undefined
        try {
          if (suspiciousDrop) {
            maintenanceWarning =
              '检测到资源数量异常下降：新快照已作为事故现场保留，未执行任何云端清理。'
          } else {
            const removed = await this.prune(resolved, credential, item.objectKey)
            if (removed > 0) maintenanceWarning = `已按保留份数自动清理 ${removed} 份旧云端快照。`
          }
        } catch (error) {
          maintenanceWarning = `新对象快照已上传成功，但旧备份清理失败：${friendlyNetworkError(error, resolved.provider).message}`
        }
        const lastMetrics = metrics.snapshot(true)
        this.writeStatus({
          provider: resolved.provider,
          lastAttemptAt: Date.now(),
          lastSuccessAt: Date.now(),
          lastObjectKey: item.objectKey,
          lastSize: item.size,
          lastContentFingerprint: contentFingerprint,
          lastResourceCount: currentResourceCount,
          lastHealthyObjectKey: suspiciousDrop
            ? previousHealth.lastHealthyObjectKey
            : item.objectKey,
          lastHealthyResourceCount: suspiciousDrop
            ? previousHealth.lastHealthyResourceCount
            : currentResourceCount,
          lastMetrics,
          lastError: undefined,
          lastWarning: maintenanceWarning,
        })
        return maintenanceWarning
          ? { ...item, maintenanceWarning, metrics: lastMetrics }
          : { ...item, metrics: lastMetrics }
      }
      throw new Error('当前资源存储不支持 Cloud Backup V3 所需的摘要与版本读取接口')
    } catch (error) {
      await this.invalidateCredentialOnConfirmed401(resolved.provider, error)
      const friendly = friendlyNetworkError(error, resolved.provider)
      const lastMetrics = metrics.snapshot(true)
      this.writeStatus({
        provider: resolved.provider,
        lastAttemptAt: Date.now(),
        lastMetrics,
        lastError: friendly.message,
        lastWarning: undefined,
      })
      throw friendly
    } finally {
      if (this.transportState.activeMetrics === metrics) {
        this.transportState.activeMetrics = undefined
        this.transportState.activeGitHubInventory = undefined
      }
    }
  }

  async listBackups(
    config?: CloudBackupConfig,
    secret?: string,
    onProgress?: CloudBackupProgressCallback,
  ): Promise<CloudBackupItem[]> {
    await this.initializeCredentials()
    const resolved = config ?? this.getActiveConfig()
    const credential = secret || this.requireSecret(resolved.provider)
    try {
      return await this.listGitHub(resolved, credential, onProgress)
    } catch (error) {
      await this.invalidateCredentialOnConfirmed401(resolved.provider, error)
      throw friendlyNetworkError(error, resolved.provider)
    }
  }

  async enforceRetention(
    config?: CloudBackupConfig,
    secret?: string,
  ): Promise<{ removed: number; remaining: number }> {
    await this.initializeCredentials()
    const resolved = config ?? this.getActiveConfig()
    const credential = secret || this.requireSecret(resolved.provider)
    try {
      const removed = await this.prune(resolved, credential, undefined, true)
      return { removed, remaining: normalizeRetention(resolved.retention) }
    } catch (error) {
      await this.invalidateCredentialOnConfirmed401(resolved.provider, error)
      throw friendlyNetworkError(error, resolved.provider)
    }
  }

  async downloadBackup(
    item: CloudBackupItem,
    config?: CloudBackupConfig,
    secret?: string,
  ): Promise<Blob> {
    await this.initializeCredentials()
    const resolved = config ?? this.getActiveConfig()
    const credential = secret || this.requireSecret(resolved.provider)
    try {
      if (item.kind === 'githubSnapshot') {
        return (await this.materializeStructuredArchive(item, resolved, credential)).blob
      }
      if (item.kind === 'githubBundle' || item.objectKey.endsWith('.srlbundle.json')) {
        return this.downloadGitHubBundle(resolved, credential, item)
      }
      const response = await this.githubFetch(resolved, credential, `/releases/assets/${item.id}`, {
        headers: { Accept: 'application/octet-stream' },
      })
      return this.verifyDownloadedBlob(item, await response.blob())
    } catch (error) {
      await this.invalidateCredentialOnConfirmed401(resolved.provider, error)
      throw friendlyNetworkError(error, resolved.provider)
    }
  }

  async listBackupResources(item: CloudBackupItem): Promise<ResourceSummary[]> {
    await this.initializeCredentials()
    const resolved = this.getActiveConfig()
    const credential = this.requireSecret(resolved.provider)
    try {
      return await listBackupResourceSummaries(
        item,
        async () => this.readGitHubStructuredSnapshot(resolved, credential, item),
        () => this.downloadBackup(item),
        this.resourceService,
        this.categoryService,
        this.restoreService,
      )
    } catch (error) {
      await this.invalidateCredentialOnConfirmed401(resolved.provider, error)
      throw friendlyNetworkError(error, resolved.provider)
    }
  }

  async restoreBackup(
    item: CloudBackupItem,
    filterPortableData?: (data: ArchivePortableData) => Promise<ArchivePortableData>,
    resourceKeys?: readonly string[],
  ): Promise<number> {
    if (item.kind === 'githubSnapshot') {
      const resolved = this.getActiveConfig()
      const credential = this.requireSecret(resolved.provider)
      try {
        return await this.restoreStructuredBackup(
          item,
          resolved,
          credential,
          filterPortableData,
          resourceKeys,
        )
      } catch (error) {
        await this.invalidateCredentialOnConfirmed401(resolved.provider, error)
        throw friendlyNetworkError(error, resolved.provider)
      }
    }
    const blob = await this.downloadBackup(item)
    const fileName = item.archiveName ?? item.objectKey.replace(/\.srlbundle\.json$/i, '')
    const [resources, categories] = await Promise.all([
      this.resourceService.listResourceListSummaries(),
      this.categoryService.list(),
    ])
    const prepared = await this.restoreService.prepare(
      new File([blob], fileName, { type: 'application/zip' }),
      resources,
      categories,
      true,
    )
    const selected = resourceKeys
      ? selectPreparedRestore(prepared, new Set(resourceKeys))
      : prepared
    const report = await this.restoreService.restore(selected)
    await this.importPreparedPortableData(prepared.portableData, filterPortableData)
    return report.restoredResources
  }

  private async restoreStructuredBackup(
    item: CloudBackupItem,
    config: CloudBackupConfig,
    secret: string,
    filterPortableData?: (data: ArchivePortableData) => Promise<ArchivePortableData>,
    resourceKeys?: readonly string[],
  ): Promise<number> {
    const loadedSnapshot = await this.readGitHubStructuredSnapshot(config, secret, item)
    const snapshot = resourceKeys
      ? selectStructuredSnapshot(loadedSnapshot, new Set(resourceKeys))
      : loadedSnapshot
    const nativeRestore = isNativeCloudTransferAvailable() && snapshot.version === 3
    const [existingResources, existingCategories] = await Promise.all([
      this.resourceService.listResourceListSummaries(),
      this.categoryService.list(),
    ])
    if (nativeRestore) {
      if (!this.restoreService.canRestoreStructuredNative()) {
        throw new Error('本地保险箱开启时不能从云端导入，请先通过保险箱设置切回普通存储。')
      }
      const plan = await this.buildNativeRestorePlan(snapshot, config, secret)
      await restoreNativeStructuredObjects({ config, secret, ...plan })
      const prepared = await this.restoreService.prepareStructuredNative(
        snapshot.resources,
        snapshot.versions,
        snapshot.categories,
        snapshot.portableData,
        existingResources,
        existingCategories,
        structuredSnapshotArchiveName(item.objectKey.split('/').at(-1) ?? item.objectKey),
      )
      const report = await this.restoreService.restoreNative(prepared)
      await this.importPreparedPortableData(prepared.portableData, filterPortableData)
      return report.restoredResources
    }
    const providerReader = await this.createGitHubObjectReader(config, secret)
    const report = await this.restoreService.restoreStructured(
      snapshot,
      providerReader,
      existingResources,
      existingCategories,
      structuredSnapshotArchiveName(item.objectKey.split('/').at(-1) ?? item.objectKey),
    )
    await this.importPreparedPortableData(snapshot.portableData, filterPortableData)
    return report.restoredResources
  }

  private async importPreparedPortableData(
    data: ArchivePortableData | undefined,
    filter?: (data: ArchivePortableData) => Promise<ArchivePortableData>,
  ): Promise<void> {
    if (!data || !this.portableDataImporter) return
    await this.portableDataImporter(filter ? await filter(data) : data)
  }

  private async buildNativeRestorePlan(
    snapshot: StructuredSnapshot,
    config: CloudBackupConfig,
    secret: string,
  ): Promise<{ objects: NativeRestoreObject[]; resources: NativeRestoreResource[] }> {
    const objectUrls = new Map<string, NativeRestoreObject>()
    const githubInventories = new Map<string, Promise<Map<string, GitHubAsset>>>()
    const githubInventory = (container: string): Promise<Map<string, GitHubAsset>> => {
      let pending = githubInventories.get(container)
      if (!pending) {
        if (config.provider !== 'github') throw new Error('GitHub 原生恢复配置无效')
        pending = this.getGitHubRelease(config, secret, false, container).then(async (release) => {
          if (!release) throw new Error(`GitHub 对象容器不存在：${container}`)
          return new Map(
            (await this.listGitHubAssets(config, secret, release.id)).map((asset) => [
              asset.name,
              asset,
            ]),
          )
        })
        githubInventories.set(container, pending)
      }
      return pending
    }
    const resources: NativeRestoreResource[] = []
    for (const resource of [...snapshot.resources, ...snapshot.versions]) {
      const segments: NativeRestoreResource['segments'] = []
      for (const part of resource.object.parts) {
        const hash = part.sha256.toLowerCase()
        const storedSize = part.storedSize ?? part.size
        const container = structuredPartContainer(part)
        const objectKey = structuredPartObjectKey(part)
        const asset = (await githubInventory(container)).get(objectKey)
        if (!asset || asset.size !== storedSize) {
          throw new Error(`GitHub 对象缺少分块：${container}/${objectKey}`)
        }
        const url = `https://api.github.com/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repository)}/releases/assets/${asset.id}`
        const existing = objectUrls.get(hash)
        if (existing && existing.size !== storedSize) {
          throw new Error(`云对象哈希对应了不同大小：${hash}`)
        }
        if (!existing) objectUrls.set(hash, { url, hash, size: storedSize })
        segments.push({ hash, offset: part.offset ?? 0, size: part.size })
      }
      resources.push({
        hash: resource.object.totalSha256.toLowerCase(),
        size: resource.object.totalSize,
        type: resource.type,
        fileName: resource.fileName,
        segments,
      })
    }
    return { objects: [...objectUrls.values()], resources }
  }

  private async materializeStructuredArchive(
    item: CloudBackupItem,
    config: CloudBackupConfig,
    secret: string,
  ) {
    const snapshot = await this.readGitHubStructuredSnapshot(config, secret, item)
    const providerReader = await this.createGitHubObjectReader(config, secret)
    return (
      await this.exportService.createArchivesFromSource(
        {
          resources: snapshot.resources,
          versions: snapshot.versions,
          read: async (planned, historical) => {
            const record = (historical ? snapshot.versions : snapshot.resources).find(
              (resource) => resource.id === planned.id,
            )
            if (!record) throw new Error(`备份缺少资源描述：${planned.fileName}`)
            return materializeStructuredResource(record, providerReader)
          },
        },
        snapshot.categories,
        { mode: 'full', portableData: snapshot.portableData },
      )
    )[0]!
  }

  async runDueBackup(): Promise<'disabled' | 'credential' | 'waiting' | 'success'> {
    await this.initializeCredentials()
    const snapshot = this.getSnapshot()
    const provider = snapshot.activeProvider
    if (!provider) return 'disabled'
    const config = provider ? snapshot[provider] : undefined
    if (!config?.autoBackup) return 'disabled'
    if (!this.getSecret(provider)) return 'credential'
    if (!(await allowsAutomaticBackup(normalizeProtection(config.protection)))) return 'waiting'
    const status = snapshot.status
    const now = Date.now()
    if (!isScheduleDue(normalizeSchedule(config.schedule), status.lastSuccessAt, now))
      return 'waiting'
    if (status.lastAttemptAt && now - status.lastAttemptAt < RETRY_MS) return 'waiting'
    await this.createBackup(config, undefined, undefined, true)
    return 'success'
  }
  private getActiveConfig(): CloudBackupConfig {
    return this.configuration.getActiveConfig()
  }
  private getSecret(provider: CloudBackupProvider): string {
    return this.configuration.getSecret(provider)
  }
  private async invalidateCredentialOnConfirmed401(
    provider: CloudBackupProvider,
    error: unknown,
  ): Promise<void> {
    return this.configuration.invalidateCredentialOnConfirmed401(provider, error)
  }
  private requireSecret(provider: CloudBackupProvider): string {
    return this.configuration.requireSecret(provider)
  }

  private async verifyDownloadedBlob(item: CloudBackupItem, blob: Blob): Promise<Blob> {
    if (item.size > 0 && blob.size !== item.size) {
      throw new Error(`云端备份大小校验失败：预期 ${item.size} 字节，实际 ${blob.size} 字节`)
    }
    const expected = readTransportHash(item.objectKey)
    if (expected && !(await hashCloudBlob(blob)).startsWith(expected)) {
      throw new Error('云端备份 SHA-256 校验失败，文件可能未完整上传或已经损坏')
    }
    return blob
  }

  private writeStatus(update: CloudBackupStatus): void {
    const current = readJson<CloudBackupStatus>(localStorage, STATUS_KEY, {})
    localStorage.setItem(
      STATUS_KEY,
      JSON.stringify({ ...current, ...update, lastError: update.lastError }),
    )
  }

  private async createStructuredFingerprint(
    config: CloudBackupConfig,
    portableData: ArchivePortableData,
  ): Promise<string> {
    const summaries = selectCloudResources(
      await (this.resourceService.listResourceListSummaries?.() ??
        this.resourceService.listSummaries()),
      normalizeContentSelection(config.contentSelection).personalResources,
    )
    const includedIds = new Set(summaries.map((resource) => resource.id))
    const versionSummaries =
      typeof this.resourceService.listVersionSummaries === 'function'
        ? (await this.resourceService.listVersionSummaries(true)).filter((resource) =>
            includedIds.has(resource.versionGroupId ?? ''),
          )
        : []
    const compact = (resource: (typeof summaries)[number]) => ({
      id: resource.id,
      contentHash: resource.contentHash,
      fileSize: resource.fileSize,
      updatedAt: resource.updatedAt,
      versionGroupId: resource.versionGroupId,
    })
    const destination = {
      provider: config.provider,
      owner: config.owner,
      repository: config.repository,
    }
    const fingerprintValue = canonicalizeFingerprintValue({
      version: 1,
      destination,
      resources: summaries.map(compact).sort((left, right) => left.id.localeCompare(right.id)),
      versions: versionSummaries
        .map(compact)
        .sort((left, right) => left.id.localeCompare(right.id)),
      categories: (await this.categoryService.list()).sort((left, right) =>
        left.id.localeCompare(right.id),
      ),
      portableData,
    })
    const fingerprintBlob = new Blob([JSON.stringify(fingerprintValue)], {
      type: 'application/json',
    })
    this.transportState.activeMetrics?.add('hashedBytes', fingerprintBlob.size)
    return hashCloudBlob(fingerprintBlob)
  }

  private async reuseUnchangedStructuredBackup(
    config: CloudBackupConfig,
    secret: string,
    objectKey: string,
  ): Promise<CloudBackupItem | undefined> {
    if (!isStructuredSnapshotObjectKey(objectKey)) return undefined
    if (config.provider === 'github') {
      const release =
        (await this.getGitHubRelease(config, secret, false, SNAPSHOT_RELEASE_TAG)) ??
        (await this.getGitHubRelease(config, secret, false, LEGACY_RELEASE_TAG))
      if (!release) return undefined
      const assets = await this.listGitHubAssets(config, secret, release.id)
      const manifest = assets.find((asset) => asset.name === objectKey)
      if (!manifest) return undefined
      let snapshot: StructuredSnapshot
      try {
        snapshot = await this.readGitHubStructuredSnapshot(config, secret, {
          id: String(manifest.id),
          objectKey: manifest.name,
          size: manifest.size,
          createdAt: Date.parse(manifest.created_at) || 0,
          kind: 'githubSnapshot',
        })
      } catch (error) {
        if (isCloudRequestTimeout(error)) throw error
        return undefined
      }
      const parts = structuredSnapshotParts(snapshot)
      const partAssets = await this.readGitHubPartInventory(config, secret, parts)
      if (parts.some((part) => partAssets.get(structuredPartIdentity(part))?.size !== part.size)) {
        return undefined
      }
      return {
        id: String(manifest.id),
        objectKey,
        size: [...snapshot.resources, ...snapshot.versions].reduce(
          (total, resource) => total + resource.fileSize,
          0,
        ),
        createdAt: Date.parse(manifest.created_at) || Date.parse(snapshot.createdAt) || Date.now(),
        kind: 'githubSnapshot',
        partCount: parts.length,
        archiveName: structuredSnapshotArchiveName(objectKey),
      }
    }

    return undefined
  }

  private async buildStructuredBackup(
    portableData: ArchivePortableData,
    onProgress?: CloudBackupProgressCallback,
    personalResources?: PersonalResourceSelection,
  ): Promise<CreatedStructuredSnapshot> {
    onProgress?.('正在逐项读取资源，构建对象级快照…')
    const summaries = selectCloudResources(
      await (this.resourceService.listResourceListSummaries?.() ??
        this.resourceService.listSummaries()),
      personalResources,
    )
    const resourceService = this.resourceService
    async function* resources() {
      for (const summary of summaries) {
        yield {
          summary,
          summaryIsPartial: true,
          load: async () => {
            const resource = await resourceService.get(summary.id)
            if (!resource) throw new Error(`云备份规划期间资源已不存在：${summary.fileName}`)
            return resource
          },
        }
      }
    }
    async function* versions() {
      const currentIds = new Set(summaries.map((summary) => summary.id))
      for (const summary of await resourceService.listVersionSummaries(true)) {
        if (
          currentIds.has(summary.id) ||
          !summary.versionGroupId ||
          !currentIds.has(summary.versionGroupId) ||
          summary.metadata.cloudBackupExcluded === true
        ) {
          continue
        }
        yield {
          summary,
          summaryIsPartial: true,
          load: async () => {
            const resource = await resourceService.getVersion(summary.id)
            if (!resource) throw new Error(`云备份规划期间历史版本已不存在：${summary.fileName}`)
            return resource
          },
        }
      }
    }
    return createStructuredSnapshot(
      resources(),
      versions(),
      await this.categoryService.list(),
      portableData,
    )
  }

  /** Cheap inventory for retention: it lists manifest containers, never every object container. */
  private async listRetentionBackups(
    config: CloudBackupConfig,
    secret: string,
  ): Promise<CloudBackupItem[]> {
    if (config.provider === 'github') {
      const [legacy, snapshots] = await Promise.all([
        this.getGitHubRelease(config, secret, false, LEGACY_RELEASE_TAG),
        this.getGitHubRelease(config, secret, false, SNAPSHOT_RELEASE_TAG),
      ])
      const assets = [
        ...(legacy ? await this.listGitHubAssets(config, secret, legacy.id) : []),
        ...(snapshots ? await this.listGitHubAssets(config, secret, snapshots.id) : []),
      ]
      return assets
        .flatMap((asset): CloudBackupItem[] => {
          const createdAt = Date.parse(asset.created_at) || 0
          if (isStructuredSnapshotObjectKey(asset.name))
            return [
              {
                id: String(asset.id),
                objectKey: asset.name,
                size: asset.size,
                createdAt,
                kind: 'githubSnapshot',
              },
            ]
          if (asset.name.endsWith('.srlbundle.json'))
            return [
              {
                id: String(asset.id),
                objectKey: asset.name,
                size: asset.size,
                createdAt,
                kind: 'githubBundle',
              },
            ]
          return /\.zip$/iu.test(asset.name)
            ? [
                {
                  id: String(asset.id),
                  objectKey: asset.name,
                  size: asset.size,
                  createdAt,
                  kind: 'single',
                },
              ]
            : []
        })
        .sort((left, right) => right.createdAt - left.createdAt)
    }
    return []
  }

  private async referencedPartIdentities(
    config: CloudBackupConfig,
    secret: string,
    backups: CloudBackupItem[],
  ): Promise<Set<string>> {
    const referenced = new Set<string>()
    for (const item of backups) {
      if (item.kind === 'githubSnapshot') {
        const snapshot = await this.readGitHubStructuredSnapshot(config, secret, item)
        for (const part of structuredSnapshotParts(snapshot))
          referenced.add(structuredPartIdentity(part))
      } else if (item.kind === 'githubBundle') {
        const manifest = await this.readGitHubBundleManifest(config, secret, item)
        for (const part of manifest.parts) referenced.add(`${LEGACY_RELEASE_TAG}\u0000${part.name}`)
      }
    }
    return referenced
  }

  private async prune(
    config: CloudBackupConfig,
    secret: string,
    protectedObjectKey?: string,
    deep = false,
  ): Promise<number> {
    const backups = await this.listRetentionBackups(config, secret)
    const normalKept = backups.slice(0, normalizeRetention(config.retention))
    const protectedItem = protectedObjectKey
      ? backups.find((item) => item.objectKey === protectedObjectKey)
      : undefined
    const kept =
      protectedItem && !normalKept.some((item) => item.id === protectedItem.id)
        ? [...normalKept, protectedItem]
        : normalKept
    const keptIds = new Set(kept.map((item) => item.id))
    const removed = backups.filter((item) => !keptIds.has(item.id))

    // Only retained and about-to-expire manifests are read during normal automatic maintenance.
    // A malformed one aborts before its snapshot can be deleted.
    const [keptParts, retiredParts] = await Promise.all([
      this.referencedPartIdentities(config, secret, kept),
      this.referencedPartIdentities(config, secret, removed),
    ])

    // 先让超出 retention 的清单退出可见快照集合；只要任一清单删除失败，
    // 本轮就不会继续回收内容对象，避免留下“仍可见但缺对象”的旧快照。
    for (const item of removed) {
      await this.githubFetch(config, secret, `/releases/assets/${item.id}`, { method: 'DELETE' })
    }

    const orphanScope = `github:${config.owner}/${config.repository}`
    const now = Date.now()

    const pending = await this.transportState.jobStore.pendingOrphans(orphanScope)
    const candidates = new Set(
      [...pending, ...retiredParts].filter(
        (part) => !keptParts.has(part) && isVerifiedChunkIdentity(part),
      ),
    )

    if (deep && config.provider === 'github') {
      const containers: Array<{ tag: string; release: GitHubRelease }> = []
      const legacy = await this.getGitHubRelease(config, secret, false, LEGACY_RELEASE_TAG)
      if (legacy) containers.push({ tag: LEGACY_RELEASE_TAG, release: legacy })
      for (let index = 1; index <= 10_000; index += 1) {
        const tag = `${OBJECT_RELEASE_PREFIX}${String(index).padStart(4, '0')}`
        const release = await this.getGitHubRelease(config, secret, false, tag)
        if (!release) break
        containers.push({ tag, release })
      }
      const orphanAssets = new Map<string, GitHubAsset>()
      for (const container of containers) {
        for (const asset of await this.listGitHubAssets(config, secret, container.release.id)) {
          const identity = `${container.tag}\u0000${asset.name}`
          if (isVerifiedChunkObjectName(asset.name) && !keptParts.has(identity))
            candidates.add(identity)
        }
      }
      const eligible = await this.transportState.jobStore.eligibleOrphans(
        orphanScope,
        candidates,
        now,
        ORPHAN_CHUNK_GRACE_MS,
      )
      for (const identity of eligible) {
        const asset = orphanAssets.get(identity)
        if (!asset) continue
        await this.githubFetch(config, secret, `/releases/assets/${asset.id}`, {
          method: 'DELETE',
        })
        await this.transportState.jobStore.clearOrphan(orphanScope, identity)
      }
      return removed.length
    }

    const eligible = await this.transportState.jobStore.eligibleOrphans(
      orphanScope,
      candidates,
      now,
      ORPHAN_CHUNK_GRACE_MS,
    )
    const assetsByIdentity = new Map<string, GitHubAsset>()
    for (const container of new Set(eligible.map((identity) => identity.split('\u0000', 1)[0]!))) {
      const release = await this.getGitHubRelease(config, secret, false, container)
      if (!release) continue
      for (const asset of await this.listGitHubAssets(config, secret, release.id))
        assetsByIdentity.set(`${container}\u0000${asset.name}`, asset)
    }
    for (const identity of eligible) {
      const asset = assetsByIdentity.get(identity)
      if (asset)
        await this.githubFetch(config, secret, `/releases/assets/${asset.id}`, { method: 'DELETE' })
      await this.transportState.jobStore.clearOrphan(orphanScope, identity)
    }
    return removed.length
  }
}

function isVerifiedChunkObjectName(name: string): boolean {
  return /^srl-chunk--sha256-[a-f0-9]{64}$/iu.test(name)
}

function isVerifiedChunkIdentity(identity: string): boolean {
  const name = identity.split('\u0000').at(-1) ?? ''
  return isVerifiedChunkObjectName(name)
}
