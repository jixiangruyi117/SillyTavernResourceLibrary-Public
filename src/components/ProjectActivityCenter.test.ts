/** @vitest-environment jsdom */
import { mount } from '@vue/test-utils'
import { expect, it, vi } from 'vitest'
import ProjectActivityCenter from './ProjectActivityCenter.vue'
import { taskCenter } from '../core/TaskCenter'
import { noticeCenter } from '../core/NoticeCenter'

it('completed attachment remains accessible from its task action', async () => {
  const open = vi.fn()
  const id = taskCenter.start({ name: '指定附件', action: { label: '查看附件', run: open } })
  taskCenter.complete(id)
  const wrapper = mount(ProjectActivityCenter)
  try {
    await wrapper.vm.$nextTick()
    await wrapper.get('.activity-center__trigger').trigger('click')
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '查看附件')!
      .trigger('click')
    expect(open).toHaveBeenCalledOnce()
    expect(wrapper.text()).toContain('指定附件')
  } finally {
    wrapper.unmount()
    taskCenter.dismiss(id)
  }
})

it('局部窗口承载的通知不重复显示，全局记录与其他通知保留', async () => {
  const local = 'activity-local-notice',
    other = 'activity-other-notice'
  noticeCenter.push({ id: local, type: 'success', message: '局部已保存', persistent: true })
  const wrapper = mount(ProjectActivityCenter, { props: { hiddenNoticeIds: [local] } })
  try {
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.activity-center').exists()).toBe(false)
    expect(noticeCenter.list().some((notice) => notice.id === local)).toBe(true)
    noticeCenter.push({ id: other, type: 'info', message: '其他通知', persistent: true })
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('其他通知')
    expect(wrapper.text()).not.toContain('局部已保存')
    await wrapper.setProps({ hiddenNoticeIds: [] })
    await wrapper.get('.activity-center__trigger').trigger('click')
    expect(wrapper.text()).toContain('局部已保存')
  } finally {
    wrapper.unmount()
    noticeCenter.dismiss(local)
    noticeCenter.dismiss(other)
  }
})

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
