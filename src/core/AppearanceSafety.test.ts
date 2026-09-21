/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest'

import { appearanceTransaction, recoverInterruptedAppearance } from './AppearanceSafety'
import {
  beginStartupAttempt,
  installStartupRescuePrompt,
  isSafeModeActive,
  markStartupReady,
} from './SafeStartup'

describe('AppearanceSafety', () => {
  afterEach(() => {
    vi.useRealTimers()
    localStorage.clear()
    sessionStorage.clear()
    document.body.replaceChildren()
  })

  it('在受 Shadow DOM 保护的 15 秒层确认后保留新 CSS', () => {
    const apply = vi.fn()
    const persist = vi.fn()
    appearanceTransaction.begin({ previousCss: '.old{}', nextCss: '.new{}', apply, persist })
    const host = document.getElementById('srl-appearance-safe-layer')
    expect(host?.shadowRoot?.textContent).toContain('保留更改')
    expect(host?.style.getPropertyPriority('display')).toBe('important')
    host?.shadowRoot?.querySelector<HTMLButtonElement>('[data-keep]')?.click()
    expect(persist).toHaveBeenCalledWith('.new{}')
    expect(localStorage.getItem('srl.appearance.pending.v1')).toBeNull()
  })

  it('超时自动恢复上一版，刷新中断也读取 previousCss 自愈', async () => {
    vi.useFakeTimers()
    const apply = vi.fn()
    const persist = vi.fn()
    appearanceTransaction.begin({
      previousCss: '.old{}',
      nextCss: '.bad{}',
      apply,
      persist,
      durationMs: 1000,
    })
    await vi.advanceTimersByTimeAsync(1000)
    expect(persist).toHaveBeenLastCalledWith('.old{}')
    expect(apply).toHaveBeenLastCalledWith('.old{}')

    localStorage.setItem(
      'srl.appearance.pending.v1',
      JSON.stringify({ previousCss: '.safe{}', nextCss: '.bad{}', expiresAt: Date.now() + 1000 }),
    )
    expect(recoverInterruptedAppearance()).toBe('.safe{}')
  })
})

describe('SafeStartup', () => {
  afterEach(() => {
    localStorage.clear()
    sessionStorage.clear()
    document.body.replaceChildren()
  })

  it('连续三次未 ready 时先阻断高风险能力并给出正常/安全启动', () => {
    expect(beginStartupAttempt().rescueRequired).toBe(false)
    expect(beginStartupAttempt().rescueRequired).toBe(false)
    expect(beginStartupAttempt().rescueRequired).toBe(true)
    expect(isSafeModeActive()).toBe(true)
    installStartupRescuePrompt()
    const host = document.getElementById('srl-startup-rescue-layer')
    expect(host?.shadowRoot?.textContent).toContain('正常启动')
    expect(host?.shadowRoot?.textContent).toContain('安全模式')
    markStartupReady()
    expect(beginStartupAttempt().failures).toBe(0)
  })
})
