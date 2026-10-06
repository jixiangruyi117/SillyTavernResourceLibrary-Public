import { type NoticeType } from '../core/NoticeCenter'

import { taskCenter } from '../core/TaskCenter'

import type { ImportVersionCandidate } from '../types/Import'

import type { VaultStatus } from '../types/Vault'

import {
  downloadSharedDiscordAttachment,
  shouldAutoResumeSharedImport,
  type SharedFileBatch,
} from '../utils/ShareTargetIntake'

export interface UseLibrarySharedActionsContext {
  pendingSharedBackupBatch: SharedFileBatch | undefined
  pendingSharedFileBatch: import('vue').ShallowRef<
    SharedFileBatch | undefined,
    SharedFileBatch | undefined
  >
  showNotice: (
    message: string,
    duration?: number,
    preserveRecycleUndo?: boolean,
    explicitType?: NoticeType,
  ) => void
  isImportChooserOpen: import('vue').Ref<boolean, boolean>
  closeImportChooserBase: () => void
  cancelPendingSharedBatch: (batch: SharedFileBatch) => Promise<void>
  closeRestorePanelBase: () => Promise<void>
  isRestorePanelOpen: import('vue').Ref<boolean, boolean>
  nativeDownloadAttempts: Map<string, { workId?: string; taskId: string }>
  nativeImportResults: Map<string, Set<string>>
  isBusy: import('vue').Ref<boolean, boolean>
  vaultStatus: import('vue').Ref<
    { enabled: boolean; locked: boolean },
    VaultStatus | { enabled: boolean; locked: boolean }
  >
  pendingVersionImports: import('vue').Ref<
    {
      onResolved?: ((committedHash?: string) => Promise<void>) | undefined
      sourceContentHash?: string | undefined
      status: 'versionCandidate'
      fileName: string
      file: {
        readonly lastModified: number
        readonly name: string
        readonly webkitRelativePath: string
        readonly size: number
        readonly type: string
        arrayBuffer: { (): Promise<ArrayBuffer>; (): Promise<ArrayBuffer> }
        bytes: { (): Promise<Uint8Array<ArrayBuffer>>; (): Promise<Uint8Array<ArrayBuffer>> }
        slice: {
          (start?: number, end?: number, contentType?: string): Blob
          (start?: number, end?: number, contentType?: string): Blob
        }
        stream: {
          (): ReadableStream<Uint8Array<ArrayBuffer>>
          (): ReadableStream<Uint8Array<ArrayBuffer>>
        }
        text: { (): Promise<string>; (): Promise<string> }
      }
      shareRecoveryId?: string | undefined
      candidates: {
        resource: {
          fileName: string
          id: string
          type: import('../types/Resource').ResourceType
          createdAt: number
          name: string
          description: string
          mimeType: string
          fileSize: number
          contentHash: string
          backupDescriptor?:
            | {
                version: 1 | 2
                resourceId: string
                contentHash: string
                size: number
                updatedAt: number
                parts?:
                  | {
                      name: string
                      offset: number
                      size: number
                      sha256: string
                      storedSize?: number | undefined
                      storage?:
                        | {
                            kind: 'github-release' | 'koofr-path'
                            container: string
                            objectKey: string
                          }
                        | undefined
                    }[]
                  | undefined
              }
            | undefined
          favorite: boolean
          categoryId: string | null
          categoryIds?: string[] | undefined
          relatedResourceIds?: string[] | undefined
          sourceLinks?:
            | {
                id: string
                label: string
                url: string
                type: import('../types/Resource').ResourceLinkType
                note?: string | undefined
                createdAt: number
                purpose?: import('../types/Resource').ResourceLinkPurpose | undefined
                installTarget?: import('../types/Resource').ResourceInstallTarget | undefined
                trustMode?: import('../types/Resource').ResourceLinkTrustMode | undefined
                versionRef?:
                  { kind: 'branch' | 'tag' | 'commit' | 'release'; value: string } | undefined
                github?:
                  | {
                      owner: string
                      repo: string
                      path?: string | undefined
                      releaseTag?: string | undefined
                      assetName?: string | undefined
                    }
                  | undefined
              }[]
            | undefined
          tags: string[]
          metadata: Record<string, unknown>
          versionGroupId?: string | undefined
          versionImportedAt?: number | undefined
          versionLabel?: string | undefined
          versionNote?: string | undefined
          versionCount?: number | undefined
          thumbnailAssetId?: string | undefined
          thumbnailBlob?:
            | {
                readonly size: number
                readonly type: string
                arrayBuffer: { (): Promise<ArrayBuffer>; (): Promise<ArrayBuffer> }
                bytes: {
                  (): Promise<Uint8Array<ArrayBuffer>>
                  (): Promise<Uint8Array<ArrayBuffer>>
                }
                slice: {
                  (start?: number, end?: number, contentType?: string): Blob
                  (start?: number, end?: number, contentType?: string): Blob
                }
                stream: {
                  (): ReadableStream<Uint8Array<ArrayBuffer>>
                  (): ReadableStream<Uint8Array<ArrayBuffer>>
                }
                text: { (): Promise<string>; (): Promise<string> }
              }
            | undefined
          updatedAt: number
        }
        matchedResource: {
          fileName: string
          id: string
          type: import('../types/Resource').ResourceType
          createdAt: number
          name: string
          description: string
          mimeType: string
          fileSize: number
          contentHash: string
          backupDescriptor?:
            | {
                version: 1 | 2
                resourceId: string
                contentHash: string
                size: number
                updatedAt: number
                parts?:
                  | {
                      name: string
                      offset: number
                      size: number
                      sha256: string
                      storedSize?: number | undefined
                      storage?:
                        | {
                            kind: 'github-release' | 'koofr-path'
                            container: string
                            objectKey: string
                          }
                        | undefined
                    }[]
                  | undefined
              }
            | undefined
          favorite: boolean
          categoryId: string | null
          categoryIds?: string[] | undefined
          relatedResourceIds?: string[] | undefined
          sourceLinks?:
            | {
                id: string
                label: string
                url: string
                type: import('../types/Resource').ResourceLinkType
                note?: string | undefined
                createdAt: number
                purpose?: import('../types/Resource').ResourceLinkPurpose | undefined
                installTarget?: import('../types/Resource').ResourceInstallTarget | undefined
                trustMode?: import('../types/Resource').ResourceLinkTrustMode | undefined
                versionRef?:
                  { kind: 'branch' | 'tag' | 'commit' | 'release'; value: string } | undefined
                github?:
                  | {
                      owner: string
                      repo: string
                      path?: string | undefined
                      releaseTag?: string | undefined
                      assetName?: string | undefined
                    }
                  | undefined
              }[]
            | undefined
          tags: string[]
          metadata: Record<string, unknown>
          versionGroupId?: string | undefined
          versionImportedAt?: number | undefined
          versionLabel?: string | undefined
          versionNote?: string | undefined
          versionCount?: number | undefined
          thumbnailAssetId?: string | undefined
          thumbnailBlob?:
            | {
                readonly size: number
                readonly type: string
                arrayBuffer: { (): Promise<ArrayBuffer>; (): Promise<ArrayBuffer> }
                bytes: {
                  (): Promise<Uint8Array<ArrayBuffer>>
                  (): Promise<Uint8Array<ArrayBuffer>>
                }
                slice: {
                  (start?: number, end?: number, contentType?: string): Blob
                  (start?: number, end?: number, contentType?: string): Blob
                }
                stream: {
                  (): ReadableStream<Uint8Array<ArrayBuffer>>
                  (): ReadableStream<Uint8Array<ArrayBuffer>>
                }
                text: { (): Promise<string>; (): Promise<string> }
              }
            | undefined
          updatedAt: number
        }
        matchedHistorical: boolean
        matchKind: import('../types/Import').VersionMatchKind
        score: number
        reasons: string[]
      }[]
    }[],
    | ImportVersionCandidate[]
    | {
        onResolved?: ((committedHash?: string) => Promise<void>) | undefined
        sourceContentHash?: string | undefined
        status: 'versionCandidate'
        fileName: string
        file: {
          readonly lastModified: number
          readonly name: string
          readonly webkitRelativePath: string
          readonly size: number
          readonly type: string
          arrayBuffer: { (): Promise<ArrayBuffer>; (): Promise<ArrayBuffer> }
          bytes: { (): Promise<Uint8Array<ArrayBuffer>>; (): Promise<Uint8Array<ArrayBuffer>> }
          slice: {
            (start?: number, end?: number, contentType?: string): Blob
            (start?: number, end?: number, contentType?: string): Blob
          }
          stream: {
            (): ReadableStream<Uint8Array<ArrayBuffer>>
            (): ReadableStream<Uint8Array<ArrayBuffer>>
          }
          text: { (): Promise<string>; (): Promise<string> }
        }
        shareRecoveryId?: string | undefined
        candidates: {
          resource: {
            fileName: string
            id: string
            type: import('../types/Resource').ResourceType
            createdAt: number
            name: string
            description: string
            mimeType: string
            fileSize: number
            contentHash: string
            backupDescriptor?:
              | {
                  version: 1 | 2
                  resourceId: string
                  contentHash: string
                  size: number
                  updatedAt: number
                  parts?:
                    | {
                        name: string
                        offset: number
                        size: number
                        sha256: string
                        storedSize?: number | undefined
                        storage?:
                          | {
                              kind: 'github-release' | 'koofr-path'
                              container: string
                              objectKey: string
                            }
                          | undefined
                      }[]
                    | undefined
                }
              | undefined
            favorite: boolean
            categoryId: string | null
            categoryIds?: string[] | undefined
            relatedResourceIds?: string[] | undefined
            sourceLinks?:
              | {
                  id: string
                  label: string
                  url: string
                  type: import('../types/Resource').ResourceLinkType
                  note?: string | undefined
                  createdAt: number
                  purpose?: import('../types/Resource').ResourceLinkPurpose | undefined
                  installTarget?: import('../types/Resource').ResourceInstallTarget | undefined
                  trustMode?: import('../types/Resource').ResourceLinkTrustMode | undefined
                  versionRef?:
                    { kind: 'branch' | 'tag' | 'commit' | 'release'; value: string } | undefined
                  github?:
                    | {
                        owner: string
                        repo: string
                        path?: string | undefined
                        releaseTag?: string | undefined
                        assetName?: string | undefined
                      }
                    | undefined
                }[]
              | undefined
            tags: string[]
            metadata: Record<string, unknown>
            versionGroupId?: string | undefined
            versionImportedAt?: number | undefined
            versionLabel?: string | undefined
            versionNote?: string | undefined
            versionCount?: number | undefined
            thumbnailAssetId?: string | undefined
            thumbnailBlob?:
              | {
                  readonly size: number
                  readonly type: string
                  arrayBuffer: { (): Promise<ArrayBuffer>; (): Promise<ArrayBuffer> }
                  bytes: {
                    (): Promise<Uint8Array<ArrayBuffer>>
                    (): Promise<Uint8Array<ArrayBuffer>>
                  }
                  slice: {
                    (start?: number, end?: number, contentType?: string): Blob
                    (start?: number, end?: number, contentType?: string): Blob
                  }
                  stream: {
                    (): ReadableStream<Uint8Array<ArrayBuffer>>
                    (): ReadableStream<Uint8Array<ArrayBuffer>>
                  }
                  text: { (): Promise<string>; (): Promise<string> }
                }
              | undefined
            updatedAt: number
          }
          matchedResource: {
            fileName: string
            id: string
            type: import('../types/Resource').ResourceType
            createdAt: number
            name: string
            description: string
            mimeType: string
            fileSize: number
            contentHash: string
            backupDescriptor?:
              | {
                  version: 1 | 2
                  resourceId: string
                  contentHash: string
                  size: number
                  updatedAt: number
                  parts?:
                    | {
                        name: string
                        offset: number
                        size: number
                        sha256: string
                        storedSize?: number | undefined
                        storage?:
                          | {
                              kind: 'github-release' | 'koofr-path'
                              container: string
                              objectKey: string
                            }
                          | undefined
                      }[]
                    | undefined
                }
              | undefined
            favorite: boolean
            categoryId: string | null
            categoryIds?: string[] | undefined
            relatedResourceIds?: string[] | undefined
            sourceLinks?:
              | {
                  id: string
                  label: string
                  url: string
                  type: import('../types/Resource').ResourceLinkType
                  note?: string | undefined
                  createdAt: number
                  purpose?: import('../types/Resource').ResourceLinkPurpose | undefined
                  installTarget?: import('../types/Resource').ResourceInstallTarget | undefined
                  trustMode?: import('../types/Resource').ResourceLinkTrustMode | undefined
                  versionRef?:
                    { kind: 'branch' | 'tag' | 'commit' | 'release'; value: string } | undefined
                  github?:
                    | {
                        owner: string
                        repo: string
                        path?: string | undefined
                        releaseTag?: string | undefined
                        assetName?: string | undefined
                      }
                    | undefined
                }[]
              | undefined
            tags: string[]
            metadata: Record<string, unknown>
            versionGroupId?: string | undefined
            versionImportedAt?: number | undefined
            versionLabel?: string | undefined
            versionNote?: string | undefined
            versionCount?: number | undefined
            thumbnailAssetId?: string | undefined
            thumbnailBlob?:
              | {
                  readonly size: number
                  readonly type: string
                  arrayBuffer: { (): Promise<ArrayBuffer>; (): Promise<ArrayBuffer> }
                  bytes: {
                    (): Promise<Uint8Array<ArrayBuffer>>
                    (): Promise<Uint8Array<ArrayBuffer>>
                  }
                  slice: {
                    (start?: number, end?: number, contentType?: string): Blob
                    (start?: number, end?: number, contentType?: string): Blob
                  }
                  stream: {
                    (): ReadableStream<Uint8Array<ArrayBuffer>>
                    (): ReadableStream<Uint8Array<ArrayBuffer>>
                  }
                  text: { (): Promise<string>; (): Promise<string> }
                }
              | undefined
            updatedAt: number
          }
          matchedHistorical: boolean
          matchKind: import('../types/Import').VersionMatchKind
          score: number
          reasons: string[]
        }[]
      }[]
  >
  pendingBackupImport: import('vue').ShallowRef<File | undefined, File | undefined>
  sharedAppImportFiles: import('vue').ShallowRef<File[], File[]>
  selectMobileDestination: (filter: 'all' | 'favorites') => void
  currentPage: import('vue').Ref<number, number>
  activeResourceIds: import('vue').ShallowRef<Set<string> | undefined, Set<string> | undefined>
  consumeSharedFiles: () => Promise<void>
  matchesSharedToken: (batch: SharedFileBatch, token: string) => boolean
  queuedSharedFileBatches: SharedFileBatch[]
  activateSharedFileBatch: (batch: SharedFileBatch) => void
  isFeatureHubOpen: import('vue').Ref<boolean, boolean>
  openSharedImport: (token: string) => Promise<void>
  trimNativeShareHistory: () => void
  isLinkImportOpen: import('vue').Ref<boolean, boolean>
  autoDownloadDiscordShareLinks: import('vue').Ref<boolean, boolean>
  autoAttemptedDiscordTokens: Set<string>
  downloadDiscordAttachment: (automatic: boolean) => Promise<void>
  chooseSharedImportRoute: (
    route: 'libraryBackup' | 'tavernBackup' | 'resource' | 'thirdPartyApp',
  ) => Promise<void>
  handleSharedImportChoice: (
    files: File[],
    route: 'libraryBackup' | 'tavernBackup' | 'resource' | 'thirdPartyApp',
    shareBatch?: SharedFileBatch,
  ) => Promise<import('./UseLibraryImport').SharedImportOutcome | false>
  deferredSharedImportBatches: Map<string, SharedFileBatch>
}
export async function acknowledgeSharedBackupAfterRestore(
  operations: UseLibrarySharedActionsContext,
): Promise<void> {
  const batch = operations.pendingSharedBackupBatch
  if (!batch) return
  try {
    await batch.acknowledge()
    if (operations.pendingSharedFileBatch.value === batch)
      operations.pendingSharedFileBatch.value = undefined
    operations.pendingSharedBackupBatch = undefined
  } catch {
    operations.showNotice('备份已恢复，但系统分享暂存文件未清理。')
  }
}

