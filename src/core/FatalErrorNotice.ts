import type { App } from 'vue'

const BANNER_ID = 'srl-fatal-error'
const REPEAT_WINDOW_MS = 5_000

let lastMessage = ''
let lastShownAt = 0

/**
 * 存储层常见故障的可读解释。
 *
 * 资源库重度依赖 IndexedDB，配额耗尽、隐私模式禁库、Safari 清理站点数据都会抛出
 * 用户看不懂的原生错误。这里只做归类提示，不尝试自动修复。
 */
function explain(message: string): string {
  const text = message.toLocaleLowerCase()
  if (text.includes('quota') || text.includes('exceeded')) {
    return '浏览器存储空间不足。请先导出完整备份，再删除部分资源或历史快照。'
  }
  if (text.includes('indexeddb') || text.includes('database') || text.includes('dexie')) {
    return '本地数据库无法访问。若使用隐私模式或浏览器刚清理过站点数据，请换回普通窗口重试。'
  }
  // 分包加载失败的原文常见形式是 "Failed to fetch dynamically imported module"，
  // 必须排在通用网络失败之前判断，否则会被归类成“稍后重试”，而这里真正的动作是刷新。
  if (text.includes('dynamically imported module') || text.includes('importing a module')) {
    return '页面模块加载失败，通常是资源库刚完成更新。刷新页面即可继续。'
  }
  if (text.includes('failed to fetch') || text.includes('networkerror')) {
    return '网络请求失败。本地资源不受影响，联网功能请稍后重试。'
  }
  return '发生了未处理的错误。本地资源仍保存在浏览器数据库中，刷新页面可以继续使用。'
}

/**
 * 用原生 DOM 渲染错误横幅。
 *
 * 刻意不使用 Vue 组件：这里要处理的正是 Vue 渲染树已经崩溃的场景。
 */
function renderErrorDialog(source: string, detail: string, advice: string): void {
  const existing = document.getElementById(BANNER_ID)
  if (existing) existing.remove()

  const overlay = document.createElement('div')
  overlay.id = BANNER_ID
  overlay.setAttribute('role', 'presentation')
  const dialog = document.createElement('section')
  dialog.className = 'srl-fatal-error__dialog'
  dialog.setAttribute('role', 'alertdialog')
  dialog.setAttribute('aria-modal', 'true')
  dialog.setAttribute('aria-labelledby', 'srl-fatal-error-title')
  dialog.setAttribute('aria-describedby', 'srl-fatal-error-advice')

  const eyebrow = document.createElement('small')
  eyebrow.textContent = '系统错误'
  const title = document.createElement('strong')
  title.id = 'srl-fatal-error-title'
  title.textContent = '该操作没有完成'
  const location = document.createElement('p')
  location.className = 'srl-fatal-error__location'
  location.textContent = `发生位置：${source}`
  const adviceNode = document.createElement('p')
  adviceNode.id = 'srl-fatal-error-advice'
  adviceNode.className = 'srl-fatal-error__advice'
  adviceNode.textContent = advice
  const technical = document.createElement('details')
  const summary = document.createElement('summary')
  summary.textContent = '查看技术详情'
  const reason = document.createElement('pre')
  reason.textContent = detail
  technical.append(summary, reason)

  const reload = document.createElement('button')
  reload.type = 'button'
  reload.textContent = '刷新页面'
  reload.addEventListener('click', () => window.location.reload())

  const dismiss = document.createElement('button')
  dismiss.type = 'button'
  dismiss.textContent = '关闭提示'
  dismiss.addEventListener('click', () => overlay.remove())

  const actions = document.createElement('div')
  actions.className = 'srl-fatal-error__actions'
  actions.append(reload, dismiss)

  dialog.append(eyebrow, title, location, adviceNode, technical, actions)
  overlay.append(dialog)
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) overlay.remove()
  })
  document.body.append(overlay)
  dismiss.focus()
}

/** 展示一次错误提示；短时间内的相同错误只提示一次，避免循环报错刷屏。 */
export function reportFatalError(source: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error)
  const now = Date.now()
  if (message === lastMessage && now - lastShownAt < REPEAT_WINDOW_MS) return
  lastMessage = message
  lastShownAt = now

  console.error(`[SRL:${source}]`, error)
  try {
    renderErrorDialog(source, `${source}：${message}`.slice(0, 1000), explain(message))
  } catch {
    // 连横幅都渲染不出来时不再追加动作，控制台记录已经完成。
  }
}

/** 注册全局兜底：Vue 渲染错误、未捕获异常与未处理的 Promise 拒绝。 */
export function installGlobalErrorHandlers(app: App): void {
  app.config.errorHandler = (error, _instance, info) => {
    reportFatalError(`组件错误 ${info}`, error)
  }
  window.addEventListener('error', (event) => {
    // 图片、样式等资源加载失败会冒泡到 window，但没有 error 对象，不作为致命错误处理。
    if (!event.error) return
    reportFatalError('运行时错误', event.error)
  })
  window.addEventListener('unhandledrejection', (event) => {
    reportFatalError('未处理的异步错误', event.reason)
  })
}
