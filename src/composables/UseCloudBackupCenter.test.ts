/** @vitest-environment jsdom */
import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, ref } from 'vue'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useCloudBackupCenter } from './UseCloudBackupCenter'
import { noticeCenter } from '../core/NoticeCenter'
import type { ResourceSummary } from '../types/Resource'

const runtime = vi.hoisted(() => ({
  snapshot: {
    activeProvider: 'github',
    status: {},
    credentials: { github: 'valid', webdav: 'valid' },
  },
  save: vi.fn(),
  list: vi.fn(),
  pending: vi.fn(),
  resume: vi.fn(),
  confirm: vi.fn(),
  backupProgress: vi.fn(),
  restoreProgress: vi.fn(),
  reconcile: vi.fn(),
  restore: vi.fn(),
  contents: vi.fn(),
}))
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => true, getPlatform: () => 'android' },
  registerPlugin: () => ({}),
}))
vi.mock('../core/AppContainer', () => ({
  resourceService: {},
  cloudBackupService: {
    getSnapshot: () => runtime.snapshot,
    hasCredential: () => true,
    initializeCredentials: async () => undefined,
    saveConfig: runtime.save,
    listBackups: runtime.list,
    pendingNativeRestores: runtime.pending,
    resumeNativeRestore: runtime.resume,
    getActiveNativeBackupProgress: runtime.backupProgress,
    getNativeRestoreProgress: runtime.restoreProgress,
    reconcileNativeJob: runtime.reconcile,
    restoreBackup: runtime.restore,
    listBackupRestoreContents: runtime.contents,
  },
}))
vi.mock('./UseConfirmDialog', () => ({ confirmAction: runtime.confirm }))
vi.mock('../services/PersonalResourceBackup', () => ({
  clearPlainSecretExportGrant: async () => undefined,
}))

const item = {
  id: 'backup-1',
  objectKey: 'snapshot.json',
  size: 512,
  createdAt: 1,
  kind: 'webdavSnapshot' as const,
}
const record = { id: 'pending-test', restore: { item, resourceKeys: ['one'] } }
const resource = (id: string, hash = id) =>
  ({
    id,
    name: id,
    contentHash: hash,
    type: 'worldBook',
    metadata: {},
    tags: [],
  }) as unknown as ResourceSummary

beforeEach(() => {
  vi.clearAllMocks()
  runtime.save.mockResolvedValue(runtime.snapshot)
  runtime.list.mockResolvedValue([])
  runtime.pending.mockResolvedValue([])
  runtime.resume.mockResolvedValue(1)
  runtime.confirm.mockResolvedValue(false)
  runtime.backupProgress.mockResolvedValue(null)
  runtime.restoreProgress.mockResolvedValue(null)
  runtime.reconcile.mockResolvedValue(undefined)
  runtime.restore.mockResolvedValue(0)
  runtime.contents.mockResolvedValue({
    resources: [],
    portableScopeIds: ['extra.chatReader', 'extra.assistantData', 'extra.credentials'],
  })
})
afterEach(() => noticeCenter.dismiss('cloud-restore:pending-test'))

function mountCenter(resources = ref<ResourceSummary[]>([])) {
  let center!: ReturnType<typeof useCloudBackupCenter>
  const emit = vi.fn()
  const wrapper = mount(
    defineComponent({
      setup() {
        center = useCloudBackupCenter(emit, () => resources.value)
        return () => null
      },
    }),
  )
  center.github.value.owner = 'example-user'
  center.github.value.repository = 'private-backup'
  return { center, wrapper, emit, resources }
}

it('locks list preflight and prevents duplicate requests or provider changes before save finishes', async () => {
  let saved!: (value: typeof runtime.snapshot) => void
  runtime.save.mockImplementationOnce(() => new Promise((resolve) => (saved = resolve)))
  const { center, wrapper } = mountCenter()
  try {
    await flushPromises()
    const first = center.loadBackups()
    await flushPromises()
    expect(center.busyAction.value).toBe('list')
    await center.loadBackups()
    center.selectProvider('webdav')
    expect(center.activeProvider.value).toBe('github')
    saved(runtime.snapshot)
    await first
    expect(runtime.save).toHaveBeenCalledOnce()
    expect(runtime.list).toHaveBeenCalledOnce()
    expect(center.busyAction.value).toBe('')
  } finally {
    wrapper.unmount()
  }
})

it('preserves valid backups and validation warnings when a list refresh finishes', async () => {
  runtime.list.mockImplementationOnce(async (_config, _secret, _progress, warning) => {
    warning('Koofr 有 1 份备份未通过校验：清单 JSON 无效')
    return [item]
  })
  const { center, wrapper } = mountCenter()
  try {
    await flushPromises()
    await center.loadBackups()
    expect(center.backups.value).toEqual([item])
    expect(center.message.value).toContain('已读取 1 个云端备份')
    expect(center.message.value).toContain('1 份备份未通过校验')
    expect(center.busyAction.value).toBe('')
    runtime.list.mockRejectedValueOnce(new Error('Koofr 网络读取失败'))
    await center.loadBackups()
    expect(center.backups.value).toEqual([item])
    expect(center.message.value).toBe('Koofr 网络读取失败')
    expect(center.busyAction.value).toBe('')
  } finally {
    wrapper.unmount()
  }
})

