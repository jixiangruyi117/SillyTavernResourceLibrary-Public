import type { Ref } from 'vue'
import { computed } from 'vue'
import type { StorageHealth } from '../services/BrowserStorageService'
import { type NativeResourceStorageInfo } from '../storage/NativeResourceFileMirror'
import { type ResourceSummary } from '../types/Resource'

interface LibraryProtectionViewContext {
  resources: Ref<ResourceSummary[]>
  lastFullBackupAt: Ref<number | undefined, number | undefined>
  BACKUP_REMINDER_INTERVAL: number
  nativeStorageInfo: Ref<NativeResourceStorageInfo | null>
  storageHealth: Ref<StorageHealth>
  backupRecommended: Ref<boolean, boolean>
}

export function useLibraryProtectionView(context: LibraryProtectionViewContext) {
  const backupOverdue = computed(
    () =>
      context.resources.value.length > 0 &&
      (!context.lastFullBackupAt.value ||
        Date.now() - context.lastFullBackupAt.value > context.BACKUP_REMINDER_INTERVAL),
  )

  const displayedStorageUsage = computed(
    () => context.nativeStorageInfo.value?.totalBytes ?? context.storageHealth.value.usage,
  )

  const displayedStorageAvailable = computed(
    () =>
      context.nativeStorageInfo.value?.availableBytes ??
      Math.max(0, context.storageHealth.value.quota - context.storageHealth.value.usage),
  )

  const storageUsagePercent = computed(() => {
    const usage = displayedStorageUsage.value
    const available = displayedStorageAvailable.value
    return usage + available > 0
      ? Math.min(100, Math.max(0, (usage / (usage + available)) * 100))
      : 0
  })

  const storageProtectionStatus = computed(() => {
    if (backupOverdue.value || context.backupRecommended.value) return '建议备份'
    if (context.storageHealth.value.persisted) return '已持久保护'
    if (context.storageHealth.value.supported) return '待开启保护'
    return '仅本机保存'
  })
  return {
    backupOverdue,
    displayedStorageUsage,
    displayedStorageAvailable,
    storageUsagePercent,
    storageProtectionStatus,
  }
}
