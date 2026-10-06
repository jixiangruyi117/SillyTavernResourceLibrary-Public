/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest'

import { PreviewBudget } from './PreviewBudget'
import { ResourceScope } from './ResourceScope'

describe('PreviewBudget', () => {
  afterEach(() => vi.useRealTimers())

  it('限制同时活跃复杂预览并在槽位释放后恢复最近可见项', () => {
    const budget = new PreviewBudget(2, 1000)
    const events: string[] = []
    const register = (id: string) =>
      budget.register(id, {
        resume: () => events.push(`${id}:resume`),
        suspend: () => events.push(`${id}:suspend`),
        release: () => events.push(`${id}:release`),
      })
    const first = register('first')
    const second = register('second')
    const third = register('third')
    first.setVisible(true)
    second.setVisible(true)
    third.setVisible(true)

    expect(budget.snapshot().filter((entry) => entry.state === 'active')).toHaveLength(2)
    expect(events).toContain('first:suspend')

    third.setVisible(false)
    expect(budget.snapshot().find((entry) => entry.id === 'first')?.state).toBe('active')
  })

  it('不可见先 suspend，隐藏过久 release，低内存优先回收隐藏项', async () => {
    vi.useFakeTimers()
    const budget = new PreviewBudget(2, 500)
    const release = vi.fn()
    const lease = budget.register('preview', { resume: vi.fn(), suspend: vi.fn(), release })
    lease.setVisible(true)
    lease.setVisible(false)
    await vi.advanceTimersByTimeAsync(500)
    expect(release).toHaveBeenCalledOnce()

    lease.setVisible(true)
    lease.setVisible(false)
    budget.handleMemoryPressure('moderate')
    expect(release).toHaveBeenCalledTimes(2)
  })
})

describe('ResourceScope', () => {
  it('按统一 dispose 清理监听、AbortController、Worker、Observer 与 ObjectURL', () => {
    const scope = new ResourceScope()
    const abort = scope.abortController()
    const terminate = vi.fn()
    const disconnect = vi.fn()
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test')
    const listener = vi.fn()
    scope.listen(window, 'online', listener)
    scope.worker({ terminate })
    scope.observer({ disconnect })
    scope.objectUrl(new Blob(['x']))

    scope.dispose()
    window.dispatchEvent(new Event('online'))

    expect(abort.signal.aborted).toBe(true)
    expect(terminate).toHaveBeenCalledOnce()
    expect(disconnect).toHaveBeenCalledOnce()
    expect(revoke).toHaveBeenCalledWith('blob:test')
    expect(listener).not.toHaveBeenCalled()
  })
})
