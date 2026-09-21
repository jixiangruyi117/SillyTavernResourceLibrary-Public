/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getPlatformInfo, getNativeSystemUiState } = vi.hoisted(() => ({
  getPlatformInfo: vi.fn(),
  getNativeSystemUiState: vi.fn(),
}))

vi.mock('./PlatformService', () => ({
  getPlatformInfo,
}))

vi.mock('./NativeSystemUi', () => ({
  getNativeSystemUiState,
}))

import { refreshSystemInsets } from './SystemInsetsService'

const webInfo = {
  kind: 'web' as const,
  apiVersion: 0,
  capabilities: [],
  insets: { top: 0, bottom: 0 },
  network: {
    offline: false,
    wifi: false,
    cellular: false,
    metered: false,
    validated: true,
  },
}

const androidInfo = {
  kind: 'android' as const,
  apiVersion: 1,
  capabilities: ['system-ui'],
  insets: { top: 96, bottom: 72 },
  network: {
    offline: false,
    wifi: true,
    cellular: false,
    metered: false,
    validated: true,
  },
}

function safeVar(name: string): string {
  return document.documentElement.style.getPropertyValue(name)
}

describe('SystemInsetsService platform safe-area contract', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    document.documentElement.removeAttribute('style')
    delete document.documentElement.dataset.statusBarVisible
    Object.defineProperty(window, 'devicePixelRatio', {
      configurable: true,
      value: 3,
    })
  })

  it('keeps browser/PWA safe areas delegated to CSS env()', async () => {
    getPlatformInfo.mockResolvedValue(webInfo)

    await refreshSystemInsets()

    expect(safeVar('--safe-top')).toBe('env(safe-area-inset-top, 0px)')
    expect(safeVar('--safe-right')).toBe('env(safe-area-inset-right, 0px)')
    expect(safeVar('--safe-bottom')).toBe('env(safe-area-inset-bottom, 0px)')
    expect(safeVar('--safe-left')).toBe('env(safe-area-inset-left, 0px)')
    expect(document.documentElement.dataset.statusBarVisible).toBeUndefined()
  })

  it('reserves Android APK status-bar inset when the native status bar is visible', async () => {
    getPlatformInfo.mockResolvedValue(androidInfo)
    getNativeSystemUiState.mockResolvedValue({ showStatusBar: true })

    await refreshSystemInsets()

    expect(safeVar('--safe-top')).toBe('32px')
    expect(safeVar('--safe-bottom')).toBe('24px')
    expect(document.documentElement.dataset.statusBarVisible).toBe('true')
  })

  it('removes Android APK top reservation in true fullscreen while preserving bottom inset', async () => {
    getPlatformInfo.mockResolvedValue(androidInfo)
    getNativeSystemUiState.mockResolvedValue({ showStatusBar: false })

    await refreshSystemInsets()

    expect(safeVar('--safe-top')).toBe('0px')
    expect(safeVar('--safe-bottom')).toBe('24px')
    expect(document.documentElement.dataset.statusBarVisible).toBe('false')
  })

  it('fails safe by reserving the Android top inset if native system-ui state cannot be read', async () => {
    getPlatformInfo.mockResolvedValue(androidInfo)
    getNativeSystemUiState.mockRejectedValue(new Error('bridge unavailable'))

    await refreshSystemInsets()

    expect(safeVar('--safe-top')).toBe('32px')
    expect(document.documentElement.dataset.statusBarVisible).toBe('true')
  })
})
