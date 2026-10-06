/** @vitest-environment jsdom */
import { computed, isReactive, ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { RESOURCE_TYPE, type ResourceSummary } from '../types/Resource'

const resources = {
  updateTagsMany: vi.fn(),
  setFavoriteMany: vi.fn(),
  moveManyToCategory: vi.fn(),
  extractCharacterAssetsMany: vi.fn(),
}

vi.mock('../core/AppContainer', () => ({ resourceService: resources }))

const confirmMock = vi.fn(async () => true)
vi.mock('./UseConfirmDialog', () => ({ confirmAction: confirmMock }))

const { useBatchOperations } = await import('./UseBatchOperations')

function item(id: string, type: string = RESOURCE_TYPE.WORLD_BOOK): ResourceSummary {
  return { id, type, categoryIds: [], name: id, tags: [] } as unknown as ResourceSummary
}

function setup(all: ResourceSummary[], page: ResourceSummary[] = all) {
  const list = ref(all)
  const notices: string[] = []
  const loadResources = vi.fn(async () => {})
  const moveToRecycleBin = vi.fn(async () => {})
  const activeCategoryId = ref<string | null | undefined>(undefined)
  const batch = useBatchOperations({
    resources: list,
    paginatedResources: computed(() => page),
    filteredResources: computed(() => all),
    visibleLibraryResources: computed(() => all),
    activeCategoryId,
    activeCategoryLabel: computed(() => '古风卡'),
    matchesCategory: (resource, categoryId) =>
      categoryId === undefined ||
      (resource as ResourceSummary & { categoryIds: string[] }).categoryIds.includes(
        categoryId as string,
      ),
    showNotice: (m) => notices.push(m),
    loadResources,
    moveToRecycleBin,
  })
  return { batch, notices, list, loadResources, moveToRecycleBin, activeCategoryId }
}

describe('useBatchOperations', () => {
  beforeEach(() => vi.clearAllMocks())

  it('切换多选模式会清空既有选择', () => {
    const { batch } = setup([item('a')])
    batch.toggleResourceSelection(item('a'))
    expect(batch.selectedResourceIds.value.size).toBe(1)
    batch.toggleBatchMode()
    expect(batch.isBatchMode.value).toBe(true)
    expect(batch.selectedResourceIds.value.size).toBe(0)
  })

  it('单项选择可反复切换', () => {
    const { batch } = setup([item('a')])
    batch.toggleResourceSelection(item('a'))
    batch.toggleResourceSelection(item('a'))
    expect(batch.selectedResourceIds.value.has('a')).toBe(false)
  })

  it('“选择本页”只作用于当前页，不动其他页已选项', () => {
    const all = [item('a'), item('b'), item('c')]
    const { batch } = setup(all, [all[0], all[1]])
    batch.toggleResourceSelection(all[2])
    batch.toggleVisibleSelection()
    expect([...batch.selectedResourceIds.value].sort()).toEqual(['a', 'b', 'c'])
    expect(batch.allVisibleSelected.value).toBe(true)

    batch.toggleVisibleSelection()
    // 取消本页后，其他页的 c 必须保留
    expect([...batch.selectedResourceIds.value]).toEqual(['c'])
  })

  it('未选中文件夹时全选范围是筛选结果，标签为“筛选结果”', () => {
    const all = [item('a'), item('b')]
    const { batch } = setup(all, [all[0]])
    expect(batch.batchSelectionScope.value).toHaveLength(2)
    expect(batch.batchSelectionScopeLabel.value).toBe('筛选结果')
    batch.toggleBatchScopeSelection()
    expect(batch.allBatchScopeSelected.value).toBe(true)
  })

  it('选中文件夹时全选范围收敛到该文件夹，标签改为文件夹名', () => {
    const inFolder = { ...item('a'), categoryIds: ['f1'] } as ResourceSummary
    const outside = { ...item('b'), categoryIds: [] } as ResourceSummary
    const { batch, activeCategoryId } = setup([inFolder, outside])
    activeCategoryId.value = 'f1'
    expect(batch.batchSelectionScope.value.map((r) => r.id)).toEqual(['a'])
    expect(batch.batchSelectionScopeLabel.value).toBe('古风卡')
  })

  it('只统计角色卡与预设为可拆分数量', () => {
    const all = [
      item('a', RESOURCE_TYPE.CHARACTER_CARD),
      item('b', RESOURCE_TYPE.PRESET),
      item('c', RESOURCE_TYPE.WORLD_BOOK),
    ]
    const { batch } = setup(all)
    batch.toggleBatchScopeSelection()
    expect(batch.selectedCharacterCount.value).toBe(2)
  })

  it('5000 项全选使用浅层 Set，避免深层响应式代理拖慢移动端', () => {
    const all = Array.from({ length: 5_000 }, (_, index) => item(`resource-${index}`))
    const { batch } = setup(all)
    const startedAt = performance.now()

    batch.toggleBatchScopeSelection()

    expect(batch.selectedResourceIds.value.size).toBe(5_000)
    expect(batch.allBatchScopeSelected.value).toBe(true)
    expect(isReactive(batch.selectedResourceIds.value)).toBe(false)
    expect(performance.now() - startedAt).toBeLessThan(200)
  })

  it('批量收藏就地更新索引，不整库重读', async () => {
    const all = [item('a'), item('b')]
    const { batch, list, loadResources } = setup(all)
    batch.toggleResourceSelection(all[0])
    await batch.handleBatchFavorite(true)
    expect(resources.setFavoriteMany).toHaveBeenCalledWith(['a'], true)
    expect(loadResources).not.toHaveBeenCalled()
    expect(list.value.find((r) => r.id === 'a')?.favorite).toBe(true)
    expect(batch.isBatchMode.value).toBe(false)
  })

  it('空选择时批量操作直接返回，不打扰服务层', async () => {
    const { batch } = setup([item('a')])
    await batch.handleBatchTag({ tag: 'x', action: 'add' })
    await batch.handleBatchMove(null)
    await batch.handleBatchFavorite(true)
    expect(resources.updateTagsMany).not.toHaveBeenCalled()
    expect(resources.moveManyToCategory).not.toHaveBeenCalled()
    expect(resources.setFavoriteMany).not.toHaveBeenCalled()
  })

  it('批量删除移入回收站，用户取消则什么都不做', async () => {
    const all = [item('a')]
    const { batch, moveToRecycleBin } = setup(all)
    batch.toggleResourceSelection(all[0])

    confirmMock.mockResolvedValueOnce(false)
    await batch.handleBatchDelete()
    expect(moveToRecycleBin).not.toHaveBeenCalled()

    confirmMock.mockResolvedValueOnce(true)
    await batch.handleBatchDelete()
    expect(moveToRecycleBin).toHaveBeenCalledWith(['a'])
  })

  it('服务层报错时给出提示并解除忙碌状态', async () => {
    const all = [item('a')]
    const { batch, notices } = setup(all)
    batch.toggleResourceSelection(all[0])
    resources.updateTagsMany.mockRejectedValueOnce(new Error('标签写入失败'))
    await batch.handleBatchTag({ tag: 'x', action: 'add' })
    expect(notices).toEqual(['标签写入失败'])
    expect(batch.isBatchBusy.value).toBe(false)
    // 失败时不应清空选择，用户可以直接重试
    expect(batch.selectedResourceIds.value.has('a')).toBe(true)
  })
})
