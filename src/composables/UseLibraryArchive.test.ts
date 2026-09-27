// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { useLibraryArchive } from './UseLibraryArchive'

const state = vi.hoisted(() => ({
  mounted: [] as (() => void)[],
  notices: [] as { actions: { label: string; run: () => Promise<void> }[] }[],
  task: {} as Record<string, unknown>,
  prepared: { resources: [], versions: [], categories: [], preview: {}, forReplacement: vi.fn() },
  prepare: vi.fn(),
  resume: vi.fn(),
  load: vi.fn(async () => {}),
  confirm: vi.fn(async () => false),
}))
vi.mock('vue', async (original) => ({
  ...(await original<typeof import('vue')>()),
  onMounted: (callback: () => void) => state.mounted.push(callback),
  onScopeDispose: () => {},
}))
vi.mock('../core/NoticeCenter', () => ({
  noticeCenter: {
    push: (notice: (typeof state.notices)[number]) => state.notices.push(notice),
    dismiss: vi.fn(),
  },
}))
vi.mock('./UseConfirmDialog', () => ({ confirmAction: state.confirm, chooseAction: vi.fn() }))
vi.mock('../services/NativeImportKeepAlive', () => ({
  isNativeImportKeepAliveAvailable: () => false,
}))
vi.mock('../core/AppContainer', () => ({
  initializeVaultOnce: async () => {},
  vaultService: { getStatus: () => ({ locked: false }), isEnabled: () => false },
  archiveRecoveryService: {
    store: {
      list: async () => [{ id: 'saved', kind: 'restore' }],
      read: async () => state.task,
      save: vi.fn(),
    },
    readSource: async () => new File(['zip'], 'backup.zip'),
    ensureSource: vi.fn(),
    savePrepared: vi.fn(),
    baseline: async () => 'unchanged',
  },
  restoreService: {
    prepare: state.prepare,
    resumePrepared: state.resume,
    isRestoreCommitted: async () => false,
  },
}))

beforeEach(() => {
  vi.clearAllMocks()
  state.mounted.length = 0
  state.notices.length = 0
  state.task = {
    id: 'saved',
    kind: 'restore',
    phase: '等待选择恢复方式',
    payload: {
      vaultEnabled: false,
      prepared: state.prepared,
      completed: [],
      baseline: 'unchanged',
    },
  }
  state.prepare.mockResolvedValue(state.prepared)
  state.resume.mockResolvedValue(state.prepared)
})

async function fixture() {
  const context = {
    isRestoring: ref(false),
    isRestorePanelOpen: ref(false),
    restoreReport: ref(),
    preparedRestore: ref(),
    restoreSourceFile: ref(),
    resources: ref([]),
    categories: ref([]),
    storageHealth: ref({ quota: 0, usage: 0 }),
    LARGE_ARCHIVE_BYTES: 1000,
    loadLibrary: state.load,
    showNotice: vi.fn(),
  }
  useLibraryArchive(() => context as unknown as ReturnType<Parameters<typeof useLibraryArchive>[0]>)
  state.mounted[0]!()
  await vi.waitFor(() => expect(state.notices).toHaveLength(1))
  await state.notices[0]!.actions[0]!.run()
  return context
}

it('rebuilds an unconfirmed restored preview so replace is not based on a serialized merge plan', async () => {
  const context = await fixture()
  expect(state.load).toHaveBeenCalledOnce()
  expect(state.prepare).toHaveBeenCalledOnce()
  expect(state.resume).not.toHaveBeenCalled()
  expect(context.preparedRestore.value.forReplacement).toBe(state.prepared.forReplacement)
  expect(context.isRestoring.value).toBe(false)
  expect(context.showNotice).not.toHaveBeenCalled()
})

it('keeps the confirmed plan and asks to continue without running preflight again', async () => {
  ;(state.task.payload as Record<string, unknown>).mode = 'replace'
  const context = await fixture()
  expect(state.resume).toHaveBeenCalledWith(state.prepared)
  expect(state.prepare).not.toHaveBeenCalled()
  expect(state.confirm).toHaveBeenCalledWith(
    expect.objectContaining({ title: '继续恢复备份', danger: true }),
  )
  expect(context.preparedRestore.value).toEqual(state.prepared)
  expect(context.showNotice).not.toHaveBeenCalled()
})
