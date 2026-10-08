// @vitest-environment jsdom
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const runtime = vi.hoisted(() => ({
  settings: vi.fn(),
  status: vi.fn(),
  jobs: vi.fn(),
  pair: vi.fn(),
  clear: vi.fn(),
  cancelJob: vi.fn(),
  cleanupHistory: vi.fn(),
  clearAutoBindings: vi.fn(async () => 0),
  listAutoBindings: vi.fn(async (): Promise<unknown[]> => []),
  countPendingSources: vi.fn(async () => 0),
  getAutoBindingView: vi.fn(async (): Promise<unknown> => undefined),
  confirmAutoBinding: vi.fn(async () => undefined),
  replaceAutoBinding: vi.fn(async () => undefined),
  unbindSource: vi.fn(async () => undefined),
  resourceSummaries: vi.fn(async (): Promise<unknown[]> => []),
  getAutomation: vi.fn(async (): Promise<unknown> => undefined),
  putAutomation: vi.fn(async () => undefined),
  backfillLateAutoBinding: vi.fn(
    async (
      _community?: unknown,
      _resource?: unknown,
      _settings?: unknown,
    ): Promise<
      Array<{
        sourceId: string
        resourceId: string
        rule: 'same-name' | 'same-author' | 'next-png'
      }>
    > => [],
  ),
  connection: vi.fn(() => ({ workerUrl: 'https://worker.example', libraryId: 'library-1' })),
  confirm: vi.fn(async () => true),
}))
vi.mock('../core/LibraryContainer', () => ({
  discordInboxAutomationSettingsService: {
    load: runtime.getAutomation,
    save: runtime.putAutomation,
  },
  communitySourceService: {
    listRecentAutoBindings: runtime.listAutoBindings,
    listAutoBindReviews: vi.fn(async () => []),
    countPendingSources: runtime.countPendingSources,
    clearRecentAutoBindings: runtime.clearAutoBindings,
    getForResource: runtime.getAutoBindingView,
    confirmAutoBinding: runtime.confirmAutoBinding,
    replaceAutoBinding: runtime.replaceAutoBinding,
    unbindSource: runtime.unbindSource,
  },
}))
vi.mock('../core/AppContainer', () => ({
  resourceService: {
    listResourceListSummaries: runtime.resourceSummaries,
    listRecentCharacterCards: vi.fn(async () => []),
  },
}))
vi.mock('../services/DiscordInboxAutoBinding', () => ({
  autoBindPendingPostsToRecentCards: runtime.backfillLateAutoBinding,
}))
vi.mock('../services/DiscordSourceSettingsService', () => ({
  loadDiscordSourceConnectionSettings: runtime.settings,
}))
vi.mock('../services/DiscordHandoffService', () => ({
  readDiscordInboxStatus: runtime.status,
  listDiscordInboxJobs: runtime.jobs,
  pairDiscordInbox: runtime.pair,
  cancelDiscordInboxJob: runtime.cancelJob,
  clearDiscordInboxCloudHistory: runtime.cleanupHistory,
  inboxConnection: runtime.connection,
  clearDiscordInboxPairing: runtime.clear,
}))
vi.mock('../composables/UseConfirmDialog', () => ({ confirmAction: runtime.confirm }))
import DiscordInboxPanel from './DiscordInboxPanel.vue'

const settings = {
  workerBaseUrl: 'https://worker.example',
  inboxLibraryId: 'library-1',
  inboxSecret: 'private-secret',
  inboxName: '我的资源库',
}
beforeEach(() => {
  vi.clearAllMocks()
  runtime.settings.mockReturnValue({ workerBaseUrl: 'https://worker.example' })
  runtime.status.mockResolvedValue({
    libraryId: 'library-1',
    name: '我的资源库',
    paired: true,
    expiresInDays: 7,
  })
  runtime.jobs.mockResolvedValue({ jobs: [], recent: [], hasMore: false })
  runtime.pair.mockImplementation(async () => {
    runtime.settings.mockReturnValue({
      ...settings,
      inboxPairCode: 'PAIR-CODE-1234567',
      inboxPairExpiresAt: Date.now() + 600_000,
    })
    return {
      libraryId: 'library-1',
      secret: 'private-secret',
      code: 'PAIR-CODE-1234567',
      expiresAt: Date.now() + 600_000,
    }
  })
  runtime.clear.mockImplementation(async () => {
    runtime.settings.mockReturnValue({ workerBaseUrl: 'https://worker.example' })
  })
  runtime.cancelJob.mockResolvedValue(undefined)
  runtime.cleanupHistory.mockResolvedValue({ posts: 3, resources: 4 })
})
afterEach(() => {
  vi.restoreAllMocks()
})

