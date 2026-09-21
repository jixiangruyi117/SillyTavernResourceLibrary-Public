import { createResourceArchiveSource } from '../services/ExportService'
import type { Ref, ShallowRef } from 'vue'
import { confirmAction } from '../composables/UseConfirmDialog'
import {
  browserStorageService,
  communitySourceStorage,
  historyService,
  resourceService,
  vaultService,
} from '../core/AppContainer'
import { mutationGuard } from '../core/MutationGuard'
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
  historySnapshots: Ref<BackupRecord[]>
  historySnapshotLimit: Ref<number, number>
  settingsPanelKey: Ref<number, number>
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
  clearBrowsingState: () => void
}

export function useLibraryProtection(getContext: () => LibraryProtectionContext) {
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
    const confirmed = await confirmAction({
      title: '清理 APK 临时缓存',
      message:
        '清空 APK 的临时缓存和代码缓存，不会删除资源、历史版本、云端备份、网页数据库或登录信息。请先完成上传、下载、导入和恢复任务。',
      confirmLabel: '清理缓存',
    })
    if (!confirmed) return
    context.isClearingNativeCache.value = true
    try {
      const clearedBytes = await clearNativeTemporaryCaches()
      await refreshStorageHealth()
      context.showNotice(
        clearedBytes > 0
          ? `已清理 ${formatBytes(clearedBytes)} 临时缓存`
          : '没有可清理的 APK 临时缓存',
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

  async function loadHistorySnapshots(): Promise<void> {
    const context = getContext()

    const [snapshots, limit] = await Promise.all([
      historyService.list(),
      historyService.getSnapshotLimit(),
    ])
    context.historySnapshots.value = snapshots
    context.historySnapshotLimit.value = limit
  }

  async function handleHistorySnapshotLimit(value: number): Promise<void> {
    const context = getContext()

    const nextLimit = Math.min(30, Math.max(1, Math.round(value)))
    const removedCount = Math.max(0, context.historySnapshots.value.length - nextLimit)
    if (
      removedCount > 0 &&
      !(await confirmAction({
        title: '缩减历史快照',
        message: `保存后将永久删除最旧的 ${removedCount} 个历史快照，确定继续吗？`,
        confirmLabel: '保存并删除',
        danger: true,
      }))
    ) {
      context.settingsPanelKey.value += 1
      return
    }
    try {
      context.historySnapshotLimit.value = await historyService.setSnapshotLimit(nextLimit)
      await loadHistorySnapshots()
      context.settingsPanelKey.value += 1
      context.showNotice(`历史快照将保留最近 ${context.historySnapshotLimit.value} 个`)
    } catch {
      context.showNotice('历史快照数量保存失败')
    }
  }

  async function captureHistory(
    reason: string,
    protectedSnapshotIds: readonly string[] = [],
  ): Promise<void> {
    const context = getContext()

    await historyService.capture(
      await createResourceArchiveSource(resourceService),
      context.categories.value,
      reason,
      protectedSnapshotIds,
    )
    await loadHistorySnapshots()
  }

  async function openVaultPanel(): Promise<void> {
    const context = getContext()

    context.isDataProtectionOpen.value = false
    context.isVaultPanelOpen.value = true
    if (!context.vaultStatus.value.locked) await loadHistorySnapshots()
  }

  async function handleVaultUnlock(password: string): Promise<void> {
    const context = getContext()

    context.isVaultBusy.value = true
    try {
      await vaultService.unlock(password)
      await communitySourceStorage.migrateVaultMode('encrypted')
      context.vaultStatus.value = vaultService.getStatus()
      window.dispatchEvent(new Event('srl:vault-unlocked'))
      await Promise.all([context.loadLibrary(), loadHistorySnapshots(), context.loadRecycleBin()])
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
    return mutationGuard.run('vault:enable', () => performVaultEnable(password))
  }

  async function performVaultEnable(password: string): Promise<void> {
    const context = getContext()

    context.isVaultBusy.value = true
    const operationId = taskCenter.start({ name: '开启本地保险库', phase: '创建安全快照' })
    try {
      taskCenter.update(operationId, { phase: '整理缩略图存储' })
      await resourceService.repairThumbnailAssets()
      await captureHistory('开启加密前')
      taskCenter.update(operationId, { phase: '分批加密本地数据' })
      await vaultService.enable(password)
      await communitySourceStorage.migrateVaultMode('encrypted')
      context.vaultStatus.value = vaultService.getStatus()
      context.clearSearchHistory()
      await Promise.all([context.loadResources(), loadHistorySnapshots(), context.loadRecycleBin()])
      taskCenter.complete(operationId)
      context.showNotice('本地数据已完成 AES-256-GCM 加密')
    } catch (error) {
      taskCenter.fail(operationId, error)
      context.showNotice(error instanceof Error ? error.message : '开启加密失败')
    } finally {
      context.isVaultBusy.value = false
    }
  }

  async function handleVaultDisable(): Promise<void> {
    const disableConfirmed = await confirmAction({
      title: '关闭本地加密',
      message: '确定关闭本地加密吗？资源和历史快照将恢复为明文存储。',
      confirmLabel: '关闭加密',
      danger: true,
    })
    if (!disableConfirmed) return
    return mutationGuard.run('vault:disable', performVaultDisable)
  }

  async function performVaultDisable(): Promise<void> {
    const context = getContext()

    context.isVaultBusy.value = true
    const operationId = taskCenter.start({ name: '关闭本地保险库', phase: '创建安全快照' })
    try {
      taskCenter.update(operationId, { phase: '整理缩略图存储' })
      await resourceService.repairThumbnailAssets()
      await captureHistory('关闭加密前')
      taskCenter.update(operationId, { phase: '分批恢复明文数据' })
      await communitySourceStorage.migrateVaultMode('plain')
      await vaultService.disable()
      context.vaultStatus.value = vaultService.getStatus()
      await Promise.all([context.loadResources(), loadHistorySnapshots(), context.loadRecycleBin()])
      taskCenter.complete(operationId)
      context.showNotice('本地加密已关闭')
    } catch (error) {
      taskCenter.fail(operationId, error)
      context.showNotice(error instanceof Error ? error.message : '关闭加密失败')
    } finally {
      context.isVaultBusy.value = false
    }
  }

  function handleVaultLock(): void {
    const context = getContext()

    vaultService.lock()
    context.vaultStatus.value = vaultService.getStatus()
    context.resetSearchState()
    context.resources.value = []
    context.categories.value = []
    context.historySnapshots.value = []
    context.recycleBinEntries.value = []
    context.recycleUndoEntry.value = undefined
    context.isVaultPanelOpen.value = true
  }

  async function handleCreateSnapshot(): Promise<void> {
    const context = getContext()

    context.isVaultBusy.value = true
    try {
      await captureHistory('手动快照')
      context.showNotice('历史版本已创建')
    } catch (error) {
      context.showNotice(error instanceof Error ? error.message : '创建历史版本失败')
    } finally {
      context.isVaultBusy.value = false
    }
  }

  async function handleRestoreSnapshot(id: string): Promise<void> {
    const context = getContext()

    const snapshot = context.historySnapshots.value.find((item) => item.id === id)
    if (!snapshot) return
    const restoreConfirmed = await confirmAction({
      title: '恢复历史版本',
      message: `确定恢复“${snapshot.reason || '本地快照'}”吗？当前整个资源库会被替换，恢复前将自动保留安全快照。`,
      confirmLabel: '恢复',
      danger: true,
    })
    if (!restoreConfirmed) return
    context.isVaultBusy.value = true
    try {
      await captureHistory('历史恢复前自动快照', [id])
      await historyService.restore(id)
      await Promise.all([context.loadLibrary(), loadHistorySnapshots(), refreshStorageHealth()])
      context.isVaultPanelOpen.value = false
      context.clearBrowsingState()
      context.showNotice('已恢复到选定的历史版本')
    } catch (error) {
      context.showNotice(error instanceof Error ? error.message : '历史版本恢复失败')
    } finally {
      context.isVaultBusy.value = false
    }
  }

  async function handleDeleteSnapshot(id: string): Promise<void> {
    const context = getContext()

    const deleteSnapshotConfirmed = await confirmAction({
      title: '删除历史版本',
      message: '确定删除这个历史版本吗？',
      confirmLabel: '删除',
      danger: true,
    })
    if (!deleteSnapshotConfirmed) return
    context.isVaultBusy.value = true
    try {
      await historyService.delete(id)
      await loadHistorySnapshots()
    } catch {
      context.showNotice('历史版本删除失败')
    } finally {
      context.isVaultBusy.value = false
    }
  }
  return {
    refreshStorageHealth,
    clearNativeTemporaryStorage,
    requestPersistentStorage,
    loadHistorySnapshots,
    handleHistorySnapshotLimit,
    captureHistory,
    openVaultPanel,
    handleVaultUnlock,
    handleVaultEnable,
    performVaultEnable,
    handleVaultDisable,
    performVaultDisable,
    handleVaultLock,
    handleCreateSnapshot,
    handleRestoreSnapshot,
    handleDeleteSnapshot,
  }
}
