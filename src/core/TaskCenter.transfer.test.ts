import assert from 'node:assert/strict'
import { it } from 'vitest'
import { TaskCenter } from './TaskCenter'

it('does not resurrect cancelled tasks from late success, failure, or byte progress', () => {
  const center = new TaskCenter()
  let aborted = false
  const id = center.start({ name: 'download', cancelable: true, cancel: () => (aborted = true) })
  assert.equal(center.cancel(id), true)
  center.complete(id)
  center.fail(id, new Error('late failure'))
  center.updateTransfer(id, { transferredBytes: 999, totalBytes: 999 })
  assert.equal(aborted, true)
  assert.equal(center.list()[0]?.status, 'cancelled')
  assert.equal(center.list()[0]?.transfer, undefined)
})

it('exposes retry only when provided and prevents concurrent retries', async () => {
  const center = new TaskCenter()
  const absent = center.start({ name: 'no retry' })
  center.fail(absent, 'failed')
  assert.equal(center.list().find((item) => item.operationId === absent)?.retryable, false)
  assert.equal(await center.retry(absent), false)
  let finish: () => void = () => undefined
  let calls = 0
  const id = center.start({
    name: 'retry',
    retry: () => {
      calls += 1
      return new Promise<void>((resolve) => (finish = resolve))
    },
  })
  assert.equal(await center.retry(id), false)
  center.fail(id, 'failed')
  const first = center.retry(id)
  assert.equal(await center.retry(id), false)
  finish()
  assert.equal(await first, true)
  assert.equal(calls, 1)
})

it('contains retry errors rather than leaking an unhandled UI promise', async () => {
  const center = new TaskCenter()
  const id = center.start({
    name: 'retry',
    retry: async () => {
      throw new Error('offline')
    },
  })
  center.fail(id, 'failed')
  assert.equal(await center.retry(id), false)
  assert.equal(center.list()[0]?.error, 'offline')
})

it('uses real byte progress, throttles publication and keeps transfer 100% running', () => {
  const oldNow = Date.now
  let now = 10_000
  Date.now = () => now
  try {
    const center = new TaskCenter()
    const id = center.start({ name: 'file', phase: 'write' })
    let publications = 0
    center.subscribe(() => (publications += 1))
    center.updateTransfer(id, { transferredBytes: 0, totalBytes: 1000 })
    for (let i = 1; i <= 1000; i++) {
      now += 1
      center.updateTransfer(id, { transferredBytes: i, totalBytes: 1000 })
    }
    const task = center.list()[0]!
    assert.equal(task.progress, 1)
    assert.equal(task.status, 'running')
    assert.equal(task.transfer?.bytesPerSecond, 1000)
    assert.ok(publications <= 6)
    center.update(id, { phase: 'confirm result', cancelable: false })
    assert.equal(task.transfer, undefined)
    assert.equal(task.progress, undefined)
    assert.equal(center.cancel(id), false)
    center.complete(id)
    center.fail(id, 'late failure')
    assert.equal(task.status, 'completed')
  } finally {
    Date.now = oldNow
  }
})

it('does not invent totals or progress and supports owner-acknowledged cancellation', () => {
  const center = new TaskCenter()
  const id = center.start({ name: 'unknown size' })
  center.updateTransfer(id, { transferredBytes: 512 })
  assert.equal(center.list()[0]?.progress, undefined)
  assert.equal(center.list()[0]?.transfer?.totalBytes, undefined)
  center.update(id, { progress: NaN })
  assert.equal(center.list()[0]?.progress, undefined)
  center.cancelled(id)
  assert.equal(center.active().length, 0)
})
