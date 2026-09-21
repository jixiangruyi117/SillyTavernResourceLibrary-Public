/** @vitest-environment jsdom */

import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { writeAppResumeState } from '../core/AppResumeState'
import { SRL_BACK_REQUEST_EVENT, type SrlBackRequestDetail } from '../composables/UseBackStack'
import { createFrontendWorkshopSourceComponent } from '../types/FrontendWorkshopSourceComponent'
import { createFrontendWorkshopSourceDocument } from '../types/FrontendWorkshopSourceDocument'
import FrontendWorkshopSourceSession from './FrontendWorkshopSourceSession.vue'

enableAutoUnmount(afterEach)

const mocks = vi.hoisted(() => ({
  getSourceDocument: vi.fn(),
  applyHistory: vi.fn(),
  undoHistory: vi.fn(),
  redoHistory: vi.fn(),
  historyStatus: vi.fn(),
  clearHistoryProject: vi.fn(),
  createCheckpoint: vi.fn(),
  restoreCheckpoint: vi.fn(),
  listCheckpoints: vi.fn(),
  reconcileCheckpoints: vi.fn(),
  clearCheckpointProject: vi.fn(),
  listSourceComponents: vi.fn(),
  insertSourceComponent: vi.fn(),
  onPreviewPolicyChange: vi.fn(() => () => undefined),
}))

vi.mock('../core/AppContainer', () => ({
  browserStorageService: {
    getFrontendWorkshopDrawerSize: () => ({ bottom: 0.46, side: 0.32 }),
    setFrontendWorkshopDrawerSize: vi.fn(),
    getPreviewPolicy: () => ({
      allowRemoteResources: false,
      allowScripts: false,
      preloadGreetingResources: false,
      preloadBeautificationResources: false,
    }),
    onPreviewPolicyChange: mocks.onPreviewPolicyChange,
  },
}))
vi.mock('../core/FrontendWorkshopContainer', () => ({
  frontendWorkshopSourceDocumentService: {
    get: mocks.getSourceDocument,
  },
  frontendWorkshopSourceHistoryService: {
    applyAndRecord: mocks.applyHistory,
    undo: mocks.undoHistory,
    redo: mocks.redoHistory,
    status: mocks.historyStatus,
    clearProject: mocks.clearHistoryProject,
  },
  frontendWorkshopSourceCheckpointService: {
    create: mocks.createCheckpoint,
    restore: mocks.restoreCheckpoint,
    list: mocks.listCheckpoints,
    reconcileProject: mocks.reconcileCheckpoints,
    clearProject: mocks.clearCheckpointProject,
  },
  frontendWorkshopSourceComponentService: {
    list: mocks.listSourceComponents,
    listForProject: mocks.listSourceComponents,
    insertIntoProject: mocks.insertSourceComponent,
  },
}))

vi.mock('./FrontendWorkshopWorkbench.vue', async () => {
  const { defineComponent, h } = await import('vue')
  return {
    default: defineComponent({
      name: 'MockFrontendWorkshopWorkbench',
      props: {
        sourceOwnerState: { type: String, default: 'visual' },
        sourceCanUndo: { type: Boolean, default: false },
        sourceCanRedo: { type: Boolean, default: false },
      },
      emits: [
        'back',
        'libraryChanged',
        'sourceRequested',
        'sourceAiRequested',
        'previewRequested',
        'sourceComponentLibraryRequested',
        'sourceUndoRequested',
        'sourceRedoRequested',
        'sourceCompatibilityRequested',
      ],
      setup(props, { emit, slots }) {
        return () =>
          h('div', { 'data-source-owner-state': props.sourceOwnerState }, [
            ...(props.sourceOwnerState === 'source' ? (slots['source-canvas']?.() ?? []) : []),
            ...(slots['source-selection-tools']?.() ?? []),
            h(
              'button',
              {
                'data-testid': 'workbench-compatibility',
                type: 'button',
                onClick: () => emit('sourceCompatibilityRequested'),
              },
              'source compatibility',
            ),
            h(
              'button',
              {
                'data-testid': 'workbench-preview',
                'data-source-owner-state': props.sourceOwnerState,
                type: 'button',
                onClick: () => {
                  const request = {
                    handled: false,
                    openLegacyPreview: () => emit('back'),
                  }
                  emit('previewRequested', request)
                  if (!request.handled) request.openLegacyPreview()
                },
              },
              'legacy preview',
            ),
            h(
              'button',
              {
                'data-testid': 'workbench-source-components',
                type: 'button',
                onClick: () => emit('sourceComponentLibraryRequested'),
              },
              'source components',
            ),
            h(
              'button',
              {
                'data-testid': 'workbench-undo',
                type: 'button',
                disabled: !props.sourceCanUndo,
                onClick: () => emit('sourceUndoRequested'),
              },
              '撤销',
            ),
            h(
              'button',
              {
                'data-testid': 'workbench-redo',
                type: 'button',
                disabled: !props.sourceCanRedo,
                onClick: () => emit('sourceRedoRequested'),
              },
              '重做',
            ),
          ])
      },
    }),
  }
})