export async function cancelPendingSharedBatch(
  operations: UseLibrarySharedActionsContext,
  batch: SharedFileBatch,
): Promise<void> {
  try {
    await batch.setRoute?.(undefined)
    await batch.acknowledge()
  } catch {
    operations.showNotice('取消未完成，系统暂存文件未能清理；请重试取消。', 9000)
    operations.isImportChooserOpen.value = true
    return
  }
  if (operations.pendingSharedFileBatch.value === batch)
    operations.pendingSharedFileBatch.value = undefined
  if (operations.pendingSharedBackupBatch === batch) operations.pendingSharedBackupBatch = undefined
}

export async function closeImportChooser(
  operations: UseLibrarySharedActionsContext,
): Promise<void> {
  operations.closeImportChooserBase()
  const batch = operations.pendingSharedFileBatch.value
  if (!batch || batch.discordAttachment) return
  await operations.cancelPendingSharedBatch(batch)
}

export async function closeRestorePanel(operations: UseLibrarySharedActionsContext): Promise<void> {
  const batch = operations.pendingSharedBackupBatch
  await operations.closeRestorePanelBase()
  if (!batch || operations.isRestorePanelOpen.value) return
  await operations.cancelPendingSharedBatch(batch)
}

export function trimNativeShareHistory(operations: UseLibrarySharedActionsContext): void {
  const tasks = new Map(taskCenter.list().map((task) => [task.operationId, task.status]))
  for (const [token, attempt] of operations.nativeDownloadAttempts) {
    if (operations.nativeDownloadAttempts.size <= 100) break
    if (tasks.get(attempt.taskId) !== 'running') {
      operations.nativeDownloadAttempts.delete(token)
      taskCenter.dismiss(attempt.taskId)
    }
  }
  while (operations.nativeImportResults.size > 100)
    operations.nativeImportResults.delete(operations.nativeImportResults.keys().next().value!)
}

