import { describe, expect, it, vi } from 'vitest'

import { TaskCenter } from './TaskCenter'

describe('TaskCenter', () => {
  it('opens completed work once while unrelated actions remain independent', async () => {
    const center = new TaskCenter()
    let finish!: () => void
    const open = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)))
    const first = center.start({ name: 'first', action: { label: '查看附件', run: open } })
    const otherOpen = vi.fn()
    const second = center.start({ name: 'second', action: { label: '查看附件', run: otherOpen } })
    center.complete(first)
    const pending = center.open(first)
    await expect(center.open(first)).resolves.toBe(false)
    await expect(center.open(second)).resolves.toBe(true)
    expect(open).toHaveBeenCalledOnce()
    expect(otherOpen).toHaveBeenCalledOnce()
    finish()
    await expect(pending).resolves.toBe(true)
    expect(center.list().find((task) => task.operationId === first)?.status).toBe('completed')
    center.dismiss(first)
    await expect(center.open(first)).resolves.toBe(false)
  })

  it('navigation failure leaves the original task and releases the action lock', async () => {
    const center = new TaskCenter()
    const open = vi
      .fn()
      .mockRejectedValueOnce(new Error('navigation failed'))
      .mockResolvedValueOnce(undefined)
    const id = center.start({ name: 'download', action: { label: '查看附件', run: open } })
    center.complete(id)
    await expect(center.open(id)).rejects.toThrow('navigation failed')
    expect(center.list()[0]?.status).toBe('completed')
    await expect(center.open(id)).resolves.toBe(true)
  })
  it('does not advertise retry when no retry action exists', async () => {
    const center = new TaskCenter()
    const id = center.start({ name: 'download' })
    center.fail(id, new Error('offline'))
    expect(center.list()[0]?.retryable).toBe(false)
    await expect(center.retry(id)).resolves.toBe(false)
  })

  it('advertises and invokes a provided retry action', async () => {
    const center = new TaskCenter()
    const retry = vi.fn(async () => undefined)
    const id = center.start({ name: 'download', retry })
    center.fail(id, new Error('offline'))
    expect(center.list()[0]?.retryable).toBe(true)
    await expect(center.retry(id)).resolves.toBe(true)
    expect(retry).toHaveBeenCalledOnce()
  })

  it('keeps cancellation terminal when a pending operation later rejects or completes', () => {
    const center = new TaskCenter()
    const cancel = vi.fn()
    const id = center.start({ name: 'download', cancelable: true, cancel })
    expect(center.cancel(id)).toBe(true)
    center.fail(id, new Error('late abort rejection'))
    center.complete(id)
    expect(center.list()[0]?.status).toBe('cancelled')
    expect(center.list()[0]?.error).toBeUndefined()
    expect(cancel).toHaveBeenCalledOnce()
    expect(center.active()).toHaveLength(0)
  })

  it('does not overwrite a completed task with a late failure', () => {
    const center = new TaskCenter()
    const id = center.start({ name: 'export' })
    center.complete(id)
    center.fail(id, new Error('late failure'))
    expect(center.list()[0]?.status).toBe('completed')
    expect(center.list()[0]?.progress).toBe(1)
  })
})
