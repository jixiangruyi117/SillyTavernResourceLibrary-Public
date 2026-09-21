/** @vitest-environment jsdom */
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import FrontendWorkshopTutorial from './FrontendWorkshopTutorial.vue'

enableAutoUnmount(afterEach)
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true
  }
  HTMLDialogElement.prototype.close = function () {
    this.open = false
  }
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})
async function open(canUseAi = true) {
  const wrapper = mount(FrontendWorkshopTutorial, {
    props: { canUseAi },
    global: { stubs: { Teleport: true } },
  })
  await wrapper.vm.open()
  await flushPromises()
  return wrapper
}
type Wrapper = Awaited<ReturnType<typeof open>>
function button(wrapper: Wrapper, text: string) {
  return wrapper.findAll('button').find((item) => item.text() === text)!
}

describe('效果参考库', () => {
  it('websites are outbound links and template prompts prefill only after explicit action', async () => {
    const wrapper = await open()
    await button(wrapper, '动效网站').trigger('click')
    const links = wrapper.findAll('.fw-reference-sites a')
    expect(links).toHaveLength(6)
    expect(
      links.every(
        (link) =>
          link.attributes('href')?.startsWith('https://') &&
          link.attributes('rel') === 'noopener noreferrer',
      ),
    ).toBe(true)
    await button(wrapper, '模板提示词').trigger('click')
    expect(wrapper.text()).toContain('deepseekv4f')
    expect(wrapper.findAll('.fw-template-turns > li')).toHaveLength(5)
    expect(wrapper.text()).toContain('不是当时的 DS 对话记录')
    expect(wrapper.emitted('usePrompt')).toBeUndefined()
    await button(wrapper, '带入 AI').trigger('click')
    expect(wrapper.emitted('usePrompt')?.[0]?.[0]).toContain('四个完整备用开场白')
    expect(wrapper.find('dialog').exists()).toBe(false)
  })
  it('手机从目录末尾进入详情回到顶部，返回恢复目录阅读位置', async () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn((query: string) => ({
        matches: query === '(max-width: 48rem)',
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    )
    const wrapper = await open()
    const scroll = wrapper.get('.fw-reference-scroll').element as HTMLElement
    scroll.scrollTop = 1200
    await wrapper.findAll('.fw-reference-directory nav button').at(-1)!.trigger('click')
    await flushPromises()
    expect((wrapper.get('.fw-reference-scroll').element as HTMLElement).scrollTop).toBe(0)
    await button(wrapper, '‹ 返回效果目录').trigger('click')
    await flushPromises()
    expect((wrapper.get('.fw-reference-scroll').element as HTMLElement).scrollTop).toBe(1200)
  })

  it('中文或英文搜索定位实际演示，返回保留搜索和组合', async () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn((query: string) => ({
        matches: query === '(max-width: 48rem)',
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    )
    const wrapper = await open()
    await wrapper.get('input[type=search]').setValue('cube')
    const entries = wrapper.findAll('.fw-reference-directory nav button')
    expect(entries).toHaveLength(1)
    await entries[0]!.trigger('click')
    expect(wrapper.find('.fw-effect-cube').exists()).toBe(true)
    await button(wrapper, '加入描述').trigger('click')
    expect(wrapper.vm.back()).toBe(true)
    await wrapper.vm.$nextTick()
    expect(wrapper.get('input').element.value).toBe('cube')
    expect(wrapper.get('.fw-reference-chosen').text()).toContain('立方体切换')
    expect(wrapper.vm.back()).toBe(true)
    await wrapper.vm.$nextTick()
    expect(wrapper.find('dialog').exists()).toBe(false)
    expect(wrapper.vm.back()).toBe(false)
  })

  it('桌面返回直接关闭并排参考库，不经过不可见的详情状态', async () => {
    const wrapper = await open()
    await wrapper.get('.fw-reference-directory nav button').trigger('click')
    expect(wrapper.vm.back()).toBe(true)
    await wrapper.vm.$nextTick()
    expect(wrapper.find('dialog').exists()).toBe(false)
  })

  it('跨分类组合多个动效和风格，只在明确点击时发出预填意图', async () => {
    const wrapper = await open()
    await button(wrapper, '加入描述').trigger('click')
    await wrapper.get('input').setValue('typewriter')
    await wrapper.get('.fw-reference-directory nav button').trigger('click')
    await button(wrapper, '加入描述').trigger('click')
    await button(wrapper, '视觉风格').trigger('click')
    await wrapper.get('input').setValue('掌机')
    await wrapper.get('.fw-reference-directory nav button').trigger('click')
    await button(wrapper, '加入描述').trigger('click')
    expect(wrapper.emitted('usePrompt')).toBeUndefined()
    await button(wrapper, '带入肘肘更健康').trigger('click')
    const prompt = wrapper.emitted('usePrompt')![0]![0] as string
    expect(prompt).toContain('3D 旋转木马')
    expect(prompt).toContain('打字机')
    expect(prompt).toContain('复古掌机')
    expect(prompt).toContain('保留原内容和功能')
    expect(wrapper.find('dialog').exists()).toBe(false)
  })

  it('剪贴板失败保留可选择的完整描述，没有作品时不提供AI入口', async () => {
    vi.stubGlobal('navigator', {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
    })
    const wrapper = await open(false)
    await button(wrapper, '加入描述').trigger('click')
    expect(button(wrapper, '带入肘肘更健康')).toBeUndefined()
    await button(wrapper, '复制描述').trigger('click')
    await flushPromises()
    expect(wrapper.get('textarea').element.value).toContain('3D 旋转木马')
    expect(wrapper.get('textarea').element.value).toContain('保留当前作品风格')
    expect(wrapper.get('[role=status]').text()).toContain('无法直接复制')
    expect(wrapper.emitted('usePrompt')).toBeUndefined()
  })

  it('空搜索结果与再次打开可恢复，不残留旧教程内容', async () => {
    const wrapper = await open()
    await wrapper.get('input').setValue('不存在的效果123')
    expect(wrapper.findAll('.fw-reference-directory nav button')).toHaveLength(0)
    expect(wrapper.text()).toContain('没找到')
    await wrapper.get('input').setValue('')
    expect(wrapper.findAll('.fw-reference-directory nav button').length).toBeGreaterThan(30)
    expect(wrapper.text()).not.toContain('组块模式')
    expect(wrapper.text()).not.toContain('隐藏后画布、预览和导出都不显示')
  })
})