describe('DiscordInboxPanel', () => {
  it('saves the foreground automatic-binding switch from the settings dialog', async () => {
    runtime.settings.mockReturnValue(settings)
    const wrapper = mount(DiscordInboxPanel)
    try {
      await flushPromises()
      wrapper.vm.openAutomationSettings()
      await flushPromises()
      const foreground = Array.from(
        document.querySelectorAll('.discord-inbox__automation input[type="checkbox"]'),
      ).at(-1) as HTMLInputElement
      foreground.click()
      await flushPromises()
      expect(runtime.putAutomation).toHaveBeenCalledWith(
        expect.objectContaining({ bindForeground: true }),
      )
    } finally {
      wrapper.unmount()
    }
  })

  it('backfills recent cards when foreground auto-binding is enabled late', async () => {
    runtime.settings.mockReturnValue(settings)
    runtime.getAutomation.mockResolvedValue({ bindSameName: true, bindSameAuthor: true })
    runtime.backfillLateAutoBinding.mockResolvedValue([
      { sourceId: 'post-1', resourceId: 'card-1', rule: 'same-name' },
    ])
    const wrapper = mount(DiscordInboxPanel)
    try {
      await flushPromises()
      wrapper.vm.openAutomationSettings()
      await flushPromises()
      const toggles = Array.from(
        document.querySelectorAll('.discord-inbox__automation input[type="checkbox"]'),
      ) as HTMLInputElement[]
      toggles.at(-1)!.click()
      await flushPromises()
      expect(runtime.backfillLateAutoBinding).toHaveBeenCalledWith(
        expect.any(Object),
        expect.any(Object),
        expect.objectContaining({
          bindSameName: true,
          bindSameAuthor: true,
          bindForeground: true,
        }),
      )
    } finally {
      wrapper.unmount()
    }
  })

  it('highlights and scrolls to the text that caused an automatic name match', async () => {
    runtime.settings.mockReturnValue(settings)
    runtime.listAutoBindings.mockResolvedValue([
      {
        source: { title: '角色 A 的帖子' },
        binding: {
          resourceId: 'card-1',
          sourceId: 'post-1',
          autoBindingRule: 'same-name',
        },
      },
    ])
    runtime.getAutoBindingView.mockResolvedValue({
      source: { title: '角色 A 的帖子' },
      messages: [{ id: 'message-1', authorName: '作者', content: '这里写着 角色 A 的详细介绍' }],
    })
    runtime.resourceSummaries.mockResolvedValue([
      {
        id: 'card-1',
        name: '角色 A',
        fileName: 'card.png',
        type: 'characterCard',
        metadata: {},
      },
    ])
    const scrollIntoView = vi.fn()
    const originalScrollIntoView = HTMLElement.prototype.scrollIntoView
    HTMLElement.prototype.scrollIntoView = scrollIntoView
    const wrapper = mount(DiscordInboxPanel, {
      props: { view: 'review' },
      attachTo: document.body,
    })
    try {
      await flushPromises()
      const inspectButton = wrapper.findAll('button').find((button) => button.text() === '查看核对')
      expect(inspectButton).toBeDefined()
      await inspectButton!.trigger('click')
      await flushPromises()
      expect(wrapper.find('mark').text()).toBe('角色 A')
      expect(wrapper.find('[data-auto-binding-target="title"]').exists()).toBe(true)
      expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' })
      expect(wrapper.find('.discord-inbox__history').exists()).toBe(false)
    } finally {
      wrapper.unmount()
      HTMLElement.prototype.scrollIntoView = originalScrollIntoView
    }
  })

  it('folds saved receipt history by default without deleting local posts', async () => {
    runtime.settings.mockReturnValue(settings)
    runtime.jobs.mockResolvedValue({
      jobs: [],
      recent: [{ id: 'saved', state: 'saved', title: '已保存帖子' }],
      hasMore: false,
    })
    const wrapper = mount(DiscordInboxPanel)
    try {
      await flushPromises()
      const history = wrapper.get('details.discord-inbox__history')
      expect(history.attributes('open')).toBeUndefined()
      expect(history.text()).toContain('已保存帖子')
      expect(history.text()).toContain('7 天')
    } finally {
      wrapper.unmount()
    }
  })
  it('automatically folds pairing details after Discord confirms the connection', async () => {
    runtime.settings.mockReturnValue({ ...settings, inboxPairCode: 'PAIR-CODE-1234567' })
    runtime.status.mockResolvedValue({
      libraryId: 'library-1',
      name: '我的资源库',
      paired: false,
      expiresInDays: 7,
    })
    const wrapper = mount(DiscordInboxPanel, { props: { mode: 'pairing' } })
    await flushPromises()
    expect(wrapper.get('#discord-inbox-settings').text()).toContain('PAIR-CODE-1234567')
    runtime.status.mockResolvedValue({
      libraryId: 'library-1',
      name: '我的资源库',
      paired: true,
      expiresInDays: 7,
    })
    window.dispatchEvent(
      new CustomEvent('srl:discord-inbox-updated', {
        detail: { status: 'ready', busy: false, received: 0 },
      }),
    )
    await flushPromises()
    expect(wrapper.find('#discord-inbox-settings').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('PAIR-CODE-1234567')
    expect(wrapper.text()).toContain('已配对')
    ;(wrapper.get('details').element as HTMLDetailsElement).open = true
    await wrapper.get('details').trigger('toggle')
    expect(wrapper.get('#discord-inbox-settings').text()).toContain('断开配对')
    expect(wrapper.text()).not.toContain('PAIR-CODE-1234567')
    wrapper.unmount()
  })

  it('pairs through the service, shows only its short-lived code and triggers the shared receiver', async () => {
    runtime.status.mockResolvedValue({
      libraryId: 'library-1',
      name: '我的资源库',
      paired: false,
      expiresInDays: 7,
    })
    const receive = vi.fn()
    window.addEventListener('srl:receive-discord-inbox', receive)
    const wrapper = mount(DiscordInboxPanel, { props: { mode: 'pairing' } })
    await flushPromises()
    expect(runtime.status).not.toHaveBeenCalled()
    await wrapper.get('input').setValue('我的资源库')
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '生成配对码')!
      .trigger('click')
    await flushPromises()
    expect(runtime.pair).toHaveBeenCalledWith('我的资源库')
    expect(wrapper.text()).toContain('PAIR-CODE-1234567')
    expect(wrapper.text()).toContain('/绑定资源库')
    expect(wrapper.text()).not.toContain('private-secret')
    expect(receive).toHaveBeenCalledOnce()
    expect(runtime.jobs).not.toHaveBeenCalled()
    window.removeEventListener('srl:receive-discord-inbox', receive)
    wrapper.unmount()
  })

  it('shows the default target, recent receipt state and real receive progress', async () => {
    runtime.settings.mockReturnValue(settings)
    runtime.jobs.mockResolvedValue({
      jobs: [{ id: 'pending-1' }],
      recent: [
        { id: 'saved-1', state: 'saved', title: '已保存帖子' },
        { id: 'waiting-1', state: 'waiting_binding', title: '待整理帖子' },
      ],
      hasMore: true,
    })
    const wrapper = mount(DiscordInboxPanel)
    try {
      await flushPromises()
      expect(wrapper.text()).toContain('默认目标：我的资源库')
      expect(wrapper.find('#discord-inbox-settings').exists()).toBe(false)
      expect(wrapper.find('.discord-inbox__automation').exists()).toBe(false)
      wrapper.vm.openAutomationSettings()
      await flushPromises()
      const dialog = document.querySelector('[role="dialog"]')
      expect(dialog?.getAttribute('aria-modal')).toBe('true')
      expect(dialog?.textContent).toContain('前台开启自动绑定')
      expect(
        dialog?.querySelectorAll('.discord-inbox__automation input[type="checkbox"]'),
      ).toHaveLength(4)
      expect(wrapper.find('details.discord-inbox__pending-jobs').exists()).toBe(true)
      expect(wrapper.get('details.discord-inbox__history').attributes('open')).toBeDefined()
      expect(wrapper.text()).toContain('待领取 1+ 条')
      expect(wrapper.text()).toContain('待关联资源')
      window.dispatchEvent(
        new CustomEvent('srl:discord-inbox-updated', {
          detail: { status: 'receiving', busy: true, received: 2, waitingBinding: 1 },
        }),
      )
      await flushPromises()
      expect(wrapper.text()).toContain('正在领取，已保存 2 条')
      expect(
        wrapper
          .findAll('button')
          .find((button) => button.text() === '正在领取…')!
          .attributes('disabled'),
      ).toBeDefined()
      window.dispatchEvent(
        new CustomEvent('srl:discord-inbox-updated', {
          detail: { status: 'ready', busy: false, received: 3, waitingBinding: 1 },
        }),
      )
      await flushPromises()
      expect(wrapper.text()).toContain('已保存 3 条，1 条待关联')
      expect(runtime.jobs).toHaveBeenCalledTimes(2)
    } finally {
      wrapper.unmount()
    }
  })

  it('lets the user review an automatic post binding and approve it as manual', async () => {
    const card = {
      id: 'card-1',
      type: 'characterCard',
      name: '角色 A',
      fileName: 'a.png',
      tags: [],
      metadata: {},
      categoryId: null,
      categoryIds: [],
      createdAt: 1,
      updatedAt: 1,
    }
    const binding = {
      source: { id: 'post-1', title: '帖子 A' },
      binding: { sourceId: 'post-1', resourceId: 'card-1', autoBindingRule: 'same-name' },
    }
    runtime.settings.mockReturnValue(settings)
    runtime.listAutoBindings.mockResolvedValueOnce([binding]).mockResolvedValueOnce([])
    runtime.getAutoBindingView.mockResolvedValue({
      source: { id: 'post-1', title: '帖子 A' },
      messages: [{ id: 'message-1', authorName: '作者', content: '帖子首楼正文' }],
      binding: binding.binding,
    })
    runtime.resourceSummaries.mockResolvedValue([card])
    const wrapper = mount(DiscordInboxPanel, { props: { view: 'review' } })
    await flushPromises()

    expect(wrapper.text()).toContain('1 条待核对')
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '查看核对')!
      .trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('帖子首楼正文')
    expect(wrapper.text()).toContain('角色 A · a.png')
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '打开角色卡')!
      .trigger('click')
    expect(wrapper.emitted('open-resource')?.[0]).toEqual([card])

    await wrapper
      .findAll('button')
      .find((button) => button.text() === '确认正确')!
      .trigger('click')
    await flushPromises()
    expect(runtime.confirmAutoBinding).toHaveBeenCalledWith('card-1', 'post-1')
    expect(wrapper.text()).not.toContain('1 条待核对')
    wrapper.unmount()
  })

  it('replaces an automatic binding with a selected character card', async () => {
    const card = (id: string, name: string) => ({
      id,
      type: 'characterCard',
      name,
      fileName: `${id}.png`,
      tags: [],
      metadata: {},
      categoryId: null,
      categoryIds: [],
      createdAt: 1,
      updatedAt: 1,
    })
    const autoBinding = {
      source: { id: 'post-2', title: '帖子 B' },
      binding: { sourceId: 'post-2', resourceId: 'card-1', autoBindingRule: 'same-author' },
    }
    runtime.settings.mockReturnValue(settings)
    runtime.listAutoBindings
      .mockResolvedValueOnce([autoBinding])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([autoBinding])
      .mockResolvedValueOnce([])
    runtime.resourceSummaries.mockResolvedValue([card('card-1', '原卡'), card('card-2', '替换卡')])
    const wrapper = mount(DiscordInboxPanel, { props: { view: 'review' } })
    await flushPromises()

    await wrapper
      .findAll('button')
      .find((button) => button.text() === '替换资源')!
      .trigger('click')
    await flushPromises()
    await wrapper.findAll('.resource-picker__list button')[1]!.trigger('click')
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '确认替换')!
      .trigger('click')
    await flushPromises()
    expect(runtime.replaceAutoBinding).toHaveBeenCalledWith('card-1', 'card-2', 'post-2')
    expect(wrapper.text()).not.toContain('1 条待核对')
    wrapper.unmount()
  })

  it('returns an automatic binding to the pending list', async () => {
    runtime.settings.mockReturnValue(settings)
    runtime.listAutoBindings
      .mockResolvedValueOnce([
        {
          source: { id: 'post-2', title: '帖子 B' },
          binding: { sourceId: 'post-2', resourceId: 'card-1', autoBindingRule: 'same-author' },
        },
      ])
      .mockResolvedValueOnce([])
    const wrapper = mount(DiscordInboxPanel, { props: { view: 'review' } })
    await flushPromises()
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '退回待整理')!
      .trigger('click')
    await flushPromises()
    expect(runtime.unbindSource).toHaveBeenCalledWith('card-1', 'post-2')
    wrapper.unmount()
  })

  it('chooses a cloud cleanup scope in a dialog and still lets the user cancel an unclaimed post', async () => {
    runtime.settings.mockReturnValue(settings)
    runtime.jobs.mockResolvedValue({
      jobs: [{ id: 'pending-post', state: 'pending', title: '未领取帖子' }],
      recent: [],
      hasMore: false,
    })
    const wrapper = mount(DiscordInboxPanel)
    try {
      await flushPromises()
      expect(wrapper.text()).toContain('待领取帖子（1）')
      wrapper.vm.openCloudCleanup()
      await flushPromises()
      expect(document.querySelector('[role="dialog"]')?.textContent).toContain('帖子收件')
      expect(document.querySelector('[role="dialog"]')?.textContent).toContain('资源下载')
      const resources = document.querySelector('input[value="resources"]') as HTMLInputElement
      resources.click()
      await flushPromises()
      ;(
        Array.from(document.querySelectorAll('[role="dialog"] button')).find(
          (button) => button.textContent === '继续',
        ) as HTMLButtonElement
      ).click()
      await flushPromises()
      expect(runtime.cleanupHistory).toHaveBeenCalledWith('resources')
      expect(runtime.confirm).toHaveBeenCalledWith(
        expect.objectContaining({ title: '清理资源下载？' }),
      )
      await flushPromises()
      expect(wrapper.text()).toContain('帖子 3 条，资源 4 项')
      await wrapper
        .findAll('button')
        .find((button) => button.text() === '取消')!
        .trigger('click')
      await flushPromises()
      expect(runtime.cancelJob).toHaveBeenCalledWith('pending-post', {
        workerUrl: 'https://worker.example',
        libraryId: 'library-1',
      })
      expect(runtime.confirm).toHaveBeenLastCalledWith(
        expect.objectContaining({ title: '取消这条待领取帖子？' }),
      )
    } finally {
      wrapper.unmount()
    }
  })

  it('replaces receiving progress with the completed partial count on an error', async () => {
    runtime.settings.mockReturnValue(settings)
    const wrapper = mount(DiscordInboxPanel)
    await flushPromises()
    for (const detail of [
      { status: 'receiving', busy: true, received: 2 },
      { status: 'error', busy: false, received: 3, error: '云端确认未完成，请稍后刷新。' },
    ])
      window.dispatchEvent(new CustomEvent('srl:discord-inbox-updated', { detail }))
    await flushPromises()
    expect(wrapper.text()).toContain('本轮领取未完成，已保存 3 条。')
    expect(wrapper.text()).toContain('云端确认未完成，请稍后刷新。')
    expect(wrapper.text()).not.toContain('正在领取')
    expect(wrapper.get('button[aria-label="刷新并领取"]').attributes('disabled')).toBeUndefined()
    wrapper.unmount()
  })

  it('makes missing protected credentials explicit and clears only through the disconnect service', async () => {
    const refresh = vi.fn()
    window.addEventListener('srl:receive-discord-inbox', refresh)
    runtime.settings.mockReturnValue({ ...settings, inboxSecret: '' })
    const wrapper = mount(DiscordInboxPanel, { props: { mode: 'pairing' } })
    await flushPromises()
    expect(wrapper.text()).toContain('本机收件凭据不可用')
    expect(wrapper.text()).toContain('不会迁移旧目标中的帖子')
    expect(wrapper.text()).toContain('云端保留 7 天')
    expect(runtime.status).not.toHaveBeenCalled()
    expect(wrapper.find('button[aria-label="刷新并领取"]').exists()).toBe(false)
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '断开配对')!
      .trigger('click')
    await flushPromises()
    expect(runtime.clear).toHaveBeenCalledOnce()
    expect(refresh).toHaveBeenCalledOnce()
    expect(runtime.confirm.mock.calls[0]).toBeDefined()
    expect(wrapper.text()).toContain('生成配对码')
    wrapper.unmount()
    window.removeEventListener('srl:receive-discord-inbox', refresh)
  })

  it('preserves a configured target when status or revocation fails and reports the failure', async () => {
    runtime.settings.mockReturnValue(settings)
    runtime.status.mockRejectedValueOnce(new Error('状态暂时不可用'))
    runtime.clear.mockRejectedValueOnce(new Error('撤销失败'))
    const wrapper = mount(DiscordInboxPanel, { props: { mode: 'pairing' } })
    await flushPromises()
    expect(wrapper.text()).toContain('状态暂时不可用')
    expect(wrapper.text()).not.toContain('生成配对码')
    ;(wrapper.get('details').element as HTMLDetailsElement).open = true
    await wrapper.get('details').trigger('toggle')
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '断开配对')!
      .trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('撤销失败')
    expect(wrapper.text()).not.toContain('生成配对码')
    wrapper.unmount()
  })

  it('identifies a previously paired library that is no longer the default target', async () => {
    runtime.settings.mockReturnValue(settings)
    runtime.status.mockResolvedValue({
      libraryId: 'library-1',
      name: '旧目标',
      paired: true,
      isDefault: false,
      expiresInDays: 7,
    })
    const wrapper = mount(DiscordInboxPanel)
    await flushPromises()
    expect(wrapper.text()).toContain('非默认目标')
    expect(wrapper.text()).toContain('本机收件库：旧目标')
    expect(wrapper.text()).toContain('这里仍可领取之前的任务')
    expect(wrapper.text()).not.toContain('默认目标：旧目标')
    wrapper.unmount()
  })

  it('refreshes the daily list after pairing changes without exposing setup controls', async () => {
    const wrapper = mount(DiscordInboxPanel)
    try {
      await flushPromises()
      expect(wrapper.text()).toContain('先在顶部“连接设置”中配对资源库')
      expect(wrapper.find('input').exists()).toBe(false)
      expect(wrapper.find('details').exists()).toBe(false)
      runtime.settings.mockReturnValue(settings)
      window.dispatchEvent(new Event('srl:receive-discord-inbox'))
      await flushPromises()
      expect(wrapper.text()).toContain('默认目标：我的资源库')
      expect(runtime.jobs).toHaveBeenCalledOnce()
      runtime.settings.mockReturnValue({ workerBaseUrl: 'https://worker.example' })
      window.dispatchEvent(new Event('srl:receive-discord-inbox'))
      await flushPromises()
      expect(wrapper.find('button').exists()).toBe(false)
      expect(wrapper.text()).toContain('先在顶部“连接设置”中配对资源库')
    } finally {
      wrapper.unmount()
    }
  })
})