it('locks a restore during confirmation and releases it after cancellation without writing', async () => {
  let decide!: (value: boolean) => void
  runtime.confirm.mockImplementationOnce(() => new Promise((resolve) => (decide = resolve)))
  const { center, wrapper } = mountCenter()
  try {
    await flushPromises()
    center.restorePicker.value = { item, resources: [resource('one')] }
    center.selectedRestoreKeys.value = new Set(['one'])
    const first = center.restore(item)
    await center.restore(item)
    expect(runtime.confirm).toHaveBeenCalledOnce()
    expect(center.busyAction.value).toBe('restore:backup-1')
    decide(false)
    await first
    expect(runtime.save).not.toHaveBeenCalled()
    expect(center.busyAction.value).toBe('')
  } finally {
    wrapper.unmount()
  }
})

it('previews only selected resources against the latest library using the shared identity rules', async () => {
  const { center, wrapper, resources } = mountCenter(ref([resource('same', 'old')]))
  try {
    center.restorePicker.value = {
      item,
      resources: [resource('duplicate', 'old'), resource('same', 'new'), resource('unchecked')],
    }
    center.selectedRestoreKeys.value = new Set(['duplicate', 'same'])
    expect(center.restorePreview.value).toEqual({ added: 1, skipped: 1, conflicts: 1 })
    resources.value = [resource('same', 'old'), resource('imported', 'new')]
    expect(center.restorePreview.value).toEqual({ added: 0, skipped: 2, conflicts: 0 })
    expect(center.backupScopeResources.value).toHaveLength(2)
  } finally {
    wrapper.unmount()
  }
})

it('allows restoring selected settings without resources and forwards the exact scope', async () => {
  const { center, wrapper, emit } = mountCenter()
  try {
    await flushPromises()
    center.restorePicker.value = { item, resources: [] }
    center.restoreScopeModel.value = { resourceIds: [], scopeIds: ['extra.generalPreferences'] }
    runtime.confirm.mockResolvedValue(true)
    await center.restore(item)
    expect(runtime.restore).toHaveBeenCalledWith(item, expect.any(Function), [], false, [
      'extra.generalPreferences',
    ])
    expect(emit).toHaveBeenCalledWith('library-changed')
    expect(center.busyAction.value).toBe('')
  } finally {
    wrapper.unmount()
  }
})

it('opens a settings-only picker with available extras and leaves sensitive content unchecked', async () => {
  const { center, wrapper } = mountCenter()
  try {
    await flushPromises()
    await center.restore(item)
    expect(runtime.contents).toHaveBeenCalledOnce()
    expect(center.restoreScopeIds.value).toEqual([
      'extra.chatReader',
      'extra.assistantData',
      'extra.credentials',
    ])
    expect(center.restoreScopeModel.value.scopeIds).toEqual(['extra.chatReader'])
    expect(center.hasRestoreSelection.value).toBe(true)
    center.restoreScopeModel.value = { resourceIds: [], scopeIds: [] }
    await center.restore(item)
    expect(runtime.restore).not.toHaveBeenCalled()
    expect(center.hasRestoreSelection.value).toBe(false)
    expect(center.message.value).toBe('请至少选择一项资源或附加数据')
  } finally {
    wrapper.unmount()
  }
})

it('resumes the current persisted record once and dismisses its notice only after completion', async () => {
  runtime.pending.mockResolvedValue([record])
  let finish!: (value: number) => void
  runtime.resume.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)))
  const { center, wrapper, emit } = mountCenter()
  try {
    await flushPromises()
    const first = center.resumePendingRestore(record.id)
    await flushPromises()
    await center.resumePendingRestore(record.id)
    expect(runtime.resume).toHaveBeenCalledOnce()
    expect(noticeCenter.list().some((notice) => notice.id === 'cloud-restore:' + record.id)).toBe(
      true,
    )
    finish(1)
    await first
    expect(emit).toHaveBeenCalledWith('library-changed')
    expect(center.pendingRestores.value).toEqual([])
    expect(noticeCenter.list().some((notice) => notice.id === 'cloud-restore:' + record.id)).toBe(
      false,
    )
  } finally {
    wrapper.unmount()
  }
})

it('a retained notice after page close routes to the current cloud page instead of mutating stale state', async () => {
  runtime.pending.mockResolvedValue([record])
  const { wrapper } = mountCenter()
  await flushPromises()
  const action = noticeCenter.list().find((notice) => notice.id === 'cloud-restore:' + record.id)!
    .actions[0]!
  wrapper.unmount()
  const route = vi.fn()
  window.addEventListener('srl:native-deep-link', route)
  try {
    await action.run()
    expect(runtime.resume).not.toHaveBeenCalled()
    expect((route.mock.calls[0]?.[0] as CustomEvent).detail).toEqual({ kind: 'backup' })
  } finally {
    window.removeEventListener('srl:native-deep-link', route)
  }
})

it('late native progress cannot overwrite the message of a newer cloud action', async () => {
  let progress!: (value: unknown) => void
  runtime.backupProgress.mockImplementationOnce(
    () => new Promise((resolve) => (progress = resolve)),
  )
  let saved!: (value: typeof runtime.snapshot) => void
  runtime.save.mockImplementationOnce(() => new Promise((resolve) => (saved = resolve)))
  const { center, wrapper } = mountCenter()
  try {
    await flushPromises()
    const action = center.loadBackups()
    await flushPromises()
    center.message.value = '当前读取任务'
    progress({ completed: 1, total: 3, totalBytes: 0, uploadedBytes: 0, status: 'running' })
    await flushPromises()
    expect(center.message.value).toBe('当前读取任务')
    expect(center.nativeBackupActive.value).toBe(false)
    saved(runtime.snapshot)
    await action
  } finally {
    wrapper.unmount()
  }
})
