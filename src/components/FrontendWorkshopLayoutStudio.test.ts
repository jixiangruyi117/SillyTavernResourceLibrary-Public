/** @vitest-environment jsdom */
import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../composables/UseConfirmDialog', () => ({
  confirmAction: vi.fn(async () => true),
}))

import FrontendWorkshopLayoutStudio from './FrontendWorkshopLayoutStudio.vue'

const fields = [
  {
    label: '姓名',
    example: '测试角色',
    group: '基础信息',
    kind: 'text' as const,
    path: '姓名',
  },
  {
    label: '状态',
    example: '探索中',
    group: '基础信息',
    kind: 'text' as const,
    path: '状态',
  },
]

describe('FrontendWorkshopLayoutStudio', () => {
  beforeEach(() => {
    vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)
  })

  it('使用不透明、固定到真实视口的顶层工作台并锁定底层页面', () => {
    const wrapper = mount(FrontendWorkshopLayoutStudio, {
      attachTo: document.body,
      props: { fields, imageUrls: [] },
    })
    const overlay = wrapper.get('.layout-studio').element as HTMLElement

    expect(overlay.style.position).toBe('fixed')
    expect(overlay.style.inset).toBe('0px')
    expect(overlay.style.height).toBe('var(--app-viewport-height)')
    expect(overlay.style.backgroundColor).toContain('--color-surface')
    expect(document.body.style.position).toBe('fixed')
    expect(document.documentElement.style.overflow).toBe('hidden')

    wrapper.unmount()
    expect(document.body.style.position).toBe('')
    expect(document.documentElement.style.overflow).toBe('')
  })

  it('操作响应式布局时可以写入撤销栈，不再把 Vue Proxy 交给 structuredClone', async () => {
    const wrapper = mount(FrontendWorkshopLayoutStudio, {
      props: { fields, imageUrls: [] },
    })

    const leftAlign = wrapper
      .findAll('.layout-studio__toolbar button')
      .find((button) => button.attributes('title') === '左对齐')!
    await expect(leftAlign.trigger('click')).resolves.toBeUndefined()

    const undo = wrapper
      .findAll('.layout-studio__mobile-history button')
      .find((button) => button.text() === '撤销')!
    expect(undo.attributes('disabled')).toBeUndefined()
    await expect(undo.trigger('click')).resolves.toBeUndefined()
    wrapper.unmount()
  })

  it('指针操作后恢复工具条、画布和属性面板的滚动位置', async () => {
    const wrapper = mount(FrontendWorkshopLayoutStudio, {
      attachTo: document.body,
      props: { fields, imageUrls: [] },
    })
    const toolbar = wrapper.get('.layout-studio__toolbar').element as HTMLElement
    const canvasScroll = wrapper.get('.layout-studio__canvas-scroll').element as HTMLElement
    const inspector = wrapper.get('.layout-studio__inspector').element as HTMLElement
    toolbar.scrollLeft = 42
    canvasScroll.scrollTop = 36
    inspector.scrollTop = 28

    const phoneButton = wrapper
      .findAll('.layout-studio__viewport-tabs button')
      .find((button) => button.text() === '手机布局')!
    await phoneButton.trigger('pointerdown', { pointerId: 1, pointerType: 'touch' })
    toolbar.scrollLeft = 120
    canvasScroll.scrollTop = 90
    inspector.scrollTop = 80
    phoneButton.element.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))
    await wrapper.vm.$nextTick()

    expect(toolbar.scrollLeft).toBe(42)
    expect(canvasScroll.scrollTop).toBe(36)
    expect(inspector.scrollTop).toBe(28)
    wrapper.unmount()
  })

  it('手机画布提示可以上下滑动查看完整布局', () => {
    const wrapper = mount(FrontendWorkshopLayoutStudio, {
      props: { fields, imageUrls: [] },
    })

    expect(wrapper.get('.layout-studio__canvas-scroll-hint').text()).toContain(
      '上下滑动画布，查看完整手机布局',
    )
    expect(
      wrapper
        .get('.layout-studio__canvas-scroll')
        .element.contains(wrapper.get('.layout-studio__canvas').element),
    ).toBe(true)
    wrapper.unmount()
  })
})
