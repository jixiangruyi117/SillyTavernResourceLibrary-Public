/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { reportFatalError } from './FatalErrorNotice'

function errorDialogText(): string {
  return document.getElementById('srl-fatal-error')?.textContent ?? ''
}

describe('reportFatalError', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.useFakeTimers()
    // 每个用例推进时间，越过同一错误的 5 秒去重窗口
    vi.setSystemTime(Date.now() + 60_000)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('渲染带来源与技术详情的错误弹窗，并保留原始错误信息', () => {
    reportFatalError('导入', new Error('something broke'))
    const overlay = document.getElementById('srl-fatal-error')
    const dialog = overlay?.querySelector('[role="alertdialog"]')
    expect(dialog).not.toBeNull()
    expect(errorDialogText()).toContain('发生位置：导入')
    expect(errorDialogText()).toContain('something broke')
  })

  it('把配额超限翻译成可执行的中文建议', () => {
    reportFatalError('保存', new Error('QuotaExceededError: quota reached'))
    expect(errorDialogText()).toContain('存储空间不足')
    expect(errorDialogText()).toContain('导出完整备份')
  })

  it('把分包加载失败提示为需要刷新', () => {
    reportFatalError('加载', new Error('Failed to fetch dynamically imported module'))
    expect(errorDialogText()).toContain('刷新页面即可继续')
  })

  it('把 IndexedDB 故障与网络故障分开解释', () => {
    reportFatalError('读取', new Error('IndexedDB is not available'))
    expect(errorDialogText()).toContain('本地数据库无法访问')

    vi.setSystemTime(Date.now() + 60_000)
    reportFatalError('上传', new Error('Failed to fetch'))
    expect(errorDialogText()).toContain('本地资源不受影响')
  })

  it('短时间内的相同错误只提示一次，避免循环报错刷屏', () => {
    reportFatalError('渲染', new Error('same failure'))
    const first = document.getElementById('srl-fatal-error')
    reportFatalError('渲染', new Error('same failure'))
    expect(document.getElementById('srl-fatal-error')).toBe(first)
  })

  it('超过去重窗口后重新提示', () => {
    reportFatalError('渲染', new Error('same failure'))
    const first = document.getElementById('srl-fatal-error')
    vi.setSystemTime(Date.now() + 6_000)
    reportFatalError('渲染', new Error('same failure'))
    expect(document.getElementById('srl-fatal-error')).not.toBe(first)
  })

  it('点击忽略后移除横幅', () => {
    reportFatalError('渲染', new Error('dismiss me'))
    const buttons = document.querySelectorAll<HTMLButtonElement>('#srl-fatal-error button')
    expect(Array.from(buttons).map((b) => b.textContent)).toEqual(['刷新页面', '关闭提示'])
    buttons[1].click()
    expect(document.getElementById('srl-fatal-error')).toBeNull()
  })
})
