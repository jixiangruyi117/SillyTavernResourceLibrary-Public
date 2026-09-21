/** @vitest-environment jsdom */
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  createFrontendWorkshopProject,
  type FrontendWorkshopNode,
  type FrontendWorkshopProject,
} from '../types/FrontendWorkshopProject'
import FrontendWorkshopWorkspace from './FrontendWorkshopWorkspace.vue'

enableAutoUnmount(afterEach)

function node(
  id: string,
  label: string,
  zIndex: number,
  layerId = 'content-layer',
): FrontendWorkshopNode {
  return {
    id,
    kind: 'text',
    label,
    style: {},
    children: [],
    layerId,
    layout: {
      phone: { x: 12, y: 20, width: 220, height: 120, zIndex },
      wide: { x: 12, y: 20, width: 220, height: 120, zIndex },
    },
  }
}

function projectWithNodes(nodes: FrontendWorkshopNode[]): FrontendWorkshopProject {
  const project = createFrontendWorkshopProject('greeting')
  project.pages[0]!.nodes = nodes
  project.pages[0]!.layers = [
    { id: 'locked-layer', name: '背景层', visible: true, locked: true },
    { id: 'content-layer', name: '内容层', visible: true, locked: false },
  ]
  return project
}

function dispatchPointer(
  element: Element,
  type: string,
  values: { pointerId: number; pointerType: string; clientX: number; clientY: number },
): void {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperties(event, {
    pointerId: { value: values.pointerId },
    pointerType: { value: values.pointerType },
    clientX: { value: values.clientX },
    clientY: { value: values.clientY },
    button: { value: 0 },
  })
  element.dispatchEvent(event)
}

function mountWorkspace(project: FrontendWorkshopProject, selectedNodeId = '') {
  return mount(FrontendWorkshopWorkspace, {
    attachTo: document.body,
    props: {
      project,
      pageId: project.pages[0]!.id,
      selectedNodeId,
      activeLayerId: '',
      canvasMode: 'phone',
      hotspotDrawMode: false,
    },
    global: { stubs: { Teleport: true } },
  })
}

