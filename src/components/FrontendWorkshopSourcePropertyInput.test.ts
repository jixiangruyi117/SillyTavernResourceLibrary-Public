/** @vitest-environment jsdom */
import { mount, enableAutoUnmount } from '@vue/test-utils'
import { describe, it, expect, afterEach } from 'vitest'
import Input from './FrontendWorkshopSourcePropertyInput.vue'
import { SOURCE_INSPECTOR_ITEMS } from '../utils/FrontendWorkshopSourceInspectorFields'
enableAutoUnmount(afterEach)
function setup(key: string, value: string, mixed = false) {
  return mount(Input, {
    props: { item: SOURCE_INSPECTOR_ITEMS.find((item) => item.key === key)!, value, mixed },
  })
}
describe('Source property controls', () => {
  it('preserves CSS expressions and provides Chinese choices without forcing defaults', async () => {
    const wrapper = setup('css.display', 'inline-flex')
    expect(wrapper.get('select').element.value).toBe('inline-flex')
    expect(wrapper.emitted('change')).toBeUndefined()
    await wrapper.get('select').setValue('__custom__')
    await wrapper.get('input').setValue('inline-grid')
    expect(wrapper.emitted('change')).toEqual([['inline-grid']])
  })
  it('accepts zero opacity and existing percentage values without multiplying them twice', async () => {
    const wrapper = setup('css.opacity', '50%')
    expect(wrapper.get<HTMLInputElement>('input[type="number"]').element.value).toBe('50')
    await wrapper.get('input[type="number"]').setValue('0')
    expect(wrapper.emitted('change')).toEqual([['0']])
    await wrapper.setProps({ value: 'var(--panel-opacity)' })
    expect(wrapper.get('input').element.value).toBe('var(--panel-opacity)')
    expect(wrapper.find('input[type="range"]').exists()).toBe(false)
  })
  it('keeps mixed selections blank and never truncates source text', async () => {
    const wrapper = setup('source.text', '', true)
    const input = wrapper.get('textarea')
    expect(input.element.value).toBe('')
    expect(input.attributes('maxlength')).toBeUndefined()
    const text = '完整文字'.repeat(10000)
    await input.setValue(text)
    expect(wrapper.emitted('change')).toEqual([[text]])
  })
})
