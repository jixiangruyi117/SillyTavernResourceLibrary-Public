import { EXTERNAL_APP_SDK_VERSION, type ExternalAppPermission } from '../types/ExternalApp'
import type { ExternalAppCheck } from './ExternalAppAcceptance'

/** Shared installation-free trial bridge; never delegates to the persistent SDK. */
interface TrialOptions {
  permissions: () => readonly ExternalAppPermission[]
  active: () => boolean
  running: () => void
  diagnostic: (level: string, message: string) => void
  notify: (message: string) => void
  loading: (label: string) => void
}
export class ExternalAppTrialSession {
  private readonly options: TrialOptions
  private port?: MessagePort
  private nonce = ''
  private sequence = 0
  private readonly storage = new Map<string, unknown>()
  private checkSequence = 0
  private pendingCheck?: { id: string; finish: (passed?: boolean, error?: Error) => void }
  constructor(options: TrialOptions) {
    this.options = options
  }

  connect(target: Window, preserveTestStorage = false): void {
    this.closeConnection(!preserveTestStorage)
    const channel = new MessageChannel()
    const nonce = crypto.randomUUID()
    this.nonce = nonce
    this.port = channel.port1
    const port = this.port
    this.options.running()
    port.onmessage = (event) => {
      const request = event.data
      if (this.nonce !== nonce || !this.options.active()) return
      if (
        request?.type === 'srl:trial-result' &&
        request.nonce === nonce &&
        request.id === this.pendingCheck?.id
      ) {
        this.pendingCheck?.finish(request.passed === true)
        return
      }
      if (request?.type === 'srl:diagnostic') {
        this.options.diagnostic(
          String(request.level ?? 'error'),
          String(request.message ?? 'APP 运行异常').slice(0, 500),
        )
        return
      }
      if (!request || request.type !== 'srl:request' || typeof request.id !== 'string') return
      if (
        request.nonce !== nonce ||
        !Number.isSafeInteger(request.sequence) ||
        request.sequence <= this.sequence
      )
        return
      this.sequence = request.sequence
      let allow = true
      let value: unknown
      const payload = request.payload ?? {}
      const storageAllowed = this.options.permissions().includes('app.storage')
      if (String(request.method).startsWith('storage.') && !storageAllowed) allow = false
      try {
        if (allow)
          switch (request.method) {
            case 'sdk.capabilities':
              value = {
                apiVersion: EXTERNAL_APP_SDK_VERSION,
                permissions: this.options
                  .permissions()
                  .filter((permission) => permission === 'app.storage'),
                permissionLevel: 'isolated',
                preview: true,
              }
              break
            case 'storage.get':
              value = this.storage.get(String(payload.key)) ?? null
              break
            case 'storage.set': {
              const encoded = JSON.stringify(payload.value)
              if (
                typeof encoded !== 'string' ||
                encoded.length > 100 * 1024 ||
                (this.storage.size >= 10 && !this.storage.has(String(payload.key)))
              ) {
                allow = false
                break
              }
              this.storage.set(String(payload.key), payload.value)
              break
            }
            case 'storage.remove':
              this.storage.delete(String(payload.key))
              break
            case 'ui.notify':
              this.options.notify(String(payload.message ?? '').slice(0, 500))
              break
            case 'ui.loading':
              this.options.loading(String(payload.label ?? '').slice(0, 120))
              break
            case 'ui.title':
            case 'ui.exitFullscreen':
              break
            default:
              allow = false
          }
      } catch {
        allow = false
      }
      port.postMessage({
        type: 'srl:response',
        nonce,
        id: request.id,
        ok: allow,
        ...(allow
          ? { value }
          : { error: '试运行不访问资源库、文件或设备，也不保存数据；安装后可申请对应能力。' }),
      })
    }
    port.start()
    target.postMessage({ type: 'srl:connect', protocolVersion: 2, nonce, trial: true }, '*', [
      channel.port2,
    ])
  }
  check(
    step: Exclude<ExternalAppCheck, { action: 'reload' }>,
    signal: AbortSignal,
  ): Promise<boolean> {
    if (!this.port || !this.options.active() || signal.aborted)
      return Promise.reject(new Error('验收预览未连接或已停止'))
    if (this.pendingCheck) return Promise.reject(new Error('上一项验收仍在运行'))
    return new Promise((resolve, reject) => {
      const id = crypto.randomUUID()
      const finish = (passed?: boolean, error?: Error) => {
        clearTimeout(timer)
        signal.removeEventListener('abort', abort)
        if (this.pendingCheck?.id === id) this.pendingCheck = undefined
        if (error) reject(error)
        else resolve(passed === true)
      }
      const abort = () => finish(undefined, new DOMException('已停止', 'AbortError'))
      // Match the existing SDK request budget. No retries or host execution fallback.
      const timer = setTimeout(
        () => finish(undefined, new Error('验收接口未在 15 秒内响应')),
        15_000,
      )
      this.pendingCheck = { id, finish }
      signal.addEventListener('abort', abort, { once: true })
      this.port!.postMessage({
        type: 'srl:trial-step',
        nonce: this.nonce,
        id,
        sequence: ++this.checkSequence,
        step,
      })
    })
  }
  disconnect(): void {
    this.closeConnection(true)
  }
  private closeConnection(clearStorage: boolean): void {
    this.pendingCheck?.finish(undefined, new Error('验收预览已关闭'))
    this.nonce = ''
    this.port?.close()
    this.port = undefined
    this.sequence = 0
    if (clearStorage) this.storage.clear()
  }
}
