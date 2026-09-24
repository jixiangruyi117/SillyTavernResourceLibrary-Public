// @vitest-environment jsdom

import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  COMMUNITY_SOURCE_ATTACHMENT_LOCAL_STATE,
  COMMUNITY_SOURCE_MESSAGE_KIND,
  COMMUNITY_SOURCE_PLATFORM,
  COMMUNITY_SOURCE_REFRESH_MODE,
  COMMUNITY_SOURCE_REMOTE_STATE,
  toCommunitySourceSummary,
  type ResourceCommunitySourceSummary,
  type ResourceCommunitySourceView,
} from '../types/CommunitySource'
import DiscordCommunitySources from './DiscordCommunitySources.vue'

const runtime = vi.hoisted(() => ({
  clearRemoteAvailability: vi.fn(),
  getAttachmentBlob: vi.fn(),
  getForResource: vi.fn(),
  listSummariesForResource: vi.fn(),
  recordMessageRemoteCheck: vi.fn(),
  recordManualRefresh: vi.fn(),
  recordRemoteCheck: vi.fn(),
}))

const refreshRuntime = vi.hoisted(() => ({
  readDiscordSourceRemote: vi.fn(),
}))

vi.mock('../core/CommunitySourceRuntime', () => ({
  communitySourceService: runtime,
}))

vi.mock('../services/DiscordSourceRefreshService', () => ({
  readDiscordSourceRemote: refreshRuntime.readDiscordSourceRemote,
}))

function sourceView(): ResourceCommunitySourceView {
  const sourceId = 'source-1'
  return {
    source: {
      id: sourceId,
      platform: COMMUNITY_SOURCE_PLATFORM.DISCORD,
      sourceKeyHash: 'a'.repeat(64),
      guildId: '11111',
      guildName: '社区 A',
      channelId: '22222',
      channelName: '角色发布',
      starterMessageId: '33333',
      canonicalUrl: 'https://discord.com/channels/11111/22222/33333',
      title: '帖子',
      forumTags: [],
      messageCount: 1,
      missingMessageCount: 0,
      latestMessagePreview: '正文',
      createdAt: 1,
      updatedAt: 1,
    },
    messages: [
      {
        id: 'message-1',
        sourceId,
        messageKeyHash: 'b'.repeat(64),
        messageId: '33333',
        kind: COMMUNITY_SOURCE_MESSAGE_KIND.STARTER,
        authorId: '44444',
        authorName: 'Author',
        content: '正文',
        embeds: [],
        attachments: ['asset-first', 'asset-second'].map((localAssetId, index) => ({
          id: `attachment-${index}`,
          name: `attachment-${index}.txt`,
          size: 5,
          url: `https://cdn.discordapp.com/attachments/a/${index}`,
          contentType: 'text/plain',
          localAssetId,
          localState: COMMUNITY_SOURCE_ATTACHMENT_LOCAL_STATE.LOCAL,
        })),
        canonicalUrl: 'https://discord.com/channels/11111/22222/33333',
        timestamp: '2026-08-27T00:00:00.000Z',
        capturedAt: 1,
        updatedAt: 1,
      },
    ],
    binding: {
      id: 'resource-1:source:source-1',
      resourceId: 'resource-1',
      sourceId,
      createdAt: 1,
    },
  }
}

