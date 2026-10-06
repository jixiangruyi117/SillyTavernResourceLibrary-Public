import {
  BRIDGE_COMPRESS_MIN_BYTES,
  gunzipBlob,
  gzipBlob,
  isCompressibleKind,
  supportsBridgeGzip,
} from '../utils/BridgeCompression'

import { BRIDGE_EXTENSION_VERSION, isBridgeExtensionOutdated } from '../utils/BridgeInstall'

import {
  createLocalTavernDirectSession,
  downloadLocalTavernDirectFile,
  LOCAL_TAVERN_ORIGIN,
  type LocalTavernDirectSession,
  removeLocalTavernDirectFile,
  uploadLocalTavernDirectFile,
} from './LanDirectService'

import {
  bridgeSha256,
  isTavernEnvelope,
  TAVERN_BRIDGE_CHUNK_SIZE,
  TAVERN_BRIDGE_MAX_FILE_SIZE,
  type TavernBridgeEnvelope,
  type TavernConflictPolicy,
  type TavernResourceItem,
  type TavernResourceKind,
} from './TavernBridgeProtocol'

import { TavernChunkSender } from './TavernChunkSender'

import { TavernDirectoryService } from './TavernDirectoryService'

export interface TavernBridgeTransferOperationsContext {
  directory: TavernDirectoryService | undefined
  assertConnected: () => void
  isLocalTavernDirectAvailable: () => boolean
  pendingSends: Map<
    string,
    { resolve: (value: TavernBridgeImportResult) => void; reject: (error: Error) => void }
  >
  peerCapabilities: string[]
  requestLocalDirectSession: (signal?: AbortSignal) => Promise<LocalTavernDirectSession>
  send: (
    type: string,
    payload?: Record<string, unknown>,
    transfer?: Transferable[],
  ) => Promise<void>
  chunkSender: TavernChunkSender
  withTimeout: <T, P>(
    promise: Promise<T>,
    id: string,
    pending: Map<string, P>,
    message: string,
    timeout?: number,
  ) => Promise<T>
  cancelledPulls: Set<string>
  state: TavernBridgeState
  setState: (status: TavernBridgeStatus, detail: string) => void
  pendingLocalDirectSessions: Map<
    string,
    { resolve: (value: LocalTavernDirectSession) => void; reject: (error: Error) => void }
  >
  pendingLists: Map<string, PendingList>
  touchList: (requestId: string) => void
  finishList: (requestId: string) => void
  pendingAvatarChecks: Map<
    string,
    { resolve: (ids: Set<string>) => void; reject: (error: Error) => void }
  >
  touchPull: (requestId: string) => void
  incoming: Map<string, IncomingTransfer>
  pendingPulls: Map<string, PendingPull>
  clearPullTimers: (pending?: PendingPull) => void
  failPull: (requestId: string, message: string, notifyPeer: boolean) => void
  failList: (requestId: string, message: string) => void
  disconnect: (detail?: string) => void
}
export type TavernBridgeStatus = 'idle' | 'discovering' | 'pairing' | 'connected' | 'error'

export type TavernBridgeTransport = 'none' | 'window' | 'relay' | 'local-direct' | 'directory'

export interface TavernBridgeImportResult {
  status: string
  name: string
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason ?? new DOMException('任务已取消', 'AbortError')
}

export function withAbortSignal<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise
  if (signal.aborted)
    return Promise.reject(signal.reason ?? new DOMException('任务已取消', 'AbortError'))
  return new Promise<T>((resolve, reject) => {
    const abort = (): void => {
      signal.removeEventListener('abort', abort)
      reject(signal.reason ?? new DOMException('任务已取消', 'AbortError'))
    }
    signal.addEventListener('abort', abort, { once: true })
    void promise.then(
      (value) => {
        signal.removeEventListener('abort', abort)
        resolve(value)
      },
      (error: unknown) => {
        signal.removeEventListener('abort', abort)
        reject(error)
      },
    )
  })
}

