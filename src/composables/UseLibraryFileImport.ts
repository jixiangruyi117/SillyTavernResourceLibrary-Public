import type { LibraryImportContext, ImportTotals } from './UseLibraryImport'
import {
  communitySourceService,
  discordInboxAutomationSettingsService,
  resourceService,
} from '../core/LibraryContainer'

import { triggerNativeHaptic } from '../core/NativeHaptics'

import { confirmChatImports } from './UseChatImportConfirmation'

import { confirmAction } from './UseConfirmDialog'

import {
  migrateCharacterCardContentWithReview,
  selectCharacterCardMigrationEdits,
} from '../services/CharacterCardMigrationReview'

import type { ImportVersionCandidate } from '../types/Import'

import { RESOURCE_TYPE } from '../types/Resource'

import { summarizeFileNames, summarizeResourceTypes } from '../utils/LibraryFormatting'

import type { CharacterCardContentEdit } from '../types/CharacterCardContentEdit'

import { PngResourceParser } from '../parser/PngResourceParser'

import { JsonResourceParser } from '../parser/JsonResourceParser'

import { isRecord } from '../utils/UnknownValue'

import { readCharacterCardContentEdits } from '../utils/CharacterCardContentEdits'

import { taskCenter } from '../core/TaskCenter'

import { materializeNativeFile, nativeFileSize } from '../core/NativeFileSource'

import { markSharedImportItemCompleted, type SharedFileBatch } from '../utils/ShareTargetIntake'

import { hashBlob } from '../services/HashService'
import { autoBindIncomingCard } from '../services/DiscordInboxAutoBinding'
import { DEFAULT_DISCORD_INBOX_AUTOMATION_SETTINGS } from '../services/DiscordInboxAutomationSettings'