function sourceSummary(view: ResourceCommunitySourceView): ResourceCommunitySourceSummary {
  return {
    source: toCommunitySourceSummary(view.source),
    binding: view.binding,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

describe('DiscordCommunitySources lazy local reads', () => {
  it('loads only summaries for the directory and reads the selected source on demand', async () => {
    const view = sourceView()
    runtime.listSummariesForResource.mockResolvedValue([sourceSummary(view)])
    runtime.getForResource.mockResolvedValue(view)
    runtime.getAttachmentBlob.mockResolvedValue(undefined)
    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      configurable: true,
      value: vi.fn(),
    })

    const wrapper = mount(DiscordCommunitySources, {
      props: { resourceId: 'resource-1' },
      attachTo: document.body,
    })
    await flushPromises()

    expect(runtime.listSummariesForResource).toHaveBeenCalledWith('resource-1')
    expect(runtime.getForResource).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('社区 A · #角色发布')

    await wrapper.get('.discord-source-open').trigger('click')
    await flushPromises()

    expect(runtime.getForResource).toHaveBeenCalledWith('resource-1', 'source-1')
    expect(document.body.textContent).toContain('正文')
    wrapper.unmount()
  })

  it('revokes partially hydrated object URLs when the detail closes', async () => {
    const view = sourceView()
    let resolveSecond!: (blob: Blob) => void
    runtime.listSummariesForResource.mockResolvedValue([sourceSummary(view)])
    runtime.getForResource.mockResolvedValue(view)
    runtime.getAttachmentBlob
      .mockResolvedValueOnce(new Blob(['first'], { type: 'text/plain' }))
      .mockImplementationOnce(
        () =>
          new Promise<Blob>((resolve) => {
            resolveSecond = resolve
          }),
      )
    const createObjectURL = vi.fn(() => 'blob:discord-first')
    const revokeObjectURL = vi.fn()
    Object.defineProperties(URL, {
      createObjectURL: { configurable: true, value: createObjectURL },
      revokeObjectURL: { configurable: true, value: revokeObjectURL },
    })
    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      configurable: true,
      value: vi.fn(),
    })

    const wrapper = mount(DiscordCommunitySources, {
      props: { resourceId: 'resource-1' },
      attachTo: document.body,
    })
    await flushPromises()
    expect(runtime.getForResource).not.toHaveBeenCalled()

    await wrapper.get('.discord-source-open').trigger('click')
    await vi.waitFor(() => expect(runtime.getAttachmentBlob).toHaveBeenCalledTimes(2))
    expect(createObjectURL).toHaveBeenCalledTimes(1)

    const close = document.querySelector<HTMLButtonElement>(
      'button[aria-label="关闭 Discord 来源详情"]',
    )
    expect(close).not.toBeNull()
    close!.click()
    resolveSecond(new Blob(['second'], { type: 'text/plain' }))
    await flushPromises()

    expect(revokeObjectURL).toHaveBeenCalledWith('blob:discord-first')
    wrapper.unmount()
  })

  it('refreshes only the open detail when background attachment localization finishes', async () => {
    const view = sourceView()
    runtime.listSummariesForResource.mockResolvedValue([sourceSummary(view)])
    runtime.getForResource.mockResolvedValue(view)
    runtime.getAttachmentBlob.mockResolvedValue(undefined)
    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      configurable: true,
      value: vi.fn(),
    })

    const wrapper = mount(DiscordCommunitySources, {
      props: { resourceId: 'resource-1' },
      attachTo: document.body,
    })
    await flushPromises()
    await wrapper.get('.discord-source-open').trigger('click')
    await flushPromises()
    expect(runtime.getForResource).toHaveBeenCalledTimes(1)

    window.dispatchEvent(
      new CustomEvent('srl:community-source-attachments-updated', {
        detail: { sourceId: 'source-other' },
      }),
    )
    await flushPromises()
    expect(runtime.getForResource).toHaveBeenCalledTimes(1)

    window.dispatchEvent(
      new CustomEvent('srl:community-source-attachments-updated', {
        detail: { sourceId: 'source-1' },
      }),
    )
    await flushPromises()

    expect(runtime.getForResource).toHaveBeenCalledTimes(2)
    expect(runtime.listSummariesForResource).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })

  it('does not persist pending missing/restored message state before the user decides', async () => {
    const view = sourceView()
    runtime.listSummariesForResource.mockResolvedValue([sourceSummary(view)])
    runtime.getForResource.mockResolvedValue(view)
    runtime.getAttachmentBlob.mockResolvedValue(undefined)
    runtime.recordRemoteCheck.mockResolvedValue(view.source)
    refreshRuntime.readDiscordSourceRemote.mockResolvedValue({
      state: 'available',
      captures: [],
      missingMessageIds: ['33333'],
      diff: {
        hasChanges: true,
        newMessages: 0,
        changedMessages: 0,
        missingMessages: 1,
        restoredMessages: 0,
        contentChanges: 0,
        embedChanges: 0,
        attachmentChanges: 0,
        sourceMetadataChanges: 0,
        changes: [
          {
            messageId: '33333',
            type: 'missing',
            authorName: 'Author',
            authorBot: false,
            summary: '正文',
          },
        ],
      },
      syncState: {
        remoteScanCursor: { lastSeenMessageId: '33333' },
        savedMessageCheckCursor: '33333',
      },
      rateLimited: false,
    })
    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      configurable: true,
      value: vi.fn(),
    })

    const wrapper = mount(DiscordCommunitySources, {
      props: { resourceId: 'resource-1' },
      attachTo: document.body,
    })
    await flushPromises()
    await wrapper.get('.discord-source-open').trigger('click')
    await flushPromises()
    const checkButton = [...document.querySelectorAll<HTMLButtonElement>('button')].find(
      (button) => button.textContent?.trim() === '检查更新',
    )
    expect(checkButton).toBeDefined()
    if (!checkButton) throw new Error('refresh button missing')
    checkButton.click()
    await flushPromises()

    expect(runtime.recordRemoteCheck).toHaveBeenCalledWith('source-1', 'available', true, undefined)
    expect(runtime.recordMessageRemoteCheck).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('原消息已删除')
    wrapper.unmount()
  })

  it('reports a partial check instead of no updates when Discord rate limits health checks', async () => {
    const view = sourceView()
    runtime.listSummariesForResource.mockResolvedValue([sourceSummary(view)])
    runtime.getForResource.mockResolvedValue(view)
    runtime.getAttachmentBlob.mockResolvedValue(undefined)
    runtime.recordRemoteCheck.mockResolvedValue(view.source)
    refreshRuntime.readDiscordSourceRemote.mockResolvedValue({
      state: 'available',
      captures: [],
      missingMessageIds: [],
      diff: {
        hasChanges: false,
        newMessages: 0,
        changedMessages: 0,
        missingMessages: 0,
        restoredMessages: 0,
        contentChanges: 0,
        embedChanges: 0,
        attachmentChanges: 0,
        sourceMetadataChanges: 0,
        changes: [],
      },
      syncState: {
        remoteScanCursor: { lastSeenMessageId: '33333' },
        savedMessageCheckCursor: '33333',
      },
      rateLimited: true,
    })
    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      configurable: true,
      value: vi.fn(),
    })

    const wrapper = mount(DiscordCommunitySources, {
      props: { resourceId: 'resource-1' },
      attachTo: document.body,
    })
    await flushPromises()
    await wrapper.get('.discord-source-open').trigger('click')
    await flushPromises()
    const checkButton = [...document.querySelectorAll<HTMLButtonElement>('button')].find(
      (button) => button.textContent?.trim() === '检查更新',
    )
    expect(checkButton).toBeDefined()
    if (!checkButton) throw new Error('refresh button missing')
    checkButton.click()
    await flushPromises()

    expect(runtime.recordRemoteCheck).toHaveBeenCalledWith('source-1', 'available', false, {
      remoteScanCursor: { lastSeenMessageId: '33333' },
      savedMessageCheckCursor: '33333',
    })
    expect(runtime.recordMessageRemoteCheck).toHaveBeenCalledWith('source-1', [], [])
    expect(document.body.textContent).toContain(
      'Discord 暂时限流，本次只完成部分旧消息检查，检查进度已保留，请稍后再次检查。',
    )
    expect(document.body.textContent).not.toContain('未发现更新')
    wrapper.unmount()
  })

  it('clears a stale unavailable state and shows one accurate notice when the Bot cannot check', async () => {
    const view = sourceView()
    view.source.remoteState = COMMUNITY_SOURCE_REMOTE_STATE.UNAVAILABLE
    runtime.listSummariesForResource.mockImplementation(async () => [sourceSummary(view)])
    runtime.getForResource.mockImplementation(async () => view)
    runtime.getAttachmentBlob.mockResolvedValue(undefined)
    runtime.recordManualRefresh.mockImplementation(async () => {
      delete view.source.remoteState
      delete view.source.hasRemoteUpdate
      view.source.discordRefreshMode = COMMUNITY_SOURCE_REFRESH_MODE.MANUAL
      return view.source
    })
    refreshRuntime.readDiscordSourceRemote.mockResolvedValue({
      state: 'uncheckable',
      reason: 'bot_access',
      stage: 'channel',
    })
    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      configurable: true,
      value: vi.fn(),
    })

    const wrapper = mount(DiscordCommunitySources, {
      props: { resourceId: 'resource-1' },
      attachTo: document.body,
    })
    await flushPromises()
    await wrapper.get('.discord-source-open').trigger('click')
    await flushPromises()
    expect(document.body.textContent).toContain('原帖当前不可访问')

    const checkButton = [...document.querySelectorAll<HTMLButtonElement>('button')].find(
      (button) => button.textContent?.trim() === '检查更新',
    )
    expect(checkButton).toBeDefined()
    if (!checkButton) throw new Error('refresh button missing')
    checkButton.click()
    await flushPromises()

    expect(runtime.recordManualRefresh).toHaveBeenCalledWith('source-1')
    expect(runtime.clearRemoteAvailability).not.toHaveBeenCalled()
    expect(runtime.recordRemoteCheck).not.toHaveBeenCalled()
    expect(runtime.recordMessageRemoteCheck).not.toHaveBeenCalled()
    expect(document.body.textContent).not.toContain('原帖当前不可访问')
    expect(document.body.textContent?.match(/因此使用手动更新/g)).toHaveLength(1)
    expect(document.body.textContent).toContain('手动更新')
    expect(document.body.textContent).toContain('前往 Discord 更新')
    expect(document.body.textContent).toContain('重试自动检查')
    expect(refreshRuntime.readDiscordSourceRemote).toHaveBeenCalledOnce()

    const manualLink = document.querySelector<HTMLAnchorElement>('.discord-thread-toolbar__primary')
    expect(manualLink?.href).toBe('https://discord.com/channels/11111/22222/33333')
    expect(refreshRuntime.readDiscordSourceRemote).toHaveBeenCalledOnce()
    wrapper.unmount()
  })
})
