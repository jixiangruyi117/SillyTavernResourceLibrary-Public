import type { ComputedRef, Ref, ShallowRef } from 'vue'
import { computed, nextTick } from 'vue'
import {
  categoryService,
  historyService,
  resourceArchiveService,
  resourceService,
} from '../core/AppContainer'
import { triggerNativeHaptic } from '../core/NativeHaptics'
import { confirmChatImports } from './UseChatImportConfirmation'
import { confirmAction } from './UseConfirmDialog'
import type { ImportVersionCandidate } from '../types/Import'
import {
  analyzeResourceLink,
  getResourceLinkRiskBadges,
  RESOURCE_INSTALL_TARGET,
  RESOURCE_INSTALL_TARGET_LABELS,
  RESOURCE_LINK_PURPOSE,
  RESOURCE_LINK_PURPOSE_LABELS,
  RESOURCE_LINK_TYPE,
  type ResourceLink,
} from '../types/Resource'
import { summarizeFileNames, summarizeResourceTypes } from '../utils/LibraryFormatting'
import { createResourceArchiveSource } from '../services/ExportService'

interface LibraryImportContext {
  pendingBackupImport: Ref<File | undefined>
  showNotice: (message: string, duration?: number, preserveRecycleUndo?: boolean) => void
  activeVersionImport: ComputedRef<ImportVersionCandidate | undefined>
  isNativeApk: boolean
  isBusy: Ref<boolean, boolean>
  isSystemFileDropActive: Ref<boolean, boolean>
  linkImportUrls: ComputedRef<string[]>
  loadResources: () => Promise<void>
  linkImportText: Ref<string, string>
  isLinkImportOpen: Ref<boolean, boolean>
  isImportChooserOpen: Ref<boolean, boolean>
  isFeatureHubOpen: Ref<boolean, boolean>
  fileImportInput: Readonly<ShallowRef<HTMLInputElement | null>>
  tavernBackupInput: Readonly<ShallowRef<HTMLInputElement | null>>
  openRestorePanel: (entry?: 'import' | 'export') => void
  handleRestoreInspect: (file: File) => Promise<void>
  extractCharacterAssets: Ref<boolean, boolean>
  pendingVersionImports: Ref<ImportVersionCandidate[]>
  LARGE_IMPORT_BYTES: number
  backupRecommended: Ref<boolean, boolean>
  hideCharacterAssets: Ref<boolean, boolean>
  refreshStorageHealth: () => Promise<void>
  isVersionImportBusy: Ref<boolean, boolean>
}

interface ImportTotals {
  imported: number
  duplicate: number
  failed: number
  firstFailure: string
}