export interface TavernBridgeState {
  status: TavernBridgeStatus
  detail: string
  pairCode: string
  tavernOrigin: string
  bridgeVersion: string
  tavernVersion: string
  transport: TavernBridgeTransport
  capabilities: string[]
}

export interface IncomingTransfer {
  meta: TavernBridgeEnvelope
  chunks: Array<ArrayBuffer | undefined>
  received: number
  file?: File
  localDirectSession?: LocalTavernDirectSession
}

export interface PendingPull {
  files: File[]
  resolve: (files: File[]) => void
  reject: (error: Error) => void
  idleTimer: number
  absoluteTimer: number
}

export interface PendingList {
  items: TavernResourceItem[]
  resolve: (items: TavernResourceItem[]) => void
  reject: (error: Error) => void
  pageCount?: number
  pages: Map<number, TavernResourceItem[]>
  idleTimer: number
  absoluteTimer: number
}
export async function sendFiles(
  context: TavernBridgeTransferOperationsContext,
  files: Array<{
    file: File
    kind: TavernResourceKind
    displayName: string
    targetName?: string
    operationId?: string
  }>,
  conflictPolicy: TavernConflictPolicy,
  onProgress?: (completed: number, total: number, detail?: string) => void,
  options: { signal?: AbortSignal } = {},
): Promise<TavernBridgeImportResult[]> {
  throwIfAborted(options.signal)
  if (context.directory) {
    const results = await context.directory.sendFiles(files, conflictPolicy, onProgress)
    throwIfAborted(options.signal)
    return results
  }
  context.assertConnected()
  const requestId = crypto.randomUUID()
  const results: TavernBridgeImportResult[] = []
  const localDirect = context.isLocalTavernDirectAvailable()
  for (let fileIndex = 0; fileIndex < files.length; fileIndex += 1) {
    throwIfAborted(options.signal)
    const item = files[fileIndex]!
    if (item.file.size > TAVERN_BRIDGE_MAX_FILE_SIZE) {
      throw new Error(`${item.file.name} 超过单文件 256 MB 限制`)
    }
    const transferId = crypto.randomUUID()
    const result = new Promise<TavernBridgeImportResult>((resolve, reject) => {
      context.pendingSends.set(transferId, { resolve, reject })
    })
    void result.catch(() => undefined)
    let localDirectSession: LocalTavernDirectSession | undefined
    try {
      // 对端声明 gzip 能力时压缩 JSON 类资源；size/sha256 描述实际传输载荷，
      // 旧端的分块记账与完整性校验因此保持不变。
      const useGzip =
        context.peerCapabilities.includes('gzip') &&
        supportsBridgeGzip() &&
        isCompressibleKind(item.kind) &&
        item.file.size > BRIDGE_COMPRESS_MIN_BYTES
      const payload = useGzip ? await gzipBlob(item.file) : item.file
      throwIfAborted(options.signal)
      const sha256 = await bridgeSha256(payload)
      throwIfAborted(options.signal)
      if (localDirect) {
        try {
          localDirectSession = await context.requestLocalDirectSession(options.signal)
          const uploaded = await uploadLocalTavernDirectFile(
            localDirectSession,
            payload,
            item.file.name,
            options.signal,
          )
          if (uploaded.size !== payload.size || uploaded.sha256 !== sha256) {
            throw new Error('本机直传上传后的完整性校验失败')
          }
        } catch {
          if (localDirectSession) await removeLocalTavernDirectFile(localDirectSession)
          localDirectSession = undefined
          throwIfAborted(options.signal)
          onProgress?.(
            fileIndex,
            files.length,
            `本机直传不可用，已回退设备码传输：${item.displayName}`,
          )
        }
      }
      await context.send('file-start', {
        requestId,
        transferId,
        direction: 'to-tavern',
        name: item.file.name,
        displayName: item.displayName,
        mimeType: item.file.type,
        kind: item.kind,
        targetName: item.targetName,
        conflictPolicy,
        operationId: item.operationId,
        size: payload.size,
        sha256,
        ...(localDirectSession ? { localDirectSession } : {}),
        ...(useGzip ? { contentEncoding: 'gzip', rawSize: item.file.size } : {}),
      })
      throwIfAborted(options.signal)
      onProgress?.(fileIndex, files.length, `正在上传 ${item.displayName}`)
      if (localDirectSession) {
        onProgress?.(fileIndex, files.length, `正在本机直传 ${item.displayName}`)
      } else {
        await context.chunkSender.send(
          payload,
          requestId,
          transferId,
          (uploadedBytes) => {
            onProgress?.(
              fileIndex,
              files.length,
              `正在上传 ${item.displayName} · ${uploadedBytes} / ${payload.size} bytes`,
            )
          },
          options.signal,
        )
      }
      throwIfAborted(options.signal)
      await context.send('file-end', { requestId, transferId })
      onProgress?.(fileIndex, files.length, `等待酒馆导入 ${item.displayName}`)
      results.push(
        await withAbortSignal(
          context.withTimeout(
            result,
            transferId,
            context.pendingSends,
            `${item.file.name} 导入酒馆超时`,
            90_000,
          ),
          options.signal,
        ),
      )
      onProgress?.(fileIndex + 1, files.length, `${item.displayName} 已完成`)
    } finally {
      if (options.signal?.aborted) {
        void context.send('file-cancel', { requestId, transferId }).catch(() => undefined)
        if (localDirectSession) await removeLocalTavernDirectFile(localDirectSession)
      }
      context.pendingSends.delete(transferId)
    }
  }
  return results
}

