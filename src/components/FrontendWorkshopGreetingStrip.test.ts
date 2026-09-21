// @vitest-environment jsdom
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFrontendWorkshopSourceDocument } from '../types/FrontendWorkshopSourceDocument'
import { prepareFrontendWorkshopSourcePatch } from '../utils/FrontendWorkshopSourcePatch'
const mocks = vi.hoisted(() => ({ apply: vi.fn() }))
vi.mock('../core/FrontendWorkshopContainer', () => ({
  frontendWorkshopSourceHistoryService: { applyAndRecord: mocks.apply },
}))
import FrontendWorkshopGreetingStrip from './FrontendWorkshopGreetingStrip.vue'

const source = createFrontendWorkshopSourceDocument(
  'p',
  '<h1>主开场白</h1><script type="application/json" data-tavern-character>{"name":"人物","alternate_greetings":["第一幕","第二幕"]}</script>',
  1,
)
beforeEach(() => {
  mocks.apply.mockReset()
})
describe('greeting editor', () => {
  it('starts collapsed and keeps an unsaved draft after collapsing and switching', async () => {
    const wrapper = mount(FrontendWorkshopGreetingStrip, {
      props: { sourceDocument: source, modelValue: 1 },
    })
    const fold = wrapper.get('details').element as HTMLDetailsElement
    expect(fold.open).toBe(false)
    fold.open = true
    await wrapper.get('textarea').setValue('未保存正文')
    fold.open = false
    await wrapper.setProps({ modelValue: 2 })
    expect((wrapper.get('details').element as HTMLDetailsElement).open).toBe(false)
    await wrapper.setProps({ modelValue: 1 })
    expect((wrapper.get('textarea').element as HTMLTextAreaElement).value).toBe('未保存正文')
    expect(wrapper.get('summary').text()).toContain('未保存')
    expect(mocks.apply).not.toHaveBeenCalled()
  })
  it('hides the strip for a main-only source', () => {
    const wrapper = mount(FrontendWorkshopGreetingStrip, {
      props: { sourceDocument: { ...source, authorSource: '<h1>主开场白</h1>' }, modelValue: 0 },
    })
    expect(wrapper.find('nav').exists()).toBe(false)
  })
  it('keeps drafts across tab switches and records one reversible source patch', async () => {
    const wrapper = mount(FrontendWorkshopGreetingStrip, {
      props: { sourceDocument: source, modelValue: 1 },
    })
    await wrapper.get('textarea').setValue('修改第一幕')
    await wrapper.setProps({ modelValue: 2 })
    await wrapper.get('textarea').setValue('修改第二幕')
    await wrapper.setProps({ modelValue: 1 })
    expect((wrapper.get('textarea').element as HTMLTextAreaElement).value).toBe('修改第一幕')
    mocks.apply.mockImplementation(async (patch) => ({
      document: {
        ...source,
        revision: 2,
        authorSource: prepareFrontendWorkshopSourcePatch(source, patch).authorSource,
      },
    }))
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '保存开场白')!
      .trigger('click')
    await flushPromises()
    expect(mocks.apply).toHaveBeenCalledOnce()
    expect(mocks.apply.mock.calls[0]![0].edits).toHaveLength(2)
    expect(wrapper.emitted('revisionAccepted')?.[0]?.[0]).toMatchObject({ revision: 2 })
  })
  it('preserves drafts and refuses to overwrite a concurrent revision', async () => {
    const wrapper = mount(FrontendWorkshopGreetingStrip, {
      props: { sourceDocument: source, modelValue: 1 },
    })
    await wrapper.get('textarea').setValue('未保存的正文')
    await wrapper.setProps({ sourceDocument: { ...source, revision: 2 } })
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '保存开场白')!
      .trigger('click')
    await flushPromises()
    expect(mocks.apply).not.toHaveBeenCalled()
    expect(wrapper.get('[role="alert"]').text()).toContain('草稿已保留')
    expect((wrapper.get('textarea').element as HTMLTextAreaElement).value).toBe('未保存的正文')
  })
})
