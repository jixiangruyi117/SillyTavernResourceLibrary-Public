/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const nativeMocks = vi.hoisted(() => ({
  backHandler: undefined as (() => void) | undefined,
  shortcutHandler: undefined as ((event: { action?: string }) => void) | undefined,
  minimizeApp: vi.fn(),
  takePending: vi.fn().mockResolvedValue({}),
  shortcutListenerReady: Promise.resolve(),
}))

vi.mock('@capacitor/app', () => ({
  App: {
    addListener: vi.fn((event: string, handler: () => void) => {
      if (event === 'backButton') nativeMocks.backHandler = handler
      return Promise.resolve({ remove: vi.fn() })
    }),
    minimizeApp: nativeMocks.minimizeApp,
  },
}))

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => true,
    getPlatform: () => 'android',
  },
  registerPlugin: () => ({
    addListener: vi.fn(async (event: string, handler: (value: { action?: string }) => void) => {
      await nativeMocks.shortcutListenerReady
      if (event === 'shortcut') nativeMocks.shortcutHandler = handler
      return { remove: vi.fn() }
    }),
    takePending: nativeMocks.takePending,
  }),
}))

import { createNativeResourceDeepLink, installNativeRuntime } from './NativeRuntime'

describe('NativeRuntime back handling', () => {
  beforeEach(() => {
    nativeMocks.backHandler = undefined
    nativeMocks.shortcutHandler = undefined
    nativeMocks.minimizeApp.mockClear()
    nativeMocks.takePending.mockClear()
    nativeMocks.shortcutListenerReady = Promise.resolve()
  })

  it('lets the active UI consume Android back before browser history or minimize', () => {
    const listener = (event: KeyboardEvent) => event.preventDefault()
    document.addEventListener('keydown', listener)
    installNativeRuntime()

    nativeMocks.backHandler?.()

    expect(nativeMocks.minimizeApp).not.toHaveBeenCalled()
    document.removeEventListener('keydown', listener)
  })

  it('等待原生快捷方式监听就绪后再读取启动期间的待办', async () => {
    let releaseListener!: () => void
    nativeMocks.shortcutListenerReady = new Promise<void>((resolve) => {
      releaseListener = resolve
    })

    installNativeRuntime()
    await Promise.resolve()
    expect(nativeMocks.takePending).not.toHaveBeenCalled()

    releaseListener()
    await vi.waitFor(() => expect(nativeMocks.takePending).toHaveBeenCalledTimes(1))
  })
})

describe('NativeRuntime deep links', () => {
  it('只为安全的资源编号生成不含内容和凭据的本机链接', () => {
    expect(createNativeResourceDeepLink('resource-01')).toBe('srl://resource/resource-01')
    expect(createNativeResourceDeepLink('../secret')).toBeNull()
  })
})