export async function handlePortMessage(
  context: TavernBridgeTransferOperationsContext,
  message: unknown,
): Promise<void> {
  if (!isTavernEnvelope(message)) return
  const requestId = typeof message.requestId === 'string' ? message.requestId : ''
  const transferId = typeof message.transferId === 'string' ? message.transferId : ''
  if (requestId && context.cancelledPulls.has(requestId)) return
  if (message.type === 'st-ready') {
    const bridgeVersion = typeof message.bridgeVersion === 'string' ? message.bridgeVersion : ''
    context.peerCapabilities = Array.isArray(message.capabilities)
      ? message.capabilities.filter((value): value is string => typeof value === 'string')
      : []
    context.state = {
      ...context.state,
      bridgeVersion,
      tavernVersion:
        typeof message.tavernVersion === 'string'
          ? message.tavernVersion
          : context.state.tavernVersion,
      capabilities: [...context.peerCapabilities],
    }
    if (!bridgeVersion || isBridgeExtensionOutdated(bridgeVersion)) {
      const versionDetail = bridgeVersion
        ? `当前 ${bridgeVersion}，资源库要求 ${BRIDGE_EXTENSION_VERSION} 或更高版本。`
        : `未收到页面扩展版本，资源库要求 ${BRIDGE_EXTENSION_VERSION} 或更高版本。`
      context.setState(
        'error',
        `酒馆页面扩展版本过旧。${versionDetail}通过 Git 链接安装的：请在酒馆扩展管理中点击更新；通过离线 ZIP 安装的：请重新下载最新离线包覆盖安装。更新后完全刷新酒馆页面再重试。`,
      )
      return
    }
    context.setState('connected', `已连接酒馆页面扩展 ${bridgeVersion}，可以双向传输`)
  } else if (message.type === 'local-direct-session') {
    const pending = context.pendingLocalDirectSessions.get(requestId)
    context.pendingLocalDirectSessions.delete(requestId)
    const session = createLocalTavernDirectSession(message.session)
    if (!session) {
      pending?.reject(new Error(`酒馆未提供有效的本机直传会话（仅允许 ${LOCAL_TAVERN_ORIGIN}）`))
    } else {
      pending?.resolve(session)
    }
  } else if (message.type === 'list-response') {
    const pending = context.pendingLists.get(requestId)
    if (!pending) return
    const items = Array.isArray(message.items) ? (message.items as TavernResourceItem[]) : []
    const pageIndex = Number(message.pageIndex)
    const pageCount = Number(message.pageCount)
    if (Number.isInteger(pageIndex) && Number.isInteger(pageCount) && pageCount > 0) {
      if (pageIndex < 0 || pageIndex >= pageCount || pageCount > 1000)
        throw new Error('酒馆资源清单分页信息无效')
      if (pending.pageCount !== undefined && pending.pageCount !== pageCount)
        throw new Error('酒馆资源清单分页总数发生变化')
      pending.pageCount = pageCount
      pending.pages.set(pageIndex, items)
      context.touchList(requestId)
      if (pending.pages.size === pageCount) context.finishList(requestId)
    } else {
      pending.items.push(...items)
      context.finishList(requestId)
    }
  } else if (message.type === 'list-progress') {
    context.touchList(requestId)
  } else if (message.type === 'persona-avatar-check-response') {
    const pending = context.pendingAvatarChecks.get(requestId)
    context.pendingAvatarChecks.delete(requestId)
    const existingIds = Array.isArray(message.existingIds)
      ? message.existingIds.filter((id): id is string => typeof id === 'string')
      : []
    pending?.resolve(new Set(existingIds))
  } else if (message.type === 'file-start' && message.direction === 'to-srl') {
    if (context.cancelledPulls.has(requestId)) return
    context.touchPull(requestId)
    if (
      typeof message.size !== 'number' ||
      !Number.isSafeInteger(message.size) ||
      message.size < 0 ||
      message.size > TAVERN_BRIDGE_MAX_FILE_SIZE
    ) {
      throw new Error('酒馆发送的文件超过 256 MB 限制')
    }
    if (context.incoming.size >= 4 && !context.incoming.has(transferId))
      throw new Error('同时接收的文件过多')
    const directRequested = Object.hasOwn(message, 'localDirectSession')
    const localDirectSession = createLocalTavernDirectSession(message.localDirectSession)
    if (directRequested && !localDirectSession) {
      throw new Error('酒馆发送了无效的本机直传会话')
    }
    if (localDirectSession) {
      try {
        const direct = await downloadLocalTavernDirectFile(
          localDirectSession,
          String(message.name),
          typeof message.mimeType === 'string' ? message.mimeType : '',
        )
        if (direct.file.size !== message.size || direct.sha256 !== message.sha256) {
          await removeLocalTavernDirectFile(localDirectSession)
          throw new Error('本机直传下载后的完整性校验失败')
        }
        context.incoming.set(transferId, {
          meta: message,
          chunks: [],
          received: direct.file.size,
          file: direct.file,
          localDirectSession,
        })
      } catch (error) {
        throw error instanceof Error ? error : new Error('本机直传下载失败')
      }
    } else {
      context.incoming.set(transferId, { meta: message, chunks: [], received: 0 })
    }
  } else if (message.type === 'file-chunk') {
    if (context.cancelledPulls.has(requestId)) return
    const transfer = context.incoming.get(transferId)
    if (!transfer || !(message.data instanceof ArrayBuffer) || typeof message.index !== 'number')
      return
    const count = Math.ceil(Number(transfer.meta.size) / TAVERN_BRIDGE_CHUNK_SIZE)
    if (
      !Number.isInteger(message.index) ||
      message.index < 0 ||
      message.index >= count ||
      message.data.byteLength > TAVERN_BRIDGE_CHUNK_SIZE
    )
      throw new Error('酒馆发送的分块序号或大小无效')
    const previous = transfer.chunks[message.index]
    if (previous) {
      const before = new Uint8Array(previous)
      const next = new Uint8Array(message.data)
      if (before.length !== next.length || before.some((byte, index) => byte !== next[index]))
        throw new Error('重复分块内容不一致')
    } else {
      transfer.chunks[message.index] = message.data
      transfer.received += message.data.byteLength
    }
    if (transfer.received > Number(transfer.meta.size)) throw new Error('接收数据超过声明大小')
    context.touchPull(requestId)
    await context.send('file-chunk-ack', { transferId, index: message.index })
  } else if (message.type === 'file-chunk-ack') {
    context.chunkSender.acknowledge(transferId, message.index)
  } else if (message.type === 'file-end') {
    if (context.cancelledPulls.has(requestId)) return
    context.touchPull(requestId)
    await finishIncoming(context, requestId, transferId)
  } else if (message.type === 'pull-progress') {
    context.touchPull(requestId)
  } else if (message.type === 'pull-complete') {
    const pending = context.pendingPulls.get(requestId)
    context.pendingPulls.delete(requestId)
    context.clearPullTimers(pending)
    pending?.resolve(pending.files)
  } else if (message.type === 'file-result') {
    const pending = context.pendingSends.get(transferId)
    context.pendingSends.delete(transferId)
    const result = message.result as { status?: string; name?: string } | undefined
    pending?.resolve({ name: result?.name ?? '资源', status: result?.status ?? 'completed' })
  } else if (message.type === 'operation-error') {
    const error = new Error(typeof message.error === 'string' ? message.error : '酒馆操作失败')
    if (transferId && context.pendingSends.has(transferId)) {
      context.pendingSends.get(transferId)?.reject(error)
      context.pendingSends.delete(transferId)
    } else if (requestId && context.pendingPulls.has(requestId)) {
      context.failPull(requestId, error.message, false)
    } else if (requestId && context.pendingLists.has(requestId)) {
      context.failList(requestId, error.message)
    } else if (requestId && context.pendingAvatarChecks.has(requestId)) {
      context.pendingAvatarChecks.get(requestId)?.reject(error)
      context.pendingAvatarChecks.delete(requestId)
    } else if (requestId && context.pendingLocalDirectSessions.has(requestId)) {
      context.pendingLocalDirectSessions.get(requestId)?.reject(error)
      context.pendingLocalDirectSessions.delete(requestId)
    } else {
      throw error
    }
  } else if (message.type === 'disconnect') {
    context.disconnect('酒馆扩展已断开')
  }
}

