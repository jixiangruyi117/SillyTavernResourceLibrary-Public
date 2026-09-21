/** @vitest-environment jsdom */
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createFrontendWorkshopSourceDocument } from '../types/FrontendWorkshopSourceDocument'
import { mapFrontendWorkshopRuntimeDomSnapshot } from '../utils/FrontendWorkshopRuntimeDomProvenance'
import { analyzeFrontendWorkshopSource } from '../utils/FrontendWorkshopSourceAnalysis'
import { resolveFrontendWorkshopSourceSelection } from '../utils/FrontendWorkshopSourceSelection'
import { resolveFrontendWorkshopSourceTransformTargets } from '../utils/FrontendWorkshopSourceTransform'

const { applyAndRecord, clearProject, createSourceComponent, getDocument, status } = vi.hoisted(
  () => ({
    applyAndRecord: vi.fn(),
    clearProject: vi.fn(),
    createSourceComponent: vi.fn(),
    getDocument: vi.fn(),
    status: vi.fn(() => ({ canUndo: false, canRedo: false, textUnits: 0 })),
  }),
)

vi.mock('../core/AppContainer', () => ({
  browserStorageService: {
    getFrontendWorkshopDrawerSize: () => ({ bottom: 0.46, side: 0.32 }),
    setFrontendWorkshopDrawerSize: vi.fn(),
  },
}))

vi.mock('../core/FrontendWorkshopContainer', () => ({
  frontendWorkshopSourceDocumentService: { get: getDocument },
  frontendWorkshopSourceHistoryService: { applyAndRecord, clearProject, status },
  frontendWorkshopSourceComponentService: { createFromSelection: createSourceComponent },
}))

import FrontendWorkshopSourceInspector from './FrontendWorkshopSourceInspector.vue'

enableAutoUnmount(afterEach)

function selectElements(
  source: ReturnType<typeof createFrontendWorkshopSourceDocument>,
  ids: string[],
) {
  const analysis = analyzeFrontendWorkshopSource(source)
  const identity = {
    projectId: source.projectId,
    sourceRevision: source.revision,
    instanceId: 'basic',
    runtimeNonce: 'basic',
  }
  const nodes = ids.map((id) => ({
    runtimeNodeId: id,
    nodeKind: 'element' as const,
    treeScope: 'document' as const,
    firstSeenSequence: 1,
    tagName: 'div',
    elementId: id,
  }))
  const mapping = mapFrontendWorkshopRuntimeDomSnapshot(source, analysis, {
    ...identity,
    requestId: 'basic',
    snapshotSequence: 1,
    nodes,
    truncated: false,
  })
  return ids.map((id, index) =>
    resolveFrontendWorkshopSourceSelection(
      source,
      analysis,
      {
        ...identity,
        runtimeNodeId: id,
        treeScope: 'document',
        tagName: 'div',
        elementId: id,
        rect: { x: 0, y: 0, width: 100, height: 50 },
      },
      mapping.nodes[index],
    ),
  )
}

