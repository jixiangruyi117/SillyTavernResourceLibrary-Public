import { defineAsyncComponent, h, type Component } from 'vue'

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
): T {
  return defineAsyncComponent({
    loader: async () => (await loader()).default,
    delay: 0,
    loadingComponent: {
      name: 'AsyncPanelLoadingBoundary',
      setup: () => () => h(AsyncPanelLoading, { label }),
    },
    timeout: LOAD_TIMEOUT_MS,
    errorComponent: {
      name: 'AsyncPanelErrorBoundary',
      setup: () => () => h(AsyncPanelError, { label }),
    },
  }) as T
}
