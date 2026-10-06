/** @vitest-environment jsdom */
import { enableAutoUnmount, flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createFrontendWorkshopProject,
  type FrontendWorkshopProject,
} from '../types/FrontendWorkshopProject'

const {
  browserStorageService,
  projectService,
  imageHostingService,
  generatedAlbumService,
  greetingResourceService,
} = vi.hoisted(() => ({
  greetingResourceService: { save: vi.fn(async (_file: File) => ({ name: '开场白' })) },
  projectService: {
    list: vi.fn(async () => [] as FrontendWorkshopProject[]),
    save: vi.fn(async (project: FrontendWorkshopProject) => ({
      ...project,
      updatedAt: Date.now(),
    })),
    delete: vi.fn(),
  },
  browserStorageService: {
    getFrontendWorkshopRecentColors: vi.fn(() => [] as string[]),
    pushFrontendWorkshopRecentColor: vi.fn((color: string) => [color]),
  },
  imageHostingService: {
    status: vi.fn(async () => ({
      configured: true,
      membership: { registered: false, disabled: false, termsAccepted: false, acceptedAt: null },
      usage: { dailyCount: 0, totalCount: 0, totalBytes: 0 },
      capacity: {
        registered: 0,
        memberLimit: 30,
        remaining: 30,
        registrationOpen: true,
        uploadEnabled: true,
        globalDailyCount: 0,
        globalDailyLimit: 150,
      },
      limits: { dailyCount: 5, totalCount: 100, totalBytes: 314572800, maxImageBytes: 10485760 },
      terms: { version: 'test', text: 'test' },
    })),
    register: vi.fn(),
    uploadShared: vi.fn(),
    uploadSelfHosted: vi.fn(),
    delete: vi.fn(),
    initializeCredentials: vi.fn(async () => undefined),
    getSelfHostedConfiguration: vi.fn(() => null),
    saveSelfHostedConfiguration: vi.fn((config) => config),
    forgetSelfHostedConfiguration: vi.fn(),
    list: vi.fn(async () => []),
  },
  generatedAlbumService: {
    list: vi.fn(async () => ({
      items: [],
      total: 0,
      page: 1,
      pageSize: 18,
      pageCount: 1,
      categories: [],
      mimeTypes: [],
    })),
    saveGenerated: vi.fn(async (image) => ({ id: image.id })),
    setHostedUrl: vi.fn(),
  },
}))

vi.mock('../core/FrontendWorkshopContainer', () => ({
  frontendWorkshopProjectService: projectService,
  frontendWorkshopSourceDocumentService: {
    createAuthorSourceIfMissing: vi.fn(async () => undefined),
    get: vi.fn(async () => undefined),
  },
}))
vi.mock('../core/ImageAlbumContainer', () => ({
  frontendWorkshopImageHostingService: imageHostingService,
  generatedImageAlbumService: generatedAlbumService,
}))
vi.mock('../core/AppContainer', () => ({
  browserStorageService,
  greetingResourceService,
}))
vi.mock('../composables/UseConfirmDialog', () => ({ confirmAction: vi.fn(async () => true) }))

import FrontendWorkshopWorkbench from './FrontendWorkshopWorkbench.vue'
import { confirmAction } from '../composables/UseConfirmDialog'

enableAutoUnmount(afterEach)

async function createGreeting(): Promise<VueWrapper> {
  const wrapper = mount(FrontendWorkshopWorkbench, {
    attachTo: document.body,
    global: { stubs: { RichContentPreview: true, Teleport: true } },
  })
  await flushPromises()
  await wrapper.get('.fw-home__create button').trigger('click')
  await flushPromises()
  return wrapper
}

async function addText(wrapper: VueWrapper): Promise<void> {
  await wrapper.get('[aria-label="快速添加"]').trigger('click')
  await flushPromises()
  const button = wrapper.findAll('.fw-popover--quick button').find((item) => item.text() === '文字')
  if (!button) throw new Error('快速添加缺少文字')
  await button.trigger('click')
  await flushPromises()
}

