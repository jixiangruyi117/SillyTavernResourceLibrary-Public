/** @vitest-environment jsdom */
import { enableAutoUnmount, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'

import FrontendWorkshopToolRail from './FrontendWorkshopToolRail.vue'

enableAutoUnmount(afterEach)

describe('FrontendWorkshopToolRail', () => {
  it('逐个发送工具 intent，并呈现受控的当前工具', async () => {
    const wrapper = mount(FrontendWorkshopToolRail, {
      props: { activeTool: 'layers', canUndo: true, canRedo: true },
    })
    expect(wrapper.get('[aria-label="打开图层"]').classes()).toContain('is-active')

    await wrapper.get('[aria-label="快速添加"]').trigger('click')
    await wrapper.get('[aria-label="打开图层"]').trigger('click')
    await wrapper.get('[aria-label="打开肘肘更健康"]').trigger('click')
    await wrapper.get('[aria-label="更多工具"]').trigger('click')
    await wrapper.get('[aria-label="撤销"]').trigger('click')
    await wrapper.get('[aria-label="重做"]').trigger('click')

    expect(wrapper.emitted('selectTool')).toEqual([['quick-add'], ['layers'], ['ai'], ['more']])
    expect(wrapper.emitted('undo')).toHaveLength(1)
    expect(wrapper.emitted('redo')).toHaveLength(1)

    const labels = wrapper
      .findAll('.frontend-workbench__rail-tools > button')
      .map((button) => button.attributes('aria-label'))
    expect(labels).toEqual(['快速添加', '打开图层', '打开肘肘更健康', '撤销', '重做', '更多工具'])
  })

  it('收起前关闭当前面板，重新展开不复活旧 popover', async () => {
    const wrapper = mount(FrontendWorkshopToolRail, {
      attachTo: document.body,
      props: { activeTool: 'quick-add', canUndo: false, canRedo: false },
      slots: { default: '<div data-owner-panel>owner panel</div>' },
    })
    expect(wrapper.get('[aria-label="撤销"]').attributes('disabled')).toBeDefined()
    expect(wrapper.get('[aria-label="重做"]').attributes('disabled')).toBeDefined()

    await wrapper.get('.frontend-workbench__rail-toggle').trigger('click')
    expect(wrapper.classes()).toContain('is-collapsed')
    expect(wrapper.find('[data-owner-panel]').exists()).toBe(false)
    expect(wrapper.get('[aria-label="快速添加"]').isVisible()).toBe(false)
    expect(wrapper.get('.frontend-workbench__rail-tools').attributes('style')).toContain(
      'display: none',
    )
    expect(wrapper.emitted('selectTool')).toEqual([['quick-add']])

    await wrapper.get('.frontend-workbench__rail-toggle').trigger('click')
    expect(wrapper.classes()).not.toContain('is-collapsed')
    expect(wrapper.find('[data-owner-panel]').exists()).toBe(true)
    expect(wrapper.get('.frontend-workbench__rail-tools').attributes('style')).not.toContain(
      'display: none',
    )
    expect(wrapper.emitted('collapsedChange')).toEqual([[true], [false]])
  })
})
