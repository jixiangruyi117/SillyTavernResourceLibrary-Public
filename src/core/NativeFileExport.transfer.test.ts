/** @vitest-environment node */
import assert from 'node:assert/strict'
import { beforeEach, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  writes: [] as string[],
  commits: 0,
  aborts: 0,
  begin: async (): Promise<void> => undefined,
  append: async (): Promise<void> => undefined,
  commit: async (): Promise<void> => undefined,
}))

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => true,
    getPlatform: () => 'android',
    isPluginAvailable: () => true,
  },
  registerPlugin: () => ({
    beginWrite: async () => {
      await state.begin()
      return { token: 'test-write' }
    },
    appendWrite: async ({ data }: { data: string }) => {
      state.writes.push(data)
      await state.append()
    },
    commitWrite: async () => {
      state.commits += 1
      await state.commit()
      return { uri: 'content://test', bytes: 3 }
    },
    abortWrite: async () => {
      state.aborts += 1
    },
  }),
}))

import { saveBlobToNativeDestination } from './NativeFileExport'
import { taskCenter } from './TaskCenter'

beforeEach(() => {
  state.writes = []
  state.commits = 0
  state.aborts = 0
  state.begin = async () => undefined
  state.append = async () => undefined
  state.commit = async () => undefined
  for (const task of taskCenter.list()) taskCenter.dismiss(task.operationId)
})

it('forwards acknowledged byte progress and completes only after native commit', async () => {
  const progress: number[] = []
  state.commit = async () => {
    const task = taskCenter.active()[0]!
    assert.equal(task.phase, '确认保存结果')
    assert.equal(task.cancelable, false)
    assert.equal(task.progress, undefined)
  }
  const result = await saveBlobToNativeDestination(new Blob(['abc']), 'test.txt', 'downloads', {
    onProgress: (value) => progress.push(value.transferredBytes),
  })
  assert.equal(result.uri, 'content://test')
  assert.deepEqual(progress, [3])
  assert.equal(state.commits, 1)
  assert.equal(state.aborts, 0)
  assert.equal(taskCenter.list()[0]?.status, 'completed')
})

it('cancels during beginWrite and removes the created temporary write', async () => {
  const controller = new AbortController()
  state.begin = async () => controller.abort(new Error('cancel during begin'))
  await assert.rejects(
    saveBlobToNativeDestination(new Blob(['abc']), 'test.txt', 'downloads', {
      signal: controller.signal,
    }),
    /cancel during begin/,
  )
  assert.equal(state.writes.length, 0)
  assert.equal(state.commits, 0)
  assert.equal(state.aborts, 1)
  assert.equal(taskCenter.list()[0]?.status, 'cancelled')
})

it('cancels the final native append without committing a partial file', async () => {
  const controller = new AbortController()
  state.append = async () => controller.abort(new Error('cancel final append'))
  await assert.rejects(
    saveBlobToNativeDestination(new Blob(['abc']), 'test.txt', 'downloads', {
      signal: controller.signal,
    }),
    /cancel final append/,
  )
  assert.equal(state.writes.length, 1)
  assert.equal(state.commits, 0)
  assert.equal(state.aborts, 1)
  assert.equal(taskCenter.list()[0]?.status, 'cancelled')
})

it('does not leave a running task if native beginWrite fails', async () => {
  state.begin = async () => {
    throw new Error('no space')
  }
  await assert.rejects(
    saveBlobToNativeDestination(new Blob(['abc']), 'test.txt', 'downloads'),
    /no space/,
  )
  assert.equal(taskCenter.active().length, 0)
  assert.equal(taskCenter.list()[0]?.status, 'failed')
  assert.equal(state.aborts, 0)
})

it('exposes task-center cancellation to the actual in-flight writer', async () => {
  state.append = async () => {
    const task = taskCenter.active()[0]!
    assert.equal(taskCenter.cancel(task.operationId), true)
  }
  await assert.rejects(
    saveBlobToNativeDestination(new Blob(['abc']), 'test.txt', 'downloads'),
    /保存已取消/,
  )
  assert.equal(state.commits, 0)
  assert.equal(state.aborts, 1)
  assert.equal(taskCenter.list()[0]?.status, 'cancelled')
})
