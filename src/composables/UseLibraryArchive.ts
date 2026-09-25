import { createResourceArchiveSource } from '../services/ExportService'
import { selectPreparedRestore } from '../services/RestoreService'
import { canRestoreOnlyPortableData } from '../services/BackupRestoreSelection'
import { includePersonalResource, plaintextSecretCopies } from '../services/PersonalResourceBackup'
import { requestSecretPassword } from './UseSecretPasswordPrompt'
import type { Ref } from 'vue'
import { confirmAction } from '../composables/UseConfirmDialog'
import {
  aiTaggingDraftService,
  browserStorageService,
  characterDrawService,
  cloudBackupService,
  exportPortableCredentialBundle,
  exportService,
  externalAppService,
  historyService,
  importPortableCredentialBundle,
  mainApiService,
  resourceService,
  restoreService,
} from '../core/AppContainer'
import { mutationGuard } from '../core/MutationGuard'
import { triggerNativeHaptic } from '../core/NativeHaptics'
import {
  getNativeSafBackupStatus,
  openNativeSafBackupWriter,
  saveBlobToNativeSafBackup,
} from '../core/NativeSafBackup'
import { taskCenter } from '../core/TaskCenter'
import type { StorageHealth } from '../services/BrowserStorageService'
import type {
  ArchivePortableData,
  ArchivePortableSelection,
  PreparedRestore,
  RestoreMode,
  RestoreReport,
} from '../types/Backup'
import { type Category, type ResourceSummary } from '../types/Resource'
import { downloadBlob, formatBytes } from '../utils/LibraryFormatting'

interface LibraryArchiveContext {
  isExporting: Ref<boolean, boolean>
  categories: Ref<Category[]>
  showNotice: (message: string, duration?: number, preserveRecycleUndo?: boolean) => void
  lastFullBackupAt: Ref<number | undefined, number | undefined>
  backupRecommended: Ref<boolean, boolean>
  isExportPanelOpen: Ref<boolean, boolean>
  refreshStorageHealth: () => Promise<void>
  historySnapshotLimit: Ref<number, number>
  reloadAppearanceSettings: () => void
  searchHistory: Ref<string[], string[]>
  cabinetResourceIds: Ref<string[], string[]>
  syncCustomUiCss: () => void
  preparedRestore: Ref<PreparedRestore | undefined>
  restoreSourceFile: Ref<File | undefined>
  restoreReport: Ref<RestoreReport | undefined>
  restoreEntry: Ref<'import' | 'export'>
  completedRestoreMode: Ref<RestoreMode>
  isRestorePanelOpen: Ref<boolean, boolean>
  storageHealth: Ref<StorageHealth>
  LARGE_ARCHIVE_BYTES: number
  isRestoring: Ref<boolean, boolean>
  resources: Ref<ResourceSummary[]>
  captureHistory: (reason: string) => Promise<void>
  loadLibrary: () => Promise<void>
}

