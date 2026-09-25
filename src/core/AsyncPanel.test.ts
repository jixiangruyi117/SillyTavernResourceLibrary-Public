/** @vitest-environment jsdom */
import { mount, flushPromises } from '@vue/test-utils'
import { defineComponent, h, nextTick } from 'vue'
import { describe, expect, it, vi } from 'vitest'

import { createAsyncPanel } from './AsyncPanel'

const LoadedPanel = defineComponent({
  name: 'LoadedPanel',
  setup: () => () => h('p', '面板内容'),
})

/**
 * 模拟动态 import 的返回值。
 *
 * Vue 只对 ES module 命名空间对象解包 .default，普通对象会被当成组件本身，
 * 因此测试桩必须带上 __esModule 标记，才能复现真实 import() 的行为。
 */
const loadedModule = { __esModule: true, default: LoadedPanel }

/** 让失败的异步组件完成重新渲染，不依赖额外重试计时器。 */
async function settle(): Promise<void> {
  for (let round = 0; round < 4; round += 1) {
    await flushPromises()
    await nextTick()
  }
}

describe('createAsyncPanel', () => {
  it('模块尚未返回时显示明确加载状态，而不是空白页', async () => {
    let resolveModule!: (value: { default: typeof LoadedPanel }) => void
    const Panel = createAsyncPanel(
      '资源库',
      () =>
        new Promise<{ default: typeof LoadedPanel }>((resolve) => {
          resolveModule = resolve
        }),
    )
    const wrapper = mount(defineComponent({ render: () => h(Panel) }))
    await nextTick()
    expect(wrapper.find('[role="status"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('正在打开资源库')
    resolveModule(loadedModule)
    await flushPromises()
    expect(wrapper.text()).toContain('面板内容')
  })

  it('加载成功时渲染目标组件', async () => {
    const Panel = createAsyncPanel('测试面板', async () => loadedModule)
    const wrapper = mount(defineComponent({ render: () => h(Panel) }))
    await flushPromises()
    expect(wrapper.text()).toContain('面板内容')
  })

  it('模块失败立即显示错误，不重复导入已缓存的失败模块', async () => {
    const loader = vi.fn().mockRejectedValue(new Error('404'))
    const Panel = createAsyncPanel('云备份', loader)
    const wrapper = mount(defineComponent({ render: () => h(Panel) }))
    await settle()
    expect(loader).toHaveBeenCalledTimes(1)
    expect(wrapper.text()).toContain('云备份加载失败')
    expect(wrapper.find('[role="alert"]').exists()).toBe(true)
    expect(wrapper.find('button').text()).toBe('刷新页面')
  })
})
