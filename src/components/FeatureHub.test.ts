/** @vitest-environment jsdom */
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { RESOURCE_TYPE, type Category, type ResourceSummary } from '../types/Resource'
import type { InstalledExternalApp } from '../types/ExternalApp'
import FeatureHub from './FeatureHub.vue'
import FolderLibraryView from './FolderLibraryView.vue'
import ActionSheet from './ActionSheet.vue'
vi.mock('../core/OfficialAppRuntime', () => ({
  officialAppService: { ready: async () => true, list: () => listOfficialApps() },
  acquireOfficialAppUse: async () => () => {},
  loadOfficialApp: async (id: string) => {
    if (id === 'draw') return (await import('./DrawApp.vue')).default
    if (id === 'imageGeneration') return (await import('./ImageGenerationApp.vue')).default
    if (id === 'imageAlbum') return (await import('./GeneratedImageAlbumApp.vue')).default
    throw new Error('Unexpected test app')
  },
}))

vi.mock('./ImageGenerationApp.vue', () => ({
  __esModule: true,
  default: {
    emits: ['back'],
    template: '<button data-testid="generation-page" @click="$emit(\'back\')">AI 生图</button>',
  },
}))
vi.mock('./GeneratedImageAlbumApp.vue', () => ({
  __esModule: true,
  default: {
    emits: ['back'],
    template: '<button data-testid="album-page" @click="$emit(\'back\')">生图相册</button>',
  },
}))

const { loadDrawState, listExternalApps, listOfficialApps } = vi.hoisted(() => ({
  listOfficialApps: vi.fn(async () =>
    [
      'draw',
      'stitch',
      'frontendWorkshop',
      'imageGeneration',
      'imageAlbum',
      'userPersona',
      'resourceBundle',
      'tavernBridge',
    ].map((id) => ({ id })),
  ),
  loadDrawState: vi.fn(),
  listExternalApps: vi.fn<() => Promise<InstalledExternalApp[]>>(async () => []),
}))

vi.mock('../core/AppContainer', () => ({
  browserStorageService: {
    getDrawShowNames: vi.fn(() => false),
    setDrawShowNames: vi.fn(),
    getChatLoadouts: vi.fn(() => []),
    setChatLoadouts: vi.fn((value) => value),
    getUserPersonaTemplates: vi.fn(() => []),
    setUserPersonaTemplates: vi.fn((value) => value),
  },
  characterDrawService: {
    load: loadDrawState,
    draw: vi.fn(),
    clear: vi.fn(),
  },
  resourceService: {
    get: vi.fn(),
  },
  externalAppService: {
    list: listExternalApps,
  },
  userPersonaService: {
    load: vi.fn(),
    create: vi.fn(),
    importFiles: vi.fn(),
    save: vi.fn(),
    delete: vi.fn(),
  },
}))

const categories: Category[] = [
  {
    id: 'folder-a',
    name: '古风收藏',
    color: '#486b5d',
    createdAt: 1,
    updatedAt: 1,
  },
]

const resources: ResourceSummary[] = [
  {
    id: 'resource-a',
    name: '青衣',
    description: '',
    type: RESOURCE_TYPE.CHARACTER_CARD,
    fileName: '青衣.png',
    mimeType: 'image/png',
    fileSize: 100,
    contentHash: 'a'.repeat(64),
    favorite: false,
    categoryId: 'folder-a',
    categoryIds: ['folder-a'],
    tags: [],
    metadata: {},
    createdAt: 1,
    updatedAt: 1,
  },
]

function render() {
  return mount(FeatureHub, {
    props: {
      resources,
      categories,
      theme: 'light',
      layoutMode: 'grid',
      uiFontScale: 'standard',
      customCss: '',
      folderBusy: false,
      cabinetResourceIds: [],
    },
  })
}