export function matchesSharedToken(batch: SharedFileBatch, token: string): boolean {
  return batch.recoveryId === token || Boolean(batch.nativeShareTokens?.includes(token))
}

export async function openSharedImport(
  operations: UseLibrarySharedActionsContext,
  token: string,
): Promise<void> {
  if (!/^discord-url-[a-f0-9-]{36}$/u.test(token)) return
  if (
    operations.isBusy.value ||
    operations.vaultStatus.value.locked ||
    operations.pendingVersionImports.value.length ||
    operations.pendingBackupImport.value ||
    operations.pendingSharedBackupBatch ||
    operations.sharedAppImportFiles.value.length
  ) {
    operations.showNotice('请先完成当前导入或解锁资源库，再查看此附件。')
    return
  }
  function showImported(): boolean {
    const imported = operations.nativeImportResults.get(token)
    if (!imported?.size || operations.pendingSharedFileBatch.value) return false
    operations.selectMobileDestination('all')
    operations.currentPage.value = 1
    operations.activeResourceIds.value = new Set(imported)
    operations.isImportChooserOpen.value = false
    return true
  }
  if (showImported()) return
  await operations.consumeSharedFiles()
  if (showImported()) return
  const pending = operations.pendingSharedFileBatch.value
  if (operations.isBusy.value || (pending && !operations.matchesSharedToken(pending, token))) {
    operations.showNotice('当前还有其他导入，请完成后再查看此附件。')
    return
  }
  const index = operations.queuedSharedFileBatches.findIndex((batch) =>
    operations.matchesSharedToken(batch, token),
  )
  if (!pending && index >= 0)
    operations.activateSharedFileBatch(operations.queuedSharedFileBatches.splice(index, 1)[0]!)
  if (
    operations.pendingSharedFileBatch.value &&
    operations.matchesSharedToken(operations.pendingSharedFileBatch.value, token)
  ) {
    operations.isFeatureHubOpen.value = false
    operations.isImportChooserOpen.value = true
    return
  }
  const task = taskCenter
    .list()
    .find((item) => item.operationId === operations.nativeDownloadAttempts.get(token)?.taskId)
  operations.showNotice(
    task?.status === 'running'
      ? '此附件仍在下载，完成后可继续导入。'
      : '此分享已处理或暂存已过期，未打开其他附件。',
  )
}