vi.mock('./FrontendWorkshopSourcePreview.vue', async () => {
  const { defineComponent, h } = await import('vue')
  return {
    default: defineComponent({
      name: 'MockFrontendWorkshopSourcePreview',
      props: {
        sourceDocument: { type: Object, required: true },
        networkMode: { type: String, default: 'offline' },
        selectionMode: { type: Boolean, default: false },
        gestureCapabilities: { type: Object, default: undefined },
        gestureDisabled: { type: Boolean, default: false },
      },
      emits: [
        'ready',
        'pagehide',
        'runtimeError',
        'compatibilityDiagnostic',
        'domSnapshot',
        'domSelection',
        'sourceGesture',
      ],
      setup(props) {
        return () =>
          h('div', {
            'data-source-runtime-preview': 'true',
            'data-selection-mode': props.selectionMode ? 'true' : 'false',
          })
      },
    }),
  }
})

interface TestHistoryState {
  expectedRevision?: number
  entryCount: number
  cursor: number
  canUndo: boolean
  canRedo: boolean
  textUnits: number
}

let historyState: TestHistoryState
let checkpointItems: Array<{
  id: string
  projectId: string
  sourceCreatedAt: number
  sourceRevision: number
  sourceFingerprint: string
  label: string
  createdAt: number
  textUnits: number
}> = []

function resetHistoryState(): void {
  historyState = {
    entryCount: 0,
    cursor: 0,
    canUndo: false,
    canRedo: false,
    textUnits: 0,
  }
}

function sourceDocument() {
  return createFrontendWorkshopSourceDocument(
    'source-project',
    '<button onclick="window.__count=1">source</button>',
    100,
  )
}

function sourceComponent() {
  return createFrontendWorkshopSourceComponent(
    {
      name: '人物卡',
      source: { html: '<article>人物卡</article>', css: '', javascript: '' },
      root: { tagName: 'article' },
      provenance: { origin: 'manual' },
      projectIds: ['source-project'],
    },
    'component-1',
    100,
  )
}

function exactSourceDocument(revision = 1, authorSource = '<div id="hero"></div>') {
  const document = createFrontendWorkshopSourceDocument('source-project', authorSource, 100)
  document.revision = revision
  return document
}

function inferredSourceDocument() {
  return createFrontendWorkshopSourceDocument(
    'source-project',
    '<button id="hero" onclick="window.__count=1">source</button>',
    100,
  )
}

function runtimeIdentity() {
  return {
    projectId: 'source-project',
    sourceRevision: 1,
    instanceId: 'instance-a',
    runtimeNonce: 'nonce-a',
  }
}

function baselineSnapshot(tagName = 'div') {
  return {
    ...runtimeIdentity(),
    requestId: 'dom-snapshot-1',
    snapshotSequence: 1,
    nodes: [
      {
        runtimeNodeId: 'runtime-node-1',
        nodeKind: 'element' as const,
        treeScope: 'document' as const,
        firstSeenSequence: 1,
        tagName,
        elementId: 'hero',
      },
    ],
    truncated: false,
  }
}

