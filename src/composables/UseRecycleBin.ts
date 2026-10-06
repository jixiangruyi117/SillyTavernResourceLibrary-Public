import { computed, ref, shallowRef } from 'vue'
import { recycleBinService, syncNativeResourceFiles } from '../core/AppContainer'
import { confirmAction } from './UseConfirmDialog'
import type { BackupRecord } from '../types/Resource'
import { taskCenter } from '../core/TaskCenter'
interface RecycleBinContext {
  isDataProtectionOpen: import('vue').Ref<boolean>
  loadResources: () => Promise<void>
  loadLibrary: () => Promise<void>
  refreshStorageHealth: () => Promise<void>
  showNotice: (message: string, duration?: number, keepUndo?: boolean) => void
}
export function useRecycleBin(context: RecycleBinContext) {
  const { isDataProtectionOpen, loadResources, loadLibrary, refreshStorageHealth, showNotice } =
    context
  const isRecycleBinOpen = ref(false)

  const isRecycleBinBusy = ref(false)

  const recycleBinEntries = shallowRef<BackupRecord[]>([])

  const recycleUndoEntry = shallowRef<BackupRecord>()

  const recycleBinSize = computed(() =>
    recycleBinEntries.value.reduce(
      (total, record) => total + (record.size ?? record.blob?.size ?? 0),
      0,
    ),
  )

  async function loadRecycleBin(): Promise<void> {
    recycleBinEntries.value = await recycleBinService.list()
  }

  async function openRecycleBin(): Promise<void> {
    await loadRecycleBin()
    isDataProtectionOpen.value = false
    isRecycleBinOpen.value = true
  }

  async function moveResourcesToRecycleBin(ids: string[]): Promise<void> {
    const operationId = taskCenter.start({ name: '移入回收站', phase: '打包所选资源' })
    try {
      const record = await recycleBinService.moveToRecycleBin(ids, (progress) => {
        if (progress.phase === 'archive') {
          taskCenter.update(operationId, { phase: '打包所选资源' })
          if (progress.writtenBytes !== undefined) {
            taskCenter.updateTransfer(operationId, { transferredBytes: progress.writtenBytes })
          }
        } else if (progress.phase === 'save') {
          taskCenter.update(operationId, { phase: '保存回收站副本' })
        } else {
          taskCenter.update(operationId, {
            phase: '删除原资源及历史版本',
            progress: progress.total ? (progress.completed ?? 0) / progress.total : undefined,
            itemProgress:
              progress.total !== undefined
                ? { completed: progress.completed ?? 0, total: progress.total }
                : undefined,
          })
        }
      })
      recycleUndoEntry.value = record
      await Promise.all([loadResources(), loadRecycleBin(), refreshStorageHealth()])
      taskCenter.complete(operationId)
      showNotice(
        record.resourceCount === 1
          ? '资源已移入回收站，可立即恢复。'
          : `${record.resourceCount} 项资源已移入回收站，可立即恢复。`,
        9000,
        true,
      )
    } catch (error) {
      taskCenter.fail(operationId, error)
      throw error
    }
  }

  async function handleRestoreRecycleBinEntry(id: string): Promise<void> {
    if (isRecycleBinBusy.value) return
    isRecycleBinBusy.value = true
    try {
      await recycleBinService.restore(id)
      if (recycleUndoEntry.value?.id === id) recycleUndoEntry.value = undefined
      await Promise.all([loadLibrary(), loadRecycleBin(), refreshStorageHealth()])
      void syncNativeResourceFiles().catch(() => undefined)
      showNotice('资源已从回收站恢复。')
    } catch (error) {
      showNotice(error instanceof Error ? error.message : '回收站资源恢复失败')
    } finally {
      isRecycleBinBusy.value = false
    }
  }

  async function handlePurgeRecycleBinEntry(id: string): Promise<void> {
    const confirmed = await confirmAction({
      title: '彻底删除回收站资源',
      message: '彻底删除后无法从本地回收站恢复。确定继续吗？',
      confirmLabel: '彻底删除',
      danger: true,
    })
    if (!confirmed) return
    isRecycleBinBusy.value = true
    const operationId = taskCenter.start({
      name: '彻底删除回收站资源',
      phase: '删除归档及大文件数据',
    })
    try {
      await recycleBinService.purge(id, ({ completed, total }) => {
        taskCenter.update(operationId, {
          phase: '删除归档及大文件数据',
          progress: total ? completed / total : undefined,
          itemProgress: { completed, total },
        })
      })
      if (recycleUndoEntry.value?.id === id) recycleUndoEntry.value = undefined
      await Promise.all([loadRecycleBin(), refreshStorageHealth()])
      taskCenter.complete(operationId)
      showNotice('已彻底删除回收站资源。')
    } catch (error) {
      taskCenter.fail(operationId, error)
      showNotice(error instanceof Error ? error.message : '彻底删除失败')
    } finally {
      isRecycleBinBusy.value = false
    }
  }

  async function handleEmptyRecycleBin(): Promise<void> {
    if (!recycleBinEntries.value.length) return
    const confirmed = await confirmAction({
      title: '清空回收站',
      message: `将永久删除回收站中的 ${recycleBinEntries.value.length} 个档案，且无法恢复。确定继续吗？`,
      confirmLabel: '清空回收站',
      danger: true,
    })
    if (!confirmed) return
    isRecycleBinBusy.value = true
    const operationId = taskCenter.start({
      name: '清空回收站',
      phase: `删除归档 0/${recycleBinEntries.value.length}`,
    })
    try {
      await recycleBinService.empty(({ completed, total }) => {
        taskCenter.update(operationId, {
          phase: `删除归档 ${completed}/${total}`,
          progress: total ? completed / total : undefined,
          itemProgress: { completed, total },
        })
      })
      recycleUndoEntry.value = undefined
      await Promise.all([loadRecycleBin(), refreshStorageHealth()])
      taskCenter.complete(operationId)
      showNotice('回收站已清空。')
    } catch (error) {
      taskCenter.fail(operationId, error)
      showNotice(error instanceof Error ? error.message : '清空回收站失败')
    } finally {
      isRecycleBinBusy.value = false
    }
  }
  return {
    openRecycleBin,
    handleRestoreRecycleBinEntry,
    handlePurgeRecycleBinEntry,
    handleEmptyRecycleBin,
    isRecycleBinOpen,
    isRecycleBinBusy,
    recycleBinEntries,
    recycleUndoEntry,
    recycleBinSize,
    loadRecycleBin,
    moveResourcesToRecycleBin,
  }
}
