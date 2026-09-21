/** @vitest-environment jsdom */
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ResourceSummary } from '../types/Resource'

const BASE_TIME = 1_700_000_000_000

function summary(overrides: Partial<ResourceSummary>): ResourceSummary {
  return {
    id: 'resource',
    type: 'characterCard',
    name: '测试角色卡',
    description: '',
    fileName: 'card.png',
    mimeType: 'image/png',
    fileSize: 10,
    contentHash: 'same-file',
    favorite: false,
    categoryId: null,
    categoryIds: [],
    relatedResourceIds: [],
    tags: [],
    metadata: { cardContentHash: 'same-card' },
    createdAt: BASE_TIME,
    updatedAt: BASE_TIME,
    ...overrides,
  } as ResourceSummary
}

const current = summary({ id: 'current', versionCount: 2, updatedAt: BASE_TIME + 1 })
const duplicate = summary({
  id: 'history-duplicate',
  type: 'other',
  versionGroupId: current.id,
  updatedAt: BASE_TIME,
})

const resourceApi = {
  backfillCardFingerprints: vi.fn(async () => 0),
  listSummaries: vi.fn(async () => [current]),
  listVersionSummaries: vi.fn(async () => [duplicate]),
  list: vi.fn(async () => []),
  deleteVersion: vi.fn(async () => undefined),
  deleteVersions: vi.fn(async (_resourceId: string, versionIds: string[]) => versionIds.length),
}
const categoryApi = { list: vi.fn(async () => []) }
const historyApi = { capture: vi.fn(async () => undefined) }
const confirmApi = vi.fn(async (_options: unknown) => true)

vi.mock('../core/AppContainer', () => ({
  get resourceService() {
    return resourceApi
  },
  get categoryService() {
    return categoryApi
  },
  get historyService() {
    return historyApi
  },
}))
vi.mock('../composables/UseConfirmDialog', () => ({
  confirmAction: (options: unknown) => confirmApi(options),
}))

import VersionRecognitionPanel from './VersionRecognitionPanel.vue'

describe('VersionRecognitionPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resourceApi.listSummaries.mockResolvedValue([current])
    resourceApi.listVersionSummaries.mockResolvedValue([duplicate])
    confirmApi.mockResolvedValue(true)
  })

  it('没有跨资源候选时仍显示并默认选中同一时间线的安全清理项', async () => {
    const wrapper = mount(VersionRecognitionPanel, { props: { resources: [current] } })
    await flushPromises()

    expect(wrapper.find('.version-recognition__duplicates').exists()).toBe(true)
    expect(wrapper.get('.version-recognition').classes()).toContain('has-historical-duplicates')
    expect(wrapper.get('.version-recognition__duplicates').attributes('open')).toBeDefined()
    expect(wrapper.text()).toContain('1 个可安全删除')
    expect(wrapper.text()).toContain('已选 1 组，共 1 个历史副本')
    expect(wrapper.text()).toContain('清理所选重复项')
    expect(wrapper.text()).toContain('没有新的跨资源合并候选')
    expect(wrapper.text()).not.toContain('没有发现可安全自动整理的版本组')
  })

  it('清理按钮先创建快照，再删除选中的历史副本并重新扫描', async () => {
    resourceApi.listVersionSummaries.mockResolvedValueOnce([duplicate]).mockResolvedValueOnce([])
    const wrapper = mount(VersionRecognitionPanel, { props: { resources: [current] } })
    await flushPromises()

    await wrapper
      .findAll('button')
      .find((button) => button.text() === '清理所选重复项')!
      .trigger('click')
    await flushPromises()

    expect(historyApi.capture).toHaveBeenCalledTimes(1)
    expect(resourceApi.deleteVersions).toHaveBeenCalledWith(current.id, [duplicate.id])
    expect(historyApi.capture.mock.invocationCallOrder[0]).toBeLessThan(
      resourceApi.deleteVersions.mock.invocationCallOrder[0],
    )
    expect(wrapper.text()).toContain('清理完成：已删除 1 个重复历史版本')
    expect(wrapper.emitted('library-changed')).toBeTruthy()
  })

  it('重新扫描会先回填新版指纹并重读当前与历史摘要', async () => {
    const staleCurrent = summary({
      id: current.id,
      contentHash: 'stale-file',
      metadata: { cardContentHash: 'stale-card' },
    })
    resourceApi.listVersionSummaries.mockResolvedValueOnce([]).mockResolvedValueOnce([duplicate])
    const wrapper = mount(VersionRecognitionPanel, { props: { resources: [staleCurrent] } })
    await flushPromises()

    expect(wrapper.find('.version-recognition__duplicates').exists()).toBe(false)
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '重新扫描')!
      .trigger('click')
    await flushPromises()

    expect(resourceApi.backfillCardFingerprints).toHaveBeenCalledTimes(2)
    expect(resourceApi.listSummaries).toHaveBeenCalledTimes(2)
    expect(resourceApi.listVersionSummaries).toHaveBeenCalledTimes(2)
    expect(wrapper.find('.version-recognition__duplicates').exists()).toBe(true)
    expect(wrapper.text()).toContain('1 个可安全删除')
  })
})
