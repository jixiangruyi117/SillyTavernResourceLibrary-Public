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

const current = summary({ id: 'current', versionCount: 3, updatedAt: BASE_TIME + 1 })
const archived = summary({
  id: 'history-archived',
  type: 'other',
  fileName: 'card-v2.png',
  versionGroupId: current.id,
  versionLabel: '第二版',
  versionImportedAt: BASE_TIME,
})
const otherArchived = summary({
  id: 'history-other',
  type: 'other',
  fileName: 'card-v1.png',
  contentHash: 'older-file',
  versionGroupId: current.id,
  versionLabel: '第一版',
  versionImportedAt: BASE_TIME - 1,
})
const orphanArchived = summary({
  id: 'history-orphan',
  name: '未关联的历史记录',
  fileName: 'orphan.json',
  versionGroupId: 'missing-current-resource',
})

const resourceApi = {
  backfillCardFingerprints: vi.fn(async () => 0),
  listSummaries: vi.fn(async () => [current]),
  listVersionSummaries: vi.fn(async () => [archived]),
  list: vi.fn(async () => []),
  deleteVersions: vi.fn(async (_resourceId: string, versionIds: string[]) => versionIds.length),
  mergeExistingResourceAsVersion: vi.fn(async () => current),
}
const categoryApi = { list: vi.fn(async () => []) }
const historyApi = { capture: vi.fn(async () => undefined) }
const confirmApi = vi.fn(async (_options: unknown) => true)
const chooseApi = vi.fn(async (_options: unknown) => 'confirm')

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
  chooseAction: (options: unknown) => chooseApi(options),
}))

import VersionRecognitionPanel from './VersionRecognitionPanel.vue'

describe('VersionRecognitionPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resourceApi.listSummaries.mockResolvedValue([current])
    resourceApi.listVersionSummaries.mockResolvedValue([archived])
    confirmApi.mockResolvedValue(true)
    chooseApi.mockResolvedValue('confirm')
  })

  it('直接从资源时间线读取已存历史项，不依赖跨资源合并候选', async () => {
    resourceApi.listVersionSummaries.mockResolvedValueOnce([archived, orphanArchived])
    const wrapper = mount(VersionRecognitionPanel, { props: { resources: [current] } })
    await flushPromises()

    expect(wrapper.get('.version-recognition__workflow-pane').text()).toContain(
      '当前版本 · 不会删除',
    )
    expect(wrapper.text()).toContain('第二版')
    expect(wrapper.text()).toContain('card-v2.png')
    expect(wrapper.text()).toContain('1 / 2')
    expect(wrapper.text()).toContain('1 个历史记录未关联当前资源，暂不列入清理候选')
    expect(wrapper.text()).toContain('1 项')
    expect(wrapper.text()).toContain('已选 0 / 1 个历史版本')
    expect(wrapper.find('.version-recognition__groups').exists()).toBe(false)
    expect((wrapper.get('input[type="checkbox"]').element as HTMLInputElement).checked).toBe(false)
  })

  it('删除历史项时只在用户选择后创建快照，当前版本保留', async () => {
    resourceApi.listVersionSummaries
      .mockResolvedValueOnce([archived, otherArchived])
      .mockResolvedValueOnce([otherArchived])
    const wrapper = mount(VersionRecognitionPanel, { props: { resources: [current] } })
    await flushPromises()

    const selectedCheckbox = wrapper
      .findAll('label')
      .find((label) => label.text().includes('card-v2.png'))!
      .get('input[type="checkbox"]')
    await selectedCheckbox.setValue(true)
    const deleteButton = wrapper
      .findAll('button')
      .find((button) => button.text() === '删除选中的历史版本')!
    await deleteButton.trigger('click')
    await flushPromises()

    expect(historyApi.capture).toHaveBeenCalledTimes(1)
    expect(resourceApi.deleteVersions).toHaveBeenCalledWith(current.id, [archived.id])
    expect(resourceApi.mergeExistingResourceAsVersion).not.toHaveBeenCalled()
    expect(historyApi.capture.mock.invocationCallOrder[0]).toBeLessThan(
      resourceApi.deleteVersions.mock.invocationCallOrder[0],
    )
    expect(wrapper.text()).toContain('清理完成：已从 1 条时间线删除 1 个历史版本；当前版本保留。')
    expect(wrapper.emitted('library-changed')).toBeTruthy()
  })

  it('重新扫描会读取已存历史版本并更新清理候选数量', async () => {
    resourceApi.listVersionSummaries.mockResolvedValueOnce([]).mockResolvedValueOnce([archived])
    const wrapper = mount(VersionRecognitionPanel, { props: { resources: [current] } })
    await flushPromises()

    expect(wrapper.text()).toContain('0 项')
    expect(wrapper.text()).toContain('目前没有已存档的历史版本')
    const scanButton = wrapper.findAll('button').find((button) => button.text() === '重新扫描')!
    await scanButton.trigger('click')
    await flushPromises()

    expect(resourceApi.backfillCardFingerprints).toHaveBeenCalledTimes(2)
    expect(resourceApi.listSummaries).toHaveBeenCalledTimes(2)
    expect(resourceApi.listVersionSummaries).toHaveBeenCalledTimes(2)
    expect(wrapper.text()).toContain('1 项')
    expect(wrapper.text()).toContain('第二版')
  })

  it('并入历史版本只在切换后展示跨资源候选，与历史项清理分开', async () => {
    const newer = summary({
      id: 'newer',
      contentHash: 'new-file',
      metadata: { cardContentHash: 'new-full', cardCoreHash: 'same-core' },
      updatedAt: BASE_TIME + 2,
    })
    const older = summary({
      id: 'older',
      contentHash: 'old-file',
      metadata: { cardContentHash: 'old-full', cardCoreHash: 'same-core' },
      updatedAt: BASE_TIME + 1,
    })
    resourceApi.listSummaries.mockResolvedValue([newer, older])
    resourceApi.listVersionSummaries.mockResolvedValue([])
    const wrapper = mount(VersionRecognitionPanel, { props: { resources: [newer, older] } })
    await flushPromises()

    expect(wrapper.text()).toContain('目前没有已存档的历史版本')
    await wrapper
      .findAll('button')
      .find((button) => button.text().includes('并入历史版本'))!
      .trigger('click')

    expect(wrapper.get('.version-recognition__workflow-pane').text()).toContain('候选 1')
    expect(wrapper.find('.version-recognition__history-list').exists()).toBe(false)
    expect(wrapper.findAll('.version-recognition__workflow-pane')).toHaveLength(1)
  })
})
