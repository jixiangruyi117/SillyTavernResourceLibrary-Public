import type { ComputedRef } from 'vue'
import { confirmAction } from '../composables/UseConfirmDialog'
import { resourceService } from '../core/AppContainer'
import type { WorkshopVersion } from '../types/FrontendWorkshopLegacyApp'
import type { WorkshopSampleIssue } from '../utils/FrontendWorkshop'
import { downloadBlob } from '../utils/LibraryFormatting'
import type { useWorkshopSessionState } from './UseWorkshopSessionState'

interface WorkshopDeliveryContext extends Pick<
  ReturnType<typeof useWorkshopSessionState>,
  | 'copied'
  | 'savingBundle'
  | 'libraryStatus'
  | 'currentIndex'
  | 'versions'
  | 'versionManageMode'
  | 'selectedVersionIds'
  | 'sample'
  | 'activeStep'
> {
  current: ComputedRef<WorkshopVersion | undefined>
  blockingSampleIssue: ComputedRef<WorkshopSampleIssue | undefined>
  worldbookJson: ComputedRef<string>
  regexJson: ComputedRef<string>
  emit: ((event: 'back') => void) & ((event: 'libraryChanged') => void)
  saveVersions: () => void
}

export function useWorkshopDelivery(getContext: () => WorkshopDeliveryContext) {
  async function copy(value: string, label: string): Promise<void> {
    const context = getContext()

    await navigator.clipboard.writeText(value)
    context.copied.value = label
    window.setTimeout(() => {
      if (context.copied.value === label) context.copied.value = ''
    }, 1600)
  }

  function safeBundleFileName(value: string): string {
    return (
      Array.from(value)
        .filter((character) => character.charCodeAt(0) >= 32)
        .join('')
        .trim()
        .replace(/[<>:"/\\|?*]/g, '-')
        .replace(/[.\s]+$/g, '')
        .slice(0, 80) || '状态栏'
    )
  }

  async function downloadWorkshopJson(kind: 'worldbook' | 'regex'): Promise<void> {
    const context = getContext()

    if (!context.current.value || context.blockingSampleIssue.value) return
    const fileName = safeBundleFileName(context.current.value.artifact.title)
    const content = kind === 'worldbook' ? context.worldbookJson.value : context.regexJson.value
    const suffix = kind === 'worldbook' ? '.world.json' : '.regex.json'
    await downloadBlob(
      new Blob([content], { type: 'application/json;charset=utf-8' }),
      `${fileName}${suffix}`,
    )
  }

  async function saveBundleToLibrary(): Promise<void> {
    const context = getContext()

    if (!context.current.value || context.savingBundle.value) return
    if (context.blockingSampleIssue.value) {
      context.libraryStatus.value = `当前版本不能交付：${context.blockingSampleIssue.value.message}`
      return
    }
    context.savingBundle.value = true
    context.libraryStatus.value = ''
    try {
      const fileName = safeBundleFileName(context.current.value.artifact.title)
      const results = await resourceService.importFiles(
        [
          new File([context.regexJson.value], `${fileName}.regex.json`, {
            type: 'application/json',
          }),
          new File([context.worldbookJson.value], `${fileName}.world.json`, {
            type: 'application/json',
          }),
        ],
        { detectVersions: false },
      )
      const failure = results.find((result) => result.status === 'failed')
      if (failure?.status === 'failed') throw new Error(failure.message)
      const ids = results.flatMap((result) =>
        result.status === 'imported' || result.status === 'duplicate' ? [result.resource.id] : [],
      )
      if (ids.length !== 2) throw new Error('配套资源未完整入库，请检查生成结果后重试')

      await resourceService.linkResources(ids)
      context.libraryStatus.value = '已保存正则与世界书，并在资源库中建立双向关联'
      context.emit('libraryChanged')
    } catch (cause) {
      context.libraryStatus.value = cause instanceof Error ? cause.message : '保存配套资源失败'
    } finally {
      context.savingBundle.value = false
    }
  }

  function move(delta: number): void {
    const context = getContext()

    context.currentIndex.value = Math.min(
      context.versions.value.length - 1,
      Math.max(0, context.currentIndex.value + delta),
    )
  }

  function toggleVersionManagement(): void {
    const context = getContext()

    context.versionManageMode.value = !context.versionManageMode.value
    context.selectedVersionIds.value = []
  }

  function toggleVersionSelection(versionId: string): void {
    const context = getContext()

    context.selectedVersionIds.value = context.selectedVersionIds.value.includes(versionId)
      ? context.selectedVersionIds.value.filter((id) => id !== versionId)
      : [...context.selectedVersionIds.value, versionId]
  }

  function selectAllVersions(): void {
    const context = getContext()

    context.selectedVersionIds.value =
      context.selectedVersionIds.value.length === context.versions.value.length
        ? []
        : context.versions.value.map((version) => version.id)
  }

  async function deleteSelectedVersions(): Promise<void> {
    const context = getContext()

    if (!context.selectedVersionIds.value.length) return
    const deletingAll = context.selectedVersionIds.value.length === context.versions.value.length
    const confirmed = await confirmAction({
      title: deletingAll
        ? '清空全部状态栏校样？'
        : `删除 ${context.selectedVersionIds.value.length} 个版本？`,
      message: deletingAll
        ? '删除后将回到设计步骤。此操作只删除本机生成历史，不影响已经保存到资源库的正则和世界书。'
        : '被删除的校样版本无法恢复；草稿中已经单独保存的旧副本不会自动改写。',
      confirmLabel: deletingAll ? '清空校样' : '删除所选',
      cancelLabel: '取消',
      danger: true,
    })
    if (!confirmed) return
    const currentId = context.current.value?.id
    const previousIndex = context.currentIndex.value
    const selected = new Set(context.selectedVersionIds.value)
    context.versions.value = context.versions.value.filter((version) => !selected.has(version.id))
    if (!context.versions.value.length) {
      context.currentIndex.value = 0
      context.sample.value = ''
      context.activeStep.value = 'design'
    } else {
      const keptCurrentIndex = currentId
        ? context.versions.value.findIndex((version) => version.id === currentId)
        : -1
      context.currentIndex.value =
        keptCurrentIndex >= 0
          ? keptCurrentIndex
          : Math.min(previousIndex, context.versions.value.length - 1)
    }
    context.selectedVersionIds.value = []
    context.versionManageMode.value = false
    context.saveVersions()
    context.libraryStatus.value = deletingAll
      ? '已清空本机状态栏校样历史'
      : '已删除所选状态栏校样版本'
  }
  return {
    copy,
    safeBundleFileName,
    downloadWorkshopJson,
    saveBundleToLibrary,
    move,
    toggleVersionManagement,
    toggleVersionSelection,
    selectAllVersions,
    deleteSelectedVersions,
  }
}
