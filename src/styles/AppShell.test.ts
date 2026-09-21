/// <reference types="node" />

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const appShellCss = readFileSync(new URL('./AppShell.css', import.meta.url), 'utf8')

function readRule(selector: string): string {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return appShellCss.match(new RegExp(`${escapedSelector}\\s*\\{([\\s\\S]*?)\\}`))?.[1] ?? ''
}

describe('AppShell 导入方式弹层', () => {
  it('在不支持混合色或毛玻璃的移动 WebView 中仍有明确的实体遮罩', () => {
    const overlayRule = readRule('.import-choice-overlay')

    expect(overlayRule).toContain('background-color: rgba(17, 24, 21, 0.68)')
    expect(overlayRule).not.toContain('color-mix(')
    expect(overlayRule).not.toContain('backdrop-filter')
  })

  it('弹层面板使用已定义的不透明主题表面令牌', () => {
    const sheetRule = readRule('.import-choice-sheet')

    expect(sheetRule).toContain('background: var(--color-surface-raised)')
    expect(sheetRule).not.toContain('var(--color-paper)')
  })

  it('关闭按钮保持至少 44px 的移动端触控尺寸', () => {
    const closeRule = readRule('.import-choice-sheet header button')

    expect(closeRule).toContain('width: var(--size-touch)')
    expect(closeRule).toContain('height: var(--size-touch)')
  })
})
