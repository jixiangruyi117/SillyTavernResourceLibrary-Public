/** @vitest-environment jsdom */
import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

import CharacterCardContentWorkbench from './CharacterCardContentWorkbench.vue'
import { chooseAction, confirmAction } from '../composables/UseConfirmDialog'
import { applyCharacterCardContentEdits } from '../utils/CharacterCardContentEdits'
import type { CharacterCardContentEdit } from '../types/CharacterCardContentEdit'

vi.mock('../composables/UseConfirmDialog', () => ({
  chooseAction: vi.fn(),
  confirmAction: vi.fn(),
}))

describe('CharacterCardContentWorkbench', () => {
  it('keeps alternate greeting identity after deleting an earlier greeting', async () => {
    vi.mocked(chooseAction).mockResolvedValue('confirm')
    vi.mocked(confirmAction).mockResolvedValue(true)
    const card = { data: { first_mes: '主开场', alternate_greetings: ['A', 'B', 'C'] } }
    const wrapper = mount(CharacterCardContentWorkbench, { props: { card, edits: [] } })
    const acceptEdits = async () => {
      const edits = wrapper.emitted('update:edits')!.at(-1)![0] as CharacterCardContentEdit[]
      await wrapper.setProps({ edits })
      return edits
    }
    try {
      await wrapper
        .findAll('.card-content-workbench__list li')[1]!
        .findAll('button')[1]!
        .trigger('click')
      await flushPromises()
      await acceptEdits()
      await wrapper
        .findAll('.card-content-workbench__list li')[1]!
        .findAll('button')[0]!
        .trigger('click')
      await wrapper.get('textarea').setValue('B 已编辑')
      await wrapper.get('.card-content-workbench__editor footer .is-primary').trigger('click')
      await flushPromises()
      const edits = await acceptEdits()
      expect(applyCharacterCardContentEdits(card, edits).card).toMatchObject({
        data: { alternate_greetings: ['B 已编辑', 'C'] },
      })
    } finally {
      wrapper.unmount()
    }
  })

  it('imports a primary greeting into a card with an empty primary', async () => {
    vi.mocked(chooseAction).mockResolvedValue('confirm')
    vi.mocked(confirmAction).mockResolvedValue(true)
    const card = { data: { first_mes: '', alternate_greetings: [] } }
    const wrapper = mount(CharacterCardContentWorkbench, { props: { card, edits: [] } })
    try {
      const input = wrapper.get('input[type="file"]')
      Object.defineProperty(input.element, 'files', {
        value: [{ name: '开场.txt', text: async () => '新的主开场' }],
      })
      await input.trigger('change')
      await flushPromises()
      await wrapper.get('select').setValue('replace-primary')
      await wrapper
        .get('.card-content-workbench__import-preview footer .is-primary')
        .trigger('click')
      await flushPromises()
      const edits = wrapper.emitted('update:edits')!.at(-1)![0] as CharacterCardContentEdit[]
      expect(applyCharacterCardContentEdits(card, edits).card).toMatchObject({
        data: { first_mes: '新的主开场' },
      })
    } finally {
      wrapper.unmount()
    }
  })

  it('edits one item in a focused form view instead of leaving the list behind it', async () => {
    const wrapper = mount(CharacterCardContentWorkbench, {
      props: {
        card: { data: { first_mes: '初始开场白' } },
        edits: [],
      },
    })

    expect(wrapper.find('.card-content-workbench__list').exists()).toBe(true)
    expect(wrapper.find('.card-content-workbench__tabs').exists()).toBe(true)
    await wrapper.get('.card-content-workbench__list button').trigger('click')

    expect(wrapper.find('.card-content-workbench__editor').exists()).toBe(true)
    expect(wrapper.find('.card-content-workbench__list').exists()).toBe(false)
    expect(wrapper.find('.card-content-workbench__tabs').exists()).toBe(false)
    expect(wrapper.text()).toContain('返回列表')
    expect(wrapper.findAll('button').filter((button) => button.text() === '返回列表')).toHaveLength(
      1,
    )
    expect(wrapper.get('textarea').element.value).toBe('初始开场白')
  })
})
