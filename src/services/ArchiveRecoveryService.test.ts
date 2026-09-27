import { expect, it, vi } from 'vitest'
import { ArchiveRecoveryService, type RestoreRecoveryTask } from './ArchiveRecoveryService'
import type { ArchiveTaskRecord } from '../storage/NativeArchiveTaskStore'
import type { PreparedRestore } from '../types/Backup'
import { hashBlob } from './HashService'

it('persists independent steps and resumes a new service without repeating completed writes', async () => {
  const records = new Map<string, ArchiveTaskRecord>()
  const store = {
    retainSource: async () => 'file:///staged',
    recoverSource: async () => 'file:///staged',
    list: async () => [...records.values()],
    read: async (id: string) => (records.has(id) ? structuredClone(records.get(id)!) : undefined),
    save: vi.fn(async (task: ArchiveTaskRecord) => {
      records.set(task.id, structuredClone(task))
    }),
    remove: async (id: string) => {
      records.delete(id)
    },
  }
  const task: RestoreRecoveryTask = {
    id: crypto.randomUUID(),
    version: 1,
    kind: 'restore',
    name: 'backup',
    phase: 'start',
    updatedAt: 1,
    payload: { vaultEnabled: false, completed: [] },
  }
  const first = new ArchiveRecoveryService(store)
  const write = vi.fn(async () => {})
  await first.step(task, '设置：外观', write)
  await expect(
    first.step(task, '设置：阅读数据', async () => {
      throw new Error('interrupted')
    }),
  ).rejects.toThrow('interrupted')
  const resumed = new ArchiveRecoveryService(store)
  const saved = (await store.read(task.id)) as RestoreRecoveryTask
  await resumed.step(saved, '设置：外观', write)
  await resumed.step(saved, '设置：阅读数据', write)
  expect(write).toHaveBeenCalledTimes(2)
  expect(((await store.read(task.id)) as RestoreRecoveryTask).payload.completed).toEqual([
    '设置：外观',
    '设置：阅读数据',
  ])
  store.save.mockRejectedValueOnce(new Error('journal disk full'))
  await expect(resumed.step(saved, '设置：凭据', write)).rejects.toThrow('journal disk full')
  expect(write).toHaveBeenCalledTimes(2)
})

it('serializes the mapped plan and source paths while leaving file bodies with staging', async () => {
  const save = vi.fn(async (_task: ArchiveTaskRecord) => {})
  const service = new ArchiveRecoveryService({
    retainSource: async () => 'file:///staged',
    recoverSource: async () => 'file:///staged',
    save,
    list: async () => [],
    read: async () => undefined,
    remove: async () => {},
  })
  const task: RestoreRecoveryTask = {
    id: 'task',
    version: 1,
    kind: 'restore',
    name: 'backup',
    phase: 'choice',
    updatedAt: 1,
    payload: { vaultEnabled: false, completed: [] },
  }
  const prepared = {
    staging: { jobId: 'native-zip-hash', paths: [['hash', 'files/a']] },
    resources: [
      {
        id: 'remapped-id',
        originalBlob: new Blob(['private file']),
        thumbnailBlob: new Blob(['thumb']),
      },
    ],
    versions: [],
    categories: [],
    preview: {},
    dispose: async () => {},
  } as unknown as PreparedRestore
  await service.savePrepared(task, prepared)
  expect(task.payload.prepared?.resources[0]?.id).toBe('remapped-id')
  expect(task.payload.prepared?.resources[0]).not.toHaveProperty('originalBlob')
  expect(task.payload.prepared?.dispose).toBeUndefined()
  expect(task.payload.prepared?.staging?.paths).toEqual([['hash', 'files/a']])
  prepared.resources[0]!.id = 'changed-after-save'
  expect(task.payload.prepared?.resources[0]?.id).toBe('remapped-id')
})

it('reselects the identical backup when its previous native URI has disappeared', async () => {
  const file = new File(['backup contents'], 'backup.zip')
  const retainSource = vi.fn(async () => 'file:///new-source')
  const service = new ArchiveRecoveryService({
    retainSource,
    recoverSource: async () => 'file:///new-source',
    save: async () => {},
    list: async () => [],
    read: async () => undefined,
    remove: async () => {},
  })
  const task: RestoreRecoveryTask = {
    id: crypto.randomUUID(),
    version: 1,
    kind: 'restore',
    name: file.name,
    phase: '预检',
    updatedAt: 1,
    payload: {
      vaultEnabled: false,
      completed: [],
      source: { uri: 'file:///gone', name: file.name, size: file.size, hash: await hashBlob(file) },
    },
  }
  await expect(service.reselectSource(task, new File(['other'], file.name))).rejects.toThrow(
    '不一致',
  )
  expect(retainSource).not.toHaveBeenCalled()
  await service.reselectSource(task, file)
  expect(task.payload.source?.uri).toBe('file:///new-source')
  expect(retainSource).toHaveBeenCalledOnce()
})
