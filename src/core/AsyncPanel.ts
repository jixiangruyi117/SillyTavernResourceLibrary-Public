import { defineAsyncComponent, defineComponent, h, Teleport, type Component } from 'vue'

import AsyncPanelError from '../components/AsyncPanelError.vue'
import AsyncPanelLoading from '../components/AsyncPanelLoading.vue'

const LOAD_TIMEOUT_MS = 20_000

/**
 * 按需加载的面板工厂。
 *
 * 分包文件名带内容哈希，服务器完成整包覆盖后，旧标签页请求的旧哈希文件会 404。
 * 直接使用 defineAsyncComponent 时这类失败没有任何界面反馈，用户只会看到“点了没反应”。
 * 同 URL 的 ES 模块失败会被浏览器记住，重复 import 不能修复旧文件；直接显示恢复入口。
 *
 * @param label 面板中文名，仅用于失败提示文案。
 * @param loader 动态 import 函数。
 */
export function createAsyncPanel<T extends Component>(
  label: string,
  loader: () => Promise<{ default: T }>,
  options: { modal?: boolean } = {},
): T {
  const boundary = (component: Component) =>
    defineComponent({
      inheritAttrs: false,
      emits: ['close'],
      setup:
        (_props, { emit }) =>
        () => {
          const content = h(component, {
            label,
            class:
              options.modal && component === AsyncPanelLoading
                ? 'async-panel-loading--embedded'
                : undefined,
          })
          if (!options.modal) return content
          // 弹窗模块尚未下载时也占据同一顶层，避免菜单消失后只剩首页。
          return h(Teleport, { to: 'body' }, [
            h('div', { class: 'editor-overlay', role: 'presentation' }, [
              h(
                'section',
                {
                  class: 'editor-sheet',
                  role: 'dialog',
                  'aria-modal': 'true',
                  'aria-label': label,
                },
                [
                  content,
                  h(
                    'button',
                    { type: 'button', class: 'button button--quiet', onClick: () => emit('close') },
                    '取消打开',
                  ),
                ],
              ),
            ]),
          ])
        },
    })
  return defineAsyncComponent({
    loader: async () => (await loader()).default,
    delay: 0,
    loadingComponent: boundary(AsyncPanelLoading),
    timeout: LOAD_TIMEOUT_MS,
    errorComponent: boundary(AsyncPanelError),
  }) as T
}
