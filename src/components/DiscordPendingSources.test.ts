/** @vitest-environment jsdom */
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, expect, it, vi } from 'vitest'
const runtime = vi.hoisted(() => ({
  bind: vi.fn(async () => undefined),
  list: vi.fn(),
  pending: vi.fn(),
  repair: vi.fn(async () => 0),
}))
vi.mock('../core/AppContainer', () => ({
  resourceService: { listResourceListSummaries: runtime.list },
}))
vi.mock('../core/CommunitySourceRuntime', () => ({
  communitySourceService: {
    listPendingSources: runtime.pending,
    bindSource: runtime.bind,
    repairInvalidResourceBindings: runtime.repair,
  },
}))
import DiscordPendingSources from './DiscordPendingSources.vue'
import { RESOURCE_GALLERY_ASSET_KIND } from '../types/ResourceGallery'
const pendingSource = {
  source: {
    id: 'source-1',
    title: '待绑定来源',
    updatedAt: 1,
    canonicalUrl: 'https://discord.com/channels/example',
  },
  messages: [],
}
beforeEach(() => {
  vi.clearAllMocks()
  runtime.list.mockResolvedValue([])
  runtime.pending.mockResolvedValue([pendingSource])
  runtime.repair.mockResolvedValue(0)
})
it('updates binding candidates after a committed library refresh without rereading sources', async () => {
  const wrapper = mount(DiscordPendingSources)
  try {
    await flushPromises()
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '选择其他资源')!
      .trigger('click')
    expect(wrapper.findAll('[role="option"]')).toHaveLength(0)
    window.dispatchEvent(
      new CustomEvent('srl:library-resources-changed', {
        detail: [
          {
            id: 'new-card',
            name: '刚导入的角色卡',
            fileName: 'card.json',
            tags: [],
            type: 'characterCard',
            metadata: {},
          },
        ],
      }),
    )
    await flushPromises()
    expect(wrapper.get('[role="option"]').text()).toContain('刚导入的角色卡')
    expect(runtime.list).toHaveBeenCalledTimes(1)
    expect(runtime.pending).toHaveBeenCalledTimes(1)
    wrapper.unmount()
    window.dispatchEvent(new CustomEvent('srl:library-resources-changed', { detail: [] }))
  } finally {
    if (wrapper.exists()) wrapper.unmount()
  }
})
it('late initial reads cannot replace a newer accepted resource list', async () => {
  let finish!: (value: unknown[]) => void
  runtime.list.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)))
  const wrapper = mount(DiscordPendingSources)
  const resource = {
    id: 'new-card',
    name: '新资源',
    fileName: 'card.json',
    tags: [],
    type: 'characterCard',
    metadata: {},
  }
  try {
    window.dispatchEvent(new CustomEvent('srl:library-resources-changed', { detail: [resource] }))
    finish([])
    await flushPromises()
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '选择其他资源')!
      .trigger('click')
    expect(wrapper.get('[role="option"]').text()).toContain('新资源')
  } finally {
    wrapper.unmount()
  }
})

