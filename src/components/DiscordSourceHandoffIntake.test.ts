// @vitest-environment jsdom

import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const runtime = vi.hoisted(() => ({
  bindSource: vi.fn(async () => undefined),
  clearHandoff: vi.fn(),
  consumeHandoff: vi.fn(async () => ({
    channelId: 'channel-1',
    messageId: 'message-1',
    canonicalUrl: 'https://discord.com/channels/guild-1/channel-1/message-1',
    authorId: 'author-1',
    authorName: '作者',
    content: '正文',
    timestamp: '2026-08-29T00:00:00.000Z',
  })),
  initializeVaultOnce: vi.fn(async () => ({ enabled: false, locked: false })),
  getSourceUsage: vi.fn(),
  listResources: vi.fn(async () => [
    {
      id: 'resource-1',
      name: '测试资源',
      fileName: 'resource.json',
      tags: [],
    },
  ]),
  readHandoff: vi.fn(() => ({ workerUrl: 'https://worker.example', token: 'handoff-token' })),
  saveDiscordCapture: vi.fn(async () => ({
    source: {
      id: 'source-1',
      platform: 'discord',
      sourceKeyHash: 'source-key',
      channelId: 'channel-1',
      canonicalUrl: 'https://discord.com/channels/guild-1/channel-1/message-1',
      title: '测试来源',
      forumTags: [],
      createdAt: 1,
      updatedAt: 1,
    },
    messages: [],
    binding: {
      id: 'pending-binding',
      resourceId: '',
      sourceId: 'source-1',
      createdAt: 1,
    },
  })),
}))

vi.mock('../core/AppContainer', () => ({
  initializeVaultOnce: runtime.initializeVaultOnce,
  resourceService: {
    importLinks: vi.fn(),
    listResourceListSummaries: runtime.listResources,
  },
  vaultService: {
    getStatus: () => ({ enabled: false, locked: false }),
  },
}))

vi.mock('../core/CommunitySourceRuntime', () => ({
  communitySourceService: {
    bindSource: runtime.bindSource,
    getSourceUsage: runtime.getSourceUsage,
    saveDiscordCapture: runtime.saveDiscordCapture,
  },
}))

vi.mock('../services/DiscordHandoffService', () => ({
  clearDiscordHandoffFromLocation: runtime.clearHandoff,
  consumeDiscordHandoff: runtime.consumeHandoff,
  readDiscordHandoffFromLocation: runtime.readHandoff,
}))

import DiscordSourceHandoffIntake from './DiscordSourceHandoffIntake.vue'

describe('DiscordSourceHandoffIntake', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    runtime.getSourceUsage.mockResolvedValue([])
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('关联成功提示会自动消失，不会永久遮挡 APK 页面', async () => {
    const wrapper = mount(DiscordSourceHandoffIntake, {
      global: { stubs: { Teleport: true } },
    })
    await flushPromises()

    await wrapper.get('input[type="radio"]').setValue()
    const bindButton = wrapper
      .findAll('button')
      .find((button) => button.text().includes('关联所选资源'))
    expect(bindButton).toBeDefined()
    await bindButton!.trigger('click')
    await flushPromises()

    expect(runtime.bindSource).toHaveBeenCalledWith('resource-1', 'source-1')
    expect(wrapper.text()).toContain('已关联到“测试资源”')

    await vi.advanceTimersByTimeAsync(2_500)
    expect(wrapper.text()).not.toContain('已关联到“测试资源”')
    wrapper.unmount()
  })

  it('再次保存已绑定来源时直接更新，不重复打开绑定弹窗', async () => {
    runtime.getSourceUsage.mockResolvedValue([
      {
        id: 'resource-1:source:source-1',
        resourceId: 'resource-1',
        sourceId: 'source-1',
        createdAt: 1,
      },
    ])
    const changed = vi.fn()
    window.addEventListener('srl:community-sources-changed', changed)

    const wrapper = mount(DiscordSourceHandoffIntake, {
      global: { stubs: { Teleport: true } },
    })
    await flushPromises()

    expect(runtime.saveDiscordCapture).toHaveBeenCalledOnce()
    expect(runtime.getSourceUsage).toHaveBeenCalledWith('source-1')
    expect(wrapper.text()).toContain('已更新已有 Discord 来源')
    expect(wrapper.text()).not.toContain('保存 Discord 来源')
    expect(runtime.bindSource).not.toHaveBeenCalled()
    expect(changed).toHaveBeenCalledOnce()

    window.removeEventListener('srl:community-sources-changed', changed)
    wrapper.unmount()
  })
})
