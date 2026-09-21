/** @vitest-environment jsdom */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import ActionSheet from './ActionSheet.vue'

describe('ActionSheet', () => {
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
