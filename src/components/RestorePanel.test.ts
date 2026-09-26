/** @vitest-environment jsdom */
import { mount } from '@vue/test-utils'
import { expect, it } from 'vitest'
import RestorePanel from './RestorePanel.vue'
import type { PreparedRestore } from '../types/Backup'
import { canRestoreOnlyPortableData } from '../services/BackupRestoreSelection'
import { taskCenter } from '../core/TaskCenter'

it('shows live restore progress inside the open panel without another floating notice', async () => {
  const id = taskCenter.start({ name: '恢复备份', phase: '写入第 2 项' })
  taskCenter.update(id, { progress: 0.5 })
  const wrapper = mount(RestorePanel, {
    props: { busy: true },
    global: { stubs: { teleport: true } },
  })
  try {
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('写入第 2 项')
    expect(wrapper.get('progress').attributes('value')).toBe('0.5')
    expect(wrapper.find('.activity-center__trigger').exists()).toBe(false)
  } finally {
    wrapper.unmount()
    taskCenter.complete(id)
    taskCenter.dismiss(id)
  }
})

it('allows portable-data merge and full replacement when all originals already exist', async () => {
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
    expect(wrapper.get('input[value="replace"]').attributes('disabled')).toBeUndefined()
    await confirm.trigger('click')
    expect(wrapper.emitted('confirm')).toEqual([['merge', []]])
    await wrapper.get('input[value="replace"]').setValue(true)
    const replace = wrapper.findAll('button').find((button) => button.text() === '确认覆盖')!
    expect(replace.attributes('disabled')).toBeUndefined()
    await replace.trigger('click')
    expect(wrapper.emitted('confirm')?.at(-1)).toEqual(['replace', []])
  } finally {
    wrapper.unmount()
  }
})
