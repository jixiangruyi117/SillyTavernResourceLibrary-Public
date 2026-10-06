/** @vitest-environment jsdom */
import { enableAutoUnmount, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createFrontendWorkshopSourceDocument } from '../types/FrontendWorkshopSourceDocument'
import FrontendWorkshopSourceWorkspace from './FrontendWorkshopSourceWorkspace.vue'

enableAutoUnmount(afterEach)

const SourcePreviewStub = {
  name: 'FrontendWorkshopSourcePreview',
  props: ['selectionMode', 'gestureDisabled', 'selectedDomSelections', 'previewSessionContext'],
  emits: ['domSnapshot', 'domSelection', 'compatibilityDiagnostic'],
  template:
    '<div class="source-preview-stub" :data-selection-mode="selectionMode" :data-disabled="gestureDisabled" :data-selection-count="selectedDomSelections.length" />',
}

function dispatchPointer(
  element: Element,
  type: string,
  options: { pointerId: number; clientX: number; clientY: number },
): void {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: options.clientX,
    clientY: options.clientY,
    screenX: options.clientX,
    screenY: options.clientY,
  })
  Object.defineProperties(event, {
    pointerId: { value: options.pointerId },
    pointerType: { value: 'touch' },
  })
  element.dispatchEvent(event)
}

