// @vitest-environment jsdom

import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  FrontendWorkshopSourceAlreadyExistsError,
  FrontendWorkshopSourceRevisionConflictError,
} from '../services/FrontendWorkshopSourceDocumentService'
import { createFrontendWorkshopProject } from '../types/FrontendWorkshopProject'

const mocks = vi.hoisted(() => ({
  getSource: vi.fn(),
  createSource: vi.fn(),
  saveSourceAtRevision: vi.fn(),
  listProjects: vi.fn(),
  compileBrowserSource: vi.fn(),
  createBrowserSourceProject: vi.fn(),
  loadBrowserSourceCompiler: vi.fn(),
  writeClipboard: vi.fn(),
  download: vi.fn(),
}))
vi.mock('../utils/LibraryFormatting', () => ({ downloadBlob: mocks.download }))

vi.mock('../services/FrontendWorkshopBrowserSourceCompilerService', () => ({
  createFrontendWorkshopBrowserSourceProjectFromFiles: mocks.createBrowserSourceProject,
}))

vi.mock('../core/FrontendWorkshopContainer', () => ({
  loadFrontendWorkshopBrowserSourceCompilerService: mocks.loadBrowserSourceCompiler,
  frontendWorkshopSourceDocumentService: {
    get: mocks.getSource,
    createAuthorSourceIfMissing: mocks.createSource,
    saveAuthorSourceAtRevision: mocks.saveSourceAtRevision,
  },
  frontendWorkshopProjectService: {
    list: mocks.listProjects,
  },
}))

import FrontendWorkshopSourceEditor from './FrontendWorkshopSourceEditor.vue'

function project() {
  const value = createFrontendWorkshopProject('greeting', 100)
  value.id = 'project-1'
  value.document.id = 'project-1'
  value.pages[0]!.nodes.push({
    id: 'current-title',
    layerId: value.pages[0]!.layers[0]!.id,
    kind: 'text',
    label: '当前标题',
    text: '当前项目文字',
    contentSource: { kind: 'manual' },
    style: {},
    children: [],
  })
  return value
}

function source(revision = 7, authorSource = '  <main>rev7</main>\n') {
  return {
    version: 1 as const,
    projectId: 'project-1',
    hostProfile: 'tavern-helper-message' as const,
    origin: 'new' as const,
    authorSource,
    revision,
    createdAt: 100,
    updatedAt: 200,
  }
}

function buttonByText(wrapper: ReturnType<typeof mount>, text: string) {
  const button = wrapper.findAll('button').find((candidate) => candidate.text().includes(text))
  if (!button) throw new Error(`button not found: ${text}`)
  return button
}

