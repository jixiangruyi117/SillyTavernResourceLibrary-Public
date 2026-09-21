/** @vitest-environment jsdom */
import { describe, expect, it } from 'vitest'

import { getCapacitorPlatform, isCapacitorApp } from './CapacitorDetection'

describe('isCapacitorApp', () => {
  it('普通网页返回 false', () => {
    expect(isCapacitorApp()).toBe(false)
  })

  it('启用 Capacitor 并标记为原生平台时返回 true', () => {
    // 模拟 Capacitor 全局对象，仅供单元测试使用
    const capacitor = window as unknown as {
      Capacitor: { isNativePlatform(): boolean }
    }
    const prevCapacitor = capacitor.Capacitor
    capacitor.Capacitor = { isNativePlatform: () => true }
    expect(isCapacitorApp()).toBe(true)
    capacitor.Capacitor = prevCapacitor
  })

  it('isNativePlatform 返回 false 时仍为 false', () => {
    const capacitor = window as unknown as {
      Capacitor: { isNativePlatform(): boolean }
    }
    const prevCapacitor = capacitor.Capacitor
    capacitor.Capacitor = { isNativePlatform: () => false }
    expect(isCapacitorApp()).toBe(false)
    capacitor.Capacitor = prevCapacitor
  })

  it('Capacitor 对象存在但缺少方法时返回 false', () => {
    const capacitor = window as unknown as {
      Capacitor?: Record<string, unknown>
    }
    const prevCapacitor = capacitor.Capacitor
    capacitor.Capacitor = {} as Record<string, unknown>
    expect(isCapacitorApp()).toBe(false)
    capacitor.Capacitor = prevCapacitor
  })

  it('worker 环境（无 window）也不会抛异常', () => {
    // jsdom 有 window，但我们只需确认无 Capacitor 时不抛错即可
    expect(() => isCapacitorApp()).not.toThrow()
  })
})

describe('getCapacitorPlatform', () => {
  it('非原生应用返回 web', () => {
    expect(getCapacitorPlatform()).toBe('web')
  })

  it('原生 Android 返回 android', () => {
    const capacitor = window as unknown as {
      Capacitor: { isNativePlatform(): boolean; getPlatform(): string }
    }
    const prevCapacitor = capacitor.Capacitor
    capacitor.Capacitor = {
      isNativePlatform: () => true,
      getPlatform: () => 'android',
    }
    expect(getCapacitorPlatform()).toBe('android')
    capacitor.Capacitor = prevCapacitor
  })

  it('原生 iOS 返回 ios', () => {
    const capacitor = window as unknown as {
      Capacitor: { isNativePlatform(): boolean; getPlatform(): string }
    }
    const prevCapacitor = capacitor.Capacitor
    capacitor.Capacitor = {
      isNativePlatform: () => true,
      getPlatform: () => 'ios',
    }
    expect(getCapacitorPlatform()).toBe('ios')
    capacitor.Capacitor = prevCapacitor
  })
})
