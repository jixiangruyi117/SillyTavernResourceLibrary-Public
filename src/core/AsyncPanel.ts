import { defineAsyncComponent, h, type Component } from 'vue'

import AsyncPanelError from '../components/AsyncPanelError.vue'
import AsyncPanelLoading from '../components/AsyncPanelLoading.vue'

const RETRY_DELAY_MS = 600
const LOAD_TIMEOUT_MS = 20_000

/**
 * 按需加载的面板工厂。
 *
 * 分包文件名带内容哈希，服务器完成整包覆盖后，旧标签页请求的旧哈希文件会 404。
 * 直接使用 defineAsyncComponent 时这类失败没有任何界面反馈，用户只会看到“点了没反应”。
 * 这里统一补上一次重试和明确的失败提示，让用户知道需要刷新。
 *
 * @param label 面板中文名，仅用于失败提示文案。
 * @param loader 动态 import 函数。
 */
export function createAsyncPanel<T extends Component>(
  label: string,
  loader: () => Promise<{ default: T }>,
): T {
  return defineAsyncComponent({
    loader: async () => {
      try {
        return (await loader()).default
      } catch (firstError) {
        // 首次失败可能只是网络抖动或部署切换的瞬间，隔一小段时间再试一次。
        await new Promise((resume) => window.setTimeout(resume, RETRY_DELAY_MS))
        try {
          return (await loader()).default
        } catch {
          throw firstError
        }
      }
    },
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
    onError(error, retry, fail, attempts) {
      // loader 内部已经重试过一次；这里只负责在超时等场景下放弃并渲染错误组件。
      if (attempts <= 1 && error.message.includes('timeout')) retry()
      else fail()
    },
  }) as T
}
