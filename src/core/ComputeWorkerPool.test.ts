import { describe, expect, it } from 'vitest'
import { ComputeWorkerPool } from './ComputeWorkerPool'

describe('ComputeWorkerPool', () => {
  it('bounds active work and drains tasks in order', async () => {
    const pool = new ComputeWorkerPool(1)
    const releases: Array<() => void> = []
    const first = pool.run('hash', () => new Promise<void>((resolve) => releases.push(resolve)))
    const second = pool.run('json-parse', async () => 'done')
    expect(pool.snapshot()).toMatchObject({ active: 1, queued: 1, kinds: ['json-parse'] })
    releases[0]?.()
    await expect(first).resolves.toBeUndefined()
    await expect(second).resolves.toBe('done')
    expect(pool.snapshot()).toMatchObject({ active: 0, queued: 0 })
  })

  it('does not start an already cancelled task', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(
      new ComputeWorkerPool().run('diff', async () => 1, controller.signal),
    ).rejects.toMatchObject({ name: 'AbortError' })
  })
})
