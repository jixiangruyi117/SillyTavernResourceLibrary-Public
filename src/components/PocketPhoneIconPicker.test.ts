/** @vitest-environment jsdom */
import { flushPromises, mount } from '@vue/test-utils'
import { reactive, toRaw } from 'vue'
import { expect, it, vi } from 'vitest'
import PocketPhoneIconPicker from './PocketPhoneIconPicker.vue'
import type {
  PersonalResourceDocument,
  PhoneIcon,
  PhoneIconSource,
} from '../types/PersonalResource'

it('switches parsed icons using plain value records so the parent draft can be saved', async () => {
  const document = reactive<PersonalResourceDocument>({
    format: 'srl-personal-resource',
    version: 1,
    kind: 'pocketPhone',
    name: 'phone',
    url: 'https://example.com/',
    text: '',
    fields: [],
    attachments: [],
    icons: [
      {
        source: 'website',
        origin: 'https://example.com/',
        dataUrl: 'data:image/png;base64,aWNvbg==',
      },
    ],
    iconSource: 'website',
  })
  const wrapper = mount(PocketPhoneIconPicker, {
    props: {
      document,
      readFile: vi.fn(),
      onChange: (icons: PhoneIcon[], selected?: PhoneIconSource) => {
        document.icons = icons
        document.iconSource = selected
      },
    },
  })
  expect(wrapper.find('select').exists()).toBe(false)
  await wrapper.get('button').trigger('click')
  expect(wrapper.findAll('option').some((option) => option.text() === 'APK 图标')).toBe(false)
  await wrapper.get('select').setValue('website')
  expect(() => structuredClone(toRaw(document))).not.toThrow()
  document.url = 'https://different.example/'
  await flushPromises()
  expect(document.icons).toHaveLength(0)
  expect(document.iconSource).toBeUndefined()
  wrapper.unmount()
})
