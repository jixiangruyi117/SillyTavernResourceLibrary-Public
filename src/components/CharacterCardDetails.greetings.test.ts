/** @vitest-environment jsdom */
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import CharacterCardDetails from './CharacterCardDetails.vue'
import GreetingPreviewDialog from './GreetingPreviewDialog.vue'
import * as opening from '../utils/OpeningPreviewContent'
import * as preview from '../utils/RichContentPreview'

enableAutoUnmount(afterEach)
const scrollDescriptors = ['scrollIntoView', 'scrollTo'].map((name) => ({
  name,
  descriptor: Object.getOwnPropertyDescriptor(HTMLElement.prototype, name),
}))
beforeEach(() => {
  for (const { name } of scrollDescriptors)
    Object.defineProperty(HTMLElement.prototype, name, { configurable: true, value: vi.fn() })
})
afterEach(() => {
  vi.restoreAllMocks()
  for (const { name, descriptor } of scrollDescriptors) {
    if (descriptor) Object.defineProperty(HTMLElement.prototype, name, descriptor)
    else Reflect.deleteProperty(HTMLElement.prototype, name)
  }
})

describe('character opening list computation', () => {
  it('列表惰性计算，切换/重命名复用，正文编辑只重算变化项', async () => {
    const excerpt = vi.spyOn(opening, 'stripOpeningPreviewHiddenBlocks')
    const rich = vi.spyOn(preview, 'hasRichPreviewContent')
    let data = { name: '角色', first_mes: '<p>主正文</p>', alternate_greetings: ['备用正文'] }
    const wrapper = mount(CharacterCardDetails, {
      props: { metadata: { card: { data } } },
      global: { stubs: { GreetingPreviewDialog: true, CharacterCardContentWorkbench: true } },
    })
    await flushPromises()
    expect(excerpt).not.toHaveBeenCalled()
    expect(rich).not.toHaveBeenCalled()
    const openList = async () => {
      await wrapper.get('.character-content-index__item').trigger('click')
      await flushPromises()
    }
    await openList()
    expect(excerpt).toHaveBeenCalledTimes(2)
    expect(rich).toHaveBeenCalledTimes(2)
    expect(wrapper.findAll('.character-greeting-card__excerpt').map((item) => item.text())).toEqual(
      ['主正文', '备用正文'],
    )
    await wrapper.get('.character-greetings__fullscreen').trigger('click')
    wrapper.findComponent(GreetingPreviewDialog).vm.$emit('update:modelValue', 1)
    await flushPromises()
    expect(excerpt).toHaveBeenCalledTimes(2)
    expect(rich).toHaveBeenCalledTimes(2)
    expect(wrapper.get('.character-greetings__track article.is-active strong').text()).toBe(
      '备用 01',
    )
    data = { ...data, name: '改名角色' }
    await wrapper.setProps({ metadata: { card: { data } } })
    await openList()
    expect(excerpt).toHaveBeenCalledTimes(2)
    expect(rich).toHaveBeenCalledTimes(2)
    data = { ...data, first_mes: '<p>更新正文</p>' }
    await wrapper.setProps({ metadata: { card: { data } } })
    await openList()
    expect(excerpt).toHaveBeenCalledTimes(3)
    expect(rich).toHaveBeenCalledTimes(3)
    expect(wrapper.findAll('.character-greeting-card__excerpt').map((item) => item.text())).toEqual(
      ['更新正文', '备用正文'],
    )
    data = { ...data, first_mes: '<!--desc:手写说明--><p>更新正文</p>' }
    await wrapper.setProps({ metadata: { card: { data } } })
    await openList()
    expect(excerpt).toHaveBeenCalledTimes(3)
    expect(rich).toHaveBeenCalledTimes(3)
    expect(wrapper.find('.character-greeting-card__excerpt').text()).toBe('手写说明')
  })
})
