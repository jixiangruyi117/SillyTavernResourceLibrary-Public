import { ref, shallowRef } from 'vue'
import {
  chooseNativeExportDirectory,
  getNativeExportDirectoryStatus,
  getNativeExportPreference,
  isNativeFileExportAvailable,
  saveBlobToNativeDestination,
  setNativeExportPreference,
  type NativeExportDestination,
} from '../core/NativeFileExport'
import { resourceService } from '../core/AppContainer'
import { getRelatedResourceIds, type ResourceReference } from '../types/Resource'
import { createModifiedCharacterResource } from '../utils/CharacterCardCustomization'
import { downloadBlob } from '../utils/LibraryFormatting'
interface NativeResourceExportContext {
  showNotice: (message: string) => void
}
export function useNativeResourceExport(context: NativeResourceExportContext) {
  const { showNotice } = context
  const pendingNativeExport = shallowRef<{
    blob: Blob
    fileName: string
    contentLabel: string
    isImage: boolean
  }>()

  const isNativeExportBusy = ref(false)

  async function handleResourceDownload(
    resource: ResourceReference,
    content: 'original' | 'modified' = 'original',
  ): Promise<void> {
    try {
      const fullResource =
        'originalBlob' in resource ? resource : await resourceService.get(resource.id)
      if (!fullResource) {
        showNotice('资源文件不存在或已被删除')
        return
      }
      const relatedResources =
        content === 'modified'
          ? (
              await Promise.all(
                getRelatedResourceIds(fullResource).map((resourceId) =>
                  resourceService.get(resourceId),
                ),
              )
            ).flatMap((item) => (item ? [item] : []))
          : []
      let exported =
        content === 'modified'
          ? await createModifiedCharacterResource(fullResource, relatedResources)
          : fullResource
      if (fullResource.type === 'pocketPhone' && fullResource.metadata.personalDocument) {
        const { personalResourceService } = await import('../core/PersonalResourceContainer')
        const file = await personalResourceService.exportFile(fullResource)
        exported = { ...fullResource, originalBlob: file, fileName: file.name }
      }
      if (isNativeFileExportAvailable()) {
        await prepareNativeExport(
          exported.originalBlob,
          exported.fileName,
          content === 'modified' ? '修改版' : '原版',
        )
        return
      }
      await downloadBlob(exported.originalBlob, exported.fileName)
      showNotice(`已下载${content === 'modified' ? '修改版' : '原版'} ${exported.fileName}`)
    } catch (error) {
      showNotice(error instanceof Error ? error.message : '角色卡导出失败')
    }
  }

  async function prepareNativeExport(
    blob: Blob,
    fileName: string,
    contentLabel: string,
  ): Promise<void> {
    const isImage = blob.type.startsWith('image/') || /\.(?:png|jpe?g|webp)$/iu.test(fileName)
    const preference = getNativeExportPreference(isImage ? 'image' : 'file')
    if (preference === 'ask') {
      pendingNativeExport.value = { blob, fileName, contentLabel, isImage }
      return
    }
    await saveNativeExport(blob, fileName, contentLabel, isImage, preference)
  }

  async function saveNativeExport(
    blob: Blob,
    fileName: string,
    contentLabel: string,
    isImage: boolean,
    destination: NativeExportDestination,
    remember = false,
  ): Promise<void> {
    isNativeExportBusy.value = true
    try {
      if (destination === 'directory') {
        const status = await getNativeExportDirectoryStatus()
        const selected = status?.available ? status : await chooseNativeExportDirectory()
        if (!selected?.available) {
          showNotice('未选择可写入的导出文件夹')
          return
        }
      }
      await saveBlobToNativeDestination(blob, fileName, destination)
      if (remember) setNativeExportPreference(isImage ? 'image' : 'file', destination)
      pendingNativeExport.value = undefined
      showNotice(
        `已保存${contentLabel} ${fileName} 到${
          destination === 'pictures'
            ? '相册'
            : destination === 'downloads'
              ? '下载目录'
              : '所选文件夹'
        }`,
      )
    } catch (error) {
      showNotice(error instanceof Error ? error.message : '保存文件失败')
    } finally {
      isNativeExportBusy.value = false
    }
  }

  async function handleNativeExportSelection(
    destination: NativeExportDestination,
    remember: boolean,
  ): Promise<void> {
    const pending = pendingNativeExport.value
    if (!pending) return
    await saveNativeExport(
      pending.blob,
      pending.fileName,
      pending.contentLabel,
      pending.isImage,
      destination,
      remember,
    )
  }

  async function sharePendingNativeExport(): Promise<void> {
    const pending = pendingNativeExport.value
    if (!pending) return
    isNativeExportBusy.value = true
    try {
      await downloadBlob(pending.blob, pending.fileName)
      pendingNativeExport.value = undefined
      showNotice(`已打开${pending.contentLabel}的系统分享`)
    } catch (error) {
      showNotice(error instanceof Error ? error.message : '打开系统分享失败')
    } finally {
      isNativeExportBusy.value = false
    }
  }
  return {
    handleResourceDownload,
    handleNativeExportSelection,
    sharePendingNativeExport,
    pendingNativeExport,
    isNativeExportBusy,
  }
}