describe('FrontendWorkshopWorkbench simplified editor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(confirmAction).mockResolvedValue(true)
    projectService.list.mockResolvedValue([])
    projectService.save.mockImplementation(async (project) => ({
      ...project,
      updatedAt: Date.now(),
    }))
    browserStorageService.getFrontendWorkshopRecentColors.mockReturnValue([])
    browserStorageService.pushFrontendWorkshopRecentColor.mockImplementation((color) => [color])
    imageHostingService.list.mockResolvedValue([])
    imageHostingService.getSelfHostedConfiguration.mockReturnValue(null)
  })

  it('取消存入不调用资源写入；首页没有重复参考库入口', async () => {
    const wrapper = await createGreeting()
    vi.mocked(confirmAction).mockResolvedValueOnce(false)
    await wrapper.setProps({ sourceOwnerState: 'source', sourceMarkup: '<main>完整作品</main>' })
    await wrapper.get('[aria-label="存入资源库"]').trigger('click')
    await flushPromises()
    expect(confirmAction).toHaveBeenCalledWith(expect.objectContaining({ title: '存入开场白资源' }))
    expect(greetingResourceService.save).not.toHaveBeenCalled()
    expect(wrapper.get('[aria-label="存入资源库"]').attributes('disabled')).toBeUndefined()
    await wrapper.get('[aria-label="返回项目首页"]').trigger('click')
    expect(wrapper.get('.feature-app-header').text()).not.toContain('效果参考库')
  })

  it('左侧栏保留快速添加、图层、肘肘更健康、撤销、重做、更多', async () => {
    const wrapper = await createGreeting()
    for (const label of ['快速添加', '打开图层', '打开肘肘更健康', '撤销', '重做', '更多工具'])
      expect(wrapper.find(`[aria-label="${label}"]`).exists()).toBe(true)
  })

  it('编辑状态恢复原项目栏，缩放操作实际改变画布', async () => {
    const wrapper = await createGreeting()
    expect(wrapper.find('.feature-app-header').exists()).toBe(false)
    expect(wrapper.get('.frontend-workbench__projectbar').text()).toContain('适合画布')
    await wrapper.get('[aria-label="重置画布视角"]').trigger('click')
    await wrapper.get('[aria-label="缩小画布"]').trigger('click')
    expect(wrapper.get('.frontend-workbench__canvas').attributes('style')).toContain('scale(0.75)')
    expect(wrapper.get('[aria-label="当前画布缩放"]').text()).toBe('75%')
    await wrapper.get('[aria-label="返回项目首页"]').trigger('click')
    expect(wrapper.find('.feature-app-header').exists()).toBe(true)
  })

  it('Source 顶部存入完整开场白资源，不退回结构化工程或复制到剪贴板', async () => {
    const wrapper = await createGreeting()
    const writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    const source = '<!doctype html>\n<div>Author source</div><script>void 0</script>'
    await wrapper.setProps({ sourceOwnerState: 'source', sourceMarkup: source })
    await wrapper.get('[aria-label="存入资源库"]').trigger('click')
    await flushPromises()
    expect(writeText).not.toHaveBeenCalled()
    expect(greetingResourceService.save).toHaveBeenCalledTimes(1)
    const file = greetingResourceService.save.mock.calls[0]![0]
    const text = await new Promise<string>((resolve) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.readAsText(file)
    })
    expect(JSON.parse(text)).toMatchObject({
      format: 'srl-greeting',
      first_mes: expect.stringContaining(source),
    })
    await wrapper.get('[aria-label="缩小画布"]').trigger('click')
    expect(wrapper.emitted('sourceViewportRequested')).toEqual([['zoom-out']])
  })

  it('选中元素后只出现一个手动属性 Dock，固定四个页签和源码入口', async () => {
    const wrapper = await createGreeting()
    await addText(wrapper)
    const target = wrapper.find('.frontend-workbench__canvas-node.is-text')
    expect(target.exists()).toBe(true)
    await target.trigger('click')
    await flushPromises()

    const dock = wrapper.get('.fw-inspector-dock')
    expect(dock.get('.fw-inspector-dock__source').text()).toBe('源码')
    expect(dock.findAll('nav > button').map((button) => button.text())).toEqual([
      '内容',
      '外观',
      '布局',
      '交互',
    ])
    expect(wrapper.find('.frontend-workbench__transform-dock').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('编辑内容')
  })

  it('点击页签直接展开对应属性，不经过旧 detail router', async () => {
    const wrapper = await createGreeting()
    await addText(wrapper)
    await wrapper.find('.frontend-workbench__canvas-node.is-text').trigger('click')
    const dock = wrapper.get('.fw-inspector-dock')
    await dock.findAll('nav > button')[1]!.trigger('click')
    await flushPromises()
    expect(dock.find('.fw-inspector').exists()).toBe(true)
    expect(dock.text()).toContain('文字')
    expect(dock.text()).toContain('填充')
    expect(wrapper.find('[data-node-detail-view]').exists()).toBe(false)
    expect(wrapper.find('.frontend-workshop-node-inspector').exists()).toBe(false)
  })

  it('交互页只展示已有 Behavior，不再暴露 guided/capability/effect/token', async () => {
    const wrapper = await createGreeting()
    await addText(wrapper)
    await wrapper.find('.frontend-workbench__canvas-node.is-text').trigger('click')
    const dock = wrapper.get('.fw-inspector-dock')
    await dock.findAll('nav > button')[3]!.trigger('click')
    await flushPromises()
    const text = dock.text()
    expect(text).toContain('已有交互')
    expect(text).not.toMatch(/guided|capability|effect|token|flip|collapse|reveal/iu)
  })

  it('新建项目模型不再生成旧 recipe/capability 字段', () => {
    const project = createFrontendWorkshopProject('greeting')
    expect(project).not.toHaveProperty('interactionBindings')
    expect(project).not.toHaveProperty('designTokens')
    expect(project.pages[0]!.nodes).toEqual([])
  })
})
