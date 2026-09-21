import {
  BRIDGE_COMPRESS_MIN_BYTES,
  gunzipBlob,
  gzipBlob,
  isCompressibleKind,
  supportsBridgeGzip,
} from '../utils/BridgeCompression'
import { BRIDGE_EXTENSION_VERSION, isBridgeExtensionOutdated } from '../utils/BridgeInstall'
import { isCapacitorApp } from '../utils/CapacitorDetection'
import {
  canUseLocalTavernDirect,
  createLocalTavernDirectSession,
  downloadLocalTavernDirectFile,
  LOCAL_TAVERN_ORIGIN,
  type LocalTavernDirectSession,
  removeLocalTavernDirectFile,
  uploadLocalTavernDirectFile,
} from './LanDirectService'
import {
  bridgeInvitation,
  bridgeSha256,
  isTavernEnvelope,
  TAVERN_BRIDGE_CHUNK_SIZE,
  TAVERN_BRIDGE_DEFAULT_IN_FLIGHT_CHUNKS,
  TAVERN_BRIDGE_MAX_IN_FLIGHT_CHUNKS,
  TAVERN_BRIDGE_MAX_FILE_SIZE,
  TAVERN_BRIDGE_MIN_IN_FLIGHT_CHUNKS,
  tavernEnvelope,
  type TavernBridgeEnvelope,
  type TavernConflictPolicy,
  type TavernResourceItem,
  type TavernResourceKind,
} from './TavernBridgeProtocol'
import { LOCAL_TAVERN_RELAY_BASE, TavernHttpRelayPort } from './TavernHttpRelayPort'

export { TavernHttpRelayPort } from './TavernHttpRelayPort'

export type TavernBridgeStatus = 'idle' | 'discovering' | 'pairing' | 'connected' | 'error'

export type TavernBridgeTransport = 'none' | 'window' | 'relay' | 'local-direct'

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

interface IncomingTransfer {
  meta: TavernBridgeEnvelope
  chunks: Array<ArrayBuffer | undefined>
  received: number
  file?: File
  localDirectSession?: LocalTavernDirectSession
}

interface PendingPull {
  files: File[]
  resolve: (files: File[]) => void
  reject: (error: Error) => void
}

export class TavernBridgeService extends EventTarget {
  private invitation = bridgeInvitation()
  private state: TavernBridgeState = {
    status: this.invitation ? 'discovering' : 'idle',
    detail: this.invitation ? '正在寻找打开此页面的酒馆' : '请从酒馆扩展打开 SRL',
    pairCode: this.invitation?.pairCode ?? '',
    tavernOrigin: this.invitation?.tavernOrigin ?? '',
    bridgeVersion: '',
    tavernVersion: '',
    transport: 'none',
    capabilities: [],
  }
  private port?: MessagePort | TavernHttpRelayPort
  private helloTimer?: number
  private messageChain = Promise.resolve()
  private readonly pendingLists = new Map<
    string,
    { resolve: (items: TavernResourceItem[]) => void; reject: (error: Error) => void }
  >()
  private readonly pendingPulls = new Map<string, PendingPull>()
  private readonly pendingSends = new Map<
    string,
    { resolve: (value: string) => void; reject: (error: Error) => void }
  >()
  private readonly pendingLocalDirectSessions = new Map<
    string,
    { resolve: (value: LocalTavernDirectSession) => void; reject: (error: Error) => void }
  >()
  private readonly incoming = new Map<string, IncomingTransfer>()
  private readonly chunkAcks = new Map<string, () => void>()
  private peerCapabilities: string[] = []
  private localDirectEnabled = false

  constructor() {
    super()
    if (typeof window !== 'undefined') {
      window.addEventListener('message', this.handleWindowMessage)
      if (this.invitation) this.startDiscovery()
    }
  }

  hasInvitation(): boolean {
    return Boolean(this.invitation)
  }

  getState(): TavernBridgeState {
    return { ...this.state, capabilities: [...this.state.capabilities] }
  }