export function handleNativeDownloadState(
  operations: UseLibrarySharedActionsContext,
  event: Event,
): boolean {
  const detail = (
    event as CustomEvent<{ token?: string; workId?: string; name?: string; cloud?: boolean }>
  ).detail
  // Cloud downloads are owned by the resource inbox, including their import task.
  if (detail?.cloud === true) return false
  const token = detail?.token
  if (!token || !/^discord-url-[a-f0-9-]{36}$/u.test(token)) return false
  const started = event.type === 'srl:native-share-download-started'
  let attempt = operations.nativeDownloadAttempts.get(token)
  if (!started && attempt?.workId && detail.workId && attempt.workId !== detail.workId) return false
  if (started && attempt && attempt.workId === detail.workId) return true
  if (!attempt || started) {
    attempt = { workId: detail.workId, taskId: 'native-download:' + token }
    operations.nativeDownloadAttempts.set(token, attempt)
    taskCenter.start({
      operationId: attempt.taskId,
      name: detail.name || 'Discord 附件下载',
      phase: '等待网络并下载',
      background: true,
      action: { label: '查看附件', run: () => operations.openSharedImport(token) },
    })
  }
  if (started) {
    for (let index = operations.queuedSharedFileBatches.length - 1; index >= 0; index -= 1)
      if (operations.queuedSharedFileBatches[index]?.discordAttachment?.cleanupToken === token)
        operations.queuedSharedFileBatches.splice(index, 1)
    if (operations.pendingSharedFileBatch.value?.discordAttachment?.cleanupToken === token) {
      operations.pendingSharedFileBatch.value = undefined
      operations.isImportChooserOpen.value = false
    }
  } else if (event.type === 'srl:native-share-download-completed') {
    taskCenter.update(attempt.taskId, { phase: '下载完成，可继续导入' })
    taskCenter.complete(attempt.taskId)
  } else {
    taskCenter.fail(attempt.taskId, '附件下载未完成，打开附件可查看原因并重试。')
  }
  operations.trimNativeShareHistory()
  return true
}

