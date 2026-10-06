/** @vitest-environment jsdom */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import FeatureAppHeader from './FeatureAppHeader.vue'

describe('FeatureAppHeader', () => {
  it('reuses the panel title layout and can disable back during a save', async () => {
    const wrapper = mount(FeatureAppHeader, {
      props: { title: '源码', layout: 'panel', backDisabled: true },
    })
    expect(wrapper.get('header').classes()).toContain('feature-app-header--panel')
    expect(wrapper.get('.feature-back-button').attributes('disabled')).toBeDefined()
    await wrapper.get('.feature-back-button').trigger('click')
    expect(wrapper.emitted('back')).toBeUndefined()
  })
  it('only renders the shared title and refuses caller-owned root attributes', () => {
    const wrapper = mount(FeatureAppHeader, {
      props: {
        title: '外观',
      },
      attrs: { class: 'private-header', 'data-private-header': 'true' },
    })

    expect(wrapper.get('header').attributes('data-srl-feature-header')).toBe('true')
    expect(wrapper.get('h1').text()).toBe('外观')
    expect(wrapper.get('header').attributes('data-srl-hook')).toBe('feature-header')
    expect(wrapper.get('header').classes()).not.toContain('private-header')
    expect(wrapper.get('header').attributes('data-private-header')).toBeUndefined()
    expect(wrapper.props()).not.toHaveProperty('eyebrow')
    expect(wrapper.props()).not.toHaveProperty('description')
    expect(wrapper.get('.feature-back-button').attributes('aria-label')).toBe('返回功能桌面')
  })

  it('routes the shared back button click through the header contract', async () => {
    const wrapper = mount(FeatureAppHeader, { props: { title: '云备份' } })

    await wrapper.get('.feature-back-button').trigger('click')

    expect(wrapper.emitted('back')).toHaveLength(1)
  })
})