  setLocalTavernDirectEnabled(enabled: boolean): boolean {
    this.localDirectEnabled = enabled && canUseLocalTavernDirect()
    return this.localDirectEnabled
  }

  isLocalTavernDirectAvailable(): boolean {
    return (
      this.localDirectEnabled &&
      canUseLocalTavernDirect() &&
      this.peerCapabilities.includes('local-direct-v1')
    )
  }

  async connectLocalTavern(): Promise<void> {
    if (!canUseLocalTavernDirect()) throw new Error('本机酒馆一键连接仅支持 Android APK')
    this.disconnect('正在请求本机酒馆连接')
    let response: Response
    try {
      response = await fetch(new URL('local-pair/requests', LOCAL_TAVERN_RELAY_BASE).href, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ srlUrl: window.location.href }),
        cache: 'no-store',
      })
    } catch {
      throw new Error('未发现本机酒馆；请先在同一台设备启动 http://127.0.0.1:8000')
    }
    const result = (await response.json().catch(() => ({}))) as {
      code?: string
      participantToken?: string
      relayBase?: string
      error?: string
    }
    if (!response.ok) {
      if (response.status === 404) {
        throw new Error('本机酒馆服务端插件未安装或版本过旧；请更新到 SRL Bridge 0.3.22 后重启酒馆')
      }
      throw new Error(result.error || `本机酒馆连接请求失败（HTTP ${response.status}）`)
    }
    const code = typeof result.code === 'string' ? result.code : ''
    const token = typeof result.participantToken === 'string' ? result.participantToken : ''
    const relayBase = new URL(String(result.relayBase ?? ''), LOCAL_TAVERN_ORIGIN)
    if (
      !/^[2-9A-HJ-NP-Z]{8}$/u.test(code) ||
      !/^[A-Za-z0-9_-]{32,}$/u.test(token) ||
      relayBase.href !== LOCAL_TAVERN_RELAY_BASE
    ) {
      throw new Error('本机酒馆返回的连接会话无效')
    }
    const port = new TavernHttpRelayPort(relayBase.href, { code, token })
    port.onmessage = (portEvent) => {
      this.messageChain = this.messageChain
        .then(() => this.handlePortMessage(portEvent.data))
        .catch((error) =>
          this.setState('error', error instanceof Error ? error.message : '本机连接处理失败'),
        )
    }
    port.onerror = (error) => {
      this.setState('error', error instanceof Error ? error.message : '本机酒馆连接已断开')
    }
    this.invitation = null
    this.port = port
    this.localDirectEnabled = true
    this.state = {
      ...this.state,
      pairCode: '',
      tavernOrigin: LOCAL_TAVERN_ORIGIN,
      bridgeVersion: '',
      tavernVersion: '',
      transport: 'local-direct',
      capabilities: [],
    }
    port.start()
    this.setState(
      'discovering',
      '已请求本机酒馆连接；请在酒馆“SRL 酒馆互传”扩展点击“允许本机 APK 连接”',
    )
  }

  private startDiscovery(): void {
    if (this.invitation?.participantToken && this.invitation.relayBase) {
      this.startRelayFromInvitation()
      return
    }
    // Capacitor 原生应用无法使用 window.opener/parent，只能使用本机服务连接
    if (isCapacitorApp()) {
      this.setState('error', '原生应用无法使用窗口通信，请在本机酒馆扩展中允许连接。')
      return
    }
    if (this.helloTimer) window.clearInterval(this.helloTimer)
    this.setState('discovering', '正在寻找酒馆窗口')
    this.sendHello()
    this.helloTimer = window.setInterval(() => this.sendHello(), 800)
    window.setTimeout(() => {
      if (this.state.status === 'discovering') {
        this.setState(
          'error',
          '没有找到酒馆窗口。请从酒馆扩展重新打开互传页面，或确认本机酒馆插件已安装。',
        )
      }
    }, 12_000)
  }

  private sendHello(): void {
    const host = window.parent !== window ? window.parent : window.opener
    if (!this.invitation || !host || ('closed' in host && host.closed)) return
    host.postMessage(
      tavernEnvelope('srl-hello', { channel: this.invitation.channel }),
      this.invitation.tavernOrigin,
    )
  }

  private startRelayFromInvitation(): void {
    const invitation = this.invitation
    if (!invitation?.participantToken || !invitation.relayBase) return
    try {
      this.connectHttpRelay(
        invitation.relayBase,
        invitation.channel.slice('relay-'.length),
        invitation.participantToken,
        invitation.pairCode,
        invitation.tavernOrigin,
      )
      this.removeRelayUrlParams()
    } catch (error) {
      this.setState('error', error instanceof Error ? error.message : '本机中继初始化失败')
    }
  }

  private connectHttpRelay(
    relayBaseValue: string,
    code: string,
    token: string,
    pairCode: string,
    tavernOrigin: string,
  ): void {
    const relayBase = new URL(relayBaseValue, tavernOrigin)
    if (relayBase.origin !== tavernOrigin) throw new Error('中继地址来源不一致')
    if (!/^[2-9A-HJ-NP-Z]{8}$/u.test(code)) throw new Error('本机中继会话格式无效')
    if (!/^\d{6}$/u.test(pairCode)) throw new Error('配对码格式无效')
    if (this.helloTimer) window.clearInterval(this.helloTimer)
    this.port?.close()
    const directPort = new TavernHttpRelayPort(relayBase.href, { code, token })
    directPort.onmessage = (portEvent) => {
      this.messageChain = this.messageChain
        .then(() => this.handlePortMessage(portEvent.data))
        .catch((error) =>
          this.setState('error', error instanceof Error ? error.message : '通信处理失败'),
        )
    }
    directPort.onerror = (error) => {
      this.setState('error', error instanceof Error ? error.message : '本机中继已断开')
    }
    this.invitation = {
      channel: `relay-${code}`,
      pairCode,
      tavernOrigin,
      relayBase: relayBase.href,
      participantToken: token,
    }
    this.state = {
      ...this.state,
      pairCode,
      tavernOrigin,
      transport: 'relay',
    }
    this.port = directPort
    directPort.start()
    this.setState('pairing', '请核对酒馆扩展中显示的六位数字')
  }

  private removeRelayUrlParams(): void {
    if (typeof history === 'undefined') return
    const url = new URL(window.location.href)
    let changed = false
    for (const key of ['srlBridge', 'pair', 'stOrigin', 'relayBase', 'relayToken']) {
      if (url.searchParams.has(key)) {
        url.searchParams.delete(key)
        changed = true
      }
    }
    if (changed) history.replaceState(history.state, '', url.href)
  }

  private readonly handleWindowMessage = (event: MessageEvent): void => {
    const message = event.data
    const host = window.parent !== window ? window.parent : window.opener
    if (!this.invitation || event.origin !== this.invitation.tavernOrigin || event.source !== host)
      return
    if (
      !isTavernEnvelope(message) ||
      message.type !== 'st-port' ||
      message.channel !== this.invitation.channel ||
      message.pairCode !== this.invitation.pairCode ||
      !event.ports[0]
    ) {
      return
    }
    if (this.helloTimer) window.clearInterval(this.helloTimer)
    this.port?.close()
    const messagePort = event.ports[0]
    this.port = messagePort
    this.state = {
      ...this.state,
      tavernVersion: typeof message.tavernVersion === 'string' ? message.tavernVersion : '',
      transport: 'window',
      capabilities: Array.isArray(message.capabilities)
        ? message.capabilities.filter((value): value is string => typeof value === 'string')
        : [],
    }
    messagePort.onmessage = (portEvent) => {
      this.messageChain = this.messageChain
        .then(() => this.handlePortMessage(portEvent.data))
        .catch((error) =>
          this.setState('error', error instanceof Error ? error.message : '通信处理失败'),
        )
    }
    messagePort.start()
    this.setState('pairing', '请核对酒馆扩展中显示的六位数字')
  }

  accept(): void {
    if (!this.invitation || !this.port) throw new Error('酒馆通信通道尚未准备好')
    this.send('srl-accept', {
      pairCode: this.invitation.pairCode,
      capabilities: supportsBridgeGzip() ? ['gzip'] : [],
    })
  }

  async listResources(): Promise<TavernResourceItem[]> {
    this.assertConnected()
    const requestId = crypto.randomUUID()
    const pending = new Promise<TavernResourceItem[]>((resolve, reject) => {
      this.pendingLists.set(requestId, { resolve, reject })
    })
    await this.send('list-request', { requestId })
    return this.withTimeout(pending, requestId, this.pendingLists, '读取酒馆资源超时')
  }

  async pullResources(items: TavernResourceItem[]): Promise<File[]> {
    this.assertConnected()
    const requestId = crypto.randomUUID()
    const pending = new Promise<File[]>((resolve, reject) => {
      this.pendingPulls.set(requestId, { files: [], resolve, reject })
    })
    await this.send('pull-request', {
      requestId,
      items: items.map(({ id }) => ({ id })),
      localDirect: this.isLocalTavernDirectAvailable(),
    })
    return this.withTimeout(pending, requestId, this.pendingPulls, '从酒馆接收资源超时', 120_000)
  }

  async sendFiles(
    files: Array<{
      file: File
      kind: TavernResourceKind
      displayName: string
      targetName?: string
    }>,
    conflictPolicy: TavernConflictPolicy,
    onProgress?: (completed: number, total: number, detail?: string) => void,
  ): Promise<string[]> {
    this.assertConnected()
    const requestId = crypto.randomUUID()
    const results: string[] = []
    const localDirect = this.isLocalTavernDirectAvailable()
    for (let fileIndex = 0; fileIndex < files.length; fileIndex += 1) {
      const item = files[fileIndex]!
      if (item.file.size > TAVERN_BRIDGE_MAX_FILE_SIZE) {
        throw new Error(`${item.file.name} 超过单文件 256 MB 限制`)
      }
      const transferId = crypto.randomUUID()
      const result = new Promise<string>((resolve, reject) => {
        this.pendingSends.set(transferId, { resolve, reject })
      })
      // 对端声明 gzip 能力时压缩 JSON 类资源；size/sha256 描述实际传输载荷，
      // 旧端的分块记账与完整性校验因此保持不变。
      const useGzip =
        this.peerCapabilities.includes('gzip') &&
        supportsBridgeGzip() &&
        isCompressibleKind(item.kind) &&
        item.file.size > BRIDGE_COMPRESS_MIN_BYTES
      const payload = useGzip ? await gzipBlob(item.file) : item.file
      const sha256 = await bridgeSha256(payload)
      let localDirectSession: LocalTavernDirectSession | undefined
      if (localDirect) {
        try {
          localDirectSession = await this.requestLocalDirectSession()
          const uploaded = await uploadLocalTavernDirectFile(
            localDirectSession,
            payload,
            item.file.name,
          )
          if (uploaded.size !== payload.size || uploaded.sha256 !== sha256) {
            throw new Error('本机直传上传后的完整性校验失败')
          }
        } catch {
          if (localDirectSession) await removeLocalTavernDirectFile(localDirectSession)
          localDirectSession = undefined
          onProgress?.(
            fileIndex,
            files.length,
            `本机直传不可用，改用当前连接的分块传输：${item.displayName}`,
          )
        }
      }
      await this.send('file-start', {
        requestId,
        transferId,
        direction: 'to-tavern',
        name: item.file.name,
        displayName: item.displayName,
        mimeType: item.file.type,
        kind: item.kind,
        targetName: item.targetName,
        conflictPolicy,
        size: payload.size,
        sha256,
        ...(localDirectSession ? { localDirectSession } : {}),
        ...(useGzip ? { contentEncoding: 'gzip', rawSize: item.file.size } : {}),
      })
      onProgress?.(fileIndex, files.length, `正在上传 ${item.displayName}`)
      if (localDirectSession) {
        onProgress?.(fileIndex, files.length, `正在本机直传 ${item.displayName}`)
      } else {
        await this.sendFileChunks(payload, requestId, transferId, (uploadedBytes) => {
          onProgress?.(
            fileIndex,
            files.length,
            `正在上传 ${item.displayName} · ${uploadedBytes} / ${payload.size} bytes`,
          )
        })
      }
      await this.send('file-end', { requestId, transferId })
      onProgress?.(fileIndex, files.length, `等待酒馆导入 ${item.displayName}`)
      results.push(
        await this.withTimeout(
          result,
          transferId,
          this.pendingSends,
          `${item.file.name} 导入酒馆超时`,
          90_000,
        ),
      )
      onProgress?.(fileIndex + 1, files.length, `${item.displayName} 已完成`)
    }
    return results
  }

  private async handlePortMessage(message: unknown): Promise<void> {
    if (!isTavernEnvelope(message)) return
    const requestId = typeof message.requestId === 'string' ? message.requestId : ''
    const transferId = typeof message.transferId === 'string' ? message.transferId : ''
    if (message.type === 'st-ready') {
      const bridgeVersion = typeof message.bridgeVersion === 'string' ? message.bridgeVersion : ''
      this.peerCapabilities = Array.isArray(message.capabilities)
        ? message.capabilities.filter((value): value is string => typeof value === 'string')
        : []
      this.state = {
        ...this.state,
        bridgeVersion,
        tavernVersion:
          typeof message.tavernVersion === 'string'
            ? message.tavernVersion
            : this.state.tavernVersion,
        capabilities: [...this.peerCapabilities],
      }
      if (!bridgeVersion || isBridgeExtensionOutdated(bridgeVersion)) {
        const versionDetail = bridgeVersion
          ? `当前 ${bridgeVersion}，资源库要求 ${BRIDGE_EXTENSION_VERSION} 或更高版本。`
          : `未收到页面扩展版本，资源库要求 ${BRIDGE_EXTENSION_VERSION} 或更高版本。`
        this.setState(
          'error',
          `酒馆页面扩展版本过旧。${versionDetail}通过 Git 链接安装的：请在酒馆扩展管理中点击更新；通过离线 ZIP 安装的：请重新下载最新离线包覆盖安装。更新后完全刷新酒馆页面再重试。`,
        )
        return
      }
      this.setState('connected', `已连接酒馆页面扩展 ${bridgeVersion}，可以双向传输`)
    } else if (message.type === 'local-direct-session') {
      const pending = this.pendingLocalDirectSessions.get(requestId)
      this.pendingLocalDirectSessions.delete(requestId)
      const session = createLocalTavernDirectSession(message.session)
      if (!session) {
        pending?.reject(new Error(`酒馆未提供有效的本机直传会话（仅允许 ${LOCAL_TAVERN_ORIGIN}）`))
      } else {
        pending?.resolve(session)
      }
    } else if (message.type === 'list-response') {
      const pending = this.pendingLists.get(requestId)
      this.pendingLists.delete(requestId)
      pending?.resolve(Array.isArray(message.items) ? (message.items as TavernResourceItem[]) : [])
    } else if (message.type === 'file-start' && message.direction === 'to-srl') {
      if (typeof message.size !== 'number' || message.size > TAVERN_BRIDGE_MAX_FILE_SIZE) {
        throw new Error('酒馆发送的文件超过 256 MB 限制')
      }
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
          this.incoming.set(transferId, {
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
        this.incoming.set(transferId, { meta: message, chunks: [], received: 0 })
      }
    } else if (message.type === 'file-chunk') {
      const transfer = this.incoming.get(transferId)
      if (!transfer || !(message.data instanceof ArrayBuffer) || typeof message.index !== 'number')
        return
      transfer.chunks[message.index] = message.data
      transfer.received += message.data.byteLength
      if (transfer.received > Number(transfer.meta.size)) throw new Error('接收数据超过声明大小')
      await this.send('file-chunk-ack', { transferId, index: message.index })
    } else if (message.type === 'file-chunk-ack') {
      const key = `${transferId}:${String(message.index)}`
      const resolve = this.chunkAcks.get(key)
      this.chunkAcks.delete(key)
      resolve?.()
    } else if (message.type === 'file-end') {
      await this.finishIncoming(requestId, transferId)
    } else if (message.type === 'pull-complete') {
      const pending = this.pendingPulls.get(requestId)
      this.pendingPulls.delete(requestId)
      pending?.resolve(pending.files)
    } else if (message.type === 'file-result') {
      const pending = this.pendingSends.get(transferId)
      this.pendingSends.delete(transferId)
      const result = message.result as { status?: string; name?: string } | undefined
      pending?.resolve(`${result?.name ?? '资源'}：${result?.status ?? '完成'}`)
    } else if (message.type === 'operation-error') {
      const error = new Error(typeof message.error === 'string' ? message.error : '酒馆操作失败')
      if (transferId && this.pendingSends.has(transferId)) {
        this.pendingSends.get(transferId)?.reject(error)
        this.pendingSends.delete(transferId)
      } else if (requestId && this.pendingPulls.has(requestId)) {
        this.pendingPulls.get(requestId)?.reject(error)
        this.pendingPulls.delete(requestId)
      } else if (requestId && this.pendingLists.has(requestId)) {
        this.pendingLists.get(requestId)?.reject(error)
        this.pendingLists.delete(requestId)
      } else if (requestId && this.pendingLocalDirectSessions.has(requestId)) {
        this.pendingLocalDirectSessions.get(requestId)?.reject(error)
        this.pendingLocalDirectSessions.delete(requestId)
      } else {
        throw error
      }
    } else if (message.type === 'disconnect') {
      this.disconnect('酒馆扩展已断开')
    }
  }

  private async finishIncoming(requestId: string, transferId: string): Promise<void> {
    const transfer = this.incoming.get(transferId)
    if (!transfer) return
    this.incoming.delete(transferId)
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
    this.pendingPulls.get(requestId)?.files.push(file)
    if (transfer.localDirectSession) await removeLocalTavernDirectFile(transfer.localDirectSession)
  }

  disconnect(detail = '连接已断开'): void {
    if (this.helloTimer) window.clearInterval(this.helloTimer)
    this.port?.close()
    this.port = undefined
    this.invitation = null
    this.peerCapabilities = []
    this.localDirectEnabled = false
    this.rejectPending(new Error(detail))
    this.state = {
      ...this.state,
      pairCode: '',
      tavernOrigin: '',
      bridgeVersion: '',
      tavernVersion: '',
      transport: 'none',
      capabilities: [],
    }
    this.setState('idle', detail)
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pendingLists.values()) pending.reject(error)
    for (const pending of this.pendingPulls.values()) pending.reject(error)
    for (const pending of this.pendingSends.values()) pending.reject(error)
    for (const pending of this.pendingLocalDirectSessions.values()) pending.reject(error)
    this.pendingLists.clear()
    this.pendingPulls.clear()
    this.pendingSends.clear()
    this.pendingLocalDirectSessions.clear()
    this.incoming.clear()
    this.chunkAcks.clear()
  }

  private send(
    type: string,
    payload: Record<string, unknown> = {},
    transfer: Transferable[] = [],
  ): Promise<void> {
    if (!this.port) throw new Error('尚未连接酒馆扩展')
    const envelope = tavernEnvelope(type, payload)
    if (this.port instanceof TavernHttpRelayPort) {
      if (type === 'file-chunk') return this.port.postFileChunk(envelope)
      return this.port.postMessage(envelope)
    }
    this.port.postMessage(envelope, transfer)
    return Promise.resolve()
  }

  private assertConnected(): void {
    if (this.state.status !== 'connected' || !this.port) throw new Error('请先完成酒馆配对')
  }

  private async requestLocalDirectSession(): Promise<LocalTavernDirectSession> {
    const requestId = crypto.randomUUID()
    const pending = new Promise<LocalTavernDirectSession>((resolve, reject) => {
      this.pendingLocalDirectSessions.set(requestId, { resolve, reject })
    })
    await this.send('local-direct-session-request', { requestId })
    return this.withTimeout(
      pending,
      requestId,
      this.pendingLocalDirectSessions,
      '创建本机直传会话超时',
      15_000,
    )
  }

  private sendChunkAndWait(payload: {
    requestId: string
    transferId: string
    index: number
    data: ArrayBuffer
  }): Promise<void> {
    const key = `${payload.transferId}:${payload.index}`
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.chunkAcks.delete(key)
        reject(new Error('文件分块确认超时'))
      }, 90_000)
      this.chunkAcks.set(key, () => {
        window.clearTimeout(timer)
        resolve()
      })
      try {
        void this.send('file-chunk', payload, [payload.data]).catch((error) => {
          window.clearTimeout(timer)
          this.chunkAcks.delete(key)
          reject(error)
        })
      } catch (error) {
        window.clearTimeout(timer)
        this.chunkAcks.delete(key)
        reject(error)
      }
    })
  }

  private async sendFileChunks(
    file: Blob,
    requestId: string,
    transferId: string,
    onAck?: (uploadedBytes: number) => void,
  ): Promise<void> {
    const pending = new Set<Promise<void>>()
    let inFlightLimit = TAVERN_BRIDGE_DEFAULT_IN_FLIGHT_CHUNKS
    let fastAckStreak = 0
    let uploadedBytes = 0
    const adjustWindow = (elapsedMs: number): void => {
      if (elapsedMs < 350 && inFlightLimit < TAVERN_BRIDGE_MAX_IN_FLIGHT_CHUNKS) {
        fastAckStreak += 1
        if (fastAckStreak >= inFlightLimit * 2) {
          inFlightLimit += 1
          fastAckStreak = 0
        }
        return
      }
      fastAckStreak = 0
      if (elapsedMs > 1_500 && inFlightLimit > TAVERN_BRIDGE_MIN_IN_FLIGHT_CHUNKS) {
        inFlightLimit -= 1
      }
    }
    try {
      for (
        let offset = 0, index = 0;
        offset < file.size;
        offset += TAVERN_BRIDGE_CHUNK_SIZE, index += 1
      ) {
        const data = await file.slice(offset, offset + TAVERN_BRIDGE_CHUNK_SIZE).arrayBuffer()
        const sentAt = performance.now()
        const ack = this.sendChunkAndWait({ requestId, transferId, index, data }).then(() => {
          adjustWindow(performance.now() - sentAt)
          uploadedBytes += data.byteLength
          onAck?.(Math.min(uploadedBytes, file.size))
        })
        pending.add(ack)
        ack.then(
          () => pending.delete(ack),
          () => pending.delete(ack),
        )
        if (pending.size >= inFlightLimit) await Promise.race(pending)
      }
      await Promise.all([...pending])
    } catch (error) {
      await Promise.allSettled([...pending])
      throw error
    }
  }

  private setState(status: TavernBridgeStatus, detail: string): void {
    this.state = { ...this.state, status, detail }
    this.dispatchEvent(new CustomEvent<TavernBridgeState>('state', { detail: this.getState() }))
  }

  private async withTimeout<T, P>(
    promise: Promise<T>,
    id: string,
    pending: Map<string, P>,
    message: string,
    timeout = 30_000,
  ): Promise<T> {
    let timer = 0
    try {
      return await Promise.race([
        promise,
        new Promise<T>((_, reject) => {
          timer = window.setTimeout(() => reject(new Error(message)), timeout)
        }),
      ])
    } finally {
      window.clearTimeout(timer)
      pending.delete(id)
    }
  }

  destroy(): void {
    this.disconnect()
    window.removeEventListener('message', this.handleWindowMessage)
  }
}

/**
 * 互传服务单例。
 *
 * 刻意不放进 AppContainer：互传只在“功能 → 酒馆互传”页面用到，
 * 放在这里可以让整个互传实现跟随 TavernBridgeCenter 一起按需加载，
 * 不进入登录后立即拉取的公共容器分包。
 */
export const tavernBridgeService = new TavernBridgeService()