export function activateSharedFileBatch(
  operations: UseLibrarySharedActionsContext,
  batch: SharedFileBatch,
): void {
  operations.pendingSharedFileBatch.value = batch
  operations.isLinkImportOpen.value = false
  const attachment = batch.discordAttachment
  if (
    attachment &&
    operations.autoDownloadDiscordShareLinks.value &&
    !attachment.error &&
    !operations.autoAttemptedDiscordTokens.has(attachment.cleanupToken)
  ) {
    operations.autoAttemptedDiscordTokens.add(attachment.cleanupToken)
    operations.isImportChooserOpen.value = false
    void operations.downloadDiscordAttachment(true)
    return
  }
  if (shouldAutoResumeSharedImport(batch)) {
    void operations.chooseSharedImportRoute(batch.route)
    return
  }
  operations.isFeatureHubOpen.value = false
  operations.isImportChooserOpen.value = true
}

export function receiveSharedFileBatch(
  operations: UseLibrarySharedActionsContext,
  batch: SharedFileBatch,
): void {
  if (batch.nativeShareTokens?.length && batch.files.length) {
    const originalComplete = batch.onItemComplete
    batch.onItemComplete = async (result) => {
      await originalComplete?.(result)
      if (result.status !== 'imported' && result.status !== 'duplicate') return
      for (const token of batch.nativeShareTokens ?? []) {
        const ids = operations.nativeImportResults.get(token) ?? new Set<string>()
        ids.add(result.resource.id)
        operations.nativeImportResults.set(token, ids)
      }
      operations.trimNativeShareHistory()
    }
  }
  if (operations.pendingSharedFileBatch.value || operations.isBusy.value) {
    operations.queuedSharedFileBatches.push(batch)
    return
  }
  operations.activateSharedFileBatch(batch)
}

