/** @vitest-environment jsdom */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import FeatureBackButton from './FeatureBackButton.vue'

describe('FeatureBackButton', () => {
  it('provides one icon-only back contract and forwards real clicks', async () => {
    const wrapper = mount(FeatureBackButton, {
      props: { label: '返回上一级' },
    })

    const button = wrapper.get('button')
    expect(button.classes()).toContain('feature-back-button')
    expect(button.attributes('type')).toBe('button')
    expect(button.attributes('aria-label')).toBe('返回上一级')
    expect(button.attributes('title')).toBe('返回上一级')
    expect(button.find('svg').exists()).toBe(true)

    await button.trigger('click')
    expect(wrapper.emitted('click')).toHaveLength(1)
  })

  it('exposes focus for full-screen dialogs that restore keyboard focus', () => {
    const wrapper = mount(FeatureBackButton, {
      props: { label: '返回列表' },
      attachTo: document.body,
    })

    ;(wrapper.vm as unknown as { focus: () => void }).focus()
    expect(document.activeElement).toBe(wrapper.get('button').element)
    wrapper.unmount()
  })
})
