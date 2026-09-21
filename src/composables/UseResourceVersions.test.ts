/** @vitest-environment jsdom */
import { ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ResourceVersionView } from '../services/ResourceService'
import type { Resource, ResourceSummary } from '../types/Resource'

const resourceApi = {
  activateVersion: vi.fn(),
  listVersions: vi.fn(),
  deleteVersion: vi.fn(),
  deleteVersions: vi.fn(),
  get: vi.fn(),
  updateVersionNote: vi.fn(),
  mergeExistingResourceAsVersion: vi.fn(),
  replaceCharacterCardArtwork: vi.fn(),
}

vi.mock('../core/AppContainer', () => ({ resourceService: resourceApi }))

const confirmMock = vi.fn(async () => true)
vi.mock('./UseConfirmDialog', () => ({ confirmAction: confirmMock }))

const { useResourceVersions } = await import('./UseResourceVersions')

const current = { id: 'r1', name: '夜航船' } as Resource

function version(id: string, active: boolean): ResourceVersionView {
  return {
    active,
    resource: { id, fileName: `${id}.png`, versionLabel: `版本 ${id}` },
  } as ResourceVersionView
}

function setup(versions: ResourceVersionView[] = []) {
  const notices: string[] = []
  const organizingResource = ref<Resource | undefined>(current)
  const organizingVersions = ref<ResourceVersionView[]>(versions)
  const isOrganizing = ref(false)
  const resources = ref<ResourceSummary[]>([{ id: 'r2', name: '旧版夜航船' } as ResourceSummary])
  const loadResources = vi.fn(async () => {})
  const refreshStorageHealth = vi.fn(async () => {})
  const api = useResourceVersions({
    organizingResource,
    organizingVersions,
    isOrganizing,
    resources,
    showNotice: (m) => notices.push(m),
    loadResources,
    refreshStorageHealth,
  })
  return { api, notices, organizingResource, organizingVersions, isOrganizing, loadResources }
}

describe('useResourceVersions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resourceApi.listVersions.mockResolvedValue([])
  })

  it('切换当前版本后刷新版本列表与资源索引', async () => {
    const next = { id: 'r1', name: '夜航船 v2' } as Resource
    resourceApi.activateVersion.mockResolvedValue(next)
    const { api, organizingResource, loadResources, notices } = setup()

    await api.handleActivateVersion('v2')

    expect(resourceApi.activateVersion).toHaveBeenCalledWith('r1', 'v2')
    expect(organizingResource.value).toStrictEqual(next)
    expect(loadResources).toHaveBeenCalled()
    expect(notices[0]).toContain('已切换当前展示版本')
  })

  it('正在进行其他版本操作时忽略并发调用', async () => {
    const { api, isOrganizing } = setup()
    isOrganizing.value = true
    await api.handleActivateVersion('v2')
    expect(resourceApi.activateVersion).not.toHaveBeenCalled()
  })

  it('不允许删除当前版本', async () => {
    const { api } = setup([version('v1', true)])
    await api.handleDeleteResourceVersion('v1')
    expect(resourceApi.deleteVersions).not.toHaveBeenCalled()
  })

  it('删除历史版本前必须确认', async () => {
    const { api } = setup([version('v1', false)])
    confirmMock.mockResolvedValueOnce(false)
    await api.handleDeleteResourceVersion('v1')
    expect(resourceApi.deleteVersions).not.toHaveBeenCalled()

    confirmMock.mockResolvedValueOnce(true)
    resourceApi.get.mockResolvedValue(current)
    await api.handleDeleteResourceVersion('v1')
    expect(resourceApi.deleteVersions).toHaveBeenCalledWith('r1', ['v1'])
  })

  it('允许删除当前逻辑版本中的非当前自定义卡面封装', async () => {
    const custom = { id: 'custom-art', fileName: 'custom.png' } as Resource
    const activeGroup = {
      active: true,
      resource: current,
      carriers: [current, custom],
    } as ResourceVersionView
    resourceApi.get.mockResolvedValue(current)
    const { api } = setup([activeGroup])

    await api.handleDeleteResourceVersion(custom.id)

    expect(resourceApi.deleteVersions).toHaveBeenCalledWith('r1', ['custom-art'])
  })

  it('更换卡面后刷新同一资源的封装列表', async () => {
    const next = { ...current, fileName: '自定义卡面.png' } as Resource
    resourceApi.replaceCharacterCardArtwork.mockResolvedValue(next)
    const { api, organizingResource, notices } = setup()
    const file = new File(['image'], '喜欢的图片.png', { type: 'image/png' })

    await api.handleReplaceCharacterCardArtwork(file)

    expect(resourceApi.replaceCharacterCardArtwork).toHaveBeenCalledWith('r1', file)
    expect(organizingResource.value).toStrictEqual(next)
    expect(notices[0]).toContain('原卡面和原文件仍保留')
  })

  it('版本备注保存与清除给出不同提示', async () => {
    resourceApi.get.mockResolvedValue(current)
    const { api, notices } = setup()
    await api.handleUpdateVersionNote('v1', '作者原版')
    await api.handleUpdateVersionNote('v1', '   ')
    expect(notices).toEqual(['版本备注已保存', '版本备注已清除'])
  })

  it('合并不存在的资源时提示并跳过', async () => {
    const { api, notices } = setup()
    await api.handleMergeExistingVersion('missing', '')
    expect(notices).toEqual(['要合并的资源已经不存在'])
    expect(resourceApi.mergeExistingResourceAsVersion).not.toHaveBeenCalled()
  })

  it('手动合并成功后同时刷新存储用量', async () => {
    resourceApi.mergeExistingResourceAsVersion.mockResolvedValue(current)
    confirmMock.mockResolvedValueOnce(true)
    const { api, notices } = setup()
    await api.handleMergeExistingVersion('r2', '来自旧库')
    expect(resourceApi.mergeExistingResourceAsVersion).toHaveBeenCalledWith('r1', 'r2', '来自旧库')
    expect(notices).toEqual(['已手动加入历史版本'])
  })

  it('没有打开任何资源时所有操作都是空动作', async () => {
    const { api, organizingResource } = setup()
    organizingResource.value = undefined
    await api.handleActivateVersion('v1')
    await api.handleUpdateVersionNote('v1', 'x')
    await api.handleMergeExistingVersion('r2', '')
    expect(resourceApi.activateVersion).not.toHaveBeenCalled()
    expect(resourceApi.updateVersionNote).not.toHaveBeenCalled()
    expect(resourceApi.mergeExistingResourceAsVersion).not.toHaveBeenCalled()
  })
})