export async function downloadSharedDiscordAttachmentNow(
  operations: UseLibrarySharedActionsContext,
): Promise<void> {
  await operations.downloadDiscordAttachment(false)
}

export async function downloadDiscordAttachment(
  operations: UseLibrarySharedActionsContext,
  automatic: boolean,
): Promise<void> {
  const batch = operations.pendingSharedFileBatch.value
  if (!batch?.discordAttachment) return
  try {
    await downloadSharedDiscordAttachment(batch.discordAttachment)
    if (operations.pendingSharedFileBatch.value === batch) {
      operations.pendingSharedFileBatch.value = undefined
      operations.isImportChooserOpen.value = false
    }
    if (!automatic) {
      operations.showNotice('已加入 Discord 附件下载队列；完成后将自动进入资源导入。', 5000)
    }
  } catch (error) {
    if (automatic) operations.isImportChooserOpen.value = true
    operations.showNotice(
      error instanceof Error ? error.message : '无法开始下载 Discord 附件',
      9000,
    )
  }
}

export async function cancelSharedDiscordAttachment(
  operations: UseLibrarySharedActionsContext,
): Promise<void> {
  const batch = operations.pendingSharedFileBatch.value
  if (!batch?.discordAttachment) return
  operations.autoAttemptedDiscordTokens.delete(batch.discordAttachment.cleanupToken)
  try {
    await batch.acknowledge()
  } catch (error) {
    operations.showNotice(error instanceof Error ? error.message : '清理分享链接失败', 9000)
    return
  }
  if (operations.pendingSharedFileBatch.value === batch) {
    operations.pendingSharedFileBatch.value = undefined
    operations.isImportChooserOpen.value = false
  }
  window.dispatchEvent(new Event('srl:native-share'))
}