describe('FrontendWorkshopSourceInspector', () => {
  beforeEach(() => {
    createSourceComponent.mockReset()
    applyAndRecord.mockReset()
  })

  it('多选文字仅生成所选元素的精确 patch，不触碰第三个元素或嵌套 HTML', async () => {
    const source = createFrontendWorkshopSourceDocument(
      'multi',
      '<div id="a">A</div><div id="b">B</div><div id="c">C</div>',
      100,
    )
    const selections = selectElements(source, ['a', 'b'])
    applyAndRecord.mockReset().mockResolvedValue({ document: { ...source, revision: 2 } })
    const wrapper = mount(FrontendWorkshopSourceInspector, {
      props: {
        sourceDocument: source,
        selection: selections[1],
        selections,
        transformTargets: { fields: {} },
      },
    })
    await wrapper.get('[data-item-key="source.text"] textarea').setValue('<b>修改</b>')
    await flushPromises()
    const patch = applyAndRecord.mock.calls[0]![0]
    expect(patch.edits).toHaveLength(2)
    expect(patch.edits.map((edit: { expectedText: string }) => edit.expectedText)).toEqual([
      'A',
      'B',
    ])
    expect(
      patch.edits.every(
        (edit: { replacement: string }) => edit.replacement === '&lt;b&gt;修改&lt;/b&gt;',
      ),
    ).toBe(true)
    const nested = createFrontendWorkshopSourceDocument(
      'multi',
      '<div id="a"><b>原始</b></div>',
      100,
    )
    await wrapper.setProps({
      sourceDocument: nested,
      selection: selectElements(nested, ['a'])[0],
      selections: [],
    })
    expect(wrapper.find('[data-item-key="source.text"]').exists()).toBe(false)
  })

  it('重新选择另一个元素会展开收起的抽屉，ID 只在代码详情中展示', async () => {
    const source = createFrontendWorkshopSourceDocument(
      'multi',
      '<div id="a">A</div><div id="b">B</div>',
      100,
    )
    const selections = selectElements(source, ['a', 'b'])
    const wrapper = mount(FrontendWorkshopSourceInspector, {
      props: { sourceDocument: source, selection: selections[0], transformTargets: { fields: {} } },
    })
    await wrapper.get('.source-inspector-handle').trigger('click')
    expect(wrapper.classes()).toContain('is-collapsed')
    await wrapper.setProps({ selection: selections[1] })
    expect(wrapper.classes()).not.toContain('is-collapsed')
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '代码详情')!
      .trigger('click')
    expect(wrapper.get('[aria-label="代码详情"]').text()).toContain('代码标识b')
    expect(wrapper.find('[data-item-key="source.elementId"]').exists()).toBe(false)
    expect(
      wrapper.findAll('button').filter((button) => button.text() === '查看元素代码'),
    ).toHaveLength(1)
  })

  it('普通行内 CSS 多选只修改各自的值；不支持的 Source 值隐藏', async () => {
    const source = createFrontendWorkshopSourceDocument(
      'multi',
      '<div id="a" style="color:red">A</div><div id="b" style="color:blue">B</div><div id="c" style="color:black">C</div>',
      100,
    )
    const selections = selectElements(source, ['a', 'b'])
    vi.stubGlobal('CSS', { supports: () => true })
    applyAndRecord.mockReset().mockResolvedValue({ document: { ...source, revision: 2 } })
    const wrapper = mount(FrontendWorkshopSourceInspector, {
      props: {
        sourceDocument: source,
        selection: selections[1],
        selections,
        transformTargets: { fields: {} },
      },
    })
    await wrapper.get('button[data-tab="appearance"]').trigger('click')
    await wrapper.get('[data-item-key="css.color"] input').setValue('green')
    await flushPromises()
    expect(applyAndRecord.mock.calls[0]![0].edits).toEqual([
      expect.objectContaining({ expectedText: 'red', replacement: 'green' }),
      expect.objectContaining({ expectedText: 'blue', replacement: 'green' }),
    ])
    vi.unstubAllGlobals()
  })

  it('未选中元素时收起面板，展开后给出选择指引和唯一 AI 入口', async () => {
    const source = createFrontendWorkshopSourceDocument('source-project', '<div>source</div>', 100)
    const wrapper = mount(FrontendWorkshopSourceInspector, {
      props: { sourceDocument: source, transformTargets: { fields: {} } },
    })

    expect(wrapper.get('.frontend-workshop-source-inspector').classes()).toContain('is-empty')
    expect(wrapper.classes()).toContain('is-collapsed')
    await wrapper.get('.source-inspector-handle').trigger('click')
    expect(wrapper.classes()).not.toContain('is-collapsed')
    expect(wrapper.text()).toContain('选择元素')
    const ai = wrapper.findAll('button').filter((button) => button.text() === 'AI 创作')
    expect(ai).toHaveLength(1)
    await ai[0]!.trigger('click')
    expect(wrapper.emitted('aiRequested')).toHaveLength(1)
  })

  it('更多内容设置仍把当前 revision 的精确属性 range 交给 History/Patch 链', async () => {
    const source = createFrontendWorkshopSourceDocument(
      'source-project',
      '<div id="hero" title="old">source</div>',
      100,
    )
    const analysis = analyzeFrontendWorkshopSource(source)
    const runtimeSelection = {
      projectId: source.projectId,
      sourceRevision: source.revision,
      instanceId: 'instance-a',
      runtimeNonce: 'nonce-a',
      runtimeNodeId: 'node-a',
      treeScope: 'document',
      tagName: 'div',
      elementId: 'hero',
      rect: { x: 0, y: 0, width: 100, height: 50 },
    } as const
    const mapping = mapFrontendWorkshopRuntimeDomSnapshot(source, analysis, {
      projectId: source.projectId,
      sourceRevision: source.revision,
      instanceId: 'instance-a',
      runtimeNonce: 'nonce-a',
      requestId: 'snapshot-a',
      snapshotSequence: 1,
      nodes: [
        {
          runtimeNodeId: 'node-a',
          nodeKind: 'element',
          treeScope: 'document',
          firstSeenSequence: 1,
          tagName: 'div',
          elementId: 'hero',
        },
      ],
      truncated: false,
    })
    const selection = resolveFrontendWorkshopSourceSelection(
      source,
      analysis,
      runtimeSelection,
      mapping.nodes[0],
    )
    const next = {
      ...source,
      revision: 2,
      authorSource: '<div id="hero" title="next">source</div>',
    }
    applyAndRecord.mockResolvedValue({ document: next })
    const wrapper = mount(FrontendWorkshopSourceInspector, {
      props: { sourceDocument: source, selection, transformTargets: { fields: {} } },
    })

    await wrapper.get('summary').trigger('click')
    const input = wrapper.get('[data-item-key="attribute.title"] input')
    await input.setValue('next')
    await flushPromises()

    expect(applyAndRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: source.projectId,
        sourceRevision: source.revision,
        edits: [expect.objectContaining({ expectedText: 'old', replacement: 'next' })],
      }),
      { label: '悬停提示' },
    )
    expect(wrapper.emitted('revisionAccepted')?.at(-1)?.[0]).toEqual(next)
    expect(wrapper.text()).toContain('已保存；可撤销')
  })

  it('把保存为组件放在精确 Source 选区操作中并复用 S8 Service', async () => {
    const source = createFrontendWorkshopSourceDocument(
      'source-project',
      '<article id="hero">source</article>',
      100,
    )
    const analysis = analyzeFrontendWorkshopSource(source)
    const runtimeSelection = {
      projectId: source.projectId,
      sourceRevision: source.revision,
      instanceId: 'instance-a',
      runtimeNonce: 'nonce-a',
      runtimeNodeId: 'node-a',
      treeScope: 'document',
      tagName: 'article',
      elementId: 'hero',
      rect: { x: 0, y: 0, width: 100, height: 50 },
    } as const
    const mapping = mapFrontendWorkshopRuntimeDomSnapshot(source, analysis, {
      projectId: source.projectId,
      sourceRevision: source.revision,
      instanceId: 'instance-a',
      runtimeNonce: 'nonce-a',
      requestId: 'snapshot-a',
      snapshotSequence: 1,
      nodes: [
        {
          runtimeNodeId: 'node-a',
          nodeKind: 'element',
          treeScope: 'document',
          firstSeenSequence: 1,
          tagName: 'article',
          elementId: 'hero',
        },
      ],
      truncated: false,
    })
    const selection = resolveFrontendWorkshopSourceSelection(
      source,
      analysis,
      runtimeSelection,
      mapping.nodes[0],
    )
    createSourceComponent.mockResolvedValue({ name: 'Hero 卡片' })
    const wrapper = mount(FrontendWorkshopSourceInspector, {
      props: { sourceDocument: source, selection, transformTargets: { fields: {} } },
    })

    await wrapper
      .findAll('button')
      .find((button) => button.text() === '存为组件')!
      .trigger('click')
    await wrapper.get('[aria-label="组件名称"]').setValue('Hero 卡片')
    await wrapper.get('form.source-inspector-utility').trigger('submit')
    await flushPromises()

    expect(createSourceComponent).toHaveBeenCalledWith(source, selection, {
      name: 'Hero 卡片',
    })
    expect(wrapper.text()).toContain('已保存到组件库')
    expect(wrapper.emitted('componentSaved')).toHaveLength(1)
  })

  it('runtime-only selection 显示原因与可用下一步，不伪造 Source range', async () => {
    const source = createFrontendWorkshopSourceDocument('source-project', '<div>source</div>', 100)
    const selection = resolveFrontendWorkshopSourceSelection(
      source,
      analyzeFrontendWorkshopSource(source),
      {
        projectId: source.projectId,
        sourceRevision: source.revision,
        instanceId: 'instance-a',
        runtimeNonce: 'nonce-a',
        runtimeNodeId: 'node-a',
        treeScope: 'document',
        tagName: 'span',
        rect: { x: 0, y: 0, width: 10, height: 10 },
      },
    )
    const wrapper = mount(FrontendWorkshopSourceInspector, {
      props: { sourceDocument: source, selection, transformTargets: { fields: {} } },
    })
    expect(wrapper.find('[data-item-key="source.elementId"]').exists()).toBe(false)
    expect(wrapper.findAll('.source-property')).toHaveLength(0)
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '代码详情')!
      .trigger('click')
    expect(wrapper.text()).toContain('没有可定位的源码位置')
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '存为组件')!
      .trigger('click')
    expect(wrapper.get('button[type="submit"]').attributes('disabled')).toBeDefined()
    expect(wrapper.find('[aria-label="代码详情"]').exists()).toBe(false)
    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'AI 修改')!
      .trigger('click')
    expect(wrapper.emitted('aiRequested')).toHaveLength(1)
  })

  it('作为 Writeback Owner 把画布手势写成一个原子 History patch', async () => {
    const source = createFrontendWorkshopSourceDocument(
      'source-project',
      '<div id="hero" style="position:relative;left:10px;top:20px"></div>',
      100,
    )
    const analysis = analyzeFrontendWorkshopSource(source)
    const runtimeSelection = {
      projectId: source.projectId,
      sourceRevision: source.revision,
      instanceId: 'instance-a',
      runtimeNonce: 'nonce-a',
      runtimeNodeId: 'node-a',
      treeScope: 'document',
      tagName: 'div',
      elementId: 'hero',
      rect: { x: 10, y: 20, width: 100, height: 50 },
    } as const
    const mapping = mapFrontendWorkshopRuntimeDomSnapshot(source, analysis, {
      projectId: source.projectId,
      sourceRevision: source.revision,
      instanceId: 'instance-a',
      runtimeNonce: 'nonce-a',
      requestId: 'snapshot-a',
      snapshotSequence: 1,
      nodes: [
        {
          runtimeNodeId: 'node-a',
          nodeKind: 'element',
          treeScope: 'document',
          firstSeenSequence: 1,
          tagName: 'div',
          elementId: 'hero',
        },
      ],
      truncated: false,
    })
    const selection = resolveFrontendWorkshopSourceSelection(
      source,
      analysis,
      runtimeSelection,
      mapping.nodes[0],
    )
    const transformTargets = resolveFrontendWorkshopSourceTransformTargets(
      source,
      analysis,
      selection,
    )
    const next = {
      ...source,
      revision: 2,
      authorSource: '<div id="hero" style="position:relative;left:25px;top:15px"></div>',
    }
    applyAndRecord.mockResolvedValue({ document: next })
    const wrapper = mount(FrontendWorkshopSourceInspector, {
      props: { sourceDocument: source, selection, transformTargets },
    })

    await wrapper.vm.applyCanvasGesture({
      selection: runtimeSelection,
      gesture: { mode: 'move', deltaX: 15, deltaY: -5 },
    })

    expect(applyAndRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: source.projectId,
        sourceRevision: source.revision,
        edits: [
          expect.objectContaining({ expectedText: '10px', replacement: '25px' }),
          expect.objectContaining({ expectedText: '20px', replacement: '15px' }),
        ],
      }),
      { label: '移动元素' },
    )
    expect(wrapper.emitted('revisionAccepted')?.at(-1)?.[0]).toEqual(next)
  })
})
