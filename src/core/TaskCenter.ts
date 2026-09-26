export type TaskStatus = 'running' | 'completed' | 'failed' | 'cancelled'

export interface TaskTransferProgress {
  transferredBytes: number
  totalBytes?: number
  bytesPerSecond?: number
  remainingSeconds?: number
  lastProgressAt: number
}

export interface TaskItemProgress {
  completed: number
  total: number
}

export interface TaskRecord {
  operationId: string
  name: string
  phase: string
  progress?: number
  itemProgress?: TaskItemProgress
  transfer?: TaskTransferProgress
  cancelable: boolean
  retryable?: boolean
  background: boolean
  status: TaskStatus
  error?: string
  startedAt: number
  updatedAt: number
}

export interface StartTaskOptions {
  operationId?: string
  name: string
  phase?: string
  cancelable?: boolean
  background?: boolean
  cancel?: () => void
  retry?: () => Promise<unknown>
}

export class TaskCenter {
  private readonly tasks = new Map<string, TaskRecord>()
  private readonly actions = new Map<string, Pick<StartTaskOptions, 'cancel' | 'retry'>>()
  private readonly listeners = new Set<() => void>()
  private readonly transferSamples = new Map<string, Array<{ at: number; bytes: number }>>()
  private readonly transferPublishedAt = new Map<string, number>()
  private readonly retrying = new Set<string>()

  start(options: StartTaskOptions): string {
    const operationId = options.operationId ?? crypto.randomUUID()
    const now = Date.now()
    this.clearTransfer(operationId)
    this.tasks.set(operationId, {
      operationId,
      name: options.name,
      phase: options.phase ?? '准备中',
      cancelable: options.cancelable === true,
      retryable: typeof options.retry === 'function',
      background: options.background === true,
      status: 'running',
      startedAt: now,
      updatedAt: now,
    })
    this.actions.set(operationId, { cancel: options.cancel, retry: options.retry })
    this.publish()
    return operationId
  }

  update(
    operationId: string,
    changes: Partial<Pick<TaskRecord, 'phase' | 'progress' | 'itemProgress' | 'cancelable'>>,
  ): void {
    const task = this.tasks.get(operationId)
    if (!task || task.status !== 'running') return
    if (changes.phase !== undefined && changes.phase !== task.phase) {
      this.clearTransfer(operationId)
      task.transfer = undefined
      task.progress = undefined
    }
    Object.assign(task, changes, { updatedAt: Date.now() })
    if (task.progress !== undefined) {
      task.progress = Number.isFinite(task.progress)
        ? Math.min(1, Math.max(0, task.progress))
        : undefined
    }
    this.publish()
  }

  /** 只接收实际已完成的字节数；传输完成不代表校验、归档或保存已完成。 */
  updateTransfer(
    operationId: string,
    progress: { transferredBytes: number; totalBytes?: number },
  ): void {
    const task = this.tasks.get(operationId)
    if (!task || task.status !== 'running' || !Number.isFinite(progress.transferredBytes)) return
    const now = Date.now()
    const bytes = Math.max(0, progress.transferredBytes)
    const total =
      progress.totalBytes !== undefined && Number.isFinite(progress.totalBytes)
        ? Math.max(bytes, progress.totalBytes, 0)
        : undefined
    let samples = this.transferSamples.get(operationId)
    if (!samples || bytes < (task.transfer?.transferredBytes ?? 0)) {
      samples = [{ at: now, bytes }]
      this.transferSamples.set(operationId, samples)
    }
    const firstUpdate = task.transfer === undefined
    const advanced = firstUpdate || bytes > task.transfer!.transferredBytes
    const lastProgressAt = advanced ? now : task.transfer!.lastProgressAt
    const lastSample = samples[samples.length - 1]!
    if (now - lastSample.at >= 250) samples.push({ at: now, bytes })
    while (samples.length > 1 && samples[1]!.at < now - 5_000) samples.shift()
    const first = samples[0]!
    const elapsed = now - first.at
    const speed =
      elapsed >= 500 ? Math.max(0, ((bytes - first.bytes) * 1_000) / elapsed) : undefined
    task.transfer = {
      transferredBytes: bytes,
      totalBytes: total,
      bytesPerSecond: speed,
      remainingSeconds:
        total !== undefined && speed ? Math.max(0, (total - bytes) / speed) : undefined,
      lastProgressAt,
    }
    task.progress = total && total > 0 ? Math.min(1, bytes / total) : undefined
    task.updatedAt = now
    // 字节回调可以很密集，但不按每个输入块刷新整个 Vue 任务列表。
    if (
      firstUpdate ||
      now - (this.transferPublishedAt.get(operationId) ?? 0) >= 250 ||
      (advanced && total !== undefined && bytes >= total)
    ) {
      this.transferPublishedAt.set(operationId, now)
      this.publish()
    }
  }

  complete(operationId: string): void {
    this.settle(operationId, 'completed')
  }

  fail(operationId: string, error: unknown): void {
    this.settle(
      operationId,
      'failed',
      error instanceof Error ? error.message : String(error || '任务失败'),
    )
  }

  cancelled(operationId: string): void {
    this.settle(operationId, 'cancelled')
  }

  cancel(operationId: string): boolean {
    const task = this.tasks.get(operationId)
    if (!task || task.status !== 'running' || !task.cancelable) return false
    this.actions.get(operationId)?.cancel?.()
    this.cancelled(operationId)
    return true
  }

  async retry(operationId: string): Promise<boolean> {
    const task = this.tasks.get(operationId)
    const retry = this.actions.get(operationId)?.retry
    if (!task || task.status !== 'failed' || !retry || this.retrying.has(operationId)) return false
    this.retrying.add(operationId)
    task.retryable = false
    this.publish()
    try {
      await retry()
      return true
    } catch (error) {
      if (this.tasks.get(operationId) === task && task.status === 'failed') {
        task.error = error instanceof Error ? error.message : String(error || '重试失败')
      }
      return false
    } finally {
      this.retrying.delete(operationId)
      if (this.tasks.get(operationId) === task) task.retryable = true
      this.publish()
    }
  }

  list(): TaskRecord[] {
    return [...this.tasks.values()].sort((left, right) => right.updatedAt - left.updatedAt)
  }

  active(): TaskRecord[] {
    return this.list().filter((task) => task.status === 'running')
  }

  dismiss(operationId: string): void {
    if (this.tasks.get(operationId)?.status === 'running') return
    this.tasks.delete(operationId)
    this.actions.delete(operationId)
    this.clearTransfer(operationId)
    this.publish()
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private settle(operationId: string, status: TaskStatus, error?: string): void {
    const task = this.tasks.get(operationId)
    // 取消后迟到的 resolve/reject 不能重新写成成功或失败。
    if (!task || task.status !== 'running') return
    Object.assign(task, {
      status,
      error,
      cancelable: false,
      updatedAt: Date.now(),
      progress: status === 'completed' ? 1 : task.progress,
    })
    this.clearTransfer(operationId)
    this.publish()
  }

  private clearTransfer(operationId: string): void {
    this.transferSamples.delete(operationId)
    this.transferPublishedAt.delete(operationId)
  }

  private publish(): void {
    for (const listener of this.listeners) listener()
  }
}

export const taskCenter = new TaskCenter()
