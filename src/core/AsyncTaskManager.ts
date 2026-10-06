import { taskCenter } from './TaskCenter'

export interface AsyncTaskContext {
  requestId: string
  signal: AbortSignal
  progress: (phase: string, progress?: number) => void
  isCurrent: () => boolean
}

export interface AsyncTaskOptions {
  key: string
  name: string
  timeoutMs?: number
  background?: boolean
}

export class AsyncTaskManager {
  private readonly active = new Map<string, { requestId: string; controller: AbortController }>()

  async run<T>(
    options: AsyncTaskOptions,
    runner: (context: AsyncTaskContext) => Promise<T>,
  ): Promise<T> {
    this.cancel(options.key)
    const requestId = crypto.randomUUID()
    const controller = new AbortController()
    this.active.set(options.key, { requestId, controller })
    const operationId = taskCenter.start({
      operationId: requestId,
      name: options.name,
      cancelable: true,
      background: options.background,
      cancel: () => controller.abort(new DOMException('任务已取消', 'AbortError')),
    })
    const timeout = options.timeoutMs
      ? window.setTimeout(
          () => controller.abort(new DOMException('任务超时', 'TimeoutError')),
          options.timeoutMs,
        )
      : undefined
    const isCurrent = () => this.active.get(options.key)?.requestId === requestId
    try {
      const result = await runner({
        requestId,
        signal: controller.signal,
        progress: (phase, progress) => taskCenter.update(operationId, { phase, progress }),
        isCurrent,
      })
      if (!isCurrent()) throw new DOMException('结果已过期', 'AbortError')
      taskCenter.complete(operationId)
      return result
    } catch (error) {
      if (controller.signal.aborted) taskCenter.cancel(operationId)
      else taskCenter.fail(operationId, error)
      throw error
    } finally {
      if (timeout !== undefined) window.clearTimeout(timeout)
      if (isCurrent()) this.active.delete(options.key)
    }
  }

  cancel(key: string): boolean {
    const active = this.active.get(key)
    if (!active) return false
    active.controller.abort(new DOMException('任务已取消', 'AbortError'))
    this.active.delete(key)
    return true
  }
}

export const asyncTaskManager = new AsyncTaskManager()