function dispatchPointer(
  element: Element,
  type: string,
  options: { clientX: number; clientY: number; pointerId: number; pointerType: string },
): void {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    button: 0,
    clientX: options.clientX,
    clientY: options.clientY,
  })
  Object.defineProperties(event, {
    pointerId: { value: options.pointerId },
    pointerType: { value: options.pointerType },
  })
  element.dispatchEvent(event)
}

describe('FeatureHub', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  beforeEach(() => {
    localStorage.clear()
    loadDrawState.mockResolvedValue({ totalDraws: 0, totalSessions: 0, records: {}, history: [] })
    listExternalApps.mockResolvedValue([])
  })

  it('keeps fixed and recent groups behind the lightweight filter entry', async () => {
    vi.useFakeTimers()
    const wrapper = render()
    const cloud = wrapper.get('.feature-app--cloud')
    dispatchPointer(cloud.element, 'pointerdown', {
      pointerId: 1,
      pointerType: 'touch',
      clientX: 10,
      clientY: 10,
    })
    await vi.advanceTimersByTimeAsync(550)
    dispatchPointer(cloud.element, 'pointerup', {
      pointerId: 1,
      pointerType: 'touch',
      clientX: 10,
      clientY: 10,
    })
    await cloud.trigger('click')
    expect(wrapper.attributes('data-feature-page')).toBe('home')
    vi.useRealTimers()

    await wrapper.get('.feature-app--draw').trigger('click')
    await vi.waitFor(() => expect(wrapper.find('.feature-app-header__back').exists()).toBe(true))
    await wrapper.get('.feature-app-header__back').trigger('click')

    await wrapper.get('[aria-label="筛选功能"]').trigger('click')
    wrapper.findComponent(ActionSheet).vm.$emit('select', { id: 'pinned' })
    await flushPromises()
    expect(wrapper.findAll('.feature-desktop > .feature-app')).toHaveLength(1)
    expect(wrapper.get('.feature-app--cloud').text()).toContain('云备份')

    await wrapper.get('[aria-label="筛选功能"]').trigger('click')
    wrapper.findComponent(ActionSheet).vm.$emit('select', { id: 'recent' })
    await flushPromises()
    expect(wrapper.findAll('.feature-desktop > .feature-app')).toHaveLength(1)
    expect(wrapper.get('.feature-app--draw').text()).toContain('抽了么')
  })

  it('opens the visual folder cabinet from the feature desktop', async () => {
    const wrapper = render()

    expect(wrapper.get('.feature-app--folders').text()).toContain('收藏柜')
    await wrapper.get('.feature-app--folders').trigger('click')

    expect(wrapper.attributes('data-feature-page')).toBe('folders')
    expect(document.body.classList.contains('folder-desktop-open')).toBe(true)
    expect(wrapper.get('.folder-library').text()).toContain('古风收藏')
    await wrapper.get('[aria-label="打开古风收藏"]').trigger('click')
    expect(wrapper.findAll('.feature-app-header')).toHaveLength(1)
    expect(wrapper.get('.feature-app-header h1').text()).toBe('古风收藏')
    expect(wrapper.find('.folder-detail__header').exists()).toBe(false)
    await wrapper.get('[aria-label="返回收藏柜"]').trigger('click')
    expect(wrapper.attributes('data-feature-page')).toBe('folders')
    expect(wrapper.get('.feature-app-header h1').text()).toBe('收藏柜')

    await wrapper.get('.feature-app-header__back').trigger('click')
    expect(document.body.classList.contains('folder-desktop-open')).toBe(false)
  })

  it('renders built-in feature apps in their registered order', async () => {
    const wrapper = render()
    await flushPromises()

    expect(
      wrapper
        .findAll('.feature-desktop > .feature-app')
        .map((app) => app.classes().find((className) => className.startsWith('feature-app--'))),
    ).toEqual([
      'feature-app--draw',
      'feature-app--appearance',
      'feature-app--folders',
      'feature-app--cloud',
      'feature-app--bridge',
      'feature-app--stitch',
      'feature-app--frontend',
      'feature-app--imageGeneration',
      'feature-app--imageAlbum',
      'feature-app--persona',
      'feature-app--bundle',
      'feature-app--extensions',
    ])
  })

  it('removes uninstalled apps from the desktop while keeping management available', async () => {
    listOfficialApps.mockResolvedValueOnce([{ id: 'draw' }]).mockResolvedValueOnce([{ id: 'draw' }])
    const wrapper = render()
    await flushPromises()
    expect(wrapper.find('.feature-app--draw').exists()).toBe(true)
    expect(wrapper.find('.feature-app--stitch').exists()).toBe(false)
    await wrapper.get('.feature-app--folders').trigger('click')
    listOfficialApps.mockResolvedValueOnce([])
    await wrapper.get('.feature-app-header__back').trigger('click')
    await flushPromises()
    expect(wrapper.find('.feature-app--draw').exists()).toBe(false)
    expect(wrapper.text()).toContain('APP 管理')
    wrapper.unmount()
  })

  it('restores the frontend workshop when its project resume state is present', async () => {
    localStorage.setItem(
      'srl.appResume.v1',
      JSON.stringify({ feature: 'frontendWorkshop', projectId: 'project-1', savedAt: 1 }),
    )

    const wrapper = render()
    await flushPromises()

    expect(wrapper.attributes('data-feature-page')).toBe('frontendWorkshop')
    expect(wrapper.emitted('feature-app-active')?.at(-1)).toEqual([true])
    expect(JSON.parse(localStorage.getItem('srl.appResume.v1') ?? '{}')).toMatchObject({
      feature: 'frontendWorkshop',
      projectId: 'project-1',
    })
  })

  it('keeps folder navigation in the cabinet and forwards resource details', async () => {
    const wrapper = render()
    await wrapper.get('.feature-app--folders').trigger('click')
    await wrapper.get('button[aria-label="打开古风收藏"]').trigger('click')
    await wrapper.get('.folder-detail__resource').trigger('click')

    expect(wrapper.emitted('openResource')).toEqual([
      [expect.objectContaining({ id: 'resource-a' })],
    ])
  })

  it('forwards cabinet desktop removal without turning it into resource deletion', async () => {
    const wrapper = render()
    await wrapper.get('.feature-app--folders').trigger('click')

    wrapper.getComponent(FolderLibraryView).vm.$emit('unpin', 'resource-a')

    expect(wrapper.emitted('cabinetUnpin')).toEqual([['resource-a']])
    expect(wrapper.emitted('delete')).toBeUndefined()
  })

  it('opens the user persona app from the feature desktop', async () => {
    const wrapper = render()
    await flushPromises()

    expect(wrapper.get('.feature-app--persona').text()).toContain('user才是老大')
    await wrapper.get('.feature-app--persona').trigger('click')

    expect(wrapper.attributes('data-feature-page')).toBe('userPersona')
    expect(wrapper.get('.async-panel-loading').text()).toContain('正在打开user才是老大')
  })

  it('opens the resource bundle app from the feature desktop', async () => {
    const wrapper = render()
    await flushPromises()

    expect(wrapper.get('.feature-app--bundle').text()).toContain('配了么')
    await wrapper.get('.feature-app--bundle').trigger('click')

    expect(wrapper.attributes('data-feature-page')).toBe('resourceBundle')
    expect(wrapper.get('.async-panel-loading').text()).toContain('正在打开配了么')
  })

  it('生图和相册使用各自路由，不依赖最近使用记录猜测入口', async () => {
    const wrapper = render()
    await flushPromises()
    await wrapper.get('.feature-app--imageGeneration').trigger('click')
    expect(wrapper.attributes('data-feature-page')).toBe('imageGeneration')
    expect(wrapper.get('.async-panel-loading').text()).toContain('正在打开AI 生图')
  })

  it('opens local extension management from the feature desktop', async () => {
    const wrapper = render()

    expect(wrapper.get('.feature-app--extensions').text()).toContain('扩展')
    await wrapper.get('.feature-app--extensions').trigger('click')

    expect(wrapper.attributes('data-feature-page')).toBe('extensions')
  })

  it('puts enabled third-party apps into the same paged feature desktop', async () => {
    listExternalApps.mockResolvedValue([
      ...['one', 'two', 'three'].map((id, index) => ({
        id: `com.example.${id}`,
        enabled: true,
        installedAt: index,
        updatedAt: index,
        runtimeHtml: '',
        manifest: {
          schemaVersion: 1 as const,
          id: `com.example.${id}`,
          name: `第三方 ${index + 1}`,
          version: '1.0.0',
          entry: 'index.html',
        },
      })),
    ])
    const wrapper = render()
    await flushPromises()

    expect(wrapper.get('.feature-desktop__pagination').text()).toContain('‹')
    expect(wrapper.findAll('.feature-desktop > .feature-app')).toHaveLength(12)
    expect(wrapper.find('.feature-app--external').exists()).toBe(false)

    await wrapper.get('button[aria-label="下一页应用"]').trigger('click')
    expect(wrapper.find('.feature-app--external').text()).toContain('第三方 1')
    expect(
      wrapper
        .findAll('.feature-app--external')
        .map((app) => app.text())
        .join(' '),
    ).toContain('第三方 1')
    expect(wrapper.findAll('.feature-app--external').map((app) => app.text())).toEqual([
      expect.stringContaining('第三方 1'),
      expect.stringContaining('第三方 2'),
      expect.stringContaining('第三方 3'),
    ])
  })

  it('mounts generation and album as independent registered pages and restores either page', async () => {
    let wrapper = render()
    await flushPromises()
    expect(wrapper.emitted('feature-app-active')).toEqual([[false]])
    for (const [id, testId, scrollLock] of [
      ['imageGeneration', 'generation-page', true],
      ['imageAlbum', 'album-page', false],
    ]) {
      await wrapper.get(`.feature-app--${id}`).trigger('click')
      await flushPromises()
      expect(wrapper.attributes('data-feature-page')).toBe(id)
      expect(wrapper.emitted('feature-app-active')?.at(-1)).toEqual([true])
      expect(document.body.classList.contains('feature-app-scroll-lock')).toBe(scrollLock)
      expect(document.documentElement.classList.contains('feature-app-scroll-lock')).toBe(
        scrollLock,
      )
      await vi.waitFor(() => expect(wrapper.find(`[data-testid="${testId}"]`).exists()).toBe(true))
      wrapper.unmount()
      expect(document.body.classList.contains('feature-app-scroll-lock')).toBe(false)
      wrapper = render()
      await flushPromises()
      expect(wrapper.attributes('data-feature-page')).toBe(id)
      expect(wrapper.emitted('feature-app-active')?.at(-1)).toEqual([true])
      await wrapper.get(`[data-testid="${testId}"]`).trigger('click')
      expect(wrapper.attributes('data-feature-page')).toBe('home')
      expect(wrapper.emitted('feature-app-active')?.at(-1)).toEqual([false])
      expect(document.body.classList.contains('feature-app-scroll-lock')).toBe(false)
      expect(document.documentElement.classList.contains('feature-app-scroll-lock')).toBe(false)
    }
    wrapper.unmount()
  })

  it('keeps document scrolling available for the appearance app', async () => {
    const wrapper = render()
    await flushPromises()

    await wrapper.get('.feature-app--appearance').trigger('click')
    await flushPromises()

    expect(wrapper.attributes('data-feature-page')).toBe('appearance')
    expect(document.body.classList.contains('feature-app-scroll-lock')).toBe(false)
    expect(document.documentElement.classList.contains('feature-app-scroll-lock')).toBe(false)
    wrapper.unmount()
  })
})
