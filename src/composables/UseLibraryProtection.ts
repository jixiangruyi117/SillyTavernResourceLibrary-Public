import { ref, type Ref, type ShallowRef } from 'vue'
import type { LegacyLibraryHistoryCleanup } from '../storage/IndexedDbResourceHealthStorage'
import { confirmAction } from '../composables/UseConfirmDialog'
import {
  browserStorageService,
  communitySourceStorage,
  resourceService,
  vaultService,
} from '../core/AppContainer'
import { mutationGuard } from '../core/MutationGuard'
import { domainEvents } from '../core/DomainEvents'
import { taskCenter } from '../core/TaskCenter'
import type { StorageHealth } from '../services/BrowserStorageService'
import {
  clearNativeTemporaryCaches,
  getNativeResourceStorageInfo,
  type NativeResourceStorageInfo,
} from '../storage/NativeResourceFileMirror'
import type { BackupRecord } from '../types/Resource'
import { type Category, type ResourceSummary } from '../types/Resource'
import type { VaultStatus } from '../types/Vault'
import { formatBytes } from '../utils/LibraryFormatting'

interface LibraryProtectionContext {
  storageHealth: Ref<StorageHealth>
  nativeStorageInfo: Ref<NativeResourceStorageInfo | null>
  isNativeApk: boolean
  isClearingNativeCache: Ref<boolean, boolean>
  showNotice: (message: string, duration?: number, preserveRecycleUndo?: boolean) => void
  isRequestingPersistence: Ref<boolean, boolean>
  categories: Ref<Category[]>
  isDataProtectionOpen: Ref<boolean, boolean>
  isVaultPanelOpen: Ref<boolean, boolean>
  vaultStatus: Ref<VaultStatus>
  isVaultBusy: Ref<boolean, boolean>
  loadLibrary: () => Promise<void>
  loadRecycleBin: () => Promise<void>
  scheduleLibraryMaintenance: () => void
  clearSearchHistory: () => void
  loadResources: () => Promise<void>
  resetSearchState: () => void
  resources: Ref<ResourceSummary[]>
  recycleBinEntries: ShallowRef<BackupRecord[], BackupRecord[]>
  recycleUndoEntry: ShallowRef<BackupRecord | undefined, BackupRecord | undefined>
}

