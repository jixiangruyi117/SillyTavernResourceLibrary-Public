// @vitest-environment jsdom
import { mount, flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFrontendWorkshopSourceDocument } from '../types/FrontendWorkshopSourceDocument'
import { prepareFrontendWorkshopSourcePatch } from '../utils/FrontendWorkshopSourcePatch'
const mocks = vi.hoisted(() => ({ apply: vi.fn() }))
vi.mock('../core/FrontendWorkshopContainer', () => ({
  frontendWorkshopSourceHistoryService: { applyAndRecord: mocks.apply },
}))
vi.mock('../composables/UseConfirmDialog', () => ({ confirmAction: vi.fn(async () => true) }))
import FrontendWorkshopSourceLayerPanel from './FrontendWorkshopSourceLayerPanel.vue'
const source = createFrontendWorkshopSourceDocument(
  'p',
  '<section data-fw-layer="person" data-fw-layer-name="人物"><div data-fw-layer="avatar" data-fw-layer-name="头像">占位</div></section>',
  1,
)
beforeEach(() => {
  mocks.apply.mockReset()
})
function mountPanel(locked: string[] = []) {
  return mount(FrontendWorkshopSourceLayerPanel, {
    props: {
      sourceDocument: source,
      selections: [],
      runtimeElements: [],
      viewState: { hidden: [], locked },
    },
    global: { stubs: { Teleport: true } },
  })
}
describe('source layer actions', () => {
  it('keeps the fixed layer surface discoverable as a dialog for iOS input viewport handling', () => {
    const wrapper = mountPanel()
    expect(wrapper.get('[role="dialog"]').attributes('aria-label')).toBe('作品图层')
    wrapper.unmount()
  })

  it('locks child groups when their ancestor is locked', () => {
    const wrapper = mountPanel(['person'])
    const child = wrapper.findAll('details.fw-layer-panel__group')[1]!
    expect(
      child
        .findAll('button')
        .filter((button) => ['选择整组', 'AI 修改', '删除'].includes(button.text()))
        .every((button) => button.attributes('disabled') !== undefined),
    ).toBe(true)
    expect(
      child
        .findAll('.fw-layer-panel__element')
        .every((button) => button.attributes('disabled') !== undefined),
    ).toBe(true)
    wrapper.unmount()
  })
  it('hides only through view state and extracts through an explicit task without a source write', async () => {
    const wrapper = mountPanel()
    await wrapper.get('[aria-label="隐藏人物"]').trigger('click')
    expect(wrapper.emitted('viewChange')?.[0]?.[0]).toMatchObject({ hidden: ['person'] })
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '提取组件')!
      .trigger('click')
    expect(wrapper.emitted('aiRequested')?.[0]?.[0]).toContain('data-fw-layer="person"')
    expect(wrapper.emitted('aiRequested')?.[0]?.[1]).toEqual([])
    expect(wrapper.emitted('close')).toHaveLength(1)
    expect(mocks.apply).not.toHaveBeenCalled()
    wrapper.unmount()
  })
  it('renames via existing reversible history rather than private layer metadata', async () => {
    const wrapper = mountPanel()
    mocks.apply.mockImplementation(async (patch) => ({
      document: {
        ...source,
        revision: 2,
        authorSource: prepareFrontendWorkshopSourcePatch(source, patch).authorSource,
      },
    }))
    await wrapper.get('[aria-label="图层名称 人物"]').setValue('角色资料')
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '改名')!
      .trigger('click')
    await flushPromises()
    expect(mocks.apply).toHaveBeenCalledOnce()
    expect((wrapper.emitted('revisionAccepted')?.[0]?.[0] as typeof source).authorSource).toContain(
      'data-fw-layer-name="角色资料"',
    )
    wrapper.unmount()
  })
})
