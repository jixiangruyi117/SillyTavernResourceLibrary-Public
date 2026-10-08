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
const confirmApi = vi.fn(async (_options: unknown) => true)
const loadVersionRecognitionSnapshot = vi.fn(async () => {
  const [resources, versions] = await Promise.all([
    resourceApi.listSummaries(),
    resourceApi.listVersionSummaries(),
  ])
  return { resources, versions, backfilled: 0 }
})

vi.mock('../core/AppContainer', () => ({
  get resourceService() {
    return { ...resourceApi, loadVersionRecognitionSnapshot }
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
    resourceApi.listVersionSummaries.mockResolvedValue([archived])
    confirmApi.mockResolvedValue(true)
  })

  it('大量历史项只渲染当前页，跨页勾选及全选仍覆盖完整范围', async () => {
    const versions = Array.from({ length: 105 }, (_, index) =>
      summary({
        id: `h${index}`,
        versionGroupId: current.id,
        versionLabel: `版本${index}`,
        fileName: `history-${index}.png`,
        contentHash: `hash-${index}`,
        versionImportedAt: index,
      }),
    )
    resourceApi.listVersionSummaries.mockResolvedValue(versions)
    const wrapper = mount(VersionRecognitionPanel, { props: { resources: [current] } })
    await flushPromises()
    expect(wrapper.findAll('.version-recognition__history-items input')).toHaveLength(40)
    await wrapper.get('.version-recognition__history-items input').setValue(true)
    await wrapper.get('nav[aria-label="历史版本分页"]').findAll('button')[1]!.trigger('click')
    expect(wrapper.findAll('.version-recognition__history-items input')).toHaveLength(40)
    await wrapper.get('.version-recognition__history-items input').setValue(true)
    expect(wrapper.text()).toContain('已选 2 / 105 个历史版本')
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '全选历史版本')!
      .trigger('click')
    expect(wrapper.text()).toContain('已选 105 / 105 个历史版本')
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '删除选中的历史版本')!
      .trigger('click')
    await flushPromises()
    expect(resourceApi.deleteVersions.mock.calls[0]![1]).toHaveLength(105)
    wrapper.unmount()
  })

  it('同名弱候选需人工选择，合并确认明确其依据且支持搜索保留项', async () => {
    const first = summary({
      id: 'same-a',
      name: '同名角色',
      contentHash: 'hash-a',
      fileName: '原版.json',
      metadata: {},
    })
    const second = summary({
      id: 'same-b',
      name: '同名角色',
      contentHash: 'hash-b',
      fileName: '改版.json',
      metadata: {},
    })
    resourceApi.listSummaries.mockResolvedValue([first, second])
    resourceApi.listVersionSummaries.mockResolvedValue([])
    const wrapper = mount(VersionRecognitionPanel, {
      props: { resources: [first, second], sameNameVersionCandidates: true },
    })
    await flushPromises()
    await wrapper
      .findAll('button')
      .find((button) => button.text().includes('并入历史版本'))!
      .trigger('click')
    expect(wrapper.get('.version-recognition__workflow-pane').text()).toContain(
      '仅同名，待人工确认',
    )
    await wrapper.get('input[aria-label="搜索候选组"]').setValue('改版')
    expect(wrapper.findAll('.version-recognition__groups > article')).toHaveLength(1)
    await wrapper.get('.resource-picker input[type="search"]').setValue('原版')
    await wrapper.get('.resource-picker [role="option"]').trigger('click')
    await wrapper
      .get('.version-recognition__groups article > header input[type="checkbox"]')
      .setValue(true)
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '并入所选版本')!
      .trigger('click')
    await flushPromises()
    expect(confirmApi.mock.calls[0]?.[0]).toMatchObject({
      message: expect.stringContaining('包含仅同名的候选组'),
    })
    expect(resourceApi.mergeExistingResourceAsVersion).toHaveBeenCalledWith(
      first.id,
      second.id,
      expect.any(String),
    )
    wrapper.unmount()
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

  it('确认后删除所选历史项，当前版本保留', async () => {
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

    expect(confirmApi).toHaveBeenCalledWith(
      expect.objectContaining({ title: '删除已存历史版本', danger: true }),
    )
    expect(resourceApi.deleteVersions).toHaveBeenCalledWith(current.id, [archived.id])
    expect(resourceApi.mergeExistingResourceAsVersion).not.toHaveBeenCalled()
    expect(confirmApi.mock.invocationCallOrder[0]).toBeLessThan(
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

    expect(loadVersionRecognitionSnapshot).toHaveBeenCalledTimes(2)
    expect(resourceApi.backfillCardFingerprints).not.toHaveBeenCalled()
    expect(resourceApi.listSummaries).toHaveBeenCalledTimes(2)
    expect(resourceApi.listVersionSummaries).toHaveBeenCalledTimes(2)
    expect(wrapper.text()).toContain('1 项')
    expect(wrapper.text()).toContain('第二版')
  })
  it('等待删除确认时阻止重复提交，取消后可以重新选择', async () => {
    let resolve!: (confirmed: boolean) => void
    confirmApi.mockReturnValue(
      new Promise<boolean>((done) => {
        resolve = done
      }),
    )
    const wrapper = mount(VersionRecognitionPanel, { props: { resources: [current] } })
    await flushPromises()
    await wrapper.get('input[type="checkbox"]').setValue(true)
    const button = wrapper.findAll('button').find((item) => item.text() === '删除选中的历史版本')!
    await button.trigger('click')
    await button.trigger('click')
    const count = confirmApi.mock.calls.length
    resolve(false)
    await flushPromises()
    expect(count).toBe(1)
    expect(resourceApi.deleteVersions).not.toHaveBeenCalled()
    expect(button.attributes('disabled')).toBeUndefined()
    confirmApi.mockResolvedValue(true)
    await button.trigger('click')
    await flushPromises()
    expect(resourceApi.deleteVersions).toHaveBeenCalledExactlyOnceWith(current.id, [archived.id])
    wrapper.unmount()
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
