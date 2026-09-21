// @vitest-environment jsdom
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, expect, it, vi } from 'vitest'
const service = vi.hoisted(() => ({ get: vi.fn(), create: vi.fn() }))
vi.mock('../core/FrontendWorkshopContainer', () => ({
  frontendWorkshopSourceComponentService: service,
}))
import FrontendWorkshopAiComponentDraft from './FrontendWorkshopAiComponentDraft.vue'
const draft = {
  name: '人物',
  source: { html: '<section>头像占位</section>', css: 'section{color:red}', javascript: '' },
  root: { tagName: 'section' },
  provenance: { origin: 'ai' as const },
}
beforeEach(() => {
  vi.clearAllMocks()
  service.get.mockResolvedValue(undefined)
  service.create.mockResolvedValue({ id: 'saved' })
})
it('only saves after preview confirmation, uses the existing library and avoids duplicate saves', async () => {
  const wrapper = mount(FrontendWorkshopAiComponentDraft, {
    props: { draft, generationId: 'generation', networkMode: 'offline' },
    global: {
      stubs: {
        FrontendWorkshopSourcePreview: {
          props: ['sourceDocument'],
          template: '<div class="preview">{{sourceDocument.authorSource}}</div>',
        },
      },
    },
  })
  expect(service.create).not.toHaveBeenCalled()
  wrapper.get('details').element.open = true
  await wrapper.get('details').trigger('toggle')
  expect(wrapper.get('.preview').text()).toContain('section{color:red}')
  await wrapper.get('input').setValue('通用资料')
  await wrapper.get('button').trigger('click')
  await flushPromises()
  expect(service.create).toHaveBeenCalledWith(expect.objectContaining({ name: '通用资料' }), {
    id: 'ai-extract-generation',
  })
  expect(wrapper.get('button').text()).toBe('已保存到组件库')
  await wrapper.get('button').trigger('click')
  expect(service.create).toHaveBeenCalledOnce()
  wrapper.unmount()
})
