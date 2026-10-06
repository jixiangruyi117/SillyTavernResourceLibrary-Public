/** @vitest-environment jsdom */
import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import ResourceImageAdd from './ResourceImageAdd.vue'

describe('gallery file import entry', () => {
  it('opens the file picker from 本地图片 and waits for quality confirmation before importing', async () => {
    const wrapper = mount(ResourceImageAdd, { props: { multiple: true } })
    const input = wrapper.get('input[type=file]')
    const open = vi.spyOn(input.element as HTMLInputElement, 'click').mockImplementation(() => {})
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '本地图片')!
      .trigger('click')
    expect(open).toHaveBeenCalledOnce()
    const file = new File(['image'], 'art.png', { type: 'image/png' })
    Object.defineProperty(input.element, 'files', { configurable: true, value: [file] })
    await input.trigger('change')
    expect(wrapper.emitted('files')).toBeUndefined()
    expect(wrapper.vm.hasDraft).toBe(true)
    await wrapper.get('select').setValue('thumbnail')
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '导入 1 张')!
      .trigger('click')
    expect(wrapper.emitted('files')).toEqual([[[file], 'thumbnail']])
    expect(wrapper.vm.hasDraft).toBe(false)
    wrapper.unmount()
  })
  it('retains a previous selection when the picker is cancelled', async () => {
    const wrapper = mount(ResourceImageAdd)
    const input = wrapper.get('input[type=file]')
    const file = new File(['image'], 'art.png', { type: 'image/png' })
    Object.defineProperty(input.element, 'files', { configurable: true, value: [file] })
    await input.trigger('change')
    Object.defineProperty(input.element, 'files', { configurable: true, value: [] })
    await input.trigger('change')
    expect(wrapper.text()).toContain('导入 1 张')
    await wrapper.setProps({ busy: true })
    expect(
      wrapper.findAll('button').every((button) => button.attributes('disabled') !== undefined),
    ).toBe(true)
    wrapper.unmount()
  })
})