export interface UseLibraryFileImportContext {
  getContext: () => LibraryImportContext
  createImportTask: (options: { name: string; phase: string }) => string
  startImportTask: (taskId: string) => Promise<void>
  updateImportTask: (taskId: string, changes: Parameters<typeof taskCenter.update>[1]) => void
  activeImportAbortController: AbortController | undefined
  throwIfImportStopped: () => void
  LARGE_IMPORT_FILE_COUNT: 20
  stopImportTask: (taskId: string) => Promise<void>
  openPendingBackupImport: () => Promise<void>
}
export async function importResourceFiles(
  operations: UseLibraryFileImportContext,
  files: File[],
  totals?: ImportTotals,
  operationId?: string,
  shareBatch?: SharedFileBatch,
): Promise<boolean> {
  const context = operations.getContext()

  if (!files.length) return true

  const wasBusy = context.isBusy.value
  context.isBusy.value = true
  const taskId =
    operationId ??
    operations.createImportTask({
      name: files.length > 1 ? `导入 ${files.length} 项资源` : `导入资源：${files[0]?.name ?? ''}`,
      phase: '准备导入',
    })
  const ownsTask = !operationId
  let resultsReceived = false
  try {
    if (ownsTask) await operations.startImportTask(taskId)
    operations.updateImportTask(taskId, { phase: `等待确认导入内容（${files.length} 项）` })
    const chatOptions = await confirmChatImports(
      files,
      resourceService,
      operations.activeImportAbortController?.signal,
    )
    if (!chatOptions) {
      if (ownsTask) taskCenter.cancelled(taskId)
      return false
    }
    const automationSettings = await discordInboxAutomationSettingsService
      .load()
      .catch(() => ({ ...DEFAULT_DISCORD_INBOX_AUTOMATION_SETTINGS }))
    const { protectPersonalImport } = await import('../services/PersonalResourceImport')
    const { requestSecretPassword } = await import('./UseSecretPasswordPrompt')
    const protectedFiles = []
    const originalContentHashes = new Map<File, string>()
    for (const file of files) {
      operations.throwIfImportStopped()
      // Small personal JSON may be encrypted with a fresh IV on each attempt.
      // Retain only the source digest so a resumed share can find its committed ciphertext.
      const smallPersonalSource =
        shareBatch && /\.json$/iu.test(file.name) && nativeFileSize(file) <= 2 * 1024 * 1024
      const source = smallPersonalSource
        ? await materializeNativeFile(file, {
            signal: operations.activeImportAbortController?.signal,
          })
        : file
      let sourceHash =
        smallPersonalSource && Object.keys(shareBatch?.completedImportAliases ?? {}).length
          ? await hashBlob(new File([source], source.name, { type: source.type }))
          : undefined
      const committedHash = sourceHash && shareBatch?.completedImportAliases?.[sourceHash]
      const alreadyCommitted =
        committedHash && (await resourceService.findByContentHash(committedHash))
      const protectedFile = alreadyCommitted
        ? source
        : await protectPersonalImport(
            source,
            () =>
              requestSecretPassword(
                '此文件含明文私密字段。输入总设置中的统一密码，加密后再存入资源库。',
              ),
            operations.activeImportAbortController?.signal,
          )
      if (shareBatch && protectedFile !== source)
        sourceHash ??= await hashBlob(new File([source], source.name, { type: source.type }))
      operations.throwIfImportStopped()
      protectedFiles.push(protectedFile)
      if (sourceHash) originalContentHashes.set(protectedFile, sourceHash)
    }
    const results = await resourceService.importFiles(protectedFiles, {
      ...chatOptions,
      extractCharacterAssets: context.extractCharacterAssets.value,
      skipVersionComparison: context.skipVersionComparisonOnImport.value,
      sameNameVersionCandidates: context.sameNameVersionCandidates?.value === true,
      preferPngContainer: automationSettings.preferPngContainer,
      persistVersionMatchCache: context.persistResourceVersionMatchCache.value,
      signal: operations.activeImportAbortController?.signal,
      completedContentHashes: shareBatch?.completedContentHashes,
      originalContentHashes,
      completedImportAliases: shareBatch?.completedImportAliases,
      discardCompletedResults: Boolean(shareBatch),
      onItemComplete: async (result) => {
        if (shareBatch && totals) {
          if (result.status === 'imported') {
            totals.imported += 1
            totals.importedBytes =
              (totals.importedBytes ?? 0) +
              result.resource.fileSize +
              (result.extractedResources ?? []).reduce(
                (sum, resource) => sum + resource.fileSize,
                0,
              )
          } else if (result.status === 'duplicate') totals.duplicate += 1
          else if (result.status === 'failed') {
            totals.failed += 1
            totals.firstFailure ||= `${result.fileName}：${result.message}`
          }
        }
        if (shareBatch && result.status === 'versionCandidate')
          context.pendingVersionImports.value.push({
            ...result,
            shareRecoveryId: shareBatch.recoveryId,
            onResolved: shareBatch.onVersionResolved,
          })
        if (
          (result.status === 'imported' || result.status === 'duplicate') &&
          result.resource.contentHash
        ) {
          if (result.sourceContentHash)
            await shareBatch?.markImportItemCompleted?.(
              result.resource.contentHash,
              result.sourceContentHash,
            )
          else await shareBatch?.markImportItemCompleted?.(result.resource.contentHash)
        }
        await shareBatch?.onItemComplete?.(result)
        if (
          shareBatch?.automaticCloud &&
          automationSettings.bindForeground &&
          result.status === 'imported'
        ) {
          const binding = await autoBindIncomingCard(
            communitySourceService,
            result.resource,
            automationSettings,
          )
          if (binding)
            window.dispatchEvent(
              new CustomEvent('srl:community-sources-changed', {
                detail: { origin: 'discord-auto-binding', sourceId: binding.sourceId },
              }),
            )
        }
      },
      onProgress: ({ completed, total, fileName, phase }) => {
        operations.updateImportTask(taskId, {
          phase: `${completed}/${total} 项 · ${phase}：${fileName}`,
          progress: completed / Math.max(1, total),
          itemProgress: { completed, total },
        })
      },
    })
    resultsReceived = true
    if (totals && !shareBatch) {
      totals.imported += results.filter((result) => result.status === 'imported').length
      totals.duplicate += results.filter((result) => result.status === 'duplicate').length
      totals.failed += results.filter((result) => result.status === 'failed').length
      const failed = results.find((result) => result.status === 'failed')
      if (failed?.status === 'failed')
        totals.firstFailure ||= `${failed.fileName}：${failed.message}`
    }
    if (!shareBatch)
      context.pendingVersionImports.value.push(
        ...results.filter(
          (result): result is ImportVersionCandidate => result.status === 'versionCandidate',
        ),
      )
    await context.loadResources()
    const importedCount =
      totals?.imported ?? results.filter((result) => result.status === 'imported').length
    const extractedResources = results.flatMap((result) =>
      result.status === 'imported' || result.status === 'duplicate'
        ? (result.extractedResources ?? [])
        : [],
    )
    const importedBytes =
      totals?.importedBytes ??
      results.reduce(
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
      importedCount >= operations.LARGE_IMPORT_FILE_COUNT ||
      importedBytes >= context.LARGE_IMPORT_BYTES
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
    if (!totals) context.showNotice(details.join('，'), 7000)
    if (ownsTask) taskCenter.complete(taskId)
    if (importedCount > 0) triggerNativeHaptic('success')
    await context.refreshStorageHealth()
    return true
  } catch (error) {
    if (operations.activeImportAbortController?.signal.aborted) return false
    if (totals && !resultsReceived) {
      totals.failed += files.length
      totals.firstFailure ||= error instanceof Error ? error.message : '导入失败'
    }
    if (!totals)
      context.showNotice(
        error instanceof Error ? error.message : '本地数据库写入失败，请检查浏览器存储权限',
      )
    if (ownsTask) taskCenter.fail(taskId, error)
    return false
  } finally {
    context.isBusy.value = wasBusy
    if (ownsTask) await operations.stopImportTask(taskId)
  }
}

export async function handleVersionImportDecision(
  operations: UseLibraryFileImportContext,
  decision: {
    action: 'activate' | 'archive' | 'replace' | 'independent' | 'existing' | 'skip'
    targetId?: string
    note?: string
  },
): Promise<void> {
  const context = operations.getContext()

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
      message: `将用“${pending.fileName}”替换「${selectedCandidate?.resource.name ?? '已有资源'}」的当前文件。旧版会保存在该资源的历史版本中。确定继续吗？`,
      confirmLabel: isContainerVariant ? '覆盖当前封装' : '覆盖当前版本',
      danger: true,
      centered: true,
    })
    if (!confirmed) return
  }

  context.isVersionImportBusy.value = true
  try {
    let committedHash: string | undefined
    let resolvedResourceId: string | undefined
    let importedCardEdits: CharacterCardContentEdit[] | undefined
    if (
      (decision.action === 'activate' || decision.action === 'replace') &&
      selectedCandidate?.resource.type === RESOURCE_TYPE.CHARACTER_CARD
    ) {
      const current = await resourceService.get(selectedCandidate.resource.id)
      if (!current) throw new Error('要迁移修改的角色卡已经不存在')
      const currentEdits = readCharacterCardContentEdits(current.metadata.characterContentEdits)
      if (isContainerVariant) {
        // A container variant has the same complete card fingerprint, so existing
        // card edits still apply and do not need to pass through version migration review.
        importedCardEdits = currentEdits
      } else {
        const tracked = currentEdits.filter((edit) => edit.migrateToVersions)
        const selectedEdits = await selectCharacterCardMigrationEdits(tracked, pending.fileName)
        if (!selectedEdits) {
          context.showNotice('已取消版本绑定；文件尚未导入。请完成或关闭当前修改迁移窗口后重试。')
          return
        }
        if (selectedEdits.length) {
          const parsed = /\.png$/iu.test(pending.file.name)
            ? await new PngResourceParser().parse(pending.file)
            : await new JsonResourceParser().parse(pending.file)
          const newCard = isRecord(parsed.metadata.card) ? parsed.metadata.card : undefined
          if (parsed.type !== RESOURCE_TYPE.CHARACTER_CARD || !newCard)
            throw new Error('所选新版本无法解析为角色卡，未迁移卡内修改')
          const migration = await migrateCharacterCardContentWithReview(newCard, [], selectedEdits)
          if (!migration) {
            context.showNotice('已取消修改迁移；文件尚未导入。')
            return
          }
          if (migration.conflicts.length) {
            const scope = migration.conflicts.map((edit) => `• ${edit.label}`).join('\n')
            const proceed = await confirmAction({
              title: '有修改与新版本冲突',
              message: `以下项目不会迁移：\n${scope}\n\n是否继续导入？冲突项将保留在旧版记录中，新版本原内容保持不变。`,
              confirmLabel: '继续并跳过冲突',
              cancelLabel: '取消导入',
            })
            if (!proceed) {
              context.showNotice('已取消版本绑定；文件尚未导入。')
              return
            }
          }
          importedCardEdits = migration.edits
        }
      }
    }
    if (decision.action === 'independent') {
      const [result] = await resourceService.importFiles([pending.file], {
        extractCharacterAssets: context.extractCharacterAssets.value,
        detectVersions: false,
        persistVersionMatchCache: context.persistResourceVersionMatchCache.value,
      })
      if (!result || result.status === 'failed') {
        throw new Error(result?.status === 'failed' ? result.message : '独立资源导入失败')
      }
      if (result.status === 'imported' || result.status === 'duplicate') {
        committedHash = result.resource.contentHash
        resolvedResourceId = result.resource.id
      }
      context.showNotice(`“${pending.fileName}”已作为独立资源导入`)
    } else if (decision.action === 'existing') {
      if (!selectedCandidate) throw new Error('请选择要保留的已有资源')
      committedHash = selectedCandidate.resource.contentHash
      resolvedResourceId = selectedCandidate.resource.id
      context.showNotice(`已确认“${selectedCandidate.resource.name}”已有该资源，本次未重复导入`)
    } else if (
      decision.action === 'activate' ||
      decision.action === 'archive' ||
      decision.action === 'replace'
    ) {
      if (!decision.targetId) throw new Error('请选择要归入的已有资源')
      const importedVersion = await resourceService.importAsVersion(
        pending.file,
        decision.targetId,
        decision.action === 'activate' || decision.action === 'replace',
        decision.note,
        isContainerVariant ? 'container' : undefined,
        {},
        false,
        true,
        importedCardEdits,
      )
      committedHash = importedVersion?.contentHash
      resolvedResourceId = decision.targetId
      if (
        (decision.action === 'activate' || decision.action === 'replace') &&
        context.extractCharacterAssets.value
      ) {
        await resourceService.extractCharacterAssetsMany([decision.targetId])
      }
      const migratedCount = importedCardEdits?.length ?? 0
      context.showNotice(
        decision.action === 'replace'
          ? isContainerVariant
            ? `“${pending.fileName}”已覆盖当前封装，旧封装仍保留在历史版本`
            : `“${pending.fileName}”已覆盖当前版本，旧版已保存在该资源的历史版本${migratedCount ? `，迁移 ${migratedCount} 项修改` : ''}`
          : isContainerVariant
            ? decision.action === 'activate'
              ? `“${pending.fileName}”已绑定到同一版本并设为当前封装，原文件仍完整保留`
              : `“${pending.fileName}”已绑定为同一版本的另一份封装，当前展示未改变`
            : decision.action === 'activate'
              ? `“${pending.fileName}”已设为当前版本，旧版已收入历史${migratedCount ? `，迁移 ${migratedCount} 项修改` : ''}`
              : `“${pending.fileName}”已加入历史，当前展示版本未改变`,
      )
    }
    if (pending.shareRecoveryId && committedHash)
      markSharedImportItemCompleted(
        pending.shareRecoveryId,
        committedHash,
        pending.sourceContentHash,
      )
    await pending.onResolved?.(committedHash)
    const nextPending = context.pendingVersionImports.value[1]
    if (nextPending && resolvedResourceId) {
      const candidates = nextPending.candidates.filter(
        (candidate) => candidate.resource.id !== resolvedResourceId,
      )
      try {
        const refreshed = await resourceService.findVersionCandidateForGroup(
          nextPending.file,
          resolvedResourceId,
          { sameNameVersionCandidates: context.sameNameVersionCandidates?.value === true },
        )
        if (refreshed) candidates.push(refreshed)
        candidates.sort((left, right) => right.score - left.score)
        nextPending.candidates = candidates.slice(0, 3)
      } catch {
        nextPending.candidates = candidates
        context.showNotice('下一项候选刷新失败；为避免误绑定，已移除刚处理资源的旧候选。')
      }
    }
    context.pendingVersionImports.value.shift()
    await context.loadResources()
    await context.refreshStorageHealth()
    if (!context.activeVersionImport.value && context.pendingBackupImport.value)
      await operations.openPendingBackupImport()
  } catch (error) {
    context.showNotice(error instanceof Error ? error.message : '历史版本保存失败')
  } finally {
    context.isVersionImportBusy.value = false
  }
}
