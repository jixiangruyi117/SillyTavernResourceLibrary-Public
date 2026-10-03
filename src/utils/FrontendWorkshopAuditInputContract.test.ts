import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

function readScript(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8')
}

describe('FrontendWorkshop browser audit input contract', () => {
  it('uses a real touchscreen tap for the Reference pointer-selection check', () => {
    const source = readScript('../../scripts/FrontendWorkshopReferenceAudit.mjs')
    expect(source).toContain("await touchCenter(frame.locator('#a'), '选择 A')")
    expect(source).toContain('document.elementFromPoint')
    expect(source).toContain('await page.touchscreen.tap(x, y)')
    expect(source).not.toContain('force: true')
    expect(source).not.toContain("dispatchEvent('click')")
  })

  it('uses Playwright touchscreen input for tap behavior instead of force/synthetic click', () => {
    const source = readScript('../../scripts/FrontendWorkshopViewportAudit.mjs')
    expect(source).toContain("cdp.send('Input.dispatchTouchEvent'")
    expect(source).not.toContain('force: true')
    expect(source).not.toContain("dispatchEvent('click')")
  })

  it('does not depend on retired ancestor/Guided Flip runtime marker scripts', () => {
    const audits = [
      readScript('../../scripts/FrontendWorkshopReferenceAudit.mjs'),
      readScript('../../scripts/FrontendWorkshopViewportAudit.mjs'),
    ].join('\n')
    expect(audits).not.toContain('data-srl-workshop-ancestor-tap-runtime')
    expect(audits).not.toContain('data-srl-workshop-guided-flip-runtime')
  })

  it('keeps the compatibility command on the current reference and viewport owners', () => {
    const component = readScript('../../scripts/FrontendWorkshopComponentInteractionAudit.mjs')
    expect(component).toContain("import('./FrontendWorkshopReferenceAudit.mjs')")
    expect(component).toContain("import('./FrontendWorkshopViewportAudit.mjs')")
    expect(component).not.toContain('frontend-workbench__component-generator')
  })
})