it('coalesces source changes that arrive during an in-flight load', async () => {
  let finish!: (value: unknown[]) => void
  runtime.pending.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)))
  const wrapper = mount(DiscordPendingSources)
  try {
    await flushPromises()
    window.dispatchEvent(new Event('srl:community-sources-changed'))
    window.dispatchEvent(new Event('srl:community-sources-changed'))
    runtime.pending.mockResolvedValue([
      { ...pendingSource, source: { ...pendingSource.source, title: '新来源' } },
    ])
    finish([])
    await flushPromises()
    expect(runtime.pending).toHaveBeenCalledTimes(2)
    expect(wrapper.text()).toContain('新来源')
  } finally {
    wrapper.unmount()
  }
})
it.each(['local', 'url'])(
  'excludes %s gallery attachments from selection and current-resource binding',
  async (storage) => {
    const ordinary = {
      id: 'card-png',
      name: 'PNG角色卡',
      fileName: 'card.png',
      tags: [],
      type: 'characterCard',
      metadata: {},
    }
    runtime.list.mockResolvedValue([
      ordinary,
      { ...ordinary, id: 'ordinary-image', name: '普通图片资源', type: 'other' },
      {
        ...ordinary,
        id: 'gallery-image',
        name: '图库附件',
        type: 'other',
        metadata: {
          assetKind: RESOURCE_GALLERY_ASSET_KIND,
          galleryOwnerId: ordinary.id,
          galleryStorage: storage,
        },
      },
    ])
    const wrapper = mount(DiscordPendingSources, { props: { contextResourceId: 'gallery-image' } })
    try {
      await flushPromises()
      expect(wrapper.findAll('button').some((button) => button.text() === '关联当前资源')).toBe(
        false,
      )
      await wrapper
        .findAll('button')
        .find((button) => button.text() === '选择其他资源')!
        .trigger('click')
      const picker = wrapper.get('.resource-picker')
      expect(picker.findAll('[role="option"]').map((option) => option.text())).toEqual([
        expect.stringContaining('PNG角色卡'),
        expect.stringContaining('普通图片资源'),
      ])
      await picker.get('input[type="search"]').setValue('图库附件')
      expect(picker.findAll('[role="option"]')).toHaveLength(0)
      await picker.get('input[type="search"]').setValue('PNG角色卡')
      await picker.get('[role="option"]').trigger('click')
      await wrapper
        .findAll('button')
        .find((button) => button.text() === '关联所选资源')!
        .trigger('click')
      await flushPromises()
      expect(runtime.bind).toHaveBeenCalledWith('card-png', 'source-1')
    } finally {
      wrapper.unmount()
    }
  },
)
it('repairs old gallery bindings before loading pending sources and shows the recovered post', async () => {
  runtime.repair.mockResolvedValueOnce(1)
  const wrapper = mount(DiscordPendingSources, { props: { hideWhenEmpty: true } })
  try {
    await flushPromises()
    expect(runtime.repair).toHaveBeenCalledWith([])
    expect(runtime.repair.mock.invocationCallOrder[0]).toBeLessThan(
      runtime.pending.mock.invocationCallOrder[0]!,
    )
    expect(wrapper.text()).toContain('已解除 1 条无效关联')
    expect(wrapper.get('.discord-pending__item').text()).toContain('待绑定来源')
  } finally {
    wrapper.unmount()
  }
})
it('hides an empty inbox section but keeps loading errors and arriving sources visible', async () => {
  runtime.pending.mockResolvedValue([])
  const wrapper = mount(DiscordPendingSources, { props: { hideWhenEmpty: true } })
  try {
    await flushPromises()
    expect(wrapper.find('.discord-pending').exists()).toBe(false)
    runtime.pending.mockRejectedValueOnce(new Error('无法读取本机来源'))
    window.dispatchEvent(new Event('srl:community-sources-changed'))
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toBe('无法读取本机来源')
    runtime.pending.mockResolvedValue([pendingSource])
    window.dispatchEvent(new Event('srl:community-sources-changed'))
    await flushPromises()
    expect(wrapper.get('.discord-pending__item').text()).toContain('待绑定来源')
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
  } finally {
    wrapper.unmount()
  }
})
it('clears a selected resource when a refresh identifies it as a gallery attachment', async () => {
  const ordinary = {
    id: 'resource-1',
    name: '原候选资源',
    fileName: 'card.png',
    tags: [],
    type: 'characterCard',
    metadata: {},
  }
  runtime.list.mockResolvedValue([ordinary])
  const wrapper = mount(DiscordPendingSources)
  try {
    await flushPromises()
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '选择其他资源')!
      .trigger('click')
    await wrapper.get('[role="option"]').trigger('click')
    const bindButton = wrapper.findAll('button').find((button) => button.text() === '关联所选资源')!
    expect(bindButton.attributes('disabled')).toBeUndefined()
    runtime.list.mockResolvedValue([
      { ...ordinary, metadata: { assetKind: RESOURCE_GALLERY_ASSET_KIND } },
    ])
    window.dispatchEvent(new Event('srl:community-sources-changed'))
    await flushPromises()
    expect(wrapper.findAll('[role="option"]')).toHaveLength(0)
    expect(bindButton.attributes('disabled')).toBeDefined()
    expect(runtime.bind).not.toHaveBeenCalled()
  } finally {
    wrapper.unmount()
  }
})
it('can select and bind a resource beyond the old first twelve choices among 5000 summaries', async () => {
  runtime.list.mockResolvedValue(
    Array.from({ length: 5000 }, (_, index) => ({
      id: `card-${index}`,
      name: `角色 ${index}`,
      fileName: `file-${index}.json`,
      tags: [],
      type: 'characterCard',
      metadata: {},
    })),
  )
  const wrapper = mount(DiscordPendingSources)
  await flushPromises()
  await wrapper
    .findAll('button')
    .find((button) => button.text() === '选择其他资源')!
    .trigger('click')
  const picker = wrapper.get('.resource-picker')
  expect(picker.findAll('[role="option"]')).toHaveLength(30)
  await picker.findAll('nav button')[1]!.trigger('click')
  expect(picker.get('nav').text()).toContain('2 / 167')
  await picker.get('[role="option"]').trigger('click')
  await picker.get('input[type="search"]').setValue('file-4999.json')
  await picker.get('[role="option"]').trigger('click')
  await picker.get('input[type="search"]').setValue('无匹配')
  expect(picker.text()).toContain('已选：角色 4999')
  await wrapper
    .findAll('button')
    .find((button) => button.text() === '关联所选资源')!
    .trigger('click')
  await flushPromises()
  expect(runtime.bind).toHaveBeenCalledWith('card-4999', 'source-1')
  wrapper.unmount()
})