export function useLibraryArchive(getContext: () => LibraryArchiveContext) {
  async function handleExport(details: {
    mode: 'full' | 'partial'
    resourceIds?: string[]
    includeAllCategories?: boolean
    splitSizeBytes?: number
    resourceContent: 'original' | 'modified'
    portableSelection: ArchivePortableSelection
  }): Promise<void> {
    return mutationGuard.run('archive:export', () => performExport(details))
  }

  async function performExport(details: {
    mode: 'full' | 'partial'
    resourceIds?: string[]
    includeAllCategories?: boolean
    splitSizeBytes?: number
    resourceContent: 'original' | 'modified'
    portableSelection: ArchivePortableSelection
  }): Promise<void> {
    const context = getContext()

    context.isExporting.value = true
    const controller = new AbortController()
    const checkCancelled = (): void => {
      if (controller.signal.aborted) throw controller.signal.reason
    }
    const operationId = taskCenter.start({
      name: '导出备份',
      phase: '收集可移植设置',
      cancelable: true,
      cancel: () => controller.abort(new DOMException('导出已取消', 'AbortError')),
    })
    let archiveName = ''
    const transfer = {
      signal: controller.signal,
      onProgress: ({ writtenBytes, fileName }: { writtenBytes: number; fileName?: string }) => {
        if (fileName !== archiveName) {
          archiveName = fileName ?? ''
          taskCenter.update(operationId, { phase: `生成 ZIP：${archiveName}` })
        }
        taskCenter.updateTransfer(operationId, { transferredBytes: writtenBytes })
      },
    }
    try {
      const portableData: ArchivePortableData = { version: 1 }
      if (details.portableSelection.appearance) {
        portableData.appearance = browserStorageService.exportAppearanceSettings()
      }
      if (details.portableSelection.cloudBackup) {
        portableData.cloudBackup = cloudBackupService.exportPortableSettings()
      }
      if (details.portableSelection.characterDraw) {
        portableData.characterDraw = {
          state: await characterDrawService.load(),
          showNames: browserStorageService.getDrawShowNames(),
        }
      }
      if (details.portableSelection.generalPreferences) {
        portableData.generalPreferences = {
          ...browserStorageService.exportGeneralPreferences(),
          historySnapshotLimit: await historyService.getSnapshotLimit(),
        }
      }
      if (details.portableSelection.mainApiProfiles) {
        portableData.mainApiProfiles = mainApiService.getProfilesState()
        portableData.credentials = await exportPortableCredentialBundle()
      }
      if (details.portableSelection.aiTaggingState) {
        portableData.aiTaggingState = {
          draft: aiTaggingDraftService.loadDraft(),
          undo: aiTaggingDraftService.loadUndo(),
        }
      }
      if (details.portableSelection.externalApps) {
        portableData.externalApps = await externalAppService.exportPortableState()
      }
      if (details.portableSelection.chatReader)
        portableData.chatReader = await externalAppService.exportReaderData()
      if (details.portableSelection.stitchWork) {
        portableData.stitchWork = browserStorageService.exportStitchWork()
      }
      checkCancelled()
      taskCenter.update(operationId, { phase: '读取资源与版本摘要' })
      const source = await createResourceArchiveSource(resourceService)
      checkCancelled()
      const allResources = source.resources
      if (details.portableSelection.plaintextSecretCopy) {
        const confirmed = await confirmAction({
          title: '明文密钥副本',
          message:
            '导出的备份清单将包含所选密钥卡的私密字段，拿到文件的人可以直接读取。加密原件同时保留。',
          confirmLabel: '继续导出明文副本',
        })
        if (!confirmed) {
          taskCenter.cancelled(operationId)
          return
        }
        checkCancelled()
        const password = await requestSecretPassword('输入查看密码，为所选密钥卡生成明文副本。')
        if (!password) {
          taskCenter.cancelled(operationId)
          return
        }
        checkCancelled()
        const selected = allResources.filter(
          (resource) =>
            includePersonalResource(resource, details.portableSelection.personalResources) &&
            (details.mode === 'full' || details.resourceIds?.includes(resource.id)),
        )
        portableData.plaintextSecretCopies = []
        for (const summary of selected) {
          checkCancelled()
          if (summary.type !== 'secret') continue
          portableData.plaintextSecretCopies.push(
            ...(await plaintextSecretCopies([await source.read(summary, false)], password)),
          )
        }
      }
      const archiveOptions = {
        ...details,
        personalResources: details.portableSelection.personalResources,
        portableData,
      }
      const nativeSafStatus = await getNativeSafBackupStatus().catch(() => null)
      checkCancelled()
      taskCenter.update(operationId, { phase: '流式压缩并写入目标' })
      const streamedArchives = nativeSafStatus?.available
        ? await exportService.createArchivesFromSource(
            source,
            context.categories.value,
            archiveOptions,
            async (fileName) => {
              const writer = await openNativeSafBackupWriter(fileName)
              if (!writer) throw new Error('系统备份文件夹授权已失效')
              return writer
            },
            transfer,
          )
        : undefined
      const archives = streamedArchives
        ? []
        : await exportService.createArchivesFromSource(
            source,
            context.categories.value,
            archiveOptions,
            undefined,
            transfer,
          )
      checkCancelled()
      let savedToSafCount = 0
      if (streamedArchives) savedToSafCount = streamedArchives.length
      for (const archive of archives) {
        checkCancelled()
        taskCenter.update(operationId, {
          phase: `保存或分享：${archive.fileName}`,
          cancelable: false,
        })
        let savedToSaf = false
        try {
          savedToSaf = await saveBlobToNativeSafBackup(archive.blob, archive.fileName)
        } catch (error) {
          context.showNotice(
            error instanceof Error
              ? `系统备份文件夹写入失败：${error.message}；已改为常规分享保存`
              : '系统备份文件夹写入失败；已改为常规分享保存',
            7000,
          )
        }
        if (savedToSaf) savedToSafCount += 1
        else await downloadBlob(archive.blob, archive.fileName)
        await new Promise<void>((continueDownload) => window.setTimeout(continueDownload, 120))
      }
      if (details.mode === 'full') {
        browserStorageService.recordFullBackup()
        context.lastFullBackupAt.value = browserStorageService.getLastFullBackupAt()
        context.backupRecommended.value = false
      }
      context.isExportPanelOpen.value = false
      taskCenter.complete(operationId)
      context.showNotice(
        (streamedArchives ?? archives).length > 1
          ? `已导出 ${(streamedArchives ?? archives).length} 个分卷，共 ${(streamedArchives ?? archives).reduce((sum, item) => sum + item.resourceCount, 0)} 项资源${savedToSafCount ? `；其中 ${savedToSafCount} 个已保存到系统备份文件夹` : ''}`
          : `已导出 ${(streamedArchives ?? archives)[0]?.resourceCount ?? 0} 项资源${savedToSafCount ? '，已保存到系统备份文件夹' : ''}`,
      )
      triggerNativeHaptic('success')
      await context.refreshStorageHealth()
    } catch (error) {
      if (controller.signal.aborted || (error instanceof Error && error.name === 'AbortError'))
        taskCenter.cancelled(operationId)
      else taskCenter.fail(operationId, error)
      context.showNotice(error instanceof Error ? error.message : '导出失败')
    } finally {
      context.isExporting.value = false
    }
  }

  async function restorePortableData(data?: ArchivePortableData): Promise<void> {
    const context = getContext()

    if (!data) return
    const credentialLabels = [
      data.mainApiProfiles?.profiles.some((profile) => profile.apiKey) ? '主 API 密钥' : '',
      data.credentials?.imageGeneration?.length ? '生图 API 密钥' : '',
      data.credentials?.imageHosting ? '自建图床 Token' : '',
      data.credentials?.legacyFrontendWorkshopApi?.apiKey ? '旧状态项目专用 API 密钥' : '',
      data.credentials?.discordSource?.botToken ? 'Discord Bot Token' : '',
      data.credentials?.cloudBackup && Object.keys(data.credentials.cloudBackup).length
        ? '云备份凭据'
        : '',
    ].filter(Boolean)
    const importCredentials =
      !credentialLabels.length ||
      (await confirmAction({
        title: '导入本机凭据',
        message: `这个备份包含：${credentialLabels.join('、')}。导入后会写入当前设备的受保护存储，确认继续吗？`,
        confirmLabel: '导入凭据',
      }))
    if (data.appearance) browserStorageService.importAppearanceSettings(data.appearance)
    if (data.cloudBackup) cloudBackupService.importPortableSettings(data.cloudBackup)
    if (data.characterDraw) {
      await characterDrawService.importState(data.characterDraw.state)
      browserStorageService.setDrawShowNames(data.characterDraw.showNames)
    }
    if (data.generalPreferences) {
      browserStorageService.importGeneralPreferences(data.generalPreferences)
      if (typeof data.generalPreferences.historySnapshotLimit === 'number') {
        context.historySnapshotLimit.value = await historyService.setSnapshotLimit(
          data.generalPreferences.historySnapshotLimit,
        )
      }
    }
    if (data.mainApiProfiles && importCredentials) {
      mainApiService.importProfilesState(data.mainApiProfiles)
      await mainApiService.awaitCredentialWrites()
    }
    if (data.credentials && importCredentials) {
      await importPortableCredentialBundle(data.credentials)
    }
    if (data.aiTaggingState?.draft) aiTaggingDraftService.saveDraft(data.aiTaggingState.draft)
    if (data.aiTaggingState?.undo) aiTaggingDraftService.saveUndo(data.aiTaggingState.undo)
    if (data.externalApps) await externalAppService.importPortableState(data.externalApps)
    if (data.chatReader) await externalAppService.importReaderData(data.chatReader)
    if (data.stitchWork) browserStorageService.importStitchWork(data.stitchWork)
    if (data.plaintextSecretCopies?.length) {
      const { restorePlainSecretCopies } = await import('../core/PersonalResourceContainer')
      await restorePlainSecretCopies(data.plaintextSecretCopies)
    }
    context.reloadAppearanceSettings()
    context.searchHistory.value = browserStorageService.getSearchHistory()
    context.cabinetResourceIds.value = browserStorageService.getCabinetResourceIds()
    context.syncCustomUiCss()
  }

  function openRestorePanel(entry: 'import' | 'export' = 'export'): void {
    const context = getContext()

    context.isExportPanelOpen.value = false
    context.preparedRestore.value = undefined
    context.restoreSourceFile.value = undefined
    context.restoreReport.value = undefined
    context.restoreEntry.value = entry
    context.completedRestoreMode.value = 'merge'
    context.isRestorePanelOpen.value = true
  }

  async function handleRestoreInspect(file: File): Promise<void> {
    const context = getContext()

    const remainingBytes = Math.max(
      0,
      context.storageHealth.value.quota - context.storageHealth.value.usage,
    )
    const mayExceedRemainingSpace = remainingBytes > 0 && file.size * 2 > remainingBytes
    if (
      (file.size >= context.LARGE_ARCHIVE_BYTES || mayExceedRemainingSpace) &&
      !(await confirmAction({
        title: '大备份包预检',
        message: `该备份包为 ${formatBytes(file.size)}，解压校验可能临时占用约 2 倍空间。${
          remainingBytes ? `当前剩余配额约 ${formatBytes(remainingBytes)}。` : ''
        }将使用分块读取，是否继续？`,
        confirmLabel: '继续预检',
      }))
    ) {
      return
    }
    context.isRestoring.value = true
    const operationId = taskCenter.start({ name: '备份预检', phase: '流式解压并校验' })
    context.restoreSourceFile.value = file
    context.preparedRestore.value = undefined
    context.restoreReport.value = undefined
    try {
      context.preparedRestore.value = await restoreService.prepare(
        file,
        context.resources.value,
        context.categories.value,
        true,
      )
      taskCenter.complete(operationId)
    } catch (error) {
      taskCenter.fail(operationId, error)
      context.showNotice(error instanceof Error ? error.message : '备份预检失败')
    } finally {
      context.isRestoring.value = false
    }
  }

  async function handleRestoreConfirm(mode: RestoreMode, resourceIds: string[]): Promise<void> {
    const context = getContext()

    const prepared = context.preparedRestore.value
    if (!prepared) return
    const selectedIds = new Set(resourceIds)
    if (!selectedIds.size && !(mode === 'merge' && canRestoreOnlyPortableData(prepared))) {
      context.showNotice('请至少选择一项资源后继续')
      return
    }
    if (mode === 'replace' && selectedIds.size !== prepared.resources.length) {
      context.showNotice('整库覆盖必须选择全部资源；部分选择请使用安全新增')
      return
    }
    if (mode === 'replace' && prepared.preview.mode !== 'full') {
      context.showNotice('只有完整备份可以覆盖整个资源库')
      return
    }
    if (
      mode === 'replace' &&
      !(await confirmAction({
        title: '整库覆盖',
        message: `确定用“${prepared.preview.fileName}”完整覆盖当前资源库吗？现有数据会先保存为本地安全快照。`,
        confirmLabel: '覆盖整库',
        danger: true,
      }))
    ) {
      return
    }

    const selected =
      mode === 'replace' || selectedIds.size === prepared.resources.length
        ? prepared
        : selectPreparedRestore(prepared, selectedIds)
    return mutationGuard.run(`archive:restore:${mode}`, () => performRestoreConfirm(selected, mode))
  }

  async function performRestoreConfirm(
    prepared: PreparedRestore,
    mode: RestoreMode,
  ): Promise<void> {
    const context = getContext()

    context.isRestoring.value = true
    const operationId = taskCenter.start({ name: '恢复备份', phase: '创建恢复前安全快照' })
    try {
      await context.captureHistory('导入备份前自动快照')
      taskCenter.update(operationId, {
        phase: mode === 'replace' ? '覆盖写入资源库' : '合并写入资源库',
        progress: 0.35,
      })
      if (mode === 'replace') {
        const sourceFile = context.restoreSourceFile.value
        if (!sourceFile) throw new Error('备份源文件已经不可用，请重新选择')
        const replacement = await restoreService.prepare(sourceFile, [], [], true)
        context.restoreReport.value = await restoreService.replace(replacement)
        await restorePortableData(replacement.portableData)
      } else {
        context.restoreReport.value = await restoreService.restore(prepared)
        await restorePortableData(prepared.portableData)
      }
      context.completedRestoreMode.value = mode
      taskCenter.update(operationId, { phase: '刷新资源与索引', progress: 0.85 })
      await context.loadLibrary()
      context.preparedRestore.value = undefined
      taskCenter.complete(operationId)
    } catch (error) {
      taskCenter.fail(operationId, error)
      const reason = error instanceof Error ? `：${error.message}` : ''
      context.showNotice(`恢复写入失败，数据库事务已回滚${reason}`)
    } finally {
      context.isRestoring.value = false
    }
  }
  return {
    handleExport,
    performExport,
    restorePortableData,
    openRestorePanel,
    handleRestoreInspect,
    handleRestoreConfirm,
    performRestoreConfirm,
  }
}