function runtimeSelection(tagName = 'div') {
  return {
    ...runtimeIdentity(),
    runtimeNodeId: 'runtime-node-1',
    treeScope: 'document' as const,
    tagName,
    elementId: 'hero',
    rect: { x: 10, y: 20, width: 100, height: 50 },
  }
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function findButton(label: string): HTMLButtonElement {
  const button = Array.from(document.querySelectorAll('button')).find(
    (candidate) =>
      candidate.textContent?.trim() === label || candidate.getAttribute('aria-label') === label,
  )
  if (!(button instanceof HTMLButtonElement)) throw new Error(`missing ${label} button`)
  return button
}

beforeEach(() => {
  localStorage.clear()
  resetHistoryState()
  mocks.getSourceDocument.mockReset()
  mocks.applyHistory.mockReset()
  mocks.undoHistory.mockReset()
  mocks.redoHistory.mockReset()
  mocks.historyStatus.mockReset()
  mocks.clearHistoryProject.mockReset()
  mocks.createCheckpoint.mockReset()
  mocks.restoreCheckpoint.mockReset()
  mocks.listCheckpoints.mockReset()
  mocks.reconcileCheckpoints.mockReset()
  mocks.clearCheckpointProject.mockReset()
  mocks.listSourceComponents.mockReset()
  mocks.insertSourceComponent.mockReset()
  mocks.listSourceComponents.mockResolvedValue([])
  mocks.onPreviewPolicyChange.mockClear()
  checkpointItems = []
  mocks.historyStatus.mockImplementation((projectId: string) => ({ projectId, ...historyState }))
  mocks.listCheckpoints.mockImplementation(() => checkpointItems)
  document.body.style.overflow = ''
})

afterEach(() => {
  document.body.innerHTML = ''
})

describe('FrontendWorkshopSourceSession', () => {
  it('参考库预填描述经过原工作台事件完整传递，不生成补丁', async () => {
    const wrapper = mount(FrontendWorkshopSourceSession, { attachTo: document.body })
    await flushPromises()
    const instruction = '使用立方体切换和字符解码，保留当前风格。'
    wrapper
      .findComponent({ name: 'MockFrontendWorkshopWorkbench' })
      .vm.$emit('sourceAiRequested', instruction)
    await flushPromises()
    expect(wrapper.emitted('sourceAiRequested')).toContainEqual([instruction])
    expect(mocks.applyHistory).not.toHaveBeenCalled()
  })
  it('intercepts the existing preview button only when the project has Source Document truth', async () => {
    mocks.getSourceDocument.mockResolvedValue(sourceDocument())
    writeAppResumeState({ feature: 'frontendWorkshop', projectId: 'source-project' })
    const wrapper = mount(FrontendWorkshopSourceSession, { attachTo: document.body })
    await flushPromises()

    expect(
      wrapper.get('[data-testid="workbench-preview"]').attributes('data-source-owner-state'),
    ).toBe('source')
    await wrapper.get('[data-testid="workbench-preview"]').trigger('click')
    await flushPromises()

    expect(wrapper.emitted('back')).toBeUndefined()
    expect(document.querySelector('[aria-label="源码运行预览"]')).not.toBeNull()
    expect(document.querySelector('[data-source-runtime-preview="true"]')).not.toBeNull()
    wrapper.unmount()
  })

  it('leaves the legacy preview path untouched when no Source Document exists', async () => {
    mocks.getSourceDocument.mockResolvedValue(undefined)
    writeAppResumeState({ feature: 'frontendWorkshop', projectId: 'legacy-project' })
    const wrapper = mount(FrontendWorkshopSourceSession, { attachTo: document.body })
    await flushPromises()

    expect(
      wrapper.get('[data-testid="workbench-preview"]').attributes('data-source-owner-state'),
    ).toBe('visual')
    await wrapper.get('[data-testid="workbench-preview"]').trigger('click')
    await flushPromises()

    expect(wrapper.emitted('back')).toHaveLength(1)
    expect(document.querySelector('[aria-label="源码运行预览"]')).toBeNull()
    wrapper.unmount()
  })

  it('never leaks into legacy preview while Source Document lookup is still pending', async () => {
    const lookup = deferred<ReturnType<typeof sourceDocument> | undefined>()
    mocks.getSourceDocument.mockReturnValue(lookup.promise)
    writeAppResumeState({ feature: 'frontendWorkshop', projectId: 'source-project' })
    const wrapper = mount(FrontendWorkshopSourceSession, { attachTo: document.body })
    await flushPromises()

    expect(
      wrapper.get('[data-testid="workbench-preview"]').attributes('data-source-owner-state'),
    ).toBe('pending')
    await wrapper.get('[data-testid="workbench-preview"]').trigger('click')
    expect(wrapper.emitted('back')).toBeUndefined()
    expect(document.querySelector('[aria-label="源码运行预览"]')).toBeNull()

    lookup.resolve(sourceDocument())
    await flushPromises()

    expect(wrapper.emitted('back')).toBeUndefined()
    expect(document.querySelector('[data-source-runtime-preview="true"]')).not.toBeNull()
    wrapper.unmount()
  })

  it('replays the legacy preview once after a pending lookup confirms there is no Source Document', async () => {
    const lookup = deferred<ReturnType<typeof sourceDocument> | undefined>()
    mocks.getSourceDocument.mockReturnValue(lookup.promise)
    writeAppResumeState({ feature: 'frontendWorkshop', projectId: 'legacy-project' })
    const wrapper = mount(FrontendWorkshopSourceSession, { attachTo: document.body })
    await flushPromises()

    await wrapper.get('[data-testid="workbench-preview"]').trigger('click')
    expect(wrapper.emitted('back')).toBeUndefined()

    lookup.resolve(undefined)
    await flushPromises()

    expect(wrapper.emitted('back')).toHaveLength(1)
    expect(document.querySelector('[aria-label="源码运行预览"]')).toBeNull()
    wrapper.unmount()
  })

  it('reacts to the existing workbench resume-state lifecycle without polling', async () => {
    mocks.getSourceDocument.mockResolvedValue(sourceDocument())
    const wrapper = mount(FrontendWorkshopSourceSession, { attachTo: document.body })
    await flushPromises()

    writeAppResumeState({ feature: 'frontendWorkshop', projectId: 'source-project' })
    await flushPromises()
    await wrapper.get('[data-testid="workbench-preview"]').trigger('click')
    await flushPromises()

    expect(mocks.getSourceDocument).toHaveBeenCalledWith('source-project')
    expect(document.querySelector('[aria-label="源码运行预览"]')).not.toBeNull()
    wrapper.unmount()
  })

  it('rechecks a legacy project when it is explicitly taken over as Source', async () => {
    mocks.getSourceDocument.mockResolvedValueOnce(undefined).mockResolvedValueOnce(sourceDocument())
    writeAppResumeState({ feature: 'frontendWorkshop', projectId: 'source-project' })
    const wrapper = mount(FrontendWorkshopSourceSession, { attachTo: document.body })
    await flushPromises()

    writeAppResumeState({ feature: 'frontendWorkshop', projectId: 'source-project' })
    await flushPromises()

    expect(mocks.getSourceDocument).toHaveBeenCalledTimes(2)
    await wrapper.get('[data-testid="workbench-preview"]').trigger('click')
    await flushPromises()
    expect(document.querySelector('[aria-label="源码运行预览"]')).not.toBeNull()
    wrapper.unmount()
  })

  it('does not reload the same Source Document for subpage-only resume updates', async () => {
    mocks.getSourceDocument.mockResolvedValue(sourceDocument())
    writeAppResumeState({ feature: 'frontendWorkshop', projectId: 'source-project' })
    const wrapper = mount(FrontendWorkshopSourceSession, { attachTo: document.body })
    await flushPromises()
    expect(mocks.getSourceDocument).toHaveBeenCalledTimes(1)

    writeAppResumeState({
      feature: 'frontendWorkshop',
      projectId: 'source-project',
      subpage: 'alternate-page',
    })
    await flushPromises()

    expect(mocks.getSourceDocument).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })

  it('closes Source Preview before the workbench consumes a system back request', async () => {
    mocks.getSourceDocument.mockResolvedValue(sourceDocument())
    writeAppResumeState({ feature: 'frontendWorkshop', projectId: 'source-project' })
    const wrapper = mount(FrontendWorkshopSourceSession, { attachTo: document.body })
    await flushPromises()
    await wrapper.get('[data-testid="workbench-preview"]').trigger('click')
    await flushPromises()

    const detail: SrlBackRequestDetail = { handled: false }
    window.dispatchEvent(new CustomEvent(SRL_BACK_REQUEST_EVENT, { detail }))
    await flushPromises()

    expect(detail.handled).toBe(true)
    expect(document.querySelector('[aria-label="源码运行预览"]')).toBeNull()
    wrapper.unmount()
  })

  it('关闭 Runtime Preview 后只保留 current exact selections 给下一次侧栏 AI 入口', async () => {
    mocks.getSourceDocument.mockResolvedValue(exactSourceDocument())
    writeAppResumeState({ feature: 'frontendWorkshop', projectId: 'source-project' })
    const wrapper = mount(FrontendWorkshopSourceSession, { attachTo: document.body })
    await flushPromises()
    await flushPromises()
    findButton('选择元素').click()

    const preview = wrapper.findComponent({ name: 'MockFrontendWorkshopSourcePreview' })
    preview.vm.$emit('domSnapshot', baselineSnapshot())
    preview.vm.$emit('domSelection', runtimeSelection())
    await flushPromises()
    await wrapper.get('[data-testid="workbench-preview"]').trigger('click')
    await flushPromises()
    window.dispatchEvent(new CustomEvent(SRL_BACK_REQUEST_EVENT, { detail: { handled: false } }))
    await flushPromises()

    const selections = (
      wrapper.vm as unknown as {
        getCurrentSourceAiSelections(): Array<{
          sourceRange?: { start: number; end: number }
        }>
      }
    ).getCurrentSourceAiSelections()
    expect(document.querySelector('[aria-label="源码运行预览"]')).toBeNull()
    expect(selections).toHaveLength(1)
    expect(selections[0]?.sourceRange).toEqual({ start: 0, end: 15 })
    expect(document.querySelector('[data-selection-mode="true"]')).not.toBeNull()
    wrapper.unmount()
  })

  it('从 Workbench 独立打开 Source Component 库并由 system back 关闭', async () => {
    mocks.getSourceDocument.mockResolvedValue(sourceDocument())
    writeAppResumeState({ feature: 'frontendWorkshop', projectId: 'source-project' })
    const wrapper = mount(FrontendWorkshopSourceSession, { attachTo: document.body })
    await flushPromises()

    await wrapper.get('[data-testid="workbench-source-components"]').trigger('click')
    await flushPromises()
    expect(document.querySelector('[aria-label="当前组件"]')).not.toBeNull()
    expect(document.querySelector('[aria-label="源码运行预览"]')).toBeNull()

    const firstDetail: SrlBackRequestDetail = { handled: false }
    window.dispatchEvent(new CustomEvent(SRL_BACK_REQUEST_EVENT, { detail: firstDetail }))
    await flushPromises()
    expect(firstDetail.handled).toBe(true)
    expect(document.querySelector('[aria-label="当前组件"]')).toBeNull()
    wrapper.unmount()
  })

  it('从更多工具打开当前 revision 的派生兼容报告并保留完整 Runtime 证据', async () => {
    mocks.getSourceDocument.mockResolvedValue(sourceDocument())
    writeAppResumeState({ feature: 'frontendWorkshop', projectId: 'source-project' })
    const wrapper = mount(FrontendWorkshopSourceSession, { attachTo: document.body })
    await flushPromises()

    await wrapper.get('[data-testid="workbench-compatibility"]').trigger('click')
    await flushPromises()
    const preview = wrapper.findComponent({ name: 'MockFrontendWorkshopSourcePreview' })
    preview.vm.$emit('compatibilityDiagnostic', {
      capability: 'message-api',
      implementationStatus: 'PARTIAL',
      parityStatus: 'UNVERIFIED',
      source: 'runtime',
      callCount: 1,
      impact: '需要真实宿主验证',
    })
    const fullRuntimeMessage = `运行失败：${'详情'.repeat(140)}`
    preview.vm.$emit('runtimeError', { kind: 'script-error', message: fullRuntimeMessage })
    await flushPromises()

    const report = document.querySelector('[aria-label="兼容检查"]')
    expect(report?.textContent).toContain('Source revision 1')
    expect(report?.textContent).toContain('可能污染多实例全局状态')
    expect(report?.textContent).toContain('Runtime 能力：message-api')
    expect(report?.textContent).toContain(fullRuntimeMessage)
    expect(document.querySelector('[aria-label="源码运行预览"]')).not.toBeNull()

    const detail: SrlBackRequestDetail = { handled: false }
    window.dispatchEvent(new CustomEvent(SRL_BACK_REQUEST_EVENT, { detail }))
    await flushPromises()
    expect(detail.handled).toBe(true)
    expect(document.querySelector('[aria-label="兼容检查"]')).toBeNull()
    expect(document.querySelector('[aria-label="源码运行预览"]')).not.toBeNull()
    wrapper.unmount()
  })

  it('只在捕获真实 Runtime error 后从报告发出 revision-bound AI 修复 intent', async () => {
    mocks.getSourceDocument.mockResolvedValue(sourceDocument())
    writeAppResumeState({ feature: 'frontendWorkshop', projectId: 'source-project' })
    const wrapper = mount(FrontendWorkshopSourceSession, { attachTo: document.body })
    await flushPromises()

    await wrapper.get('[data-testid="workbench-compatibility"]').trigger('click')
    await flushPromises()
    const fixButton = findButton('AI 修复')
    expect(fixButton.disabled).toBe(true)

    const preview = wrapper.findComponent({ name: 'MockFrontendWorkshopSourcePreview' })
    preview.vm.$emit('runtimeError', { kind: 'script-error', message: 'refresh is not defined' })
    await flushPromises()
    expect(fixButton.disabled).toBe(false)
    fixButton.click()
    await flushPromises()

    expect(wrapper.emitted('sourceRuntimeFixRequested')).toEqual([
      [
        expect.objectContaining({
          projectId: 'source-project',
          sourceRevision: 1,
          sourceCreatedAt: 100,
          runtimeError: { kind: 'script-error', message: 'refresh is not defined' },
          diagnostics: expect.arrayContaining([
            expect.objectContaining({ category: 'runtime', severity: 'error' }),
          ]),
        }),
      ],
    ])
    expect(document.querySelector('[aria-label="兼容检查"]')).toBeNull()
    expect(document.querySelector('[aria-label="源码运行预览"]')).toBeNull()
    wrapper.unmount()
  })

  it('当前组件的快速使用直接经唯一插入链插入作品', async () => {
    mocks.getSourceDocument.mockResolvedValue(sourceDocument())
    mocks.listSourceComponents.mockResolvedValue([sourceComponent()])
    writeAppResumeState({ feature: 'frontendWorkshop', projectId: 'source-project' })
    const wrapper = mount(FrontendWorkshopSourceSession, { attachTo: document.body })
    await flushPromises()

    await wrapper.get('[data-testid="workbench-source-components"]').trigger('click')
    await flushPromises()
    const quickUse = Array.from(document.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === '快速使用',
    )
    if (!(quickUse instanceof HTMLButtonElement)) throw new Error('missing quick use button')
    quickUse.click()
    await flushPromises()

    expect(document.querySelector('[aria-label="当前组件"]')).toBeNull()
    expect(mocks.insertSourceComponent).toHaveBeenCalledWith('component-1', 'source-project', 1)
    wrapper.unmount()
  })

  it('routes an exact text edit through the Source History service instead of direct Source persistence', async () => {
    mocks.getSourceDocument.mockResolvedValue(exactSourceDocument(1, '<div id="hero">old</div>'))
    mocks.applyHistory.mockImplementation(async () => {
      historyState = {
        expectedRevision: 2,
        entryCount: 1,
        cursor: 1,
        canUndo: true,
        canRedo: false,
        textUnits: 8,
      }
      return {
        document: exactSourceDocument(2, '<div id="hero">next</div>'),
        receipt: {},
      }
    })
    writeAppResumeState({ feature: 'frontendWorkshop', projectId: 'source-project' })
    const wrapper = mount(FrontendWorkshopSourceSession, { attachTo: document.body })
    await flushPromises()
    await flushPromises()

    findButton('选择元素').click()
    await flushPromises()
    expect(document.querySelector('[data-selection-mode="true"]')).not.toBeNull()

    const preview = wrapper.findComponent({ name: 'MockFrontendWorkshopSourcePreview' })
    preview.vm.$emit('domSnapshot', baselineSnapshot())
    preview.vm.$emit('domSelection', runtimeSelection())
    await flushPromises()

    const idInput = document.querySelector('[data-item-key="source.text"] textarea')
    if (!(idInput instanceof HTMLTextAreaElement)) throw new Error('missing Source text input')
    expect(idInput.disabled).toBe(false)
    expect(idInput.value).toBe('old')
    idInput.value = 'next'
    idInput.dispatchEvent(new Event('change', { bubbles: true }))
    await flushPromises()

    expect(mocks.applyHistory).toHaveBeenCalledTimes(1)
    const [patch, options] = mocks.applyHistory.mock.calls[0]!
    expect(patch).toMatchObject({
      projectId: 'source-project',
      sourceRevision: 1,
      edits: [{ expectedText: 'old', replacement: 'next' }],
    })
    expect(options).toEqual({ label: '文字内容' })
    expect(wrapper.emitted('libraryChanged')).toHaveLength(1)
    expect(document.body.textContent).toContain('已保存；可撤销，预览已按新 revision 重建')
    expect(findButton('撤销').disabled).toBe(false)
    expect(findButton('重做').disabled).toBe(true)
    wrapper.unmount()
  })

  it('routes one exact inline transform value through Source History and preserves the proven raw range', async () => {
    const raw =
      '<div id="hero" style="position:relative;left : 10px ; top:20px; width:100px; height:50px; transform:rotate(5deg); color:red"></div>'
    const updated =
      '<div id="hero" style="position:relative;left : 42.25px ; top:20px; width:100px; height:50px; transform:rotate(5deg); color:red"></div>'
    mocks.getSourceDocument.mockResolvedValue(exactSourceDocument(1, raw))
    mocks.applyHistory.mockResolvedValue({
      document: exactSourceDocument(2, updated),
      receipt: {},
    })
    writeAppResumeState({ feature: 'frontendWorkshop', projectId: 'source-project' })
    const wrapper = mount(FrontendWorkshopSourceSession, { attachTo: document.body })
    await flushPromises()
    await flushPromises()

    findButton('选择元素').click()
    await flushPromises()

    const preview = wrapper.findComponent({ name: 'MockFrontendWorkshopSourcePreview' })
    preview.vm.$emit('domSnapshot', baselineSnapshot())
    preview.vm.$emit('domSelection', runtimeSelection())
    await flushPromises()

    document.querySelector<HTMLButtonElement>('[data-tab="layout"]')!.click()
    await flushPromises()
    const xInput = document.querySelector('[data-item-key="source.positionX"] input[type="number"]')
    const yInput = document.querySelector('[data-item-key="source.positionY"] input[type="number"]')
    const widthInput = document.querySelector('[data-item-key="source.width"] input[type="number"]')
    findButton('布局').click()
    await flushPromises()
    const heightInput = document.querySelector(
      '[data-item-key="source.height"] input[type="number"]',
    )
    const rotationInput = document.querySelector(
      '[data-item-key="source.rotation"] input[type="number"]',
    )
    if (!(xInput instanceof HTMLInputElement)) throw new Error('missing Source X input')
    if (!(yInput instanceof HTMLInputElement)) throw new Error('missing Source Y input')
    if (!(widthInput instanceof HTMLInputElement)) throw new Error('missing Source width input')
    if (!(heightInput instanceof HTMLInputElement)) throw new Error('missing Source height input')
    if (!(rotationInput instanceof HTMLInputElement))
      throw new Error('missing Source rotation input')
    expect(xInput.value).toBe('10')
    expect(yInput.value).toBe('20')
    expect(widthInput.value).toBe('100')
    expect(heightInput.value).toBe('50')
    expect(rotationInput.value).toBe('5')
    expect(xInput.disabled).toBe(false)

    xInput.value = '42.25'
    xInput.dispatchEvent(new Event('change', { bubbles: true }))
    await flushPromises()

    expect(mocks.applyHistory).toHaveBeenCalledTimes(1)
    const [patch, options] = mocks.applyHistory.mock.calls[0]!
    expect(patch).toMatchObject({
      projectId: 'source-project',
      sourceRevision: 1,
      edits: [{ expectedText: '10px', replacement: '42.25px' }],
    })
    expect(options).toEqual({ label: '修改 X' })
    expect(wrapper.emitted('libraryChanged')).toHaveLength(1)
    expect(document.body.textContent).toContain('已保存；可撤销，预览已按新 revision 重建')
    wrapper.unmount()
  })

  it('keeps Undo and Redo in the same monotonic Source revision flow and refreshes their availability', async () => {
    mocks.getSourceDocument.mockResolvedValue(exactSourceDocument(1, '<div id="hero">old</div>'))
    mocks.applyHistory.mockImplementation(async () => {
      historyState = {
        expectedRevision: 2,
        entryCount: 1,
        cursor: 1,
        canUndo: true,
        canRedo: false,
        textUnits: 8,
      }
      return {
        document: exactSourceDocument(2, '<div id="hero">next</div>'),
        receipt: {},
      }
    })
    mocks.undoHistory.mockImplementation(async () => {
      historyState = {
        expectedRevision: 3,
        entryCount: 1,
        cursor: 0,
        canUndo: false,
        canRedo: true,
        textUnits: 8,
      }
      return exactSourceDocument(3, '<div id="hero">old</div>')
    })
    mocks.redoHistory.mockImplementation(async () => {
      historyState = {
        expectedRevision: 4,
        entryCount: 1,
        cursor: 1,
        canUndo: true,
        canRedo: false,
        textUnits: 8,
      }
      return exactSourceDocument(4, '<div id="hero">next</div>')
    })
    writeAppResumeState({ feature: 'frontendWorkshop', projectId: 'source-project' })
    const wrapper = mount(FrontendWorkshopSourceSession, { attachTo: document.body })
    await flushPromises()
    await flushPromises()

    findButton('选择元素').click()
    await flushPromises()
    const preview = wrapper.findComponent({ name: 'MockFrontendWorkshopSourcePreview' })
    preview.vm.$emit('domSnapshot', baselineSnapshot())
    preview.vm.$emit('domSelection', runtimeSelection())
    await flushPromises()
    const idInput = document.querySelector('[data-item-key="source.text"] textarea')
    if (!(idInput instanceof HTMLTextAreaElement)) throw new Error('missing Source text input')
    expect(idInput.disabled).toBe(false)
    expect(idInput.value).toBe('old')
    idInput.value = 'next'
    idInput.dispatchEvent(new Event('change', { bubbles: true }))
    await flushPromises()

    expect(findButton('撤销').disabled).toBe(false)
    findButton('撤销').click()
    await flushPromises()

    expect(mocks.undoHistory).toHaveBeenCalledWith('source-project')
    expect(
      wrapper.findComponent({ name: 'MockFrontendWorkshopSourcePreview' }).props('sourceDocument'),
    ).toMatchObject({ revision: 3, authorSource: '<div id="hero">old</div>' })
    expect(findButton('撤销').disabled).toBe(true)
    expect(findButton('重做').disabled).toBe(false)
    expect(document.body.textContent).toContain('已撤销；预览已按新 revision 重建')

    findButton('重做').click()
    await flushPromises()

    expect(mocks.redoHistory).toHaveBeenCalledWith('source-project')
    expect(
      wrapper.findComponent({ name: 'MockFrontendWorkshopSourcePreview' }).props('sourceDocument'),
    ).toMatchObject({ revision: 4, authorSource: '<div id="hero">next</div>' })
    expect(findButton('撤销').disabled).toBe(false)
    expect(findButton('重做').disabled).toBe(true)
    expect(document.body.textContent).toContain('已重做；预览已按新 revision 重建')
    wrapper.unmount()
  })

  it('routes the Workbench rail through the existing Source History owner', async () => {
    mocks.getSourceDocument.mockResolvedValue(exactSourceDocument(2, '<div id="next"></div>'))
    historyState = {
      expectedRevision: 2,
      entryCount: 1,
      cursor: 1,
      canUndo: true,
      canRedo: false,
      textUnits: 8,
    }
    mocks.undoHistory.mockImplementation(async () => {
      historyState = {
        expectedRevision: 3,
        entryCount: 1,
        cursor: 0,
        canUndo: false,
        canRedo: true,
        textUnits: 8,
      }
      return exactSourceDocument(3, '<div id="hero"></div>')
    })
    mocks.redoHistory.mockImplementation(async () => {
      historyState = {
        expectedRevision: 4,
        entryCount: 1,
        cursor: 1,
        canUndo: true,
        canRedo: false,
        textUnits: 8,
      }
      return exactSourceDocument(4, '<div id="next"></div>')
    })
    writeAppResumeState({ feature: 'frontendWorkshop', projectId: 'source-project' })
    const wrapper = mount(FrontendWorkshopSourceSession, { attachTo: document.body })
    await flushPromises()

    expect(wrapper.get('[data-testid="workbench-undo"]').attributes('disabled')).toBeUndefined()
    expect(wrapper.get('[data-testid="workbench-redo"]').attributes('disabled')).toBeDefined()
    await wrapper.get('[data-testid="workbench-undo"]').trigger('click')
    await flushPromises()

    expect(mocks.undoHistory).toHaveBeenCalledWith('source-project')
    expect(wrapper.get('[data-testid="workbench-undo"]').attributes('disabled')).toBeDefined()
    expect(wrapper.get('[data-testid="workbench-redo"]').attributes('disabled')).toBeUndefined()
    await wrapper.get('[data-testid="workbench-redo"]').trigger('click')
    await flushPromises()

    expect(mocks.redoHistory).toHaveBeenCalledWith('source-project')
    expect(wrapper.emitted('libraryChanged')).toHaveLength(2)
    wrapper.unmount()
  })

  it('submits one move gesture as one atomic two-range Source history unit', async () => {
    const raw =
      '<div id="hero" style="position:relative;left:10px;top:20px;width:100px;height:50px;transform:rotate(5deg)"></div>'
    const next =
      '<div id="hero" style="position:relative;left:25px;top:15px;width:100px;height:50px;transform:rotate(5deg)"></div>'
    mocks.getSourceDocument.mockResolvedValue(exactSourceDocument(1, raw))
    mocks.applyHistory.mockImplementation(async () => {
      historyState = {
        expectedRevision: 2,
        entryCount: 1,
        cursor: 1,
        canUndo: true,
        canRedo: false,
        textUnits: 18,
      }
      return { document: exactSourceDocument(2, next), receipt: {} }
    })
    writeAppResumeState({ feature: 'frontendWorkshop', projectId: 'source-project' })
    const wrapper = mount(FrontendWorkshopSourceSession, { attachTo: document.body })
    await flushPromises()
    await flushPromises()
    findButton('选择元素').click()
    await flushPromises()

    const preview = wrapper.findComponent({ name: 'MockFrontendWorkshopSourcePreview' })
    preview.vm.$emit('domSnapshot', baselineSnapshot())
    preview.vm.$emit('domSelection', runtimeSelection())
    await flushPromises()
    expect(preview.props('gestureCapabilities')).toEqual({
      move: true,
      resize: true,
      scale: true,
      rotate: true,
    })

    preview.vm.$emit('sourceGesture', {
      selection: runtimeSelection(),
      gesture: { mode: 'move', deltaX: 15, deltaY: -5 },
    })
    await flushPromises()

    expect(mocks.applyHistory).toHaveBeenCalledTimes(1)
    const [patch, options] = mocks.applyHistory.mock.calls[0]!
    expect(patch).toMatchObject({
      projectId: 'source-project',
      sourceRevision: 1,
      edits: [
        { expectedText: '10px', replacement: '25px' },
        { expectedText: '20px', replacement: '15px' },
      ],
    })
    expect(options).toEqual({ label: '移动元素' })
    expect(
      wrapper.findComponent({ name: 'MockFrontendWorkshopSourcePreview' }).props('sourceDocument'),
    ).toMatchObject({ revision: 2, authorSource: next })
    expect(findButton('撤销').disabled).toBe(false)
    expect(document.body.textContent).toContain('移动元素已保存；可撤销')
    wrapper.unmount()
  })

  it('ignores a Source gesture from a stale disposable runtime identity', async () => {
    const raw = '<div id="hero" style="position:relative;left:10px;top:20px"></div>'
    mocks.getSourceDocument.mockResolvedValue(exactSourceDocument(1, raw))
    writeAppResumeState({ feature: 'frontendWorkshop', projectId: 'source-project' })
    const wrapper = mount(FrontendWorkshopSourceSession, { attachTo: document.body })
    await flushPromises()
    await flushPromises()
    findButton('选择元素').click()
    await flushPromises()

    const preview = wrapper.findComponent({ name: 'MockFrontendWorkshopSourcePreview' })
    preview.vm.$emit('domSnapshot', baselineSnapshot())
    preview.vm.$emit('domSelection', runtimeSelection())
    await flushPromises()
    preview.vm.$emit('sourceGesture', {
      selection: { ...runtimeSelection(), runtimeNonce: 'stale-nonce' },
      gesture: { mode: 'move', deltaX: 5, deltaY: 5 },
    })
    await flushPromises()

    expect(mocks.applyHistory).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('does not expose stylesheet or ambiguous inline values as precise Source transform fields', async () => {
    const raw =
      '<style>#hero{left:10px}</style><div id="hero" style="top:var(--y); width:100px !important; height:50px"></div>'
    mocks.getSourceDocument.mockResolvedValue(exactSourceDocument(1, raw))
    writeAppResumeState({ feature: 'frontendWorkshop', projectId: 'source-project' })
    const wrapper = mount(FrontendWorkshopSourceSession, { attachTo: document.body })
    await flushPromises()
    await flushPromises()

    findButton('选择元素').click()
    await flushPromises()

    const preview = wrapper.findComponent({ name: 'MockFrontendWorkshopSourcePreview' })
    preview.vm.$emit('domSnapshot', baselineSnapshot())
    preview.vm.$emit('domSelection', runtimeSelection())
    await flushPromises()

    expect(document.querySelector('[data-item-key="source.positionX"]')).toBeNull()
    expect(document.querySelector('[data-item-key="source.positionY"]')).toBeNull()
    expect(document.querySelector('[data-item-key="source.width"]')).toBeNull()
    findButton('布局').click()
    await flushPromises()
    const heightInput = document.querySelector(
      '[data-item-key="source.height"] input[type="number"]',
    )
    if (!(heightInput instanceof HTMLInputElement))
      throw new Error('missing exact Source height input')
    expect(heightInput.value).toBe('50')
    expect(heightInput.disabled).toBe(false)
    expect(mocks.applyHistory).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('creates and restores a bounded Source checkpoint from the preview toolbar', async () => {
    const source = exactSourceDocument()
    mocks.getSourceDocument.mockResolvedValue(source)
    const checkpoint = {
      id: 'checkpoint-1',
      projectId: source.projectId,
      sourceCreatedAt: source.createdAt,
      sourceRevision: source.revision,
      sourceFingerprint: 'utf16-21-deadbeef',
      label: '检查点 1',
      createdAt: 200,
      textUnits: source.authorSource.length,
    }
    mocks.createCheckpoint.mockImplementation(async () => {
      checkpointItems = [checkpoint]
      return checkpoint
    })
    mocks.restoreCheckpoint.mockImplementation(async () => {
      historyState = {
        expectedRevision: 2,
        entryCount: 1,
        cursor: 1,
        canUndo: true,
        canRedo: false,
        textUnits: 42,
      }
      return {
        document: exactSourceDocument(2, '<div id="checkpoint"></div>'),
        checkpoint,
        changed: true,
      }
    })
    writeAppResumeState({ feature: 'frontendWorkshop', projectId: source.projectId })
    const wrapper = mount(FrontendWorkshopSourceSession, { attachTo: document.body })
    await flushPromises()
    await wrapper.get('[data-testid="workbench-preview"]').trigger('click')
    await flushPromises()

    expect(findButton('恢复').disabled).toBe(true)
    findButton('保存点').click()
    await flushPromises()

    expect(mocks.createCheckpoint).toHaveBeenCalledWith(source.projectId, {
      expectedRevision: 1,
      expectedSourceCreatedAt: 100,
    })
    const checkpointSelect = document.querySelector('select[aria-label="Source 检查点"]')
    if (!(checkpointSelect instanceof HTMLSelectElement)) {
      throw new Error('missing Source checkpoint select')
    }
    expect(checkpointSelect.value).toBe(checkpoint.id)
    expect(findButton('恢复').disabled).toBe(false)
    expect(document.body.textContent).toContain('已保存检查点：检查点 1')

    findButton('恢复').click()
    await flushPromises()

    expect(mocks.restoreCheckpoint).toHaveBeenCalledWith(source.projectId, checkpoint.id, {
      expectedRevision: 1,
      expectedSourceCreatedAt: 100,
    })
    expect(
      wrapper.findComponent({ name: 'MockFrontendWorkshopSourcePreview' }).props('sourceDocument'),
    ).toMatchObject({ revision: 2, authorSource: '<div id="checkpoint"></div>' })
    expect(findButton('撤销').disabled).toBe(false)
    expect(document.body.textContent).toContain('已恢复检查点：检查点 1；可撤销')
    wrapper.unmount()
  })

  it('keeps an inferred selection inspectable but disables precise Source writeback', async () => {
    mocks.getSourceDocument.mockResolvedValue(inferredSourceDocument())
    writeAppResumeState({ feature: 'frontendWorkshop', projectId: 'source-project' })
    const wrapper = mount(FrontendWorkshopSourceSession, { attachTo: document.body })
    await flushPromises()
    await flushPromises()

    findButton('选择元素').click()
    await flushPromises()

    const preview = wrapper.findComponent({ name: 'MockFrontendWorkshopSourcePreview' })
    preview.vm.$emit('domSnapshot', baselineSnapshot('button'))
    preview.vm.$emit('domSelection', runtimeSelection('button'))
    await flushPromises()

    expect(document.querySelector('[data-item-key="source.elementId"]')).toBeNull()
    expect(document.querySelectorAll('.source-property')).toHaveLength(0)
    expect(document.body.textContent).toContain('暂时无法准确定位')
    findButton('代码详情').click()
    await flushPromises()
    expect(findButton('查看元素代码').disabled).toBe(false)
    expect(mocks.applyHistory).not.toHaveBeenCalled()
    wrapper.unmount()
  })
})
