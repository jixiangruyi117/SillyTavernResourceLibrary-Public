/** @vitest-environment jsdom */
import { mount } from '@vue/test-utils'
import { reactive } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import LibraryLinkImportPanel from './LibraryLinkImportPanel.vue'

describe('LibraryLinkImportPanel', () => {
  it('renders as import-sheet content and submits through the shared handler', async () => {
    const handleLinkImport = vi.fn()
    const model = reactive({
      handleLinkImport,
      linkImportText: 'https://github.com/owner/repo',
      linkImportUrls: ['https://github.com/owner/repo'],
      isBusy: false,
      linkImportPreview: undefined,
    })

    const wrapper = mount(LibraryLinkImportPanel, {
      props: { model: model as never },
    })

    expect(wrapper.find('#link-import-panel').exists()).toBe(true)
    expect(wrapper.find('.link-import-panel__collapse').exists()).toBe(false)
    await wrapper.get('form').trigger('submit')
    expect(handleLinkImport).toHaveBeenCalledTimes(1)

    wrapper.unmount()
  })
})
