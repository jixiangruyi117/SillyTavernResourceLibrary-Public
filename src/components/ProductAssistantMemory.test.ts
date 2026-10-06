/** @vitest-environment jsdom */
import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import ProductAssistantMemory from './ProductAssistantMemory.vue'
import type { ProductAssistantWorkspaceService } from '../services/ProductAssistantWorkspaceService'
describe('assistant memory editor', () => {
  it('adds, edits and deletes explicit preferences, preserving input after a failed write', async () => {
    const saveMemories = vi.fn(async (items) => items)
    const workspace = { memories: () => [], saveMemories }
    const wrapper = mount(ProductAssistantMemory, {
      props: { workspace: workspace as unknown as ProductAssistantWorkspaceService },
    })
    try {
      await wrapper.get('.chat-memory-actions button[type="button"]').trigger('click')
      await wrapper.get('[aria-label="偏好 1"]').setValue('喜欢紫色')
      await wrapper.get('[aria-label="偏好 1 适用范围"]').setValue('appearance')
      saveMemories.mockRejectedValueOnce(new Error('存储已满'))
      await wrapper.get('form').trigger('submit')
      await flushPromises()
      expect(wrapper.get('[role="alert"]').text()).toBe('存储已满')
      expect(wrapper.get<HTMLTextAreaElement>('textarea').element.value).toBe('喜欢紫色')
      await wrapper.get('form').trigger('submit')
      await flushPromises()
      expect(saveMemories.mock.calls.at(-1)?.[0]).toEqual([
        expect.objectContaining({ text: '喜欢紫色', scope: 'appearance' }),
      ])
      expect(wrapper.emitted('saved')).toHaveLength(1)
      await wrapper.get('[aria-label="删除偏好 1"]').trigger('click')
      await flushPromises()
      expect(saveMemories.mock.calls.at(-1)?.[0]).toEqual([])
      expect(wrapper.find('textarea').exists()).toBe(false)
    } finally {
      wrapper.unmount()
    }
  })
})
