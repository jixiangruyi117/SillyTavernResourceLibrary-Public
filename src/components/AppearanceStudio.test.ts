/** @vitest-environment jsdom */
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('../core/OfficialAppRuntime', () => ({
  officialAppService: { list: async () => [{ id: 'imageAlbum' }] },
}))

import { BrowserStorageService } from '../services/BrowserStorageService'
import AppearanceOriginalCssActions from './AppearanceOriginalCssActions.vue'
import AppearanceStudio from './AppearanceStudio.vue'

describe('AppearanceStudio cabinet layout', () => {
  beforeEach(() => localStorage.clear())

  it('offers two, three and four columns and persists the selected density', async () => {
    const wrapper = mount(AppearanceStudio, {
      props: { theme: 'light', layoutMode: 'grid', uiFontScale: 'standard', customCss: '' },
    })

    const options = wrapper.findAll('[data-cabinet-columns]')
    expect(options.map((option) => option.attributes('data-cabinet-columns'))).toEqual([
      '2',
      '3',
      '4',
    ])
    expect(wrapper.text()).toContain('收藏柜布局')

    await wrapper.get('[data-cabinet-columns="2"]').trigger('click')
    expect(new BrowserStorageService().getCabinetColumns()).toBe(2)
    expect(wrapper.get('[data-cabinet-columns="2"]').attributes('aria-checked')).toBe('true')
  })

  it('offers every feature app and separates installed APPs from dormant scopes', async () => {
    const wrapper = mount(AppearanceStudio, {
      props: { theme: 'light', layoutMode: 'grid', uiFontScale: 'standard', customCss: '' },
    })

    expect(wrapper.text()).toContain('收藏柜')
    expect(wrapper.text()).toContain('酒馆互传')
    expect(wrapper.text()).toContain('缝了么')
    expect(wrapper.text()).toContain('前端了么')
    expect(wrapper.text()).toContain('user才是老大')
    await flushPromises()
    expect(wrapper.get('[aria-label="选择要装修的界面"]').text()).toContain('生图相册')
    expect(wrapper.get('[aria-label="未安装 APP 的样式"]').text()).toContain('AI 生图')
    expect(wrapper.get('[aria-label="选择要装修的界面"]').text()).not.toContain('AI 生图')
  })

  it('shares official CSS actions without passing user CSS', () => {
    const wrapper = mount(AppearanceStudio, {
      props: { theme: 'light', layoutMode: 'grid', uiFontScale: 'standard', customCss: '.user {}' },
    })
    const actions = wrapper.findAllComponents(AppearanceOriginalCssActions)
    expect(actions).toHaveLength(2)
    expect(actions[0]!.props('scope')).toBeUndefined()
    expect(actions[1]!.props('scope')?.value).toBe('library')
    expect(wrapper.get<HTMLTextAreaElement>('textarea').element.value).toBe('.user {}')
    const placeholder = wrapper.findAll('textarea')[1]!.attributes('placeholder')
    expect(placeholder).toBe('在此填写本界面的自定义 CSS')
    expect(wrapper.emitted('save-css')).toBeUndefined()
  })

  it('offers three controlled font tiers instead of arbitrary root scaling', async () => {
    const wrapper = mount(AppearanceStudio, {
      props: { theme: 'light', layoutMode: 'grid', uiFontScale: 'standard', customCss: '' },
    })

    const options = wrapper.findAll('[data-font-scale]')
    expect(options.map((option) => option.attributes('data-font-scale'))).toEqual([
      'small',
      'standard',
      'large',
    ])
    await wrapper.get('[data-font-scale="large"]').trigger('click')
    expect(wrapper.emitted('update:uiFontScale')?.[0]).toEqual(['large'])
  })
})
