import type { Ref } from 'vue'

import { resourceService } from '../core/AppContainer'
import { confirmAction } from './UseConfirmDialog'
import type { ResourceVersionView } from '../services/ResourceService'
import type { Resource, ResourceSummary } from '../types/Resource'

interface ResourceVersionsContext {
  /** 详情页当前打开的资源，切换版本后就地替换。 */
  organizingResource: Ref<Resource | undefined>
  organizingVersions: Ref<ResourceVersionView[]>
  /** 详情页忙碌标记，防止版本操作并发。 */
  isOrganizing: Ref<boolean>
  resources: Ref<ResourceSummary[]>
  showNotice: (message: string) => void
  loadResources: () => Promise<void>
  refreshStorageHealth: () => Promise<void>
}

/**
 * 资源版本组操作。
 *
 * 当前版与历史版共用文件夹、标签与关联关系，这里只负责切换当前版、
 * 删除非当前版、维护版本备注以及把已有独立资源并入版本历史；
 * 任何一步都不改写原文件内容。
 */
export function useResourceVersions(context: ResourceVersionsContext) {
  async function reloadVersionState(resourceId: string): Promise<void> {
    context.organizingVersions.value = await resourceService.listVersions(resourceId)
    await context.loadResources()
  }

  async function handleActivateVersion(versionId: string): Promise<void> {
    const resource = context.organizingResource.value
    if (!resource || context.isOrganizing.value) return
    context.isOrganizing.value = true
    try {
      context.organizingResource.value = await resourceService.activateVersion(
        resource.id,
        versionId,
      )
      await reloadVersionState(resource.id)
      context.showNotice('已切换当前展示版本，刚才的版本已收入历史')
    } catch (error) {
      context.showNotice(error instanceof Error ? error.message : '版本切换失败')
    } finally {
      context.isOrganizing.value = false
    }
  }

  async function handleDeleteResourceVersion(versionId: string | string[]): Promise<void> {
    const resource = context.organizingResource.value
    if (!resource || context.isOrganizing.value) return
    const versionIds = Array.isArray(versionId) ? versionId : [versionId]
    const version = context.organizingVersions.value.find((item) =>
      (item.carriers ?? [item.resource]).some((carrier) => versionIds.includes(carrier.id)),
    )
    if (
      !version ||
      versionIds.includes(resource.id) ||
      (version.active && versionIds.includes(version.resource.id))
    )
      return
    const target = (version.carriers ?? [version.resource]).find((carrier) =>
      versionIds.includes(carrier.id),
    )
    const confirmed = await confirmAction({
      title: '删除历史版本',
      message:
        versionIds.length > 1
          ? `永久删除历史版本“${version.resource.versionLabel ?? version.resource.fileName}”及其 ${versionIds.length} 份封装吗？`
          : `永久删除历史文件“${target?.versionLabel ?? target?.fileName ?? version.resource.fileName}”吗？`,
      confirmLabel: '永久删除',
      danger: true,
    })
    if (!confirmed) return
    context.isOrganizing.value = true
    try {
      await resourceService.deleteVersions(resource.id, versionIds)
      context.organizingResource.value = await resourceService.get(resource.id)
      await reloadVersionState(resource.id)
      context.showNotice('历史版本已删除')
    } catch (error) {
      context.showNotice(error instanceof Error ? error.message : '历史版本删除失败')
    } finally {
      context.isOrganizing.value = false
    }
  }

  async function handleUpdateVersionNote(versionId: string, note: string): Promise<void> {
    const resource = context.organizingResource.value
    if (!resource || context.isOrganizing.value) return
    context.isOrganizing.value = true
    try {
      await resourceService.updateVersionNote(resource.id, versionId, note)
      context.organizingResource.value = await resourceService.get(resource.id)
      await reloadVersionState(resource.id)
      context.showNotice(note.trim() ? '版本备注已保存' : '版本备注已清除')
    } catch (error) {
      context.showNotice(error instanceof Error ? error.message : '版本备注保存失败')
    } finally {
      context.isOrganizing.value = false
    }
  }

  async function handleReplaceCharacterCardArtwork(file: File): Promise<void> {
    const resource = context.organizingResource.value
    if (!resource || context.isOrganizing.value) return
    context.isOrganizing.value = true
    try {
      context.organizingResource.value = await resourceService.replaceCharacterCardArtwork(
        resource.id,
        file,
      )
      await reloadVersionState(resource.id)
      context.showNotice('新卡面已保存为当前 PNG 封装，原卡面和原文件仍保留在同一版本中')
    } catch (error) {
      context.showNotice(error instanceof Error ? error.message : '更换卡面失败')
    } finally {
      context.isOrganizing.value = false
    }
  }

  async function handleMergeExistingVersion(sourceResourceId: string, note: string): Promise<void> {
    const resource = context.organizingResource.value
    if (!resource || context.isOrganizing.value) return
    const source = context.resources.value.find((item) => item.id === sourceResourceId)
    if (!source) {
      context.showNotice('要合并的资源已经不存在')
      return
    }
    const confirmed = await confirmAction({
      title: '并入历史版本',
      message: `把“${source.name}”从资源库列表移入“${resource.name}”的历史版本吗？原文件会保留在版本历史里。`,
      confirmLabel: '并入历史',
    })
    if (!confirmed) return
    context.isOrganizing.value = true
    try {
      context.organizingResource.value = await resourceService.mergeExistingResourceAsVersion(
        resource.id,
        sourceResourceId,
        note,
      )
      await reloadVersionState(resource.id)
      await context.refreshStorageHealth()
      context.showNotice('已手动加入历史版本')
    } catch (error) {
      context.showNotice(error instanceof Error ? error.message : '手动版本合并失败')
    } finally {
      context.isOrganizing.value = false
    }
  }

  return {
    handleActivateVersion,
    handleDeleteResourceVersion,
    handleUpdateVersionNote,
    handleMergeExistingVersion,
    handleReplaceCharacterCardArtwork,
  }
}