describe('FrontendWorkshopWorkspace direct canvas', () => {
  it('画布自己拥有视口状态，项目栏只调用其公开操作', async () => {
    const wrapper = mountWorkspace(projectWithNodes([]))
    await flushPromises()
    wrapper.vm.resetZoom()
    await flushPromises()
    expect(wrapper.get('.frontend-workbench__canvas').attributes('style')).toContain('scale(1)')
    wrapper.vm.adjustZoom(-0.25)
    await flushPromises()
    expect(wrapper.get('.frontend-workbench__canvas').attributes('style')).toContain('scale(0.75)')
    wrapper.vm.setCanvasMode('wide')
    expect(wrapper.emitted('canvasModeChange')).toEqual([['wide']])
    expect(wrapper.find('.frontend-workbench__transform-dock').exists()).toBe(false)
    expect(wrapper.find('[aria-label="编辑当前元素内容"]').exists()).toBe(false)
  })

  it('拥有单选、锁定查看与重叠命中选择', async () => {
    const background = node('background', '背景', 1, 'locked-layer')
    background.kind = 'image'
    const front = node('front', '前景', 4)
    const wrapper = mountWorkspace(projectWithNodes([background, front]))
    const frontElement = wrapper.get('[data-node-id="front"]').element

    dispatchPointer(frontElement, 'pointerdown', {
      pointerId: 1,
      pointerType: 'mouse',
      clientX: 24,
      clientY: 32,
    })
    frontElement.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 24, clientY: 32 }))
    dispatchPointer(frontElement, 'pointerdown', {
      pointerId: 2,
      pointerType: 'mouse',
      clientX: 24,
      clientY: 32,
    })
    frontElement.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 24, clientY: 32 }))
    await flushPromises()

    const picker = wrapper.get('.frontend-workbench__overlap-picker')
    expect(picker.text()).toContain('文字：前景')
    expect(picker.text()).toContain('图片：背景')
    expect(picker.text()).toContain('图层已锁定')
    await picker
      .findAll('button')
      .find((button) => button.text().includes('图片：背景'))!
      .trigger('click')
    expect(wrapper.emitted('selectNode')?.at(-1)).toEqual(['background'])
    await wrapper.setProps({ selectedNodeId: 'background' })
    expect(wrapper.get('.frontend-workbench__transform-readout').text()).toContain('已锁定')
  })

  it('同一 pointer lifecycle 提交拖动，pointercancel 只恢复预览', async () => {
    const wrapper = mountWorkspace(projectWithNodes([node('front', '前景', 1)]))
    const frontElement = wrapper.get('[data-node-id="front"]').element
    const canvas = wrapper.get('.frontend-workbench__canvas').element

    dispatchPointer(frontElement, 'pointerdown', {
      pointerId: 3,
      pointerType: 'mouse',
      clientX: 24,
      clientY: 32,
    })
    dispatchPointer(canvas, 'pointermove', {
      pointerId: 3,
      pointerType: 'mouse',
      clientX: 64,
      clientY: 72,
    })
    dispatchPointer(canvas, 'pointerup', {
      pointerId: 3,
      pointerType: 'mouse',
      clientX: 64,
      clientY: 72,
    })
    expect(wrapper.emitted('previewProject')?.length).toBeGreaterThan(0)
    expect(wrapper.emitted('commitGesture')).toHaveLength(1)

    dispatchPointer(frontElement, 'pointerdown', {
      pointerId: 4,
      pointerType: 'mouse',
      clientX: 24,
      clientY: 32,
    })
    dispatchPointer(canvas, 'pointermove', {
      pointerId: 4,
      pointerType: 'mouse',
      clientX: 84,
      clientY: 92,
    })
    dispatchPointer(canvas, 'pointercancel', {
      pointerId: 4,
      pointerType: 'mouse',
      clientX: 84,
      clientY: 92,
    })
    expect(wrapper.emitted('commitGesture')).toHaveLength(1)
  })

  it('空白画布只发出清除选择 intent', async () => {
    const wrapper = mountWorkspace(projectWithNodes([]))
    await wrapper.get('.frontend-workbench__canvas').trigger('click')
    expect(wrapper.emitted('clearSelection')).toHaveLength(1)
  })

  it('选中元素直接显示画布变换手柄，不再生成第二套编辑入口', async () => {
    const wrapper = mountWorkspace(projectWithNodes([node('front', '前景', 1)]), 'front')
    await flushPromises()
    expect(wrapper.findAll('.frontend-workbench__scale-handle')).toHaveLength(4)
    expect(wrapper.find('.frontend-workbench__rotate-handle').exists()).toBe(true)
    expect(wrapper.find('.frontend-workbench__transform-dock').exists()).toBe(false)
    expect(wrapper.emitted('requestPanel')).toBeUndefined()
    expect(wrapper.emitted('requestDetail')).toBeUndefined()
  })

  it('用屏幕像素阈值取消长按，不受画布缩放影响', async () => {
    vi.useFakeTimers()
    try {
      const back = node('back', '背景', 1)
      const front = node('front', '前景', 2)
      const wrapper = mountWorkspace(projectWithNodes([back, front]))
      const frontElement = wrapper.get('[data-node-id="front"]').element
      const canvas = wrapper.get('.frontend-workbench__canvas').element
      Object.defineProperty(canvas, 'getBoundingClientRect', {
        configurable: true,
        value: () => ({
          width: 780,
          height: 1720,
          left: 0,
          top: 0,
          right: 780,
          bottom: 1720,
        }),
      })

      dispatchPointer(frontElement, 'pointerdown', {
        pointerId: 32,
        pointerType: 'touch',
        clientX: 48,
        clientY: 64,
      })
      dispatchPointer(canvas, 'pointermove', {
        pointerId: 32,
        pointerType: 'touch',
        clientX: 59,
        clientY: 64,
      })
      await vi.advanceTimersByTimeAsync(500)
      await flushPromises()

      expect(wrapper.find('.frontend-workbench__overlap-picker').exists()).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })
})
