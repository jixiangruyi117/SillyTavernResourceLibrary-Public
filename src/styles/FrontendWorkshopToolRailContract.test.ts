import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('./FrontendWorkshopToolRail.css', import.meta.url), 'utf8')

describe('FrontendWorkshopToolRail CSS contract', () => {
  it('外壳不裁剪 toggle / popover，移动端只滚动内部工具列表', () => {
    expect(css).toMatch(/\.frontend-workbench__tool-rail\s*\{[\s\S]*?overflow:\s*visible;/)
    expect(css).toMatch(
      /@media \(max-width: 48rem\)[\s\S]*?\.frontend-workbench__rail-tools\s*\{[\s\S]*?overflow-y:\s*auto;/,
    )
    expect(css).not.toMatch(
      /@media \(max-width: 48rem\)[\s\S]*?\.frontend-workbench__tool-rail\s*\{[^}]*overflow-y:\s*auto;/,
    )
  })

  it('工具按钮使用独立 44px 命中区和 36px 可见层，不再用相邻重叠的扩张热区', () => {
    expect(css).toMatch(
      /\.frontend-workbench__rail-tools > button\s*\{[\s\S]*?width:\s*2\.75rem;[\s\S]*?height:\s*2\.75rem;/,
    )
    expect(css).toMatch(
      /\.frontend-workbench__rail-tools > button::before\s*\{[\s\S]*?width:\s*var\(--control-visual-secondary\);[\s\S]*?height:\s*var\(--control-visual-secondary\);/,
    )
    expect(css).not.toContain('inset: -0.25rem')
  })

  it('展开按钮的命中区位于 rail 外侧，不覆盖 rail 内工具', () => {
    expect(css).toMatch(
      /\.frontend-workbench__rail-toggle\s*\{[\s\S]*?left:\s*100%;[\s\S]*?width:\s*2\.75rem !important;/,
    )
  })
})
