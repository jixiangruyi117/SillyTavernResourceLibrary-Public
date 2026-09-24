import { tavernHttpFetch } from './TavernHttpTransport'
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
  TAVERN_BRIDGE_MAX_FILE_SIZE,
  tavernEnvelope,
  type TavernBridgeEnvelope,
  type TavernConflictPolicy,
  type TavernResourceItem,
  type TavernResourceKind,
} from './TavernBridgeProtocol'
import { LOCAL_TAVERN_RELAY_BASE, TavernHttpRelayPort } from './TavernHttpRelayPort'
import { TavernChunkSender } from './TavernChunkSender'
import { TavernDirectoryService } from './TavernDirectoryService'
import {
  BrowserTavernDirectory,
  chooseBrowserTavernDirectory,
  supportsBrowserTavernDirectory,
} from '../storage/TavernDirectoryStorage'
import {
  chooseNativeTavernDirectory,
  supportsNativeTavernDirectory,
} from '../storage/NativeTavernDirectoryStorage'

export { TavernHttpRelayPort } from './TavernHttpRelayPort'

export type TavernBridgeStatus = 'idle' | 'discovering' | 'pairing' | 'connected' | 'error'

export type TavernBridgeTransport = 'none' | 'window' | 'relay' | 'local-direct' | 'directory'

export interface TavernBridgeImportResult {
  status: string
  name: string
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
  private directory?: TavernDirectoryService
  private invitation = bridgeInvitation()
  private state: TavernBridgeState = {
    status: this.invitation ? 'discovering' : 'idle',
    detail: this.invitation ? '正在寻找打开此页面的酒馆' : '输入酒馆设备码，或选择本机酒馆目录',
    pairCode: this.invitation?.pairCode ?? '',
    tavernOrigin: this.invitation?.tavernOrigin ?? '',
    bridgeVersion: '',
    tavernVersion: '',
    transport: 'none',
    capabilities: [],
  }
  private port?: MessagePort | TavernHttpRelayPort
  private helloTimer?: number
  private relayWindow?: Window
  private relayOrigin = ''
  private messageChain = Promise.resolve()
  private readonly pendingLists = new Map<
    string,
    { resolve: (items: TavernResourceItem[]) => void; reject: (error: Error) => void }
  >()
  private readonly pendingPulls = new Map<string, PendingPull>()
  private readonly pendingSends = new Map<
    string,
    { resolve: (value: TavernBridgeImportResult) => void; reject: (error: Error) => void }
  >()
  private readonly pendingAvatarChecks = new Map<
    string,
    { resolve: (ids: Set<string>) => void; reject: (error: Error) => void }
  >()
  private readonly pendingLocalDirectSessions = new Map<
    string,
    { resolve: (value: LocalTavernDirectSession) => void; reject: (error: Error) => void }
  >()
  private readonly incoming = new Map<string, IncomingTransfer>()
  private readonly chunkSender = new TavernChunkSender((payload) =>
    this.send('file-chunk', { ...payload }, [payload.data]),
  )
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

  canBindDirectory(): boolean {
    return supportsNativeTavernDirectory() || supportsBrowserTavernDirectory()
  }

  async bindDirectory(reuse = true): Promise<void> {
    const storage = supportsNativeTavernDirectory()
      ? await chooseNativeTavernDirectory(reuse)
      : await chooseBrowserTavernDirectory(reuse)
    const directory = new TavernDirectoryService(storage)
    await directory.validate()
    if (storage instanceof BrowserTavernDirectory) await storage.remember()
    this.disconnect('正在绑定酒馆目录')
    this.directory = directory
    this.peerCapabilities = [...directory.capabilities]
    this.state = {
      ...this.state,
      transport: 'directory',
      tavernOrigin: storage.name,
      bridgeVersion: '本地目录',
      capabilities: [...directory.capabilities],
    }
    this.setState('connected', `已绑定 ${storage.name}；写回前请关闭酒馆，写入后下次启动生效`)
  }

