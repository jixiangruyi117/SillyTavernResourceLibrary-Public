/** @vitest-environment jsdom */
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { RESOURCE_TYPE, type Category, type ResourceSummary } from '../types/Resource'
import ResourceBundleApp from './ResourceBundleApp.vue'

const { getBundles, setBundles, confirm } = vi.hoisted(() => ({
  getBundles: vi.fn(),
  setBundles: vi.fn(),
  confirm: vi.fn(),
}))

vi.mock('../core/AppContainer', () => ({
  browserStorageService: {
    getChatLoadouts: getBundles,
    setChatLoadouts: setBundles,
  },
}))

vi.mock('../composables/UseConfirmDialog', () => ({ confirmAction: confirm }))

function resource(
  id: string,
  name: string,
  type: ResourceSummary['type'],
  relatedResourceIds: string[] = [],
): ResourceSummary {
  return {
    id,
    name,
    description: '',
    type,
    fileName: `${name}.json`,
    mimeType: 'application/json',
    fileSize: 10,
    contentHash: id,
    favorite: false,
    categoryId: null,
    relatedResourceIds,
    tags: [],
    metadata: {},
    createdAt: 1,
    updatedAt: 1,
  }
}

const resources = [
  resource('character', '北境角色', RESOURCE_TYPE.CHARACTER_CARD),
  resource('world', '北境世界书', RESOURCE_TYPE.WORLD_BOOK),
  resource('preset', '北境预设', RESOURCE_TYPE.PRESET, ['other']),
]
const categories: Category[] = []

describe('ResourceBundleApp', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getBundles.mockReturnValue([])
    setBundles.mockImplementation((value) => value)
    confirm.mockResolvedValue(true)
  })

  it('创建并持久化装载方案，不改写永久资源关联', async () => {
    const wrapper = mount(ResourceBundleApp, { props: { resources, categories } })

    await wrapper.get('.resource-bundle-app__fields input').setValue('北境完整套装')
    await wrapper.get('.resource-bundle-app__fields select').setValue('character')
    await wrapper
      .findAll('.resource-bundle-app__candidates button')
      .find((button) => button.text().includes('北境世界书'))!
      .trigger('click')
    await wrapper.get('.resource-bundle-app__actions button').trigger('click')
    await flushPromises()

    expect(setBundles).toHaveBeenCalledWith([
      expect.objectContaining({
        name: '北境完整套装',
        primaryResourceId: 'character',
        resourceIds: ['world'],
      }),
    ])
    expect(wrapper.text()).toContain('不会改写资源之间的永久关联')
    expect(wrapper.emitted('libraryChanged')).toBeUndefined()
  })

  it('可恢复、发送并删除已保存套装，删除模板不会删除资源', async () => {
    const template = {
      id: 'bundle-1',
      name: '北境完整套装',
      primaryResourceId: 'character',
      resourceIds: ['world', 'preset'],
      createdAt: 1,
      updatedAt: 2,
    }
    getBundles.mockReturnValue([template])
    const wrapper = mount(ResourceBundleApp, { props: { resources, categories } })

    await wrapper.get('.resource-bundle-app__saved article > button').trigger('click')
    await wrapper.get('.resource-bundle-app__actions button:last-child').trigger('click')
    expect(wrapper.emitted('sendToTavern')).toEqual([[['character', 'world', 'preset']]])

    await wrapper.get('button[aria-label="删除套装"]').trigger('click')
    await flushPromises()
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ title: '删除资源套装' }))
    expect(setBundles).toHaveBeenLastCalledWith([])
  })

  it('可隐藏已经关联到其他资源的候选，同时保留已选套装项', async () => {
    const template = {
      id: 'bundle-1',
      name: '北境完整套装',
      primaryResourceId: 'character',
      resourceIds: ['preset'],
      createdAt: 1,
      updatedAt: 2,
    }
    getBundles.mockReturnValue([template])
    const wrapper = mount(ResourceBundleApp, { props: { resources, categories } })
    await wrapper.get('.resource-bundle-app__saved article > button').trigger('click')
    await wrapper.get('.resource-bundle-app__bound-filter input').setValue(true)

    const candidateText = wrapper
      .findAll('.resource-bundle-app__candidates button')
      .map((item) => item.text())
    expect(candidateText.some((text) => text.includes('北境预设'))).toBe(true)
  })
})