export function useLibraryProtection(getContext: () => LibraryProtectionContext) {
  const legacyLibraryHistory = ref<LegacyLibraryHistoryCleanup>({ records: [], bytes: 0 })
  const isClearingLegacyLibraryHistory = ref(false)

  async function refreshLegacyLibraryHistory(): Promise<void> {
    try {
      legacyLibraryHistory.value = await browserStorageService.legacyLibraryHistoryCleanup()
    } catch (error) {
      getContext().showNotice('无法读取旧整库快照占用')
      throw error
    }
  }

  async function clearLegacyLibraryHistory(): Promise<void> {
    const context = getContext()
    if (isClearingLegacyLibraryHistory.value || context.isVaultBusy.value) return
    isClearingLegacyLibraryHistory.value = true
    try {
      await refreshLegacyLibraryHistory()
      const plan = {
        records: legacyLibraryHistory.value.records.map((record) => ({ ...record })),
        bytes: legacyLibraryHistory.value.bytes,
      }
      if (!plan.records.length) return
      const confirmed = await confirmAction({
        title: '清理旧整库快照',
        message: `永久删除 ${plan.records.length} 份旧整库快照（${formatBytes(plan.bytes)}），无法撤销。当前资源、单资源版本、回收站和云备份不受影响。`,
        confirmLabel: '永久清理',
      })
      if (!confirmed) return
      const bytes = await browserStorageService.clearLegacyLibraryHistory(plan)
      legacyLibraryHistory.value = { records: [], bytes: 0 }
      context.showNotice(
        `已清理 ${plan.records.length} 份旧整库快照（${formatBytes(bytes)}）；系统回收磁盘空间可能稍有延迟`,
      )
      await refreshStorageHealth()
    } catch (error) {
      context.showNotice(error instanceof Error ? error.message : '旧整库快照清理失败')
      await refreshLegacyLibraryHistory().catch(() => undefined)
    } finally {
      isClearingLegacyLibraryHistory.value = false
    }
  }

  async function refreshStorageHealth(): Promise<void> {
    const context = getContext()

    const [health, nativeInfo] = await Promise.all([
      browserStorageService.getHealth(),
      getNativeResourceStorageInfo().catch(() => null),
    ])
    context.storageHealth.value = health
    context.nativeStorageInfo.value = nativeInfo
  }

  async function clearNativeTemporaryStorage(): Promise<void> {
    const context = getContext()

    if (!context.isNativeApk || context.isClearingNativeCache.value) return
    context.isClearingNativeCache.value = true
    try {
      const confirmed = await confirmAction({
        title: '清理 APK 临时缓存',
        message:
          '清空 APK 的临时缓存和代码缓存，不会删除资源、历史版本、云端备份、网页数据库或登录信息。请先完成上传、下载、导入和恢复任务。',
        confirmLabel: '清理缓存',
      })
      if (!confirmed) return
      const clearedBytes = await clearNativeTemporaryCaches()
      await refreshStorageHealth()
      domainEvents.emit('NativeTemporaryCachesCleared', {
        storage: context.nativeStorageInfo.value,
        measuredAt: Date.now(),
      })
      context.showNotice(
        clearedBytes > 0
          ? `已清理 ${formatBytes(clearedBytes)} 临时缓存；网页容器中的数据库等数据未清理`
          : '没有可清理的 APK 临时缓存；网页容器中的数据库等数据未清理',
      )
    } catch (error) {
      context.showNotice(error instanceof Error ? error.message : 'APK 临时缓存清理失败')
    } finally {
      context.isClearingNativeCache.value = false
    }
  }

  async function requestPersistentStorage(): Promise<void> {
    const context = getContext()

    context.isRequestingPersistence.value = true
    try {
      context.storageHealth.value = await browserStorageService.requestPersistence()
      context.showNotice(
        context.storageHealth.value.persisted
          ? '浏览器已授予持久化存储保护'
          : '浏览器暂未授予持久化保护，建议定期完整备份',
      )
    } finally {
      context.isRequestingPersistence.value = false
    }
  }

  async function openVaultPanel(): Promise<void> {
    const context = getContext()

    context.isDataProtectionOpen.value = false
    context.isVaultPanelOpen.value = true
  }

  async function handleVaultUnlock(password: string): Promise<void> {
    const context = getContext()

    if (context.isVaultBusy.value || isClearingLegacyLibraryHistory.value) return
    context.isVaultBusy.value = true
    try {
      await vaultService.unlock(password)
      await communitySourceStorage.migrateVaultMode('encrypted')
      context.vaultStatus.value = vaultService.getStatus()
      window.dispatchEvent(new Event('srl:vault-unlocked'))
      await Promise.all([context.loadLibrary(), context.loadRecycleBin()])
      context.isVaultPanelOpen.value = false
      context.scheduleLibraryMaintenance()
      context.showNotice('本地保险库已解锁')
    } catch (error) {
      context.showNotice(error instanceof Error ? error.message : '解锁失败')
    } finally {
      context.isVaultBusy.value = false
    }
  }

  async function handleVaultEnable(password: string): Promise<void> {
    const context = getContext()
    if (context.isVaultBusy.value || isClearingLegacyLibraryHistory.value) return
    context.isVaultBusy.value = true
    try {
      const confirmed = await confirmAction({
        title: '开启本地保险库',
        message:
          '加密会转换当前设备上的全部资源。密码不会保存，忘记密码无法恢复。建议先导出完整备份。',
        confirmLabel: '开启加密',
        danger: true,
      })
      if (!confirmed) return
      await mutationGuard.run('vault:enable', () => performVaultEnable(password))
    } finally {
      context.isVaultBusy.value = false
    }
  }

  async function performVaultEnable(password: string): Promise<void> {
    const context = getContext()

    const operationId = taskCenter.start({
      name: '开启本地保险库',
      phase: '准备加密',
    })
    try {
      taskCenter.update(operationId, { phase: '整理缩略图存储' })
      await resourceService.repairThumbnailAssets()
      taskCenter.update(operationId, { phase: '分批加密本地数据' })
      await vaultService.enable(password)
      await communitySourceStorage.migrateVaultMode('encrypted')
      context.vaultStatus.value = vaultService.getStatus()
      context.clearSearchHistory()
      await Promise.all([context.loadResources(), context.loadRecycleBin()])
      taskCenter.complete(operationId)
      context.showNotice('本地数据已完成 AES-256-GCM 加密')
    } catch (error) {
      taskCenter.fail(operationId, error)
      context.showNotice(error instanceof Error ? error.message : '开启加密失败')
    }
  }

  async function handleVaultDisable(): Promise<void> {
    const context = getContext()
    if (context.isVaultBusy.value || isClearingLegacyLibraryHistory.value) return
    context.isVaultBusy.value = true
    try {
      const confirmed = await confirmAction({
        title: '关闭本地加密',
        message: '关闭后，本机资源将恢复为明文存储。确定继续吗？',
        confirmLabel: '关闭并解密',
        danger: true,
      })
      if (!confirmed) return
      await mutationGuard.run('vault:disable', () => performVaultDisable())
    } finally {
      context.isVaultBusy.value = false
    }
  }

  async function performVaultDisable(): Promise<void> {
    const context = getContext()

    const operationId = taskCenter.start({
      name: '关闭本地保险库',
      phase: '准备关闭加密',
    })
    try {
      taskCenter.update(operationId, { phase: '整理缩略图存储' })
      await resourceService.repairThumbnailAssets()
      taskCenter.update(operationId, { phase: '分批恢复明文数据' })
      await communitySourceStorage.migrateVaultMode('plain')
      await vaultService.disable()
      context.vaultStatus.value = vaultService.getStatus()
      await Promise.all([context.loadResources(), context.loadRecycleBin()])
      taskCenter.complete(operationId)
      context.showNotice('本地加密已关闭')
    } catch (error) {
      taskCenter.fail(operationId, error)
      context.showNotice(error instanceof Error ? error.message : '关闭加密失败')
    }
  }

  function handleVaultLock(): void {
    const context = getContext()

    if (context.isVaultBusy.value || isClearingLegacyLibraryHistory.value) return
    vaultService.lock()
    context.vaultStatus.value = vaultService.getStatus()
    context.resetSearchState()
    context.resources.value = []
    context.categories.value = []
    context.recycleBinEntries.value = []
    context.recycleUndoEntry.value = undefined
    context.isVaultPanelOpen.value = true
  }

  return {
    legacyLibraryHistory,
    isClearingLegacyLibraryHistory,
    refreshLegacyLibraryHistory,
    clearLegacyLibraryHistory,
    refreshStorageHealth,
    clearNativeTemporaryStorage,
    requestPersistentStorage,
    openVaultPanel,
    handleVaultUnlock,
    handleVaultEnable,
    handleVaultDisable,
    handleVaultLock,
  }
}
