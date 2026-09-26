/** @vitest-environment jsdom */
import { mount } from '@vue/test-utils'
import { expect, it } from 'vitest'
import ProjectActivityCenter from './ProjectActivityCenter.vue'
import { taskCenter } from '../core/TaskCenter'

it('任务抽屉与浮动进度互斥，面板承载的恢复任务不再重复展示', async () => {
  const id = taskCenter.start({ name: '恢复备份', phase: '恢复资源' })
  const wrapper = mount(ProjectActivityCenter)
  try {
    await wrapper.vm.$nextTick()
    expect(wrapper.findAll('progress')).toHaveLength(1)
    await wrapper.get('.activity-center__trigger').trigger('click')
    expect(wrapper.findAll('progress')).toHaveLength(1)
    expect(wrapper.find('.activity-center__focused-progress').exists()).toBe(false)
    await wrapper.setProps({ hiddenTaskNames: ['恢复备份'] })
    expect(wrapper.findAll('progress')).toHaveLength(0)
  } finally {
    wrapper.unmount()
    taskCenter.complete(id)
    taskCenter.dismiss(id)
  }
})
