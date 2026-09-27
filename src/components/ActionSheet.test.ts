/** @vitest-environment jsdom */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import ActionSheet from './ActionSheet.vue'

describe('ActionSheet', () => {
  it('identifies the current selection without marking ordinary actions as toggles', () => {
    const wrapper = mount(ActionSheet, {
      props: {
        open: true,
        title: '图片分类',
        actions: [
          { id: 'all', label: '全部分类', selected: true },
          { id: 'art', label: '同人图', selected: false },
          { id: 'manage', label: '管理分类' },
        ],
      },
      global: { stubs: { Teleport: true, Transition: false } },
    })
    const buttons = wrapper.findAll('.action-sheet__actions button')
    expect(buttons[0]!.attributes('aria-pressed')).toBe('true')
    expect(buttons[0]!.text()).toContain('✓')
    expect(buttons[1]!.attributes('aria-pressed')).toBe('false')
    expect(buttons[2]!.attributes('aria-pressed')).toBeUndefined()
    wrapper.unmount()
  })
  it('emits the selected action and closes', async () => {
    const wrapper = mount(ActionSheet, {
      props: {
        open: true,
        title: '更多操作',
        actions: [{ id: 'download', label: '下载' }],
      },
      global: { stubs: { Teleport: true, Transition: false } },
    })
    await wrapper.get('.action-sheet__actions button').trigger('click')
    expect(wrapper.emitted('select')?.[0]?.[0]).toMatchObject({ id: 'download' })
    expect(wrapper.emitted('update:open')?.[0]).toEqual([false])
    wrapper.unmount()
  })

  it('consumes the shared Android back request while open', async () => {
    const wrapper = mount(ActionSheet, {
      props: { open: true, title: '操作', actions: [] },
      global: { stubs: { Teleport: true, Transition: false } },
    })
    const detail = { handled: false }
    window.dispatchEvent(new CustomEvent('srl:back-request', { detail }))
    expect(detail.handled).toBe(true)
    expect(wrapper.emitted('update:open')?.[0]).toEqual([false])
    wrapper.unmount()
  })
})