export async function finishIncoming(
  context: TavernBridgeTransferOperationsContext,
  requestId: string,
  transferId: string,
): Promise<void> {
  const transfer = context.incoming.get(transferId)
  if (!transfer) return
  context.incoming.delete(transferId)
  const blob =
    transfer.file ??
    new Blob(transfer.chunks.filter(Boolean) as ArrayBuffer[], {
      type: typeof transfer.meta.mimeType === 'string' ? transfer.meta.mimeType : '',
    })
  if (
    blob.size !== Number(transfer.meta.size) ||
    (await bridgeSha256(blob)) !== transfer.meta.sha256
  ) {
    throw new Error(`${String(transfer.meta.name)} 完整性校验失败`)
  }
  let content: Blob = blob
  if (transfer.meta.contentEncoding === 'gzip') {
    content = await gunzipBlob(blob)
    const rawSize = Number(transfer.meta.rawSize)
    if (Number.isFinite(rawSize) && rawSize > 0 && content.size !== rawSize) {
      throw new Error(`${String(transfer.meta.name)} 解压后大小与声明不符`)
    }
  }
  const file = new File([content], String(transfer.meta.name), {
    type: typeof transfer.meta.mimeType === 'string' ? transfer.meta.mimeType : '',
  })
  context.pendingPulls.get(requestId)?.files.push(file)
  if (transfer.localDirectSession) await removeLocalTavernDirectFile(transfer.localDirectSession)
}
