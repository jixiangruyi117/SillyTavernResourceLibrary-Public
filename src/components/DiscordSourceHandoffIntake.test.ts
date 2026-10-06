// @vitest-environment jsdom

import { DOMWrapper, enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const runtime = vi.hoisted(() => ({
  bindSource: vi.fn(async () => undefined),
  clearHandoff: vi.fn(),
  parseHandoffLink: vi.fn((value: string) =>
    value === 'https://worker.example/open/pasted-token'
      ? { workerUrl: 'https://worker.example', token: 'pasted-token' }
      : undefined,
  ),
  consumeHandoff: vi.fn(async (_request?: unknown) => ({
    channelId: 'channel-1',
    messageId: 'message-1',
    canonicalUrl: 'https://discord.com/channels/guild-1/channel-1/message-1',
    authorId: 'author-1',
    authorName: '作者',
    content: '正文',
    timestamp: '2026-08-29T00:00:00.000Z',
  })),
  initializeVaultOnce: vi.fn(async () => ({ enabled: false, locked: false })),
  vaultStatus: vi.fn(() => ({ enabled: false, locked: false })),
  receiveHandoff: vi.fn(),
  acknowledgeHandoff: vi.fn(
    async (_request?: unknown, _delivery?: unknown, _state?: string): Promise<void> => undefined,
  ),
  listInboxJobs: vi.fn(async () => ({
    jobs: [] as Array<{ id: string; state: string; createdAt: number }>,
    recent: [] as Array<{ id: string; state: string; createdAt: number }>,
    hasMore: false,
  })),
  receiveInboxJob: vi.fn(),
  notifyInboxResult: vi.fn(),
  acknowledgeInboxJob: vi.fn(async () => undefined),
  settings: vi.fn((): { workerBaseUrl: string; inboxLibraryId?: string; inboxSecret?: string } => ({
    workerBaseUrl: 'https://worker.example',
  })),
  localize: vi.fn(async (): Promise<void> => undefined),
  sourceUsageByHash: vi.fn(async (_key?: string) => [] as unknown[]),
  listWaitingSources: vi.fn(async (_after?: string) => ({
    sourceKeyHashes: [] as string[],
    nextCursor: null as string | null,
  })),
  acknowledgeSourceBound: vi.fn(async () => undefined),
  getSourceUsage: vi.fn(),
  listResources: vi.fn(async () => [
    {
      id: 'resource-1',
      name: '测试资源',
      fileName: 'resource.json',
      tags: [],
      type: 'characterCard',
      metadata: {},
    },
  ]),
  readHandoff: vi.fn((): { workerUrl: string; token: string } | undefined => ({
    workerUrl: 'https://worker.example',
    token: 'handoff-token',
  })),
  saveDiscordCapture: vi.fn(async (capture?: { messageId: string }) => ({
    source: {
      id: 'source-1',
      platform: 'discord',
      sourceKeyHash: 'a'.repeat(64),
      channelId: 'channel-1',
      canonicalUrl: 'https://discord.com/channels/guild-1/channel-1/message-1',
      title: '测试来源',
      forumTags: [],
      createdAt: 1,
      updatedAt: 1,
    },
    messages: [
      {
        messageId: capture?.messageId ?? 'message-1',
        authorName: '作者',
        content: '正文',
        attachments: [],
        embeds: [],
      },
    ],
    binding: {
      id: 'pending-binding',
      resourceId: '',
      sourceId: 'source-1',
      createdAt: 1,
    },
  })),
}))

vi.mock('../core/LibraryContainer', () => ({
  initializeVaultOnce: runtime.initializeVaultOnce,
  resourceService: {
    importLinks: vi.fn(),
    listResourceListSummaries: runtime.listResources,
  },
  vaultService: {
    getStatus: runtime.vaultStatus,
  },
}))

vi.mock('../core/CommunitySourceRuntime', () => ({
  communitySourceService: {
    bindSource: runtime.bindSource,
    getSourceUsage: runtime.getSourceUsage,
    saveDiscordCapture: runtime.saveDiscordCapture,
    localizeSavedMessageAttachments: runtime.localize,
    getSourceUsageByKeyHash: runtime.sourceUsageByHash,
  },
}))

vi.mock('../services/DiscordHandoffService', () => ({
  clearDiscordHandoffFromLocation: runtime.clearHandoff,
  receiveDiscordHandoff: runtime.receiveHandoff,
  acknowledgeDiscordHandoff: runtime.acknowledgeHandoff,
  listDiscordInboxJobs: runtime.listInboxJobs,
  receiveDiscordInboxJob: runtime.receiveInboxJob,
  acknowledgeDiscordInboxJob: runtime.acknowledgeInboxJob,
  acknowledgeDiscordInboxSourceBound: runtime.acknowledgeSourceBound,
  listDiscordInboxWaitingSources: runtime.listWaitingSources,
  parseDiscordHandoffLink: runtime.parseHandoffLink,
  readDiscordHandoffFromLocation: runtime.readHandoff,
}))

vi.mock('../services/NativeDiscordInboxService', () => ({
  notifyNativeDiscordInboxResult: runtime.notifyInboxResult,
}))

vi.mock('../services/DiscordSourceSettingsService', () => ({
  loadDiscordSourceConnectionSettings: runtime.settings,
}))

import DiscordSourceHandoffIntake from './DiscordSourceHandoffIntake.vue'
import { RESOURCE_GALLERY_ASSET_KIND } from '../types/ResourceGallery'

enableAutoUnmount(afterEach)
beforeAll(async () => {
  // Compile the lazy picker fixture before fake timers; interactions still use the real component.
  await import('./ResourcePicker.vue')
})

function configureInbox(): void {
  runtime.readHandoff.mockReturnValue(undefined)
  runtime.settings.mockReturnValue({
    workerBaseUrl: 'https://worker.example',
    inboxLibraryId: 'library-1',
    inboxSecret: 'private-secret',
  })
}

async function delivery(id = 'delivery-1') {
  return {
    capture: await runtime.consumeHandoff(),
    delivery: { id, libraryId: null, capturedAt: 123 },
  }
}

function requestNative(token: string): void {
  window.dispatchEvent(
    new CustomEvent('srl:native-deep-link', {
      detail: { kind: 'discordSource', workerUrl: 'https://worker.example', token },
    }),
  )
}

describe('DiscordSourceHandoffIntake', () => {
  it('keeps gallery attachments out of the direct handoff picker while PNG cards remain bindable', async () => {
    const ordinary = {
      id: 'card-png',
      name: 'PNG角色卡',
      fileName: 'card.png',
      tags: [],
      type: 'characterCard',
      metadata: {},
    }
    runtime.listResources.mockResolvedValueOnce([
      ordinary,
      ...['local', 'url'].map((storage) => ({
        ...ordinary,
        id: `gallery-${storage}`,
        name: `图库附件${storage}`,
        type: 'other',
        metadata: {
          assetKind: RESOURCE_GALLERY_ASSET_KIND,
          galleryOwnerId: ordinary.id,
          galleryStorage: storage,
        },
      })),
    ])
    const wrapper = mount(DiscordSourceHandoffIntake, { global: { stubs: { Teleport: true } } })
    try {
      await flushPromises()
      const picker = wrapper.get('.resource-picker')
      expect(picker.findAll('[role="option"]')).toHaveLength(1)
      expect(picker.get('[role="option"]').text()).toContain('PNG角色卡')
      await picker.get('input[type="search"]').setValue('图库附件')
      expect(picker.findAll('[role="option"]')).toHaveLength(0)
      await picker.get('input[type="search"]').setValue('PNG角色卡')
      await picker.get('[role="option"]').trigger('click')
      await wrapper
        .findAll('button')
        .find((button) => button.text() === '关联所选资源')!
        .trigger('click')
      await flushPromises()
      expect(runtime.bindSource).toHaveBeenCalledWith('card-png', 'source-1')
    } finally {
      wrapper.unmount()
    }
  })
  it('pages all 5000 candidates and keeps a selection outside the current search before binding', async () => {
    runtime.listResources.mockResolvedValueOnce(
      Array.from({ length: 5000 }, (_, index) => ({
        id: `card-${index}`,
        name: `角色 ${index}`,
        fileName: `file-${index}.json`,
        tags: [],
        type: 'characterCard',
        metadata: {},
      })),
    )
    const wrapper = mount(DiscordSourceHandoffIntake, { attachTo: document.body })
    const body = new DOMWrapper(document.body)
    await flushPromises()
    expect(body.findAll('[role="option"]')).toHaveLength(30)
    expect(runtime.listResources).toHaveBeenCalledOnce()
    const picker = body.get('.resource-picker')
    await picker.findAll('nav button')[1]!.trigger('click')
    expect(picker.get('nav').text()).toContain('2 / 167')
    await picker.get('input[type="search"]').setValue('file-4999.json')
    await picker.get('[role="option"]').trigger('click')
    await picker.get('input[type="search"]').setValue('不存在')
    expect(picker.text()).toContain('已选：角色 4999')
    await body
      .findAll('button')
      .find((button) => button.text() === '关联所选资源')!
      .trigger('click')
    await flushPromises()
    expect(runtime.bindSource).toHaveBeenCalledWith('card-4999', 'source-1')
    wrapper.unmount()
  })
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    runtime.vaultStatus.mockReturnValue({ enabled: false, locked: false })
    runtime.settings.mockReturnValue({ workerBaseUrl: 'https://worker.example' })
    runtime.listInboxJobs.mockResolvedValue({ jobs: [], recent: [], hasMore: false })
    runtime.sourceUsageByHash.mockResolvedValue([])
    runtime.listWaitingSources.mockResolvedValue({ sourceKeyHashes: [], nextCursor: null })
    runtime.receiveHandoff.mockImplementation(async (request: unknown) => ({
      capture: await runtime.consumeHandoff(request),
    }))
    runtime.receiveInboxJob.mockImplementation(async (id: string) => ({
      capture: { ...(await runtime.consumeHandoff()), messageId: id },
      delivery: { id, libraryId: 'library-1', capturedAt: 123 },
    }))
    runtime.readHandoff.mockReturnValue({
      workerUrl: 'https://worker.example',
      token: 'handoff-token',
    })
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

    await wrapper.get('[role="option"]').trigger('click')
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

  it('从已安装 PWA 粘贴 Worker 链接并走现有本地保存流程', async () => {
    runtime.readHandoff.mockReturnValue(undefined)
    const wrapper = mount(DiscordSourceHandoffIntake, {
      global: { stubs: { Teleport: true } },
    })
    await flushPromises()

    window.dispatchEvent(new Event('srl:open-discord-handoff-paste'))
    await flushPromises()
    const textarea = wrapper.get('textarea[placeholder="粘贴 https://…/open/… 链接"]')
    await textarea.setValue('https://worker.example/open/pasted-token')
    const receiveButton = wrapper
      .findAll('button')
      .find((button) => button.text().includes('领取并保存到本机'))
    expect(receiveButton).toBeDefined()
    await receiveButton!.trigger('click')
    await flushPromises()

    expect(runtime.parseHandoffLink).toHaveBeenCalledWith(
      'https://worker.example/open/pasted-token',
    )
    expect(runtime.consumeHandoff).toHaveBeenCalledWith({
      workerUrl: 'https://worker.example',
      token: 'pasted-token',
    })
    expect(runtime.saveDiscordCapture).toHaveBeenCalledOnce()
    expect(wrapper.text()).toContain('保存 Discord 来源')
    wrapper.unmount()
  })

  it('acknowledges only after the saved message is read back and localizes attachments afterwards', async () => {
    const envelope = await delivery()
    runtime.receiveHandoff.mockResolvedValue(envelope)
    const wrapper = mount(DiscordSourceHandoffIntake, { global: { stubs: { Teleport: true } } })
    await flushPromises()
    expect(runtime.saveDiscordCapture).toHaveBeenCalledWith(envelope.capture, {
      capturedAt: 123,
      deferAttachmentLocalization: true,
    })
    expect(runtime.acknowledgeHandoff).toHaveBeenCalledWith(
      { workerUrl: 'https://worker.example', token: 'handoff-token' },
      envelope.delivery,
      'waiting_binding',
    )
    expect(runtime.acknowledgeHandoff.mock.invocationCallOrder[0]).toBeGreaterThan(
      runtime.getSourceUsage.mock.invocationCallOrder[0]!,
    )
    expect(runtime.localize.mock.invocationCallOrder[0]).toBeGreaterThan(
      runtime.acknowledgeHandoff.mock.invocationCallOrder[0]!,
    )
    wrapper.unmount()
  })

  it('upgrades an unpaired temporary receipt after binding through the existing manual dialog', async () => {
    const envelope = await delivery()
    runtime.receiveHandoff.mockResolvedValue(envelope)
    const wrapper = mount(DiscordSourceHandoffIntake, { global: { stubs: { Teleport: true } } })
    await flushPromises()
    runtime.sourceUsageByHash.mockResolvedValue([{ resourceId: 'resource-1' }])
    await wrapper.get('[role="option"]').trigger('click')
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '关联所选资源')!
      .trigger('click')
    await flushPromises()
    expect(runtime.bindSource).toHaveBeenCalledWith('resource-1', 'source-1')
    expect(runtime.acknowledgeHandoff).toHaveBeenNthCalledWith(
      2,
      { workerUrl: 'https://worker.example', token: 'handoff-token' },
      envelope.delivery,
      'saved',
    )
    expect(runtime.sourceUsageByHash).toHaveBeenCalledWith('a'.repeat(64))
    expect(runtime.listInboxJobs).not.toHaveBeenCalled()
    expect(runtime.saveDiscordCapture).toHaveBeenCalledOnce()
    wrapper.unmount()
  })

  it('keeps a failed temporary binding acknowledgement for online retry and removes it after success', async () => {
    runtime.receiveHandoff.mockResolvedValue(await delivery())
    const wrapper = mount(DiscordSourceHandoffIntake, { global: { stubs: { Teleport: true } } })
    await flushPromises()
    runtime.sourceUsageByHash.mockResolvedValue([{ resourceId: 'resource-1' }])
    runtime.acknowledgeHandoff.mockRejectedValueOnce(new Error('offline'))
    window.dispatchEvent(
      new CustomEvent('srl:community-source-bound', { detail: { sourceKeyHash: 'a'.repeat(64) } }),
    )
    await flushPromises()
    expect(runtime.acknowledgeHandoff).toHaveBeenCalledTimes(2)
    window.dispatchEvent(new Event('online'))
    await flushPromises()
    expect(runtime.acknowledgeHandoff).toHaveBeenCalledTimes(3)
    expect(runtime.acknowledgeHandoff.mock.calls.at(-1)![2]).toBe('saved')
    window.dispatchEvent(new Event('online'))
    await flushPromises()
    expect(runtime.acknowledgeHandoff).toHaveBeenCalledTimes(3)
    expect(runtime.saveDiscordCapture).toHaveBeenCalledOnce()
    expect(runtime.acknowledgeSourceBound).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('defers unpaired temporary binding acknowledgement while locked and resumes on unlock', async () => {
    runtime.receiveHandoff.mockResolvedValue(await delivery())
    const wrapper = mount(DiscordSourceHandoffIntake, { global: { stubs: { Teleport: true } } })
    await flushPromises()
    runtime.sourceUsageByHash.mockResolvedValue([{ resourceId: 'resource-1' }])
    runtime.vaultStatus.mockReturnValue({ enabled: true, locked: true })
    window.dispatchEvent(
      new CustomEvent('srl:community-source-bound', { detail: { sourceKeyHash: 'a'.repeat(64) } }),
    )
    await flushPromises()
    expect(runtime.acknowledgeHandoff).toHaveBeenCalledOnce()
    runtime.vaultStatus.mockReturnValue({ enabled: true, locked: false })
    window.dispatchEvent(new Event('srl:vault-unlocked'))
    await flushPromises()
    expect(runtime.acknowledgeHandoff).toHaveBeenCalledTimes(2)
    expect(runtime.acknowledgeHandoff.mock.calls.at(-1)![2]).toBe('saved')
    expect(runtime.listInboxJobs).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('does not acknowledge a failed save or a message missing from the saved readback', async () => {
    runtime.receiveHandoff.mockResolvedValue(await delivery())
    runtime.saveDiscordCapture.mockRejectedValueOnce(new Error('save failed'))
    const failed = mount(DiscordSourceHandoffIntake, { global: { stubs: { Teleport: true } } })
    await flushPromises()
    expect(runtime.acknowledgeHandoff).not.toHaveBeenCalled()
    expect(failed.text()).toContain('save failed')
    failed.unmount()
    const saved = await runtime.saveDiscordCapture()
    runtime.saveDiscordCapture.mockResolvedValueOnce({ ...saved, messages: [] })
    const missing = mount(DiscordSourceHandoffIntake, { global: { stubs: { Teleport: true } } })
    await flushPromises()
    expect(runtime.acknowledgeHandoff).not.toHaveBeenCalled()
    expect(missing.text()).toContain('读回校验未完成')
    missing.unmount()
  })

  it('retries a failed acknowledgement through an idempotent save without opening the manual binding prompt again', async () => {
    runtime.receiveHandoff.mockResolvedValue(await delivery())
    runtime.acknowledgeHandoff.mockRejectedValueOnce(new Error('ack failed'))
    const wrapper = mount(DiscordSourceHandoffIntake, { global: { stubs: { Teleport: true } } })
    await flushPromises()
    expect(wrapper.text()).toContain('正文已保存在本机')
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '稍后整理')!
      .trigger('click')
    requestNative('handoff-token')
    await flushPromises()
    expect(runtime.saveDiscordCapture).toHaveBeenCalledTimes(2)
    expect(runtime.acknowledgeHandoff).toHaveBeenCalledTimes(2)
    expect(wrapper.text()).not.toContain('保存 Discord 来源')
    expect(runtime.localize).toHaveBeenCalledOnce()
    wrapper.unmount()
  })

  it('merges the same handoff from two entrances and queues a different handoff while receiving', async () => {
    const envelope = await delivery()
    let resolve!: (value: typeof envelope) => void
    runtime.receiveHandoff.mockReturnValueOnce(
      new Promise<typeof envelope>((done) => {
        resolve = done
      }),
    )
    const wrapper = mount(DiscordSourceHandoffIntake, { global: { stubs: { Teleport: true } } })
    await flushPromises()
    requestNative('handoff-token')
    requestNative('second-token')
    await flushPromises()
    expect(runtime.receiveHandoff).toHaveBeenCalledOnce()
    resolve(envelope)
    await flushPromises()
    expect(runtime.receiveHandoff).toHaveBeenCalledTimes(2)
    expect(runtime.saveDiscordCapture).toHaveBeenCalledTimes(2)
    wrapper.unmount()
  })

  it('saves cloud jobs quietly, marking unbound posts for centralized binding and bound posts as saved', async () => {
    configureInbox()
    runtime.listInboxJobs.mockResolvedValueOnce({
      jobs: [
        { id: 'job-1', state: 'pending', createdAt: 1 },
        { id: 'job-2', state: 'pending', createdAt: 2 },
      ],
      recent: [],
      hasMore: false,
    })
    runtime.getSourceUsage
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ resourceId: 'resource-1' }])
    const progress = vi.fn()
    window.addEventListener('srl:discord-inbox-updated', progress)
    const wrapper = mount(DiscordSourceHandoffIntake, { global: { stubs: { Teleport: true } } })
    await flushPromises()
    expect(runtime.acknowledgeInboxJob).toHaveBeenNthCalledWith(1, 'job-1', 'waiting_binding', {
      workerUrl: 'https://worker.example',
      libraryId: 'library-1',
    })
    expect(runtime.acknowledgeInboxJob).toHaveBeenNthCalledWith(2, 'job-2', 'saved', {
      workerUrl: 'https://worker.example',
      libraryId: 'library-1',
    })
    expect(
      runtime.notifyInboxResult.mock.calls.map(([result]) => [
        result.kind,
        result.id,
        result.state,
      ]),
    ).toEqual([
      ['post', 'job-1', 'waiting_binding'],
      ['post', 'job-2', 'saved'],
    ])
    expect(runtime.notifyInboxResult.mock.calls.every(([result]) => Boolean(result.name))).toBe(
      true,
    )
    expect(runtime.listResources).not.toHaveBeenCalled()
    expect(wrapper.text()).not.toContain('保存 Discord 来源')
    expect(progress.mock.calls.at(-1)![0].detail).toEqual({
      status: 'ready',
      busy: false,
      received: 2,
      waitingBinding: 1,
      error: undefined,
    })
    window.removeEventListener('srl:discord-inbox-updated', progress)
    wrapper.unmount()
  })

  it('does not contact the inbox while Vault is locked and resumes on its existing unlock event', async () => {
    configureInbox()
    runtime.vaultStatus.mockReturnValue({ enabled: true, locked: true })
    runtime.listInboxJobs.mockResolvedValueOnce({
      jobs: [{ id: 'job-1', state: 'pending', createdAt: 1 }],
      recent: [],
      hasMore: false,
    })
    const wrapper = mount(DiscordSourceHandoffIntake, { global: { stubs: { Teleport: true } } })
    await flushPromises()
    expect(runtime.listInboxJobs).not.toHaveBeenCalled()
    expect(runtime.receiveInboxJob).not.toHaveBeenCalled()
    runtime.vaultStatus.mockReturnValue({ enabled: true, locked: false })
    window.dispatchEvent(new Event('srl:vault-unlocked'))
    await flushPromises()
    expect(runtime.receiveInboxJob).toHaveBeenCalledWith('job-1')
    expect(runtime.acknowledgeInboxJob).toHaveBeenCalledWith('job-1', 'waiting_binding', {
      workerUrl: 'https://worker.example',
      libraryId: 'library-1',
    })
    wrapper.unmount()
  })

  it.each(['body', 'binding'] as const)(
    'stops %s acknowledgement if Vault locks during local readback',
    async (kind) => {
      configureInbox()
      if (kind === 'body') {
        runtime.listInboxJobs.mockResolvedValueOnce({
          jobs: [{ id: 'job-1', state: 'pending', createdAt: 1 }],
          recent: [],
          hasMore: false,
        })
        runtime.getSourceUsage.mockImplementationOnce(async () => {
          runtime.vaultStatus.mockReturnValue({ enabled: true, locked: true })
          return []
        })
      } else {
        runtime.listWaitingSources.mockResolvedValueOnce({
          sourceKeyHashes: ['f'.repeat(64)],
          nextCursor: null,
        })
        runtime.sourceUsageByHash.mockImplementationOnce(async () => {
          runtime.vaultStatus.mockReturnValue({ enabled: true, locked: true })
          return [{ resourceId: 'resource-1' }]
        })
      }
      const progress = vi.fn()
      window.addEventListener('srl:discord-inbox-updated', progress)
      const wrapper = mount(DiscordSourceHandoffIntake, { global: { stubs: { Teleport: true } } })
      await flushPromises()
      expect(runtime.acknowledgeInboxJob).not.toHaveBeenCalled()
      expect(runtime.acknowledgeSourceBound).not.toHaveBeenCalled()
      expect(progress.mock.calls.at(-1)![0].detail.status).toBe('locked')
      window.removeEventListener('srl:discord-inbox-updated', progress)
      wrapper.unmount()
    },
  )

  it('keeps cloud jobs unacknowledged after a save failure and refuses another library target', async () => {
    configureInbox()
    const listing = {
      jobs: [{ id: 'job-1', state: 'pending', createdAt: 1 }],
      recent: [],
      hasMore: false,
    }
    runtime.listInboxJobs.mockResolvedValue(listing)
    runtime.saveDiscordCapture.mockRejectedValueOnce(
      new Error('private source text must not enter progress'),
    )
    const progress = vi.fn()
    window.addEventListener('srl:discord-inbox-updated', progress)
    const wrapper = mount(DiscordSourceHandoffIntake, { global: { stubs: { Teleport: true } } })
    await flushPromises()
    expect(runtime.acknowledgeInboxJob).not.toHaveBeenCalled()
    expect(JSON.stringify(progress.mock.calls.at(-1)![0].detail)).not.toContain(
      'private source text',
    )
    expect(runtime.notifyInboxResult).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'post', id: 'job-1', state: 'failed' }),
    )
    expect(JSON.stringify(runtime.notifyInboxResult.mock.calls)).not.toContain(
      'private source text',
    )
    const envelope = await delivery('job-1')
    runtime.receiveInboxJob.mockResolvedValue({
      ...envelope,
      delivery: { ...envelope.delivery, libraryId: 'another-library' },
    })
    window.dispatchEvent(new Event('srl:receive-discord-inbox'))
    await flushPromises()
    expect(runtime.saveDiscordCapture).toHaveBeenCalledOnce()
    expect(runtime.acknowledgeInboxJob).not.toHaveBeenCalled()
    expect(progress.mock.calls.at(-1)![0].detail.error).toContain('收件目标')
    window.removeEventListener('srl:discord-inbox-updated', progress)
    wrapper.unmount()
  })

  it('retries cloud acknowledgements in the same session and survives a receiver remount', async () => {
    configureInbox()
    runtime.listInboxJobs.mockResolvedValue({
      jobs: [{ id: 'job-1', state: 'pending', createdAt: 1 }],
      recent: [],
      hasMore: false,
    })
    runtime.acknowledgeInboxJob.mockRejectedValueOnce(new Error('offline'))
    const wrapper = mount(DiscordSourceHandoffIntake, { global: { stubs: { Teleport: true } } })
    await flushPromises()
    window.dispatchEvent(new Event('srl:receive-discord-inbox'))
    await flushPromises()
    expect(runtime.saveDiscordCapture).toHaveBeenCalledTimes(2)
    expect(runtime.receiveInboxJob).toHaveBeenCalledTimes(2)
    expect(runtime.acknowledgeInboxJob).toHaveBeenCalledTimes(2)
    expect(runtime.notifyInboxResult.mock.calls.some(([result]) => result.state === 'failed')).toBe(
      false,
    )
    wrapper.unmount()
    const reopened = mount(DiscordSourceHandoffIntake, { global: { stubs: { Teleport: true } } })
    await flushPromises()
    expect(runtime.saveDiscordCapture).toHaveBeenCalledTimes(3)
    expect(runtime.saveDiscordCapture.mock.calls[2]![0]?.messageId).toBe('job-1')
    expect(runtime.acknowledgeInboxJob).toHaveBeenCalledTimes(3)
    expect(reopened.text()).not.toContain('保存 Discord 来源')
    reopened.unmount()
  })

  it('caps one receive pass at 100 jobs without a polling timer', async () => {
    configureInbox()
    let batch = 0
    runtime.listInboxJobs.mockImplementation(async () => ({
      jobs: Array.from({ length: 20 }, (_, index) => ({
        id: `job-${batch * 20 + index}`,
        state: 'pending',
        createdAt: index,
      })),
      recent: [],
      hasMore: (++batch, true),
    }))
    const wrapper = mount(DiscordSourceHandoffIntake, { global: { stubs: { Teleport: true } } })
    await flushPromises()
    expect(runtime.listInboxJobs).toHaveBeenCalledTimes(5)
    expect(runtime.receiveInboxJob).toHaveBeenCalledTimes(100)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(runtime.listInboxJobs).toHaveBeenCalledTimes(5)
    wrapper.unmount()
  })

  it('updates a waiting cloud receipt after the pending source is bound without resaving its body', async () => {
    configureInbox()
    runtime.listWaitingSources.mockResolvedValue({
      sourceKeyHashes: ['a'.repeat(64)],
      nextCursor: null,
    })
    runtime.sourceUsageByHash.mockResolvedValue([{ resourceId: 'resource-1' }])
    const wrapper = mount(DiscordSourceHandoffIntake, { global: { stubs: { Teleport: true } } })
    await flushPromises()
    expect(runtime.acknowledgeSourceBound).toHaveBeenCalledWith('a'.repeat(64), {
      workerUrl: 'https://worker.example',
      libraryId: 'library-1',
    })
    expect(runtime.saveDiscordCapture).not.toHaveBeenCalled()
    expect(runtime.localize).not.toHaveBeenCalled()
    window.dispatchEvent(new Event('srl:community-sources-changed'))
    await flushPromises()
    expect(runtime.listInboxJobs).toHaveBeenCalledTimes(2)
    wrapper.unmount()
  })

  it('isolates failed acknowledgement receipts when another library reuses the same delivery ID', async () => {
    configureInbox()
    runtime.listInboxJobs.mockResolvedValue({
      jobs: [{ id: 'job-1', state: 'pending', createdAt: 1 }],
      recent: [],
      hasMore: false,
    })
    runtime.acknowledgeInboxJob.mockRejectedValueOnce(new Error('offline'))
    const wrapper = mount(DiscordSourceHandoffIntake, { global: { stubs: { Teleport: true } } })
    await flushPromises()
    runtime.settings.mockReturnValue({
      workerBaseUrl: 'https://worker.example',
      inboxLibraryId: 'library-2',
      inboxSecret: 'new-secret',
    })
    const envelope = await delivery('job-1')
    runtime.receiveInboxJob.mockResolvedValue({
      ...envelope,
      capture: { ...envelope.capture, content: '另一份正文' },
      delivery: { ...envelope.delivery, libraryId: 'library-2' },
    })
    window.dispatchEvent(new Event('srl:receive-discord-inbox'))
    await flushPromises()
    expect(runtime.saveDiscordCapture).toHaveBeenCalledTimes(2)
    expect(runtime.saveDiscordCapture.mock.calls[1]![0]).toMatchObject({ content: '另一份正文' })
    expect(runtime.acknowledgeInboxJob).toHaveBeenCalledTimes(2)
    wrapper.unmount()
  })

  it('does not acknowledge through a different connection when pairing changes during a save', async () => {
    configureInbox()
    runtime.listInboxJobs.mockResolvedValue({
      jobs: [{ id: 'job-1', state: 'pending', createdAt: 1 }],
      recent: [],
      hasMore: false,
    })
    runtime.getSourceUsage.mockImplementationOnce(async () => {
      runtime.settings.mockReturnValue({
        workerBaseUrl: 'https://other-worker.example',
        inboxLibraryId: 'library-1',
        inboxSecret: 'new-secret',
      })
      return []
    })
    const wrapper = mount(DiscordSourceHandoffIntake, { global: { stubs: { Teleport: true } } })
    await flushPromises()
    expect(runtime.acknowledgeInboxJob).not.toHaveBeenCalled()
    configureInbox()
    window.dispatchEvent(new Event('srl:receive-discord-inbox'))
    await flushPromises()
    expect(runtime.saveDiscordCapture).toHaveBeenCalledTimes(2)
    expect(runtime.acknowledgeInboxJob).toHaveBeenCalledOnce()
    wrapper.unmount()
  })

  it('saves the entire body batch before serial background attachment localization can block', async () => {
    configureInbox()
    runtime.listInboxJobs.mockResolvedValueOnce({
      jobs: [
        { id: 'job-1', state: 'pending', createdAt: 1 },
        { id: 'job-2', state: 'pending', createdAt: 2 },
      ],
      recent: [],
      hasMore: false,
    })
    let resolve!: () => void
    runtime.localize.mockImplementationOnce(
      () =>
        new Promise<void>((done) => {
          resolve = done
        }),
    )
    const wrapper = mount(DiscordSourceHandoffIntake, { global: { stubs: { Teleport: true } } })
    await flushPromises()
    expect(runtime.saveDiscordCapture).toHaveBeenCalledTimes(2)
    expect(runtime.acknowledgeInboxJob).toHaveBeenCalledTimes(2)
    expect(runtime.localize).toHaveBeenCalledOnce()
    resolve()
    await flushPromises()
    expect(runtime.localize).toHaveBeenCalledTimes(2)
    wrapper.unmount()
  })

  it('continues waiting-source pagination beyond 100 and acknowledges a bound event outside recent receipts', async () => {
    configureInbox()
    runtime.listWaitingSources.mockImplementation(async (after?: string) => {
      const start = after ? Number.parseInt(after, 16) + 1 : 0
      const sourceKeyHashes = Array.from({ length: Math.min(20, 130 - start) }, (_, index) =>
        (start + index).toString(16).padStart(64, '0'),
      )
      return { sourceKeyHashes, nextCursor: start + 20 < 130 ? sourceKeyHashes.at(-1)! : null }
    })
    const wrapper = mount(DiscordSourceHandoffIntake, { global: { stubs: { Teleport: true } } })
    await flushPromises()
    expect(runtime.listWaitingSources).toHaveBeenCalledTimes(5)
    expect(runtime.sourceUsageByHash).toHaveBeenCalledTimes(100)
    window.dispatchEvent(new Event('srl:receive-discord-inbox'))
    await flushPromises()
    expect(runtime.listWaitingSources).toHaveBeenCalledTimes(7)
    expect(runtime.sourceUsageByHash).toHaveBeenCalledTimes(130)
    runtime.sourceUsageByHash.mockResolvedValue([{ resourceId: 'bound-resource' }])
    window.dispatchEvent(
      new CustomEvent('srl:community-source-bound', { detail: { sourceKeyHash: 'f'.repeat(64) } }),
    )
    await flushPromises()
    expect(runtime.acknowledgeSourceBound).toHaveBeenCalledWith('f'.repeat(64), {
      workerUrl: 'https://worker.example',
      libraryId: 'library-1',
    })
    expect(runtime.saveDiscordCapture).not.toHaveBeenCalled()
    expect(runtime.receiveInboxJob).not.toHaveBeenCalled()
    wrapper.unmount()
  })
})
