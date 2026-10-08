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
import {
  categoryService,
  exportService,
  resourceGalleryService,
  resourceService,
} from '../core/AppContainer'
import {
  getRelatedResourceIds,
  isUserPersonaAvatarAttachment,
  RESOURCE_TYPE,
  type Resource,
  type ResourceReference,
} from '../types/Resource'
import { readCharacterCardOverrides } from '../utils/CharacterCardCustomization'
import { resourceCoverId } from '../types/ResourceGallery'
import { chooseAction } from './UseConfirmDialog'
import { hashBlob } from '../services/HashService'
import { downloadBlob } from '../utils/LibraryFormatting'
import { resourceDownloadFileHint } from '../services/ExportService'
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
    content?: 'original' | 'modified' | 'modifiedFile',
  ): Promise<void> {
    try {
      const fullResource =
        'originalBlob' in resource ? resource : await resourceService.get(resource.id)
      if (!fullResource) {
        showNotice('资源文件不存在或已被删除')
        return
      }
      if (!content) {
        const fileHint = resourceDownloadFileHint(fullResource)
        const choice = await chooseAction({
          title: '下载资源',
          message: `“${fullResource.name}”\n原版：原始文件。\n${fileHint ? `单文件：${fileHint}，包含已保存的内容修改。\n` : '此资源没有酒馆原生单文件格式。\n'}完整包：ZIP，包含内容修改、封面/图库和名称、标签、作者备注、文件夹及关联信息，可导回资源库。未保存的编辑不包含在内。角色卡采用选定封面，JSON 卡无卡面时使用空白 PNG；图库、收藏等资源库信息仅在完整包中保留。`,
          confirmLabel: fileHint ? '修改版单文件' : '完整修改包',
          alternativeLabel: '下载原版',
          additionalLabel: fileHint ? '完整修改包' : undefined,
          cancelLabel: '取消',
          centered: true,
        })
        if (choice === 'cancel') return
        content =
          choice === 'alternative'
            ? 'original'
            : choice === 'confirm' && fileHint
              ? 'modifiedFile'
              : 'modified'
      }
      let prepared = fullResource
      if (
        content === 'modified' &&
        fullResource.type === 'pocketPhone' &&
        fullResource.metadata.personalDocument
      ) {
        const { personalResourceService } = await import('../core/PersonalResourceContainer')
        const file = await personalResourceService.exportFile(fullResource)
        prepared = {
          ...fullResource,
          originalBlob: file,
          fileName: file.name,
          mimeType: file.type,
          fileSize: file.size,
          contentHash: await hashBlob(file),
        }
      }
      let blob = prepared.originalBlob
      let fileName = prepared.fileName
      if (content !== 'original') {
        const attachments: Resource[] = []
        const imageIds = new Set(
          content === 'modified'
            ? (await resourceGalleryService.listExportImages(fullResource.id)).map(
                (image) => image.id,
              )
            : [],
        )
        const coverId = resourceCoverId(fullResource)
        if (
          coverId &&
          (content === 'modified' || fullResource.type === RESOURCE_TYPE.CHARACTER_CARD)
        )
          imageIds.add(coverId)
        for (const id of imageIds) {
          const image = await resourceService.get(id)
          if (!image) throw new Error('图库图片已不存在，请重新打开资源后下载')
          attachments.push(image)
        }
        if (content === 'modified' && fullResource.type === RESOURCE_TYPE.USER_PERSONA) {
          for (const id of getRelatedResourceIds(fullResource)) {
            const related = await resourceService.get(id)
            if (related && isUserPersonaAvatarAttachment(related)) attachments.push(related)
          }
        }
        const replacements: Resource[] = []
        const overrides = readCharacterCardOverrides(fullResource.metadata)
        for (const id of new Set([overrides.worldBookResourceId, overrides.greetingResourceId])) {
          if (!id) continue
          const related = await resourceService.get(id)
          if (related) replacements.push(related)
        }
        if (content === 'modifiedFile') {
          const file = await exportService.createResourceDownloadFile(
            prepared,
            attachments,
            replacements,
          )
          blob = file
          fileName = file.name
        } else {
          const archive = await exportService.createResourceDownloadArchive(
            prepared,
            attachments,
            await categoryService.list(),
            replacements,
          )
          blob = archive.blob
          fileName = archive.fileName
        }
      }
      const contentLabel =
        content === 'original' ? '原版' : content === 'modifiedFile' ? '修改版单文件' : '完整修改包'
      if (isNativeFileExportAvailable()) {
        await prepareNativeExport(blob, fileName, contentLabel)
        return
      }
      await downloadBlob(blob, fileName)
      showNotice(`已下载${contentLabel} ${fileName}`)
    } catch (error) {
      showNotice(error instanceof Error ? error.message : '资源导出失败')
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
