/** @vitest-environment jsdom */
import { computed, defineComponent, ref } from 'vue'
import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { useLibraryLifecycle } from './UseLibraryLifecycle'
import type { SharedFileBatch } from '../utils/ShareTargetIntake'

const intake = vi.hoisted(() => ({ take: vi.fn(), retry: vi.fn(), complete: vi.fn() }))
vi.mock('../utils/ShareTargetIntake', () => ({
  takeSharedFileBatches: intake.take,
  clearShareTargetQuery: vi.fn(),
  allowDiscordAttachmentRetry: intake.retry,
  forgetCompletedDiscordAttachment: intake.complete,
}))
vi.mock('../core/LibraryContainer', () => ({
  initializeVaultOnce: () => new Promise(() => undefined),
  greetingResourceService: { onSaved: () => () => undefined },
  resourceService: {},
  browserStorageService: {},
  cloudBackupService: {},
  syncNativeResourceFiles: vi.fn(),
}))
vi.mock('../core/AppContainer', () => ({
  cloudBackupService: {
    pendingNativeRestores: vi.fn(async () => []),
    reconcileNativeJob: vi.fn(async () => undefined),
    runDueBackup: vi.fn(async () => undefined),
  },
}))
vi.mock('../core/SafeStartup', () => ({ markStartupReady: vi.fn() }))

function mountLifecycle(onRender?: (cssSyncCount: number) => void) {
  const receive = vi.fn(),
    notice = vi.fn()
  const syncCustomUiCss = vi.fn()
  const context: Parameters<typeof useLibraryLifecycle>[0] = {
    showNotice: notice,
    receiveSharedFileBatch: receive,
    loadResources: vi.fn(),
    refreshStorageHealth: vi.fn(),
    vaultStatus: ref({ locked: false } as Parameters<
      typeof useLibraryLifecycle
    >[0]['vaultStatus']['value']),
    searchQuery: ref(''),
    searchHistory: ref([]),
    isVaultPanelOpen: ref(false),
    loadLibrary: vi.fn(),
    loadRecycleBin: vi.fn(),
    handleNativeDeepLink: vi.fn(),
    isOverlayOpen: computed(() => false),
    searchScope: ref('name'),
    activeFilter: ref('all'),
    activeCategoryId: ref(undefined),
    activeTag: ref(''),
    sortValue: ref('newest'),
    pageSize: ref(30),
    currentPage: ref(1),
    refreshSearchContentIndex: vi.fn(),
    resources: ref([]),
    selectedSplitResourceId: ref(undefined),
    isFeatureHubOpen: ref(false),
    saveWorkspaceSnapshot: vi.fn(),
    totalPages: computed(() => 1),
    applyTheme: vi.fn(),
    theme: ref('light'),
    applyUiFontScale: vi.fn(),
    uiFontScale: ref('standard'),
    handleGlobalKeydown: vi.fn(),
    handleBackRequest: vi.fn(),
    handleBrowserPopState: vi.fn(),
    updateSplitViewport: vi.fn(),
    handleNativeShortcut: vi.fn(),
    handleMobileFocus: vi.fn(),
    syncCustomUiCss,
  }
  let lifecycle!: ReturnType<typeof useLibraryLifecycle>
  const wrapper = mount(
    defineComponent({
      setup() {
        lifecycle = useLibraryLifecycle(context)
        return () => {
          onRender?.(syncCustomUiCss.mock.calls.length)
          return null
        }
      },
    }),
  )
  return { wrapper, lifecycle, receive, notice, context }
}
function empty(): SharedFileBatch {
  return { files: [], acknowledge: async () => undefined }
}
function attachment(index: number): SharedFileBatch {
  return {
    ...empty(),
    discordAttachment: {
      name: `${index}.json`,
      type: 'application/json',
      cleanupToken: `discord-url-${index}`,
      discordUrl: `https://cdn.discordapp.com/attachments/1/${index}/card.json`,
    },
  }
}

describe('系统分享待处理队列', () => {
  it('首次渲染前应用已保存的全局 CSS', () => {
    intake.take.mockReset()
    intake.retry.mockReset()
    intake.complete.mockReset()
    const { wrapper } = mountLifecycle((cssSyncCount) => {
      expect(cssSyncCount).toBe(1)
    })
    wrapper.unmount()
    intake.take.mockReset()
    intake.retry.mockReset()
    intake.complete.mockReset()
  })

  it('rejected stale receipts cannot reset share deduplication or trigger another intake', () => {
    const { wrapper, context } = mountLifecycle()
    context.handleNativeDownloadState = () => false
    intake.retry.mockClear()
    intake.complete.mockClear()
    try {
      window.dispatchEvent(
        new CustomEvent('srl:native-share-download-failed', {
          detail: { token: 'old', workId: 'old-work' },
        }),
      )
      window.dispatchEvent(
        new CustomEvent('srl:native-share-download-completed', {
          detail: { token: 'old', workId: 'old-work' },
        }),
      )
      expect(intake.retry).not.toHaveBeenCalled()
      expect(intake.complete).not.toHaveBeenCalled()
      expect(intake.take).not.toHaveBeenCalled()
    } finally {
      wrapper.unmount()
    }
  })
  it('无关文件读取失败不会丢弃已交付的 DC 下载确认', async () => {
    const link = attachment(300)
    intake.take.mockResolvedValueOnce([link]).mockRejectedValueOnce(new Error('文件读取失败'))
    const { wrapper, lifecycle, receive, notice } = mountLifecycle()
    try {
      await lifecycle.consumeSharedFiles()
      expect(receive).toHaveBeenCalledExactlyOnceWith(link)
      expect(notice).toHaveBeenCalledWith('文件读取失败')
    } finally {
      wrapper.unmount()
      intake.take.mockReset()
    }
  })
  it('单次到达事件取完多条 DC 链接并继续交付普通文件，不等待下载完成', async () => {
    const links = Array.from({ length: 200 }, (_, index) => attachment(index))
    const file = { ...empty(), files: [new File(['{}'], 'pending.json')] }
    intake.take.mockResolvedValueOnce(links).mockResolvedValueOnce([file])
    const { wrapper, lifecycle, receive } = mountLifecycle()
    try {
      await lifecycle.consumeSharedFiles()
      expect(receive.mock.calls.map(([batch]) => batch)).toEqual([...links, file])
      expect(intake.take).toHaveBeenCalledTimes(2)
    } finally {
      wrapper.unmount()
      intake.take.mockReset()
    }
  })

  it('读取期间新的 ready 事件会继续扫描，而不会被忙碌标记丢弃', async () => {
    let finish!: (batches: SharedFileBatch[]) => void
    intake.take.mockReturnValueOnce(
      new Promise<SharedFileBatch[]>((resolve) => {
        finish = resolve
      }),
    )
    const next = attachment(1)
    intake.take.mockResolvedValueOnce([next]).mockResolvedValueOnce([])
    const { wrapper, lifecycle, receive } = mountLifecycle()
    try {
      const scan = lifecycle.consumeSharedFiles()
      await lifecycle.consumeSharedFiles()
      finish([])
      await scan
      expect(receive).toHaveBeenCalledExactlyOnceWith(next)
      expect(intake.take).toHaveBeenCalledTimes(3)
    } finally {
      wrapper.unmount()
      intake.take.mockReset()
    }
  })
})