export function useLibraryImport(getContext: () => LibraryImportContext) {
  const linkImportUrls = computed(() => splitLinkImportText(getContext().linkImportText.value))

  const linkImportPreview = computed(() => {
    const url = linkImportUrls.value[0]
    if (!url) return undefined
    const analysis = analyzeResourceLink(url)
    if (!analysis.url || !analysis.type) return { valid: false as const, url }
    const link: ResourceLink = {
      id: 'preview',
      label: '',
      url: analysis.url,
      type: analysis.type,
      purpose: analysis.purpose ?? RESOURCE_LINK_PURPOSE.SOURCE_POST,
      installTarget: analysis.installTarget ?? RESOURCE_INSTALL_TARGET.NONE,
      trustMode: analysis.trustMode,
      versionRef: analysis.versionRef,
      github: analysis.github,
      createdAt: 0,
    }
    return {
      valid: true as const,
      url: analysis.url,
      purposeLabel: RESOURCE_LINK_PURPOSE_LABELS[link.purpose ?? RESOURCE_LINK_PURPOSE.SOURCE_POST],
      installTargetLabel:
        link.type === RESOURCE_LINK_TYPE.GITHUB &&
        link.purpose === RESOURCE_LINK_PURPOSE.REPOSITORY &&
        link.installTarget === RESOURCE_INSTALL_TARGET.NONE
          ? '用途待读取'
          : RESOURCE_INSTALL_TARGET_LABELS[link.installTarget ?? RESOURCE_INSTALL_TARGET.NONE],
      badges: getResourceLinkRiskBadges(link),
      github: link.github,
      versionRef: link.versionRef,
    }
  })

  const LARGE_IMPORT_FILE_COUNT = 20

  function splitLinkImportText(value: string): string[] {
    return Array.from(
      new Set(
        value
          .split(/[\s,，]+/)
          .map((item) => item.trim())
          .filter(Boolean),
      ),
    )
  }

  async function handleImport(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement
    const selectedFiles = Array.from(input.files ?? [])
    input.value = ''

    await processImportedFiles(selectedFiles)
  }

  async function handleTavernBackupImport(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement
    const file = input.files?.[0]
    input.value = ''
    if (!file) return
    const context = getContext()
    if (context.isBusy.value) return
    if (!/\.zip$/i.test(file.name)) {
      context.showNotice('酒馆备份必须是 ZIP 文件。普通资源请使用“导入本地资源 / 备份”。')
      return
    }
    context.isBusy.value = true
    try {
      context.showNotice(`正在校验 SillyTavern 备份：${file.name}…`)
      await resourceArchiveService.validateTavernBackup(file)
      let batch: File[] = []
      let count = 0
      const totals: ImportTotals = { imported: 0, duplicate: 0, failed: 0, firstFailure: '' }
      for await (const resourceFile of resourceArchiveService.tavernFiles(file)) {
        batch.push(resourceFile)
        count++
        if (batch.length === 10) {
          await importResourceFiles(batch, totals)
          batch = []
        }
      }
      if (batch.length) await importResourceFiles(batch, totals)
      context.showNotice(
        count
          ? `酒馆备份已提取 ${count} 个受支持资源文件：成功 ${totals.imported}，重复 ${totals.duplicate}，失败 ${totals.failed}${totals.firstFailure ? `（${totals.firstFailure}）` : ''}。${context.pendingVersionImports.value.length ? '有文件待确认历史版本。' : ''}聊天、缓存、账号密钥、系统提示词及不支持的配置未导入。`
          : '已确认是 SillyTavern 备份，但没有发现当前支持导入的资源。',
        9000,
      )
    } catch (error) {
      context.showNotice(error instanceof Error ? error.message : '酒馆备份导入失败', 9000)
    } finally {
      context.isBusy.value = false
    }
  }

  async function processImportedFiles(selectedFiles: File[]): Promise<void> {
    const context = getContext()

    if (!selectedFiles.length || context.isBusy.value) return
    context.isBusy.value = true
    try {
      const ordinaryFiles = selectedFiles.filter((file) => !/\.zip$/i.test(file.name))
      if (ordinaryFiles.length) await importResourceFiles(ordinaryFiles)
      for (const file of selectedFiles.filter((item) => /\.zip$/i.test(item.name))) {
        try {
          context.isBusy.value = true
          context.showNotice(`正在识别 ${file.name}…`)
          const kind = await resourceArchiveService.inspect(file)
          if (kind === 'library') {
            context.pendingBackupImport.value = file
            if (!context.activeVersionImport.value) await openPendingBackupImport()
            break
          }
          if (kind === 'personal') {
            await importResourceFiles([file])
            continue
          }
          let batch: File[] = []
          let count = 0
          const totals: ImportTotals = { imported: 0, duplicate: 0, failed: 0, firstFailure: '' }
          for await (const resourceFile of resourceArchiveService.tavernFiles(file)) {
            batch.push(resourceFile)
            count++
            if (batch.length === 10) {
              await importResourceFiles(batch, totals)
              batch = []
            }
          }
          if (batch.length) await importResourceFiles(batch, totals)
          context.showNotice(
            `酒馆压缩包已处理 ${count} 个资源文件：成功 ${totals.imported}，重复 ${totals.duplicate}，失败 ${totals.failed}${totals.firstFailure ? `（${totals.firstFailure}）` : ''}。${context.pendingVersionImports.value.length ? '有文件待确认历史版本。' : ''}聊天、缓存及账号密钥未作为资源导入。`,
            9000,
          )
        } catch (error) {
          context.showNotice(error instanceof Error ? error.message : '压缩包导入失败', 9000)
        }
      }
    } finally {
      context.isBusy.value = false
    }
  }

  function handleSystemFileDragOver(event: DragEvent): void {
    const context = getContext()

    if (
      !context.isNativeApk ||
      context.isBusy.value ||
      !Array.from(event.dataTransfer?.types ?? []).includes('Files')
    )
      return
    event.preventDefault()
    context.isSystemFileDropActive.value = true
  }

  function handleSystemFileDragLeave(event: DragEvent): void {
    const context = getContext()

    if (!event.currentTarget || event.target === event.currentTarget)
      context.isSystemFileDropActive.value = false
  }

  async function handleSystemFileDrop(event: DragEvent): Promise<void> {
    const context = getContext()

    context.isSystemFileDropActive.value = false
    if (!context.isNativeApk || context.isBusy.value) return
    const files = Array.from(event.dataTransfer?.files ?? [])
    if (!files.length) return
    event.preventDefault()
    context.showNotice(`收到 ${files.length} 个系统拖放文件，开始导入…`)
    await processImportedFiles(files)
  }

  async function handleLinkImport(): Promise<void> {
    const context = getContext()

    const urls = context.linkImportUrls.value
    if (!urls.length || context.isBusy.value) return
    context.isBusy.value = true
    try {
      const results = await resourceService.importLinks(urls)
      const importedCount = results.filter((result) => result.status === 'imported').length
      const duplicateCount = results.filter((result) => result.status === 'duplicate').length
      const failed = results.filter((result) => result.status === 'failed')
      await context.loadResources()
      if (!failed.length && importedCount + duplicateCount > 0) {
        context.linkImportText.value = ''
        closeImportChooser()
      }
      context.showNotice(
        [
          importedCount ? `链接资源 ${importedCount} 项` : '',
          duplicateCount ? `重复 ${duplicateCount} 项` : '',
          failed.length ? `失败 ${failed.length} 项：${failed[0]?.message}` : '',
        ]
          .filter(Boolean)
          .join('；') || '没有可导入的链接',
      )
    } finally {
      context.isBusy.value = false
    }
  }

  function closeImportChooser(): void {
    const context = getContext()

    context.isLinkImportOpen.value = false
    context.isImportChooserOpen.value = false
  }

  function openLinkImportPanel(): void {
    const context = getContext()

    context.isImportChooserOpen.value = true
    context.isLinkImportOpen.value = true
    void nextTick(() => {
      document.getElementById('link-import-text')?.focus({ preventScroll: true })
    })
  }

  function openImportChooser(): void {
    const context = getContext()

    if (context.isBusy.value) return
    context.isFeatureHubOpen.value = false
    context.isLinkImportOpen.value = false
    context.isImportChooserOpen.value = true
  }

  function openFileImportPicker(): void {
    const context = getContext()

    closeImportChooser()
    void nextTick(() => context.fileImportInput.value?.click())
  }

  function openTavernBackupPicker(): void {
    const context = getContext()
    if (context.isBusy.value) return
    closeImportChooser()
    void nextTick(() => context.tavernBackupInput.value?.click())
  }

  async function openPendingBackupImport(): Promise<void> {
    const context = getContext()

    const file = context.pendingBackupImport.value
    if (!file) return
    context.pendingBackupImport.value = undefined
    context.openRestorePanel('import')
    await context.handleRestoreInspect(file)
  }

  async function importResourceFiles(files: File[], totals?: ImportTotals): Promise<boolean> {
    const context = getContext()

    if (!files.length) return true

    const wasBusy = context.isBusy.value
    context.isBusy.value = true
    let resultsReceived = false
    try {
      const chatOptions = await confirmChatImports(files, resourceService)
      if (!chatOptions) return false
      const { protectPersonalImport } = await import('../services/PersonalResourceImport')
      const { requestSecretPassword } = await import('./UseSecretPasswordPrompt')
      const protectedFiles = []
      for (const file of files)
        protectedFiles.push(
          await protectPersonalImport(file, () =>
            requestSecretPassword(
              '此文件含明文私密字段。输入总设置中的统一密码，加密后再存入资源库。',
            ),
          ),
        )
      const results = await resourceService.importFiles(protectedFiles, {
        ...chatOptions,
        extractCharacterAssets: context.extractCharacterAssets.value,
      })
      resultsReceived = true
      if (totals) {
        totals.imported += results.filter((result) => result.status === 'imported').length
        totals.duplicate += results.filter((result) => result.status === 'duplicate').length
        totals.failed += results.filter((result) => result.status === 'failed').length
        const failed = results.find((result) => result.status === 'failed')
        if (failed?.status === 'failed')
          totals.firstFailure ||= `${failed.fileName}：${failed.message}`
      }
      context.pendingVersionImports.value.push(
        ...results.filter(
          (result): result is ImportVersionCandidate => result.status === 'versionCandidate',
        ),
      )
      await context.loadResources()
      const importedCount = results.filter((result) => result.status === 'imported').length
      const extractedResources = results.flatMap((result) =>
        result.status === 'imported' || result.status === 'duplicate'
          ? (result.extractedResources ?? [])
          : [],
      )
      const importedBytes = results.reduce(
        (total, result) =>
          result.status === 'imported'
            ? total +
              result.resource.fileSize +
              (result.extractedResources ?? []).reduce(
                (subtotal, resource) => subtotal + resource.fileSize,
                0,
              )
            : total,
        0,
      )
      const duplicateCount = results.filter((result) => result.status === 'duplicate').length
      const duplicateFileNames = results.flatMap((result) =>
        result.status === 'duplicate' ? [result.fileName] : [],
      )
      const firstDuplicate = results.find((result) => result.status === 'duplicate')
      const reclassifiedCount = results.filter(
        (result) => result.status === 'duplicate' && result.reclassified,
      ).length
      const failedCount = results.filter((result) => result.status === 'failed').length
      const firstFailure = results.find((result) => result.status === 'failed')
      const recognizedResources = results.flatMap((result) =>
        result.status === 'imported' || result.status === 'duplicate'
          ? [result.resource, ...(result.extractedResources ?? [])]
          : [],
      )
      const typeSummary = summarizeResourceTypes(recognizedResources)
      const isLargeImport =
        importedCount >= LARGE_IMPORT_FILE_COUNT || importedBytes >= context.LARGE_IMPORT_BYTES
      if (isLargeImport) context.backupRecommended.value = true
      const details = [
        `成功 ${importedCount} 项`,
        extractedResources.length
          ? `自动拆分配套 ${extractedResources.length} 项${context.hideCharacterAssets.value ? '（已从普通列表隐藏）' : ''}`
          : '',
        duplicateCount
          ? `已存在：${summarizeFileNames(duplicateFileNames)}${firstDuplicate?.status === 'duplicate' ? `（${firstDuplicate.message}）` : ''}${reclassifiedCount ? `（重新识别 ${reclassifiedCount} 项）` : ''}`
          : '',
        firstFailure?.status === 'failed'
          ? `失败 ${failedCount} 项：${firstFailure.fileName}（${firstFailure.message}）`
          : '',
        typeSummary ? `类型：${typeSummary}` : '',
        context.pendingVersionImports.value.length
          ? `有 ${context.pendingVersionImports.value.length} 个文件需要确认是否为历史版本`
          : '',
        isLargeImport ? '本次导入量较大，建议立即创建完整备份' : '',
      ].filter(Boolean)
      context.showNotice(details.join('，'), 7000)
      if (importedCount > 0) triggerNativeHaptic('success')
      await context.refreshStorageHealth()
      return true
    } catch (error) {
      if (totals && !resultsReceived) {
        totals.failed += files.length
        totals.firstFailure ||= error instanceof Error ? error.message : '导入失败'
      }
      context.showNotice(
        error instanceof Error ? error.message : '本地数据库写入失败，请检查浏览器存储权限',
      )
      return false
    } finally {
      context.isBusy.value = wasBusy
    }
  }

  async function handleVersionImportDecision(decision: {
    action: 'activate' | 'archive' | 'replace' | 'independent' | 'skip'
    targetId?: string
    note?: string
  }): Promise<void> {
    const context = getContext()

    const pending = context.activeVersionImport.value
    if (!pending || context.isVersionImportBusy.value) return

    const selectedCandidate = pending.candidates.find(
      (candidate) => candidate.resource.id === decision.targetId,
    )
    const isContainerVariant = selectedCandidate?.matchKind === 'containerVariant'
    if (decision.action === 'replace') {
      if (!decision.targetId) throw new Error('请选择要覆盖的已有资源')
      const confirmed = await confirmAction({
        title: isContainerVariant ? '覆盖当前封装' : '覆盖当前版本',
        message: `将用“${pending.fileName}”替换「${selectedCandidate?.resource.name ?? '已有资源'}」的当前文件，旧版不会进入历史记录，只能通过本地快照恢复。确定继续吗？`,
        confirmLabel: isContainerVariant ? '覆盖当前封装' : '覆盖当前版本',
        danger: true,
        centered: true,
      })
      if (!confirmed) return
    }

    context.isVersionImportBusy.value = true
    try {
      if (decision.action === 'independent') {
        const [result] = await resourceService.importFiles([pending.file], {
          extractCharacterAssets: context.extractCharacterAssets.value,
          detectVersions: false,
        })
        if (!result || result.status === 'failed') {
          throw new Error(result?.status === 'failed' ? result.message : '独立资源导入失败')
        }
        context.showNotice(`“${pending.fileName}”已作为独立资源导入`)
      } else if (
        decision.action === 'activate' ||
        decision.action === 'archive' ||
        decision.action === 'replace'
      ) {
        if (!decision.targetId) throw new Error('请选择要归入的已有资源')
        if (decision.action === 'replace') {
          await historyService.capture(
            await createResourceArchiveSource(resourceService),
            await categoryService.list(),
            '覆盖资源当前版本前自动快照',
          )
        }
        await resourceService.importAsVersion(
          pending.file,
          decision.targetId,
          decision.action === 'activate' || decision.action === 'replace',
          decision.note,
          isContainerVariant ? 'container' : undefined,
          {},
          false,
          decision.action !== 'replace',
        )
        if (
          (decision.action === 'activate' || decision.action === 'replace') &&
          context.extractCharacterAssets.value
        ) {
          await resourceService.extractCharacterAssetsMany([decision.targetId])
        }
        context.showNotice(
          decision.action === 'replace'
            ? isContainerVariant
              ? `“${pending.fileName}”已覆盖当前封装，旧封装未进入历史记录`
              : `“${pending.fileName}”已覆盖当前版本，旧版未进入历史记录`
            : isContainerVariant
              ? decision.action === 'activate'
                ? `“${pending.fileName}”已绑定到同一版本并设为当前封装，原文件仍完整保留`
                : `“${pending.fileName}”已绑定为同一版本的另一份封装，当前展示未改变`
              : decision.action === 'activate'
                ? `“${pending.fileName}”已设为当前版本，旧版已收入历史`
                : `“${pending.fileName}”已加入历史，当前展示版本未改变`,
        )
      }
      context.pendingVersionImports.value.shift()
      await context.loadResources()
      await context.refreshStorageHealth()
      if (!context.activeVersionImport.value && context.pendingBackupImport.value)
        await openPendingBackupImport()
    } catch (error) {
      context.showNotice(error instanceof Error ? error.message : '历史版本保存失败')
    } finally {
      context.isVersionImportBusy.value = false
    }
  }
  return {
    linkImportUrls,
    linkImportPreview,
    splitLinkImportText,
    handleImport,
    handleTavernBackupImport,
    processImportedFiles,
    handleSystemFileDragOver,
    handleSystemFileDragLeave,
    handleSystemFileDrop,
    handleLinkImport,
    closeImportChooser,
    openLinkImportPanel,
    openImportChooser,
    openFileImportPicker,
    openTavernBackupPicker,
    openPendingBackupImport,
    importResourceFiles,
    handleVersionImportDecision,
  }
}
