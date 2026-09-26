/** @vitest-environment jsdom */
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { afterEach, describe, expect, it } from 'vitest'

import { RESOURCE_TYPE, type Category, type ResourceSummary } from '../types/Resource'
import ExportPanel from './ExportPanel.vue'
import { taskCenter } from '../core/TaskCenter'

it('导出面板内显示实际任务进度，不再只有正在装箱', async () => {
  const id = taskCenter.start({ name: '导出备份', phase: '写入第 2 项' })
  taskCenter.update(id, { progress: 0.5 })
  const wrapper = mount(ExportPanel, {
    props: { resources: [], categories: [], busy: true },
    global: { stubs: { teleport: true } },
  })
  try {
    await nextTick()
    expect(wrapper.text()).toContain('写入第 2 项')
    expect(wrapper.get('progress').attributes('value')).toBe('0.5')
    expect(wrapper.find('.activity-center__trigger').exists()).toBe(false)
  } finally {
    wrapper.unmount()
    taskCenter.complete(id)
    taskCenter.dismiss(id)
  }
})

const resources = [
  {
    id: 'extra',
    name: '番外合集',
    fileName: 'extra.zip',
    fileSize: 4_000,
    type: RESOURCE_TYPE.EXTRA_STORY,
    categoryId: null,
    metadata: {},
  },
  {
    id: 'phone',
    name: '小手机',
    fileName: 'phone.apk',
    fileSize: 8_000,
    type: RESOURCE_TYPE.POCKET_PHONE,
    categoryId: null,
    metadata: {},
  },
  {
    id: 'card',
    name: '不会带走的角色卡',
    fileName: 'card.png',
    fileSize: 2_000,
    type: RESOURCE_TYPE.CHARACTER_CARD,
    categoryId: null,
    metadata: {},
  },
] as ResourceSummary[]

const categories: Category[] = []

function button(text: string): HTMLButtonElement {
  const target = Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find((item) =>
    item.textContent?.includes(text),
  )
  if (!target) throw new Error(`找不到按钮：${text}`)
  return target
}

afterEach(() => {
  document.body.replaceChildren()
})

describe('ExportPanel', () => {
  it('分包必须先展示导出与未导出清单，再允许确认导出', async () => {
    const wrapper = mount(ExportPanel, {
      attachTo: document.body,
      props: { resources, categories, busy: false },
    })

    const cardScope = Array.from(
      document.querySelectorAll<HTMLButtonElement>('.backup-scope-tree__scope-row'),
    ).find((item) => item.textContent?.includes('角色卡'))
    cardScope?.click()
    await nextTick()

    button('检查分包内容').click()
    await nextTick()
    expect(document.body.textContent).toContain('确认分包内容')
    expect(document.body.textContent).toContain('将导出')
    expect(document.body.textContent).toContain('番外合集')
    expect(document.body.textContent).toContain('小手机')
    expect(document.body.textContent).toContain('不会导出')
    expect(document.body.textContent).toContain('不会带走的角色卡')
    expect(document.body.textContent).toContain('确认导出 2 项')

    button('确认导出 2 项').click()
    await nextTick()
    const exported = wrapper.emitted('partial')?.[0]?.[0] as { resourceIds: string[] }
    expect(exported.resourceIds).toEqual(['extra', 'phone'])
    wrapper.unmount()
  })
})
