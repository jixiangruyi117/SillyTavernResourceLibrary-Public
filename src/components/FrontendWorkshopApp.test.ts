import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('./FrontendWorkshopApp.vue', import.meta.url), 'utf8')

describe('FrontendWorkshopApp', () => {
  it('uses the current Source/Workbench shell instead of the retired status-bar generator', () => {
    expect(source).toContain('FrontendWorkshopSourceAiShell')
    expect(source).not.toContain('UseFrontendWorkshopApp')
    expect(source).not.toContain('StatusPlaceHolder')
    expect(source).not.toContain('状态栏校样')
    expect(source).not.toContain('FrontendWorkshopLegacy')
  })
})
