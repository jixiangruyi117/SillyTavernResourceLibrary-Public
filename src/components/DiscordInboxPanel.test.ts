// @vitest-environment jsdom
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const runtime = vi.hoisted(() => ({
  settings: vi.fn(),
  status: vi.fn(),
  jobs: vi.fn(),
  pair: vi.fn(),
  clear: vi.fn(),
  confirm: vi.fn(async () => true),
}))
vi.mock('../services/DiscordSourceSettingsService', () => ({
  loadDiscordSourceConnectionSettings: runtime.settings,
}))
vi.mock('../services/DiscordHandoffService', () => ({
  readDiscordInboxStatus: runtime.status,
  listDiscordInboxJobs: runtime.jobs,
  pairDiscordInbox: runtime.pair,
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
})
afterEach(() => {
  vi.restoreAllMocks()
})

describe('DiscordInboxPanel', () => {
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
    await flushPromises()
    expect(wrapper.text()).toContain('默认目标：我的资源库')
    expect(wrapper.find('#discord-inbox-settings').exists()).toBe(false)
    expect(wrapper.find('button[aria-label="收件设置"]').exists()).toBe(false)
    expect(wrapper.find('details').exists()).toBe(false)
    expect(wrapper.find('input').exists()).toBe(false)
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
    wrapper.unmount()
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
