/** @vitest-environment jsdom */
import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Category } from '../types/Resource'
import BatchBar from './BatchBar.vue'

const categories = [
  { id: 'f1', name: '古风卡', color: '#888' },
  { id: 'f2', name: '现代卡', color: '#999' },
] as Category[]

function render(overrides: Record<string, unknown> = {}) {
  return mount(BatchBar, {
    props: {
      count: 3,
      visibleCount: 24,
      allVisibleSelected: false,
      scopeCount: 120,
      scopeLabel: '筛选结果',
      allScopeSelected: false,
      selectedCharacterCount: 2,
      categories,
      busy: false,
      ...overrides,
    },
  })
}

describe('BatchBar', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('报告实际边框高度、跟随换行更新，并在卸载时释放占位', () => {
    let notifyResize: ResizeObserverCallback | undefined
    const observe = vi.fn()
    const disconnect = vi.fn()
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: ResizeObserverCallback) {
          notifyResize = callback
        }
        observe = observe
        disconnect = disconnect
      },
    )
    let height = 273
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
      () => ({ height }) as DOMRect,
    )
    const wrapper = render()
    expect(wrapper.emitted('resize')).toEqual([[273]])
    expect(observe).toHaveBeenCalledWith(wrapper.element, { box: 'border-box' })
    height = 321
    notifyResize!([], {} as ResizeObserver)
    expect(wrapper.emitted('resize')?.at(-1)).toEqual([321])
    wrapper.unmount()
    expect(disconnect).toHaveBeenCalledOnce()
    expect(wrapper.emitted('resize')?.at(-1)).toEqual([0])
  })

  it('展示已选数量并标注为批量操作区', () => {
    const wrapper = render()
    expect(wrapper.attributes('aria-label')).toBe('批量操作')
    expect(wrapper.text()).toContain('3')
    expect(wrapper.text()).toContain('项已选择')
  })

  it('同时提供“选择本页”和“全选当前范围”两个入口', () => {
    const wrapper = render()
    const text = wrapper.text()
    expect(text).toContain('24')
    expect(text).toContain('120')
    expect(text).toContain('筛选结果')
  })

  it('忙碌时禁用全部操作按钮，只保留退出入口', () => {
    const wrapper = render({ busy: true })
    const enabled = wrapper.findAll('button').filter((b) => b.attributes('disabled') === undefined)
    // 批量操作进行中仍必须能退出批量模式，否则用户会被困住
    expect(enabled).toHaveLength(1)
    expect(enabled[0].attributes('aria-label')).toBe('退出批量模式')
  })

  it('非忙碌时按钮可用', () => {
    const wrapper = render()
    const enabled = wrapper.findAll('button').filter((b) => !b.attributes('disabled'))
    expect(enabled.length).toBeGreaterThan(0)
  })

  it('点击收藏与取消收藏分别带出布尔参数', async () => {
    const wrapper = render()
    const favorite = wrapper.findAll('button').filter((b) => b.text().includes('收藏'))
    expect(favorite.length).toBeGreaterThanOrEqual(2)
    await favorite[0].trigger('click')
    await favorite[1].trigger('click')
    expect(wrapper.emitted('favorite')).toEqual([[true], [false]])
  })

  it('拆分入口只在选中角色卡或预设时可用', () => {
    const withCards = render({ selectedCharacterCount: 2 })
    const splitEnabled = withCards
      .findAll('button')
      .filter((b) => b.text().includes('拆分') && !b.attributes('disabled'))
    expect(splitEnabled.length).toBeGreaterThan(0)

    const withoutCards = render({ selectedCharacterCount: 0 })
    const splitDisabled = withoutCards
      .findAll('button')
      .filter((b) => b.text().includes('拆分') && b.attributes('disabled') !== undefined)
    expect(splitDisabled.length).toBeGreaterThan(0)
  })

  it('列出全部文件夹供批量移动选择', () => {
    const wrapper = render()
    const options = wrapper.findAll('option').map((o) => o.text())
    expect(options.join(' ')).toContain('古风卡')
    expect(options.join(' ')).toContain('现代卡')
  })

  it('删除按钮触发 delete 事件由上层做二次确认', async () => {
    const wrapper = render()
    const remove = wrapper.findAll('button').find((b) => b.text().includes('删除'))
    await remove?.trigger('click')
    expect(wrapper.emitted('delete')).toHaveLength(1)
  })

  it('AI 标签入口无需预先选择，交由实验台继续筛选', async () => {
    const wrapper = render({ count: 0 })
    const button = wrapper.findAll('button').find((item) => item.text().includes('AI 识别标签'))
    expect(button?.attributes('disabled')).toBeUndefined()
    await button?.trigger('click')
    expect(wrapper.emitted('aiTag')).toHaveLength(1)
  })
})