describe('FrontendWorkshopSourceWorkspace', () => {
  it('Source revision 更新保留多选工具状态，单选按钮退出多选而不是关闭选择', async () => {
    const sourceDocument = createFrontendWorkshopSourceDocument(
      'source-project',
      '<div id="a">A</div>',
      100,
    )
    const wrapper = mount(FrontendWorkshopSourceWorkspace, {
      props: { sourceDocument, networkMode: 'offline' },
      global: { stubs: { FrontendWorkshopSourcePreview: SourcePreviewStub } },
    })
    const owner = wrapper.vm as unknown as {
      toggleMultiSelectMode(): void
      toggleSelectionMode(): void
    }
    owner.toggleMultiSelectMode()
    await wrapper.setProps({ sourceDocument: { ...sourceDocument, revision: 2 } })
    expect(wrapper.emitted('multiSelectModeChange')?.at(-1)).toEqual([true])
    owner.toggleSelectionMode()
    await wrapper.vm.$nextTick()
    expect(wrapper.emitted('multiSelectModeChange')?.at(-1)).toEqual([false])
    expect(wrapper.get('.source-preview-stub').attributes('data-selection-mode')).toBe('true')
  })

  it('拥有选择模式并把状态传给唯一 Source Preview Runtime', async () => {
    const sourceDocument = createFrontendWorkshopSourceDocument(
      'source-project',
      '<div id="hero">source</div>',
      100,
    )
    const wrapper = mount(FrontendWorkshopSourceWorkspace, {
      props: { sourceDocument, networkMode: 'offline', gestureDisabled: true },
      global: { stubs: { FrontendWorkshopSourcePreview: SourcePreviewStub } },
    })
    const owner = wrapper.vm as unknown as {
      resetSelection: (clearMode?: boolean) => void
      toggleSelectionMode: () => void
    }

    expect(wrapper.get('.source-preview-stub').attributes('data-selection-mode')).toBe('false')
    owner.toggleSelectionMode()
    await wrapper.vm.$nextTick()
    expect(wrapper.get('.source-preview-stub').attributes('data-selection-mode')).toBe('true')
    expect(wrapper.emitted('selectionModeChange')).toEqual([[true]])

    owner.resetSelection(true)
    await wrapper.vm.$nextTick()
    expect(wrapper.get('.source-preview-stub').attributes('data-selection-mode')).toBe('false')
    expect(wrapper.emitted('selectionModeChange')).toEqual([[true], [false]])
  })

  it('PreviewSessionContext 默认缺席，只透传调用方明确提供的内存 Context', () => {
    const sourceDocument = createFrontendWorkshopSourceDocument(
      'source-project',
      '<div>source</div>',
      100,
    )
    const withoutContext = mount(FrontendWorkshopSourceWorkspace, {
      props: { sourceDocument, networkMode: 'offline' },
      global: { stubs: { FrontendWorkshopSourcePreview: SourcePreviewStub } },
    })
    expect(
      withoutContext.findComponent(SourcePreviewStub).props('previewSessionContext'),
    ).toBeUndefined()
    withoutContext.unmount()

    const previewSessionContext = { character: { name: 'fixture-character' } }
    const withContext = mount(FrontendWorkshopSourceWorkspace, {
      props: { sourceDocument, networkMode: 'offline', previewSessionContext },
      global: { stubs: { FrontendWorkshopSourcePreview: SourcePreviewStub } },
    })
    expect(withContext.findComponent(SourcePreviewStub).props('previewSessionContext')).toEqual(
      previewSessionContext,
    )
  })

  it('多选模式把连续 Runtime 点击收敛为同一个 selections Owner 并可再次点击取消', async () => {
    const sourceDocument = createFrontendWorkshopSourceDocument(
      'source-project',
      '<main><section id="one">一</section><section id="two">二</section></main>',
      100,
    )
    const wrapper = mount(FrontendWorkshopSourceWorkspace, {
      props: { sourceDocument, networkMode: 'offline' },
      global: { stubs: { FrontendWorkshopSourcePreview: SourcePreviewStub } },
    })
    const owner = wrapper.vm as unknown as { toggleMultiSelectMode: () => void }
    owner.toggleMultiSelectMode()
    await wrapper.vm.$nextTick()
    const preview = wrapper.findComponent(SourcePreviewStub)
    const identity = {
      projectId: 'source-project',
      sourceRevision: 1,
      instanceId: 'runtime',
      runtimeNonce: 'nonce',
    }
    preview.vm.$emit('domSnapshot', {
      ...identity,
      requestId: 'snapshot',
      snapshotSequence: 1,
      truncated: false,
      nodes: [
        {
          runtimeNodeId: 'one',
          nodeKind: 'element',
          treeScope: 'document',
          firstSeenSequence: 1,
          tagName: 'section',
          elementId: 'one',
        },
        {
          runtimeNodeId: 'two',
          nodeKind: 'element',
          treeScope: 'document',
          firstSeenSequence: 1,
          tagName: 'section',
          elementId: 'two',
        },
      ],
    })
    const selection = (runtimeNodeId: string, elementId: string, x: number) => ({
      ...identity,
      runtimeNodeId,
      treeScope: 'document',
      tagName: 'section',
      elementId,
      rect: { x, y: 10, width: 80, height: 40 },
    })
    preview.vm.$emit('domSelection', selection('one', 'one', 10))
    preview.vm.$emit('domSelection', selection('two', 'two', 110))
    await wrapper.vm.$nextTick()

    const emissions = wrapper.emitted('selectionsChange') ?? []
    expect(emissions.at(-1)?.[0]).toHaveLength(2)
    expect(wrapper.get('.source-preview-stub').attributes('data-selection-count')).toBe('2')
    expect(wrapper.get('.frontend-workshop-source-workspace__selection-summary').text()).toContain(
      '已选 2 个',
    )

    preview.vm.$emit('domSelection', selection('one', 'one', 10))
    await wrapper.vm.$nextTick()
    expect((wrapper.emitted('selectionsChange') ?? []).at(-1)?.[0]).toHaveLength(1)
  })

  it('长按后移动视角，普通拖动保留滚动，选择模式不丢失', async () => {
    vi.useFakeTimers()
    const wrapper = mount(FrontendWorkshopSourceWorkspace, {
      attachTo: document.body,
      props: {
        sourceDocument: createFrontendWorkshopSourceDocument('p', '<h1>标题</h1>', 1),
        networkMode: 'offline',
      },
      global: { stubs: { FrontendWorkshopSourcePreview: SourcePreviewStub } },
    })
    const owner = wrapper.vm as unknown as { toggleSelectionMode(): void }
    owner.toggleSelectionMode()
    const viewport = wrapper.get('.frontend-workshop-source-workspace__viewport')
    dispatchPointer(viewport.element, 'pointerdown', { pointerId: 4, clientX: 40, clientY: 60 })
    dispatchPointer(viewport.element, 'pointermove', { pointerId: 4, clientX: 78, clientY: 92 })
    await vi.advanceTimersByTimeAsync(500)
    expect(wrapper.get('.frontend-workshop-source-workspace__stage').attributes('style')).toContain(
      'translate3d(0px, 0px, 0)',
    )
    dispatchPointer(viewport.element, 'pointerdown', { pointerId: 5, clientX: 40, clientY: 60 })
    await vi.advanceTimersByTimeAsync(400)
    dispatchPointer(viewport.element, 'pointermove', { pointerId: 5, clientX: 78, clientY: 92 })
    dispatchPointer(viewport.element, 'pointerup', { pointerId: 5, clientX: 78, clientY: 92 })
    await wrapper.vm.$nextTick()
    expect(wrapper.get('.frontend-workshop-source-workspace__stage').attributes('style')).toContain(
      'translate3d(38px, 32px, 0)',
    )
    expect(wrapper.get('.source-preview-stub').attributes('data-selection-mode')).toBe('true')
    wrapper.unmount()
    vi.useRealTimers()
  })

  it('Source 不可用时不伪造结构化预览', () => {
    const wrapper = mount(FrontendWorkshopSourceWorkspace, {
      props: { networkMode: 'offline' },
      global: { stubs: { FrontendWorkshopSourcePreview: SourcePreviewStub } },
    })
    expect(wrapper.find('.source-preview-stub').exists()).toBe(false)
    expect(wrapper.text()).toContain('没有改用旧预览')
  })

  it('把唯一 Source Preview 的 Compatibility Diagnostic 原样交给上层 Owner', async () => {
    const sourceDocument = createFrontendWorkshopSourceDocument(
      'source-project',
      '<div>source</div>',
      100,
    )
    const wrapper = mount(FrontendWorkshopSourceWorkspace, {
      props: { sourceDocument, networkMode: 'offline' },
      global: { stubs: { FrontendWorkshopSourcePreview: SourcePreviewStub } },
    })
    const diagnostic = {
      capability: 'message-api',
      implementationStatus: 'PARTIAL',
      parityStatus: 'UNVERIFIED',
      source: 'runtime',
      callCount: 1,
      impact: '需要真实宿主验证',
    }

    wrapper.findComponent(SourcePreviewStub).vm.$emit('compatibilityDiagnostic', diagnostic)
    await wrapper.vm.$nextTick()

    expect(wrapper.emitted('compatibilityDiagnostic')).toEqual([[diagnostic]])
  })
})
