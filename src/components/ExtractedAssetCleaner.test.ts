/** @vitest-environment jsdom */
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ResourceSummary } from '../types/Resource'

const BASE_TIME = 1_700_000_000_000

function summary(overrides: Partial<ResourceSummary>): ResourceSummary {
  return {
    id: 'id',
    type: 'worldBook',
    name: '资源',
    description: '',
    fileName: 'file.json',
    mimeType: 'application/json',
    fileSize: 10,
    contentHash: 'hash',
    favorite: false,
    categoryId: null,
    categoryIds: [],
    relatedResourceIds: [],
    tags: [],
    metadata: {},
    createdAt: BASE_TIME,
    updatedAt: BASE_TIME,
    ...overrides,
  } as ResourceSummary
}

const character = summary({
  id: 'card-1',
  type: 'characterCard',
  name: '溯源角色卡',
  metadata: {
    card: { data: { name: 'x', character_book: { entries: [{ uid: 1 }] } } },
  },
})
const freshCopy = summary({
  id: 'copy-fresh',
  name: '干净副本',
  metadata: { extractedFromCharacterId: 'card-1', extractedAssetKind: 'worldBook' },
})
const editedCopy = summary({
  id: 'copy-edited',
  name: '被编辑过的副本',
  metadata: { extractedFromCharacterId: 'card-1', extractedAssetKind: 'worldBook' },
  updatedAt: BASE_TIME + 10 * 60_000,
})

const recycleBinApi = { moveToRecycleBin: vi.fn(async () => undefined) }
const confirmApi = vi.fn(async (_options: unknown) => true)

vi.mock('../core/AppContainer', () => ({
  get recycleBinService() {
    return recycleBinApi
  },
}))
vi.mock('../composables/UseConfirmDialog', () => ({
  confirmAction: (options: unknown) => confirmApi(options),
}))

import ExtractedAssetCleaner from './ExtractedAssetCleaner.vue'

function render(resources: ResourceSummary[]) {
  return mount(ExtractedAssetCleaner, { props: { resources } })
}

describe('ExtractedAssetCleaner', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    confirmApi.mockResolvedValue(true)
  })

  it('空态显示没有可清理的拆分副本', () => {
    const wrapper = render([character])
    expect(wrapper.text()).toContain('没有可清理的拆分副本')
  })

  it('列表显示副本、类型、溯源卡名；可能已修改带徽章且默认不勾选', () => {
    const wrapper = render([character, freshCopy, editedCopy])
    expect(wrapper.text()).toContain('共 2 项，已选 1 项')
    const rows = wrapper.findAll('.extracted-cleaner__list li')
    const freshRow = rows.find((row) => row.text().includes('干净副本'))!
    const editedRow = rows.find((row) => row.text().includes('被编辑过的副本'))!
    expect(freshRow.text()).toContain('溯源角色卡')
    expect((freshRow.find('input').element as HTMLInputElement).checked).toBe(true)
    expect(editedRow.text()).toContain('可能已修改')
    expect((editedRow.find('input').element as HTMLInputElement).checked).toBe(false)
  })

  it('全选与反选更新计数', async () => {
    const wrapper = render([character, freshCopy, editedCopy])
    await wrapper
      .findAll('.extracted-cleaner__toolbar button')
      .find((button) => button.text() === '全选')!
      .trigger('click')
    expect(wrapper.text()).toContain('已选 2 项')
    await wrapper
      .findAll('.extracted-cleaner__toolbar button')
      .find((button) => button.text() === '反选')!
      .trigger('click')
    expect(wrapper.text()).toContain('已选 0 项')
  })

  it('清理只删除选中的副本：先快照、再删除、后通知刷新', async () => {
    const wrapper = render([character, freshCopy, editedCopy])
    await wrapper.find('.duplicate-cleaner__clean').trigger('click')
    await flushPromises()
    expect(confirmApi).toHaveBeenCalledTimes(1)
    expect(recycleBinApi.moveToRecycleBin).toHaveBeenCalledWith(['copy-fresh'])
    expect(wrapper.emitted('library-changed')).toBeTruthy()
    expect(wrapper.text()).toContain('已清理 1 项拆分副本')
  })

  it('确认弹窗取消时不执行删除', async () => {
    confirmApi.mockResolvedValueOnce(false)
    const wrapper = render([character, freshCopy])
    await wrapper.find('.duplicate-cleaner__clean').trigger('click')
    await flushPromises()
    expect(recycleBinApi.moveToRecycleBin).not.toHaveBeenCalled()
    expect(wrapper.emitted('library-changed')).toBeFalsy()
  })

  it('溯源卡缺失或卡内已无内嵌的副本不出现在列表', () => {
    const orphan = summary({
      id: 'orphan',
      name: '孤儿副本',
      metadata: { extractedFromCharacterId: 'gone', extractedAssetKind: 'worldBook' },
    })
    const emptyCard = summary({
      id: 'card-empty',
      type: 'characterCard',
      name: '已无内嵌的卡',
      metadata: { card: { data: { name: 'y' } } },
    })
    const strippedCopy = summary({
      id: 'copy-stripped',
      name: '卡内已无内嵌的副本',
      metadata: { extractedFromCharacterId: 'card-empty', extractedAssetKind: 'worldBook' },
    })
    const wrapper = render([orphan, emptyCard, strippedCopy])
    expect(wrapper.text()).toContain('没有可清理的拆分副本')
  })
})
