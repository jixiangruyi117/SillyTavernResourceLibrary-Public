/** @vitest-environment jsdom */
import { mount } from '@vue/test-utils'
import { expect, it, vi } from 'vitest'
import ProductAssistantNavigationLink from './ProductAssistantNavigationLink.vue'
it('saves before reopening a reviewed feature and refuses navigation if saving fails', async () => {
  const order: string[] = []
  const persist = vi.fn(async () => {
    order.push('save')
  })
  const navigate = vi.fn(async () => {
    order.push('navigate')
  })
  const wrapper = mount(ProductAssistantNavigationLink, {
    props: {
      destination: { target: 'library', title: '资源库', guide: 'library-search' },
      navigate,
      persist,
      busy: false,
    },
  })
  try {
    await wrapper.get('button').trigger('click')
    await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith('library', 'library-search'))
    expect(order).toEqual(['save', 'navigate'])
    navigate.mockClear()
    persist.mockRejectedValueOnce(new Error('磁盘已满'))
    await wrapper.get('button').trigger('click')
    await vi.waitFor(() => expect(wrapper.emitted('failed')).toEqual([['磁盘已满']]))
    expect(navigate).not.toHaveBeenCalled()
    await wrapper.setProps({ busy: true })
    await wrapper.get('button').trigger('click')
    expect(navigate).not.toHaveBeenCalled()
  } finally {
    wrapper.unmount()
  }
})
