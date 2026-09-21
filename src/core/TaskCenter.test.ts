import { describe, expect, it, vi } from 'vitest'

import { TaskCenter } from './TaskCenter'

describe('TaskCenter', () => {
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
