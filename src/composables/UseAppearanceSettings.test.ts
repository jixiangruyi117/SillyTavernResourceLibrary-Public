/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { PreviewPolicy } from '../services/BrowserStorageService'

let policy: PreviewPolicy = { allowRemoteResources: false, allowScripts: false }

const storage = {
  getLayoutMode: vi.fn(() => 'grid' as const),
  getUiFontScale: vi.fn(() => 'standard' as const),
  getPreviewPolicy: vi.fn(() => policy),
  setPreviewPolicy: vi.fn((next: PreviewPolicy) => {
    policy = next
    return next
  }),
  getCustomUiCss: vi.fn(() => ''),
  getCustomUiPresets: vi.fn(() => []),
  setCustomUiCss: vi.fn(),
  getExtractCharacterAssets: vi.fn(() => false),
  setExtractCharacterAssets: vi.fn(),
  getShowManuallyBoundResources: vi.fn(() => true),
  getHideCharacterAssets: vi.fn(() => false),
  getHideChatDisplayRegex: vi.fn(() => true),
  getBlurThumbnails: vi.fn(() => true),
  setBlurThumbnails: vi.fn(),
  setLayoutMode: vi.fn(),
  setUiFontScale: vi.fn((value: 'small' | 'standard' | 'large') => value),
}

vi.mock('../core/AppContainer', () => ({ browserStorageService: storage }))

const confirmMock = vi.fn(async () => true)
vi.mock('./UseConfirmDialog', () => ({ confirmAction: confirmMock }))

const { useAppearanceSettings } = await import('./UseAppearanceSettings')

describe('useAppearanceSettings', () => {
  let notices: string[]

  beforeEach(() => {
    document
      .getElementById('srl-appearance-safe-layer')
      ?.shadowRoot?.querySelector<HTMLButtonElement>('[data-rollback]')
      ?.click()
    vi.clearAllMocks()
    policy = { allowRemoteResources: false, allowScripts: false }
    notices = []
    document.head.innerHTML = ''
    document.documentElement.removeAttribute('data-theme')
    document.documentElement.removeAttribute('data-font-scale')
    localStorage.clear()
  })

  const create = () => useAppearanceSettings((message) => notices.push(message))

  it('应用主题会同时写入文档属性与本地存储', () => {
    const appearance = create()
    appearance.applyTheme('dark')
    expect(appearance.theme.value).toBe('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(localStorage.getItem('srl-theme')).toBe('dark')
  })

  it('字体大小只接受受控档位并同步到文档属性', () => {
    const appearance = create()
    appearance.applyUiFontScale('large')

    expect(appearance.uiFontScale.value).toBe('large')
    expect(document.documentElement.dataset.fontScale).toBe('large')
    expect(storage.setUiFontScale).toHaveBeenCalledWith('large')
  })

  it('自定义 CSS 保存后注入同一个 style 节点，不重复创建', () => {
    const appearance = create()
    appearance.saveCustomUiCss('.a { color: red }')
    appearance.saveCustomUiCss('.b { color: blue }')
    expect(document.querySelectorAll('#srl-custom-ui-style')).toHaveLength(1)
    expect(document.getElementById('srl-custom-ui-style')?.textContent).toContain('.b')
    expect(notices).toEqual([
      '自定义 CSS 已临时应用，请在 15 秒内选择“保留更改”',
      '未确认更改，已自动恢复上一版 CSS',
      '自定义 CSS 已临时应用，请在 15 秒内选择“保留更改”',
    ])
  })

  it('清空自定义 CSS 给出不同提示', () => {
    const appearance = create()
    appearance.saveCustomUiCss('')
    expect(notices).toEqual(['自定义 CSS 已清除'])
  })

  it('自定义 CSS 截断到 20 万字符，防止超长输入撑爆存储', () => {
    const appearance = create()
    appearance.saveCustomUiCss('a'.repeat(250_000))
    expect(appearance.customUiCss.value).toHaveLength(200_000)
  })

  it('关闭远程资源开关会连同脚本一起关闭', () => {
    const appearance = create()
    appearance.applyRemotePreviewPolicy(false)
    expect(storage.setPreviewPolicy).toHaveBeenCalledWith({
      allowRemoteResources: false,
      allowScripts: false,
    })
  })

  it('用户在二次确认中取消时不得开启脚本预览', async () => {
    confirmMock.mockResolvedValueOnce(false)
    const appearance = create()
    const keyBefore = appearance.settingsPanelKey.value

    await appearance.applyScriptPreviewPolicy(true)

    expect(confirmMock).toHaveBeenCalledOnce()
    expect(storage.setPreviewPolicy).not.toHaveBeenCalled()
    expect(appearance.previewPolicy.value.allowScripts).toBe(false)
    // 面板需要重建，让被点开的开关回到实际状态
    expect(appearance.settingsPanelKey.value).toBe(keyBefore + 1)
  })

  it('确认后开启脚本预览并连带放行远程资源', async () => {
    confirmMock.mockResolvedValueOnce(true)
    const appearance = create()
    await appearance.applyScriptPreviewPolicy(true)
    expect(storage.setPreviewPolicy).toHaveBeenCalledWith({
      allowRemoteResources: true,
      allowScripts: true,
    })
  })

  it('关闭脚本预览不需要二次确认', async () => {
    const appearance = create()
    await appearance.applyScriptPreviewPolicy(false)
    expect(confirmMock).not.toHaveBeenCalled()
    expect(storage.setPreviewPolicy).toHaveBeenCalledWith({
      allowRemoteResources: false,
      allowScripts: false,
    })
  })

  it('恢复便携配置后重新读取全部外观设置', () => {
    const appearance = create()
    storage.getLayoutMode.mockReturnValue('list' as never)
    storage.getUiFontScale.mockReturnValue('small' as never)
    localStorage.setItem('srl-theme', 'dark')

    appearance.reloadAppearanceSettings()

    expect(appearance.theme.value).toBe('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(appearance.layoutMode.value).toBe('list')
    expect(appearance.uiFontScale.value).toBe('small')
    expect(document.documentElement.dataset.fontScale).toBe('small')
  })
})