export async function chooseSharedImportRoute(
  operations: UseLibrarySharedActionsContext,
  route: 'libraryBackup' | 'tavernBackup' | 'resource' | 'thirdPartyApp',
) {
  const batch = operations.pendingSharedFileBatch.value
  if (!batch) return
  // The selected route may open a restore/editor panel or a long-running task.
  // Close the route sheet first so progress and confirmation UI cannot stack on it.
  operations.isImportChooserOpen.value = false
  let savedRoute = false
  try {
    if (!batch.route && batch.setRoute) {
      await batch.setRoute(route)
      savedRoute = true
    }
    await batch.markImportStarted?.()
    const outcome = await operations.handleSharedImportChoice(batch.files, route, batch)
    if (!outcome) {
      await batch.onFailure?.('资源未导入；可能已取消、文件结构不支持或需要另选导入用途。')
      if (batch.onFailure) {
        operations.pendingSharedFileBatch.value = undefined
        return
      }
      if ((savedRoute || batch.routeWasPersisted) && batch.setRoute) await batch.setRoute(undefined)
      operations.isImportChooserOpen.value = true
      return
    }
    if (outcome === 'thirdPartyApp') return
    if (outcome === 'restore') {
      if (operations.pendingSharedFileBatch.value !== batch) return
      // Keep the original shared ZIP until the restore is committed. If Android
      // recreates the WebView while the user is choosing a restore mode, the
      // staged share can be recognized and preflighted again. The inspected
      // archive type owns acknowledgement timing, even when Android's route hint
      // came from a different import shortcut.
      operations.pendingSharedBackupBatch = batch
      return
    }
    const waitingForVersionDecision = Boolean(
      batch.recoveryId &&
      operations.pendingVersionImports.value.some(
        (candidate) => candidate.shareRecoveryId === batch.recoveryId,
      ),
    )
    if (waitingForVersionDecision && batch.recoveryId) {
      operations.deferredSharedImportBatches.set(batch.recoveryId, batch)
      operations.pendingSharedFileBatch.value = undefined
      return
    }
    await batch.acknowledge()
  } catch (error) {
    if (batch.onFailure) {
      await batch.onFailure(error instanceof Error ? error.message : '云端资源导入或确认失败')
      operations.pendingSharedFileBatch.value = undefined
      return
    }
    if ((savedRoute || batch.routeWasPersisted) && batch.setRoute) {
      try {
        await batch.setRoute(undefined)
      } catch {
        // Keep the original processing error visible; stale route hints expire with the share.
      }
    }
    const reason = error instanceof Error ? `：${error.message}` : ''
    operations.showNotice(`分享文件处理失败${reason}；原分享文件仍保留，可重新选择用途。`, 9000)
    operations.isImportChooserOpen.value = true
    return
  }
  operations.pendingSharedFileBatch.value = undefined
}

export async function handleSharedAppFilesConsumed(
  operations: UseLibrarySharedActionsContext,
): Promise<void> {
  operations.sharedAppImportFiles.value = []
  const batch = operations.pendingSharedFileBatch.value
  if (batch) {
    try {
      await batch.acknowledge()
    } catch {
      operations.showNotice('APP 预览已打开，但系统分享暂存未清理。')
    }
    operations.pendingSharedFileBatch.value = undefined
  }
  operations.isImportChooserOpen.value = false
}
