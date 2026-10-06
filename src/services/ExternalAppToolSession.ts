import type { ExternalAppToolDescriptor } from '../types/ExternalApp'
import { readExternalAppToolResult, validateExternalAppToolArguments } from './ExternalAppTools'

/** One invocation in the existing iframe's MessagePort. Never evaluates author code in the host. */
export class ExternalAppToolSession {
  private port?: Pick<MessagePort, 'postMessage'>
  private nonce = ''
  private registered = new Set<string>()
  private sequence = 0
  private pending?: {
    id: string
    tool: ExternalAppToolDescriptor
    args: Record<string, unknown>
    sent: boolean
    resolve: (value: unknown) => void
    reject: (reason: Error) => void
  }
  get activeTool(): ExternalAppToolDescriptor | undefined {
    return this.pending?.tool
  }
  connect(port: Pick<MessagePort, 'postMessage'>, nonce: string): void {
    if (this.port) this.close()
    this.port = port
    this.nonce = nonce
    this.registered.clear()
  }
  handle(data: Record<string, unknown>): boolean {
    if (!['srl:tools-ready', 'srl:tool-result'].includes(String(data?.type))) return false
    if (data.nonce !== this.nonce) return true
    if (data.type === 'srl:tools-ready') {
      if (
        Array.isArray(data.names) &&
        data.names.length <= 12 &&
        data.names.every((name) => typeof name === 'string' && /^[a-z][a-z0-9_]{0,47}$/u.test(name))
      ) {
        this.registered = new Set(data.names as string[])
        this.dispatch()
      }
    } else if (this.pending?.sent && data.id === this.pending.id) {
      const pending = this.pending
      if (data.ok !== true)
        pending.reject(new Error('自定义工具执行失败；已执行的操作保留，请在 APP 中检查'))
      else {
        try {
          pending.resolve(readExternalAppToolResult(data.result))
        } catch (error) {
          pending.reject(error instanceof Error ? error : new Error('工具结果无效'))
        }
      }
    }
    return true
  }
  private dispatch(): void {
    const pending = this.pending
    if (!this.port || !pending || pending.sent || !this.registered.has(pending.tool.name)) return
    pending.sent = true
    this.port.postMessage({
      type: 'srl:tool-call',
      nonce: this.nonce,
      sequence: ++this.sequence,
      id: pending.id,
      name: pending.tool.name,
      args: pending.args,
    })
  }
  async invoke(
    tool: ExternalAppToolDescriptor,
    encoded: string,
    signal: AbortSignal,
  ): Promise<unknown> {
    if (signal.aborted) throw new DOMException('已停止', 'AbortError')
    if (this.pending) throw new Error('已有自定义工具正在运行')
    const args = validateExternalAppToolArguments(tool, encoded)
    // A finite author callback/registration budget avoids an indefinitely stuck AI round.
    // Cancellation closes the caller's visible APP workspace, also rejecting SDK permission/file waits.
    return new Promise((resolve, reject) => {
      const finish = (error: Error | undefined, value?: unknown) => {
        if (!this.pending) return
        if (error && this.pending.sent)
          this.port?.postMessage({
            type: 'srl:tool-cancel',
            nonce: this.nonce,
            id: this.pending.id,
          })
        this.pending = undefined
        clearTimeout(timer)
        signal.removeEventListener('abort', abort)
        if (error) reject(error)
        else resolve(value)
      }
      const abort = () => finish(new DOMException('已停止；已执行的操作保留', 'AbortError'))
      const timer = setTimeout(
        () => finish(new Error('自定义工具未在60秒内完成注册或执行；已执行的操作保留')),
        60_000,
      )
      this.pending = {
        id: crypto.randomUUID(),
        tool,
        args,
        sent: false,
        resolve: (value) => finish(undefined, value),
        reject: (reason) => finish(reason),
      }
      signal.addEventListener('abort', abort, { once: true })
      this.dispatch()
    })
  }
  close(): void {
    this.pending?.reject(new Error('APP 工作区已关闭或重载；已执行的操作保留'))
    this.port = undefined
    this.nonce = ''
    this.registered.clear()
  }
}
