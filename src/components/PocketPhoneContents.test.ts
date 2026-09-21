/** @vitest-environment jsdom */
import { mount } from '@vue/test-utils'
import { expect, it } from 'vitest'
import PocketPhoneContents from './PocketPhoneContents.vue'
import type { PersonalResourceDocument } from '../types/PersonalResource'

it('separates installation and source downloads, preserves notes and exposes one edit action', async () => {
  const document: PersonalResourceDocument = {
    format: 'srl-personal-resource',
    version: 1,
    kind: 'pocketPhone',
    name: '小手机',
    url: 'https://example.com/phone',
    text: '第一步\n第二步',
    fields: [],
    attachments: [
      { path: 'attachments/src', name: 'src/main.js', kind: 'source', size: 1024 },
      { path: 'attachments/apk', name: 'phone.apk', kind: 'apk', size: 2048 },
    ],
  }
  const w = mount(PocketPhoneContents, { props: { document, busy: false } })
  const apk = w.get('ul[aria-label="APK 安装包"]')
  const source = w.get('ul[aria-label="源码文件"]')
  expect(apk.text()).toContain('phone.apk')
  expect(apk.text()).not.toContain('src/main.js')
  expect(source.text()).toContain('src/main.js')
  expect(w.get('.pocket-phone-contents__notes').text()).toBe('第一步\n第二步')
  expect(w.get('a').attributes('href')).toBe(document.url)
  await source.get('button').trigger('click')
  expect(w.emitted('download')).toEqual([['attachments/src']])
  await w.get('.pocket-phone-contents__actions button').trigger('click')
  expect(w.emitted('edit')).toHaveLength(1)
  await w.setProps({ busy: true })
  expect(w.get('.pocket-phone-contents__actions button').attributes('disabled')).toBeDefined()
  expect(apk.get('button').attributes('disabled')).toBeDefined()
  w.unmount()
})
