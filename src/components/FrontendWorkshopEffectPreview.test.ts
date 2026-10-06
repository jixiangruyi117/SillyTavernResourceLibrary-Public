/** @vitest-environment jsdom */
import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { workshopEffects, workshopReferences } from '../utils/FrontendWorkshopEffectCatalog'
import FrontendWorkshopEffectPreview from './FrontendWorkshopEffectPreview.vue'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})
function effect(id: string) {
  return workshopEffects.find((item) => item.id === id)!
}
describe('参考效果演示', () => {
  it('目录中的每个效果都能挂载并有操作方式，初始不自动播放', () => {
    expect(new Set(workshopEffects.map((item) => item.id)).size).toBe(workshopEffects.length)
    for (const item of workshopEffects) {
      const wrapper = mount(FrontendWorkshopEffectPreview, { props: { effect: item } })
      expect(workshopReferences[item.reference]).toBeDefined()
      expect(wrapper.find('.fw-effect-preview__controls').text().length).toBeGreaterThan(0)
      expect(wrapper.find('.is-playing').exists()).toBe(false)
      expect(wrapper.text().length).toBeGreaterThan(10)
      wrapper.unmount()
    }
  })
  it('播放计数后可立即完成，离开时清除计时器', async () => {
    vi.useFakeTimers()
    const wrapper = mount(FrontendWorkshopEffectPreview, { props: { effect: effect('count') } })
    await wrapper.get('button').trigger('click')
    await vi.advanceTimersByTimeAsync(200)
    const count = Number(wrapper.get('.fw-effect-word strong').text())
    expect(count).toBeGreaterThan(0)
    expect(count).toBeLessThan(87)
    await wrapper.get('button').trigger('click')
    expect(wrapper.get('.fw-effect-word strong').text()).toBe('87')
    expect(wrapper.find('.is-playing').exists()).toBe(false)
    await wrapper.get('button').trigger('click')
    wrapper.unmount()
    expect(vi.getTimerCount()).toBe(0)
  })
  it('减少动态效果时不启动播放计时器，最终正文保持可读', async () => {
    vi.useFakeTimers()
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
    )
    const wrapper = mount(FrontendWorkshopEffectPreview, { props: { effect: effect('decode') } })
    await wrapper.get('button').trigger('click')
    expect(wrapper.text()).toContain('UNKNOWN')
    expect(wrapper.find('.is-playing').exists()).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
    wrapper.unmount()
  })
  it('翻面和手风琴向前切换仍有正确的可见状态', async () => {
    for (const id of ['flip-card', 'accordion']) {
      const wrapper = mount(FrontendWorkshopEffectPreview, { props: { effect: effect(id) } })
      await wrapper.get('[aria-label="上一步效果"]').trigger('click')
      if (id === 'flip-card')
        expect(wrapper.get('.fw-effect-flipper').classes()).toContain('is-open')
      else expect(wrapper.get('.fw-effect-accordion [aria-pressed=true]').text()).toContain('回忆')
      wrapper.unmount()
    }
  })
})
