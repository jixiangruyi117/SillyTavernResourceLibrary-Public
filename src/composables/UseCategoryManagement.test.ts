/** @vitest-environment jsdom */
import { ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Category } from '../types/Resource'

const categories = {
  create: vi.fn(),
  update: vi.fn(),
  setHidden: vi.fn(),
  delete: vi.fn(),
}

vi.mock('../core/AppContainer', () => ({ categoryService: categories }))

const confirmMock = vi.fn(async () => true)
vi.mock('./UseConfirmDialog', () => ({ confirmAction: confirmMock }))

const { useCategoryManagement } = await import('./UseCategoryManagement')

function folder(overrides: Partial<Category> = {}): Category {
  return { id: 'f1', name: '古风卡', color: '#888', hidden: false, ...overrides } as Category
}

function setup() {
  const notices: string[] = []
  const activeCategoryId = ref<string | null | undefined>(undefined)
  const isOrganizing = ref(false)
  const loadLibrary = vi.fn(async () => {})
  const manager = useCategoryManagement({
    activeCategoryId,
    isOrganizing,
    showNotice: (m) => notices.push(m),
    loadLibrary,
  })
  return { manager, notices, activeCategoryId, isOrganizing, loadLibrary }
}

describe('useCategoryManagement', () => {
  beforeEach(() => vi.clearAllMocks())

  it('创建成功后重载资源库并重建面板', async () => {
    const { manager, notices, loadLibrary } = setup()
    const keyBefore = manager.categoryManagerKey.value
    await manager.handleCategoryCreate({ name: '新文件夹', color: '#111' })
    expect(categories.create).toHaveBeenCalledWith('新文件夹', '#111')
    expect(loadLibrary).toHaveBeenCalled()
    expect(manager.categoryManagerKey.value).toBe(keyBefore + 1)
    expect(notices).toEqual(['文件夹已创建'])
  })

  it('创建失败时透传服务层错误信息且不重建面板', async () => {
    const { manager, notices } = setup()
    categories.create.mockRejectedValueOnce(new Error('名称重复'))
    const keyBefore = manager.categoryManagerKey.value
    await manager.handleCategoryCreate({ name: '古风卡', color: '#111' })
    expect(notices).toEqual(['名称重复'])
    expect(manager.categoryManagerKey.value).toBe(keyBefore)
  })

  it('隐藏当前正在浏览的文件夹时退回“全部文件夹”', async () => {
    const { manager, activeCategoryId, notices } = setup()
    activeCategoryId.value = 'f1'
    await manager.handleCategoryVisibility(folder({ hidden: false }))
    expect(categories.setHidden).toHaveBeenCalledWith(expect.objectContaining({ id: 'f1' }), true)
    expect(activeCategoryId.value).toBeUndefined()
    expect(notices[0]).toContain('已从资源库和抽卡隐藏')
  })

  it('恢复显示不改变当前浏览位置', async () => {
    const { manager, activeCategoryId, notices } = setup()
    activeCategoryId.value = 'f1'
    await manager.handleCategoryVisibility(folder({ hidden: true }))
    expect(categories.setHidden).toHaveBeenCalledWith(expect.objectContaining({ id: 'f1' }), false)
    expect(activeCategoryId.value).toBe('f1')
    expect(notices[0]).toContain('已恢复显示')
  })

  it('删除前必须二次确认，取消则不调用服务', async () => {
    const { manager } = setup()
    confirmMock.mockResolvedValueOnce(false)
    await manager.handleCategoryDelete(folder())
    expect(categories.delete).not.toHaveBeenCalled()
  })

  it('确认删除只移除文件夹并退回全部文件夹', async () => {
    const { manager, activeCategoryId } = setup()
    activeCategoryId.value = 'f1'
    confirmMock.mockResolvedValueOnce(true)
    await manager.handleCategoryDelete(folder())
    expect(categories.delete).toHaveBeenCalledWith('f1')
    expect(activeCategoryId.value).toBeUndefined()
  })

  it('任何分支结束后都释放忙碌标记', async () => {
    const { manager, isOrganizing } = setup()
    categories.update.mockRejectedValueOnce(new Error('boom'))
    await manager.handleCategoryUpdate({ category: folder(), name: 'x', color: '#000' })
    expect(isOrganizing.value).toBe(false)
  })
})