describe('FrontendWorkshopSourceEditor new-only takeover', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: mocks.writeClipboard },
    })
    mocks.writeClipboard.mockResolvedValue(undefined)
    mocks.listProjects.mockResolvedValue([project()])
    mocks.getSource.mockResolvedValue(source())
    mocks.createBrowserSourceProject.mockResolvedValue({
      entryPath: 'main.ts',
      files: [{ path: 'main.ts', contents: 'fixture' }],
    })
    mocks.compileBrowserSource.mockResolvedValue({
      capability: 'browser-compile',
      entryPath: 'main.ts',
      authorSource: '<script>fixture-compiled-source</script>',
      diagnostics: [],
    })
    mocks.loadBrowserSourceCompiler.mockResolvedValue({ compile: mocks.compileBrowserSource })
  })

  it('保存已有 Source 时携带打开时 revision，并原样提交用户草稿', async () => {
    const saved = source(8, '\n<section>saved</section>  ')
    mocks.saveSourceAtRevision.mockResolvedValue(saved)
    const wrapper = mount(FrontendWorkshopSourceEditor, { props: { projectId: 'project-1' } })
    await flushPromises()

    expect(wrapper.get('textarea').element.value).toBe('  <main>rev7</main>\n')
    const rawDraft = '\n<section data-x="1">  keep  </section>\n<script>window.x=1</script>  '
    await wrapper.get('textarea').setValue(rawDraft)
    await wrapper.get('button.is-primary').trigger('click')
    await flushPromises()

    expect(mocks.saveSourceAtRevision).toHaveBeenCalledWith('project-1', 7, rawDraft, {
      origin: 'new',
    })
    expect(wrapper.emitted('applied')?.[0]).toEqual([saved, false])
  })

  it('显式导入 Browser Source 时先编译到 draft，保存后才写入唯一 Source', async () => {
    const saved = {
      ...source(8, '<script>fixture-compiled-source</script>'),
      origin: 'imported' as const,
    }
    mocks.saveSourceAtRevision.mockResolvedValue(saved)
    const wrapper = mount(FrontendWorkshopSourceEditor, { props: { projectId: 'project-1' } })
    await flushPromises()
    const input = wrapper.findAll('input[type="file"]')[0]!
    expect(mocks.loadBrowserSourceCompiler).not.toHaveBeenCalled()
    const file = new File(['fixture'], 'main.ts', { type: 'text/typescript' })
    Object.defineProperty(input.element, 'files', { configurable: true, value: [file] })

    await input.trigger('change')
    await flushPromises()

    expect(mocks.createBrowserSourceProject).toHaveBeenCalledWith([file])
    expect(mocks.loadBrowserSourceCompiler).toHaveBeenCalledTimes(1)
    expect(mocks.compileBrowserSource).toHaveBeenCalledTimes(1)
    expect(wrapper.get('textarea').element.value).toBe('<script>fixture-compiled-source</script>')
    expect(mocks.saveSourceAtRevision).not.toHaveBeenCalled()

    await wrapper.get('button.is-primary').trigger('click')
    await flushPromises()
    expect(mocks.saveSourceAtRevision).toHaveBeenCalledWith(
      'project-1',
      7,
      '<script>fixture-compiled-source</script>',
      { origin: 'imported' },
    )
  })

  it('高置信度 TavernHelper 单一消息 envelope 必须先提取成纯 Author Source 再保存', async () => {
    const saved = {
      ...source(8, '<body><main>匿名前端</main><script>window.ready=true</script></body>'),
      origin: 'imported' as const,
    }
    mocks.saveSourceAtRevision.mockResolvedValue(saved)
    const wrapper = mount(FrontendWorkshopSourceEditor, { props: { projectId: 'project-1' } })
    await flushPromises()

    await wrapper
      .get('textarea')
      .setValue(
        '```html\n<body><main>匿名前端</main><script>window.ready=true</script></body>\n```',
      )
    await flushPromises()

    expect(wrapper.get('[data-envelope-kind="single"]').text()).toContain(
      '检测到 TavernHelper 消息前端格式',
    )
    await wrapper.get('button.is-primary').trigger('click')
    expect(mocks.saveSourceAtRevision).not.toHaveBeenCalled()
    expect(wrapper.get('[role="alert"]').text()).toContain('Author Source 只保存纯前端源码')

    await buttonByText(wrapper, '按 TavernHelper 前端导入').trigger('click')
    await flushPromises()
    const imported = wrapper.get('textarea').element.value
    expect(imported).toContain('<main>匿名前端</main>')
    expect(imported).toContain('<script>window.ready=true</script>')
    expect(imported).not.toContain('```')

    await wrapper.get('button.is-primary').trigger('click')
    await flushPromises()
    expect(mocks.saveSourceAtRevision).toHaveBeenCalledWith('project-1', 7, imported, {
      origin: 'imported',
    })
  })

  it('mixed prose + frontend block 不会静默丢正文或自动保存 envelope', async () => {
    const wrapper = mount(FrontendWorkshopSourceEditor, { props: { projectId: 'project-1' } })
    await flushPromises()
    const mixed = '前文保留。\n\n```html\n<body><main>前端</main></body>\n```\n\n后文保留。'

    await wrapper.get('textarea').setValue(mixed)
    await flushPromises()
    expect(wrapper.get('[data-envelope-kind="mixed"]').text()).toContain('普通消息正文')
    expect(wrapper.get('textarea').element.value).toBe(mixed)

    await wrapper.get('button.is-primary').trigger('click')
    expect(mocks.saveSourceAtRevision).not.toHaveBeenCalled()
    expect(wrapper.get('textarea').element.value).toBe(mixed)

    await buttonByText(wrapper, '按 TavernHelper 前端导入').trigger('click')
    await flushPromises()
    expect(wrapper.get('textarea').element.value).toContain('<main>前端</main>')
    expect(wrapper.get('textarea').element.value).not.toContain('前文保留')
  })

  it('multiple frontend blocks 要求显式选择，不自动拼接', async () => {
    const wrapper = mount(FrontendWorkshopSourceEditor, { props: { projectId: 'project-1' } })
    await flushPromises()
    await wrapper
      .get('textarea')
      .setValue(
        '```\n<body><main>A</main></body>\n```\n\n```html\n<body><main>B</main></body>\n```',
      )
    await flushPromises()

    expect(wrapper.get('[data-envelope-kind="multiple"]').text()).toContain(
      '多个 TavernHelper 前端块',
    )
    await wrapper.get('select[aria-label="选择 TavernHelper 前端块"]').setValue('1')
    await buttonByText(wrapper, '按 TavernHelper 前端导入选中块').trigger('click')
    await flushPromises()

    expect(wrapper.get('textarea').element.value).toContain('<main>B</main>')
    expect(wrapper.get('textarea').element.value).not.toContain('<main>A</main>')
  })

  it('导出独立开场白JSON，没有配套脚本就不显示脚本入口，且不触碰剪贴板或Source', async () => {
    const wrapper = mount(FrontendWorkshopSourceEditor, { props: { projectId: 'project-1' } })
    await flushPromises()

    expect(wrapper.text()).not.toContain('导出助手脚本 JSON')
    expect(wrapper.findAll('button').some((button) => button.text().startsWith('复制'))).toBe(false)
    await buttonByText(wrapper, '导出开场白 JSON').trigger('click')
    await flushPromises()
    const blob = mocks.download.mock.calls.at(-1)?.[0] as Blob
    const exported = await new Promise<string>((resolve) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.readAsText(blob)
    })
    expect(JSON.parse(exported)).toMatchObject({
      format: 'srl-greeting',
      first_mes: '```html\n<body>  <main>rev7</main>\n</body>\n```',
      companion_scripts: [],
    })
    expect(mocks.writeClipboard).not.toHaveBeenCalled()
    expect(wrapper.get('textarea').element.value).toBe('  <main>rev7</main>\n')
    expect(mocks.saveSourceAtRevision).not.toHaveBeenCalled()
  })

  it('没有源码时从空白开始，粘贴代码后保存，不再接管旧画布', async () => {
    mocks.getSource.mockResolvedValue(undefined)
    const saved = source(1, '<current-source />')
    mocks.createSource.mockResolvedValue(saved)

    const wrapper = mount(FrontendWorkshopSourceEditor, { props: { projectId: 'project-1' } })
    await flushPromises()

    expect(wrapper.find('[aria-label="选择接管基线"]').exists()).toBe(false)
    expect(wrapper.get('textarea').element.value).toBe('')
    expect(wrapper.get('textarea').attributes('placeholder')).toContain('粘贴或编辑')
    expect(wrapper.find('footer').exists()).toBe(false)
    await wrapper.get('textarea').setValue('<main>外来的完整源码</main>')

    const rendered = wrapper.get('textarea').element.value
    await wrapper.get('button.is-primary').trigger('click')
    await flushPromises()

    expect(mocks.createSource).toHaveBeenCalledWith('project-1', rendered, { origin: 'new' })
    expect(mocks.saveSourceAtRevision).not.toHaveBeenCalled()
    expect(wrapper.emitted('applied')?.[0]).toEqual([saved, true])
  })

  it('status 不允许进入 greeting Source 接管链', async () => {
    const legacyStatus = createFrontendWorkshopProject('status', 100)
    legacyStatus.id = 'project-1'
    legacyStatus.document.id = 'project-1'
    mocks.listProjects.mockResolvedValue([legacyStatus])
    mocks.getSource.mockResolvedValue(undefined)

    const wrapper = mount(FrontendWorkshopSourceEditor, { props: { projectId: 'project-1' } })
    await flushPromises()

    expect(wrapper.get('[role="alert"]').text()).toContain('状态栏项目由旧状态栏编辑器负责')
    expect(mocks.createSource).not.toHaveBeenCalled()
  })

  it('stale revision 冲突时 fail closed，保持编辑器打开且不发 applied', async () => {
    mocks.saveSourceAtRevision.mockRejectedValue(
      new FrontendWorkshopSourceRevisionConflictError('project-1', 7, 8),
    )
    const wrapper = mount(FrontendWorkshopSourceEditor, { props: { projectId: 'project-1' } })
    await flushPromises()
    await wrapper.get('textarea').setValue('<main>stale draft</main>')
    await wrapper.get('button.is-primary').trigger('click')
    await flushPromises()

    expect(wrapper.get('[role="alert"]').text()).toContain('当前为 8')
    expect(wrapper.get('[role="alert"]').text()).toContain('本次保存已取消')
    expect(wrapper.emitted('applied')).toBeUndefined()
  })

  it('首次接管期间 Source 被别处创建时 fail closed，不覆盖新真源', async () => {
    mocks.getSource.mockResolvedValue(undefined)
    mocks.createSource.mockRejectedValue(
      new FrontendWorkshopSourceAlreadyExistsError('project-1', 1),
    )
    const wrapper = mount(FrontendWorkshopSourceEditor, { props: { projectId: 'project-1' } })
    await flushPromises()
    await wrapper.get('button.is-primary').trigger('click')
    await flushPromises()

    expect(wrapper.get('[role="alert"]').text()).toContain('当前 revision 1')
    expect(wrapper.emitted('applied')).toBeUndefined()
  })
})