  openDeviceRelay(joinUrl: string, tavernOrigin: string): void {
    const join = new URL(joinUrl)
    const origin = new URL(tavernOrigin)
    if (
      !['http:', 'https:'].includes(join.protocol) ||
      origin.origin !== tavernOrigin ||
      join.origin !== tavernOrigin
    ) {
      throw new Error('酒馆中继地址无效')
    }
    this.disconnect('正在建立设备码连接')
    // Capacitor 原生应用无法操作弹窗，不能离开当前页面；
    // 引导用户在酒馆互传页使用"输入设备码"方式连接。
    if (isCapacitorApp()) {
      throw new Error('原生应用不支持同浏览器配对窗口，请使用"输入酒馆显示的设备码"方式连接。')
    }
    const relayWindow = window.open(
      join.href,
      `srl-device-relay-${Date.now()}`,
      'popup,width=520,height=680',
    )
    if (!relayWindow) throw new Error('浏览器阻止了中继窗口')
    this.relayWindow = relayWindow
    this.relayOrigin = tavernOrigin
    this.setState('discovering', '正在通过酒馆中继连接；资源库会保留在当前页面')
    window.setTimeout(() => {
      if (this.state.status === 'discovering' && !this.invitation) {
        this.setState(
          'error',
          '没有收到新版酒馆中继响应；请确认页面扩展和服务端插件都是 0.3.11 或更新版本、酒馆地址没有把 http 写成 https，并允许本站打开弹出窗口。',
        )
      }
    }, 12_000)
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

  async joinSecureRelay(codeValue: string): Promise<void> {
    const code = codeValue.trim().toUpperCase()
    if (!/^[2-9A-HJ-NP-Z]{8}$/u.test(code)) throw new Error('设备码格式无效')
    this.disconnect('正在连接 HTTPS 安全中继')
    const endpoint = new URL('api/bridge/join', `${window.location.origin}/`)
    let response: Response
    try {
      response = await tavernHttpFetch(endpoint.href, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
        cache: 'no-store',
      })
    } catch {
      throw new Error('无法连接资源库的 HTTPS 中继，请检查网络或服务器是否已更新')
    }
    const result = (await response.json().catch(() => ({}))) as {
      error?: string
      pairCode?: string
      participantToken?: string
      relayBase?: string
      reliableDelivery?: boolean
      message?: string
    }
    if (!response.ok) {
      if (response.status === 404) {
        throw new Error(result.error || result.message || '设备码不存在或已过期，请在酒馆重新生成')
      }
      throw new Error(
        result.error || result.message || `HTTPS 中继连接失败（HTTP ${response.status}）`,
      )
    }
    if (
      typeof result.pairCode !== 'string' ||
      typeof result.participantToken !== 'string' ||
      typeof result.relayBase !== 'string'
    ) {
      throw new Error('HTTPS 中继返回的数据不完整，请更新云服务器')
    }
    const relayBase = new URL(result.relayBase, window.location.origin)
    this.connectHttpRelay(
      relayBase.href,
      code,
      result.participantToken,
      result.pairCode,
      relayBase.origin,
      result.reliableDelivery === true,
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
        .catch((error) => this.failConnection(error, '本机连接处理失败'))
    }
    port.onerror = (error) => this.failConnection(error, '本机酒馆连接已断开')
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
    // Capacitor 原生应用无法使用 window.opener/parent，必须用设备码中继
    if (isCapacitorApp()) {
      this.setState('error', '原生应用无法使用窗口通信，请使用”设备码中继”连接酒馆。')
      return
    }
    if (this.helloTimer) window.clearInterval(this.helloTimer)
    this.setState('discovering', '正在连接酒馆中继')
    this.sendHello()
    this.helloTimer = window.setInterval(() => this.sendHello(), 800)
    window.setTimeout(() => {
      if (this.state.status === 'discovering') {
        this.setState(
          'error',
          '没有找到酒馆窗口。移动端或酒馆安全头可能切断了窗口连接；请优先改用”设备码中继”，并确认酒馆服务端插件已安装。',
        )
      }
    }, 12_000)
  }

