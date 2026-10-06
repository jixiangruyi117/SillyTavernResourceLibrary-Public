export interface MutationContext {
  operationId: string
}

export class MutationGuard {
  private readonly inflight = new Map<string, Promise<unknown>>()

  run<T>(actionKey: string, mutation: (context: MutationContext) => Promise<T>): Promise<T> {
    const current = this.inflight.get(actionKey)
    if (current) return current as Promise<T>
    const operationId = crypto.randomUUID()
    const promise = mutation({ operationId }).finally(() => {
      if (this.inflight.get(actionKey) === promise) this.inflight.delete(actionKey)
    })
    this.inflight.set(actionKey, promise)
    return promise
  }

  isRunning(actionKey: string): boolean {
    return this.inflight.has(actionKey)
  }
}

export const mutationGuard = new MutationGuard()
