/** @vitest-environment jsdom */
import { mount } from '@vue/test-utils'
import { expect, it } from 'vitest'
import RestorePanel from './RestorePanel.vue'
import type { PreparedRestore } from '../types/Backup'
import { canRestoreOnlyPortableData } from '../services/BackupRestoreSelection'

it('allows restoring saved reader data when all original chats already exist, without enabling overwrite', async () => {
  const prepared = {
    resources: [],
    versions: [],
    categories: [],
    preview: {
      mode: 'full',
      createdAt: new Date().toISOString(),
      duplicatesToSkip: 2,
      portableSections: ['读了么阅读数据'],
    },
    portableData: {
      version: 1,
      chatReader: [{ appId: 'com.srl.duleme', key: 'chat:old', value: { note: '保留原备注' } }],
    },
  } as unknown as PreparedRestore
  expect(canRestoreOnlyPortableData(prepared)).toBe(true)
  expect(canRestoreOnlyPortableData({ ...prepared, portableData: undefined })).toBe(false)
  const wrapper = mount(RestorePanel, {
    props: { prepared, busy: false },
    global: { stubs: { teleport: true } },
  })
  try {
    const confirm = wrapper.findAll('button').find((button) => button.text() === '确认新增')!
    expect(confirm.attributes('disabled')).toBeUndefined()
    expect(wrapper.get('input[value="replace"]').attributes('disabled')).toBeDefined()
    await confirm.trigger('click')
    expect(wrapper.emitted('confirm')).toEqual([['merge', []]])
  } finally {
    wrapper.unmount()
  }
})