  private sendHello(): void {
    const host = this.relayWindow ?? (window.parent !== window ? window.parent : window.opener)
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
      this.setState('error', error instanceof Error ? error.message : '设备码中继初始化失败')
    }
  }

  private connectHttpRelay(
    relayBaseValue: string,
    code: string,
    token: string,
    pairCode: string,
    tavernOrigin: string,
    reliableDelivery = false,
  ): void {
    const relayBase = new URL(relayBaseValue, tavernOrigin)
    if (relayBase.origin !== tavernOrigin) throw new Error('中继地址来源不一致')
    if (!/^[2-9A-HJ-NP-Z]{8}$/u.test(code)) throw new Error('设备码格式无效')
    if (!/^\d{6}$/u.test(pairCode)) throw new Error('配对码格式无效')
    if (this.helloTimer) window.clearInterval(this.helloTimer)
    this.port?.close()
    const directPort = new TavernHttpRelayPort(relayBase.href, { code, token, reliableDelivery })
    directPort.onmessage = (portEvent) => {
      this.messageChain = this.messageChain
        .then(() => this.handlePortMessage(portEvent.data))
        .catch((error) => this.failConnection(error, '通信处理失败'))
      return this.messageChain
    }
    directPort.onrecovery = (recovering) => {
      if (this.port === directPort)
        this.setState(
          this.state.status,
          recovering
            ? '网络暂时中断，正在恢复传输；请保持页面在前台'
            : this.state.status === 'connected'
              ? '网络已恢复，继续传输'
              : '请核对酒馆中的六位配对码',
        )
    }
    directPort.onerror = (error) => this.failConnection(error, '设备码中继已断开')
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
    if (
      !this.invitation &&
      this.relayWindow &&
      event.origin === this.relayOrigin &&
      isTavernEnvelope(message) &&
      message.type === 'relay-invitation' &&
      typeof message.channel === 'string' &&
      /^relay-[2-9A-HJ-NP-Z]{8}$/u.test(message.channel) &&
      typeof message.pairCode === 'string' &&
      /^\d{6}$/u.test(message.pairCode)
    ) {
      this.invitation = {
        channel: message.channel,
        pairCode: message.pairCode,
        tavernOrigin: event.origin,
      }
      if (event.source && 'postMessage' in event.source) {
        this.relayWindow = event.source as Window
      }
      this.state = {
        ...this.state,
        pairCode: message.pairCode,
        tavernOrigin: event.origin,
      }
      // 中继窗口仍在时必须通过窗口转发。线上 SRL 是 HTTPS，而本机酒馆通常是 HTTP；
      // 若在这里直接 fetch 酒馆的 relay API，Android/iOS 会按混合内容拦截并报 Failed to fetch。
      this.startDiscovery()
      return
    }
    const host = this.relayWindow ?? (window.parent !== window ? window.parent : window.opener)
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
        .catch((error) => this.failConnection(error, '通信处理失败'))
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
    if (this.directory) return this.directory.listResources()
    this.assertConnected()
    const requestId = crypto.randomUUID()
    const pending = new Promise<TavernResourceItem[]>((resolve, reject) => {
      this.pendingLists.set(requestId, { resolve, reject })
    })
    void this.send('list-request', { requestId }).catch((error) =>
      this.pendingLists.get(requestId)?.reject(error),
    )
    return this.withTimeout(pending, requestId, this.pendingLists, '读取酒馆资源超时')
  }

  async checkUserAvatarIds(ids: string[]): Promise<Set<string>> {
    if (this.directory) return this.directory.checkUserAvatarIds(ids)
    this.assertConnected()
    if (!this.peerCapabilities.includes('persona-avatar-check-v1')) {
      throw new Error('酒馆页面扩展不支持头像核对，请更新扩展后重试')
    }
    const requestId = crypto.randomUUID()
    const pending = new Promise<Set<string>>((resolve, reject) => {
      this.pendingAvatarChecks.set(requestId, { resolve, reject })
    })
    void this.send('persona-avatar-check-request', { requestId, avatarIds: ids }).catch((error) =>
      this.pendingAvatarChecks.get(requestId)?.reject(error),
    )
    return this.withTimeout(pending, requestId, this.pendingAvatarChecks, '核对酒馆头像超时')
  }

  async pullResources(items: TavernResourceItem[]): Promise<File[]> {
    if (this.directory) return this.directory.pullResources(items)
    this.assertConnected()
    const requestId = crypto.randomUUID()
    const pending = new Promise<File[]>((resolve, reject) => {
      this.pendingPulls.set(requestId, { files: [], resolve, reject })
    })
    void this.send('pull-request', {
      requestId,
      items: items.map(({ id }) => ({ id })),
      localDirect: this.isLocalTavernDirectAvailable(),
    }).catch((error) => this.pendingPulls.get(requestId)?.reject(error))
    return this.withTimeout(pending, requestId, this.pendingPulls, '从酒馆接收资源超时', 120_000)
  }

  async sendFiles(
    files: Array<{
      file: File
      kind: TavernResourceKind
      displayName: string
      targetName?: string
      operationId?: string
    }>,
    conflictPolicy: TavernConflictPolicy,
    onProgress?: (completed: number, total: number, detail?: string) => void,
  ): Promise<TavernBridgeImportResult[]> {
    if (this.directory) return this.directory.sendFiles(files, conflictPolicy, onProgress)
    this.assertConnected()
    const requestId = crypto.randomUUID()
    const results: TavernBridgeImportResult[] = []
    const localDirect = this.isLocalTavernDirectAvailable()
    for (let fileIndex = 0; fileIndex < files.length; fileIndex += 1) {
      const item = files[fileIndex]!
      if (item.file.size > TAVERN_BRIDGE_MAX_FILE_SIZE) {
        throw new Error(`${item.file.name} 超过单文件 256 MB 限制`)
      }
      const transferId = crypto.randomUUID()
      const result = new Promise<TavernBridgeImportResult>((resolve, reject) => {
        this.pendingSends.set(transferId, { resolve, reject })
      })
      void result.catch(() => undefined)
      try {
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
              `本机直传不可用，已回退设备码传输：${item.displayName}`,
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
          operationId: item.operationId,
          size: payload.size,
          sha256,
          ...(localDirectSession ? { localDirectSession } : {}),
          ...(useGzip ? { contentEncoding: 'gzip', rawSize: item.file.size } : {}),
        })
        onProgress?.(fileIndex, files.length, `正在上传 ${item.displayName}`)
        if (localDirectSession) {
          onProgress?.(fileIndex, files.length, `正在本机直传 ${item.displayName}`)
        } else {
          await this.chunkSender.send(payload, requestId, transferId, (uploadedBytes) => {
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
      } finally {
        this.pendingSends.delete(transferId)
      }
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
    } else if (message.type === 'persona-avatar-check-response') {
      const pending = this.pendingAvatarChecks.get(requestId)
      this.pendingAvatarChecks.delete(requestId)
      const existingIds = Array.isArray(message.existingIds)
        ? message.existingIds.filter((id): id is string => typeof id === 'string')
        : []
      pending?.resolve(new Set(existingIds))
    } else if (message.type === 'file-start' && message.direction === 'to-srl') {
      if (
        typeof message.size !== 'number' ||
        !Number.isSafeInteger(message.size) ||
        message.size < 0 ||
        message.size > TAVERN_BRIDGE_MAX_FILE_SIZE
      ) {
        throw new Error('酒馆发送的文件超过 256 MB 限制')
      }
      if (this.incoming.size >= 4 && !this.incoming.has(transferId))
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
      await this.send('file-chunk-ack', { transferId, index: message.index })
    } else if (message.type === 'file-chunk-ack') {
      this.chunkSender.acknowledge(transferId, message.index)
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
      pending?.resolve({ name: result?.name ?? '资源', status: result?.status ?? 'completed' })
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
      } else if (requestId && this.pendingAvatarChecks.has(requestId)) {
        this.pendingAvatarChecks.get(requestId)?.reject(error)
        this.pendingAvatarChecks.delete(requestId)
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
    this.directory = undefined
    if (this.helloTimer) window.clearInterval(this.helloTimer)
    this.port?.close()
    this.port = undefined
    this.relayWindow?.close()
    this.relayWindow = undefined
    this.relayOrigin = ''
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

  private failConnection(reason: unknown, fallback: string): void {
    if (this.state.status === 'idle') return
    const error = reason instanceof Error ? reason : new Error(fallback)
    this.port?.close()
    this.port = undefined
    this.rejectPending(error)
    this.setState('error', error.message)
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pendingLists.values()) pending.reject(error)
    for (const pending of this.pendingPulls.values()) pending.reject(error)
    for (const pending of this.pendingSends.values()) pending.reject(error)
    for (const pending of this.pendingAvatarChecks.values()) pending.reject(error)
    for (const pending of this.pendingLocalDirectSessions.values()) pending.reject(error)
    this.pendingLists.clear()
    this.pendingPulls.clear()
    this.pendingSends.clear()
    this.pendingAvatarChecks.clear()
    this.pendingLocalDirectSessions.clear()
    this.incoming.clear()
    this.chunkSender.cancel(error)
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
    void this.send('local-direct-session-request', { requestId }).catch((error) =>
      this.pendingLocalDirectSessions.get(requestId)?.reject(error),
    )
    return this.withTimeout(
      pending,
      requestId,
      this.pendingLocalDirectSessions,
      '创建本机直传会话超时',
      15_000,
    )
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
