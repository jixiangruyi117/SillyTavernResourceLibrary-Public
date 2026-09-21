export type ComputeTaskKind =
  | 'hash'
  | 'png-metadata'
  | 'json-parse'
  | 'zip-scan'
  | 'search-index'
  | 'diff'
  | 'preset-similarity'
  | 'regex-safety'
  | 'css-analysis'

interface QueuedTask<T> {
  kind: ComputeTaskKind
  signal?: AbortSignal
  execute: () => Promise<T>
  resolve: (value: T) => void
  reject: (error: unknown) => void
}

function defaultConcurrency(): number {
  const cores = typeof navigator === 'undefined' ? 2 : navigator.hardwareConcurrency || 2
  return cores <= 4 ? 1 : 2
}

/** Shared scheduler for CPU-heavy Worker clients; mobile stays at one active job, desktop at two. */
export class ComputeWorkerPool {
  private readonly concurrency: number
  private active = 0
  private readonly queue: QueuedTask<unknown>[] = []

  constructor(concurrency = defaultConcurrency()) {
    this.concurrency = Math.max(1, Math.min(2, Math.floor(concurrency)))
  }

  run<T>(kind: ComputeTaskKind, execute: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (signal?.aborted) return Promise.reject(new DOMException('任务已取消', 'AbortError'))
    return new Promise<T>((resolve, reject) => {
      this.queue.push({ kind, execute, signal, resolve, reject } as QueuedTask<unknown>)
      this.drain()
    })
  }

  snapshot(): { active: number; queued: number; kinds: ComputeTaskKind[] } {
    return {
      active: this.active,
      queued: this.queue.length,
      kinds: this.queue.map((item) => item.kind),
    }
  }

  private drain(): void {
    while (this.active < this.concurrency && this.queue.length) {
      const task = this.queue.shift()!
      if (task.signal?.aborted) {
        task.reject(new DOMException('任务已取消', 'AbortError'))
        continue
      }
      this.active += 1
      void task
        .execute()
        .then(task.resolve, task.reject)
        .finally(() => {
          this.active -= 1
          this.drain()
        })
    }
  }
}

export const computeWorkerPool = new ComputeWorkerPool()
