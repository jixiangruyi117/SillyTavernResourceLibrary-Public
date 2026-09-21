/** @vitest-environment jsdom */
import { describe, expect, it } from 'vitest'
import { FEATURE_APP_REGISTRY } from './FeatureAppRegistry'
import {
  appearanceScopes,
  compileAppearancePreset,
  parseAppearancePreset,
  removeAppAppearanceCss,
  upgradeLegacyAppearanceCss,
} from './AppearanceScopes'
import type { CustomCssPreset } from '../types/BrowserPreferences'
const preset: CustomCssPreset = {
  id: 'one',
  name: '旧预设',
  globalCss: ':root { --test: 1; }',
  scopedCss: {
    frontend: '.panel { color: red; }',
    'app:imageAlbum': ':scope { --album: 1; }',
    'app:future': ':scope { --future: 1; }',
  },
  createdAt: '',
  updatedAt: '',
}
describe('registry-owned appearance scopes', () => {
  it('covers every visible registry entry, keeping aliases and adding future IDs without an editor list', () => {
    expect(
      appearanceScopes()
        .filter((scope) => scope.appId)
        .map((scope) => scope.appId),
    ).toEqual(FEATURE_APP_REGISTRY.filter((app) => app.visible).map((app) => app.id))
    expect(appearanceScopes().find((scope) => scope.appId === 'frontendWorkshop')?.value).toBe(
      'frontend',
    )
    const appended = [
      ...FEATURE_APP_REGISTRY,
      {
        ...FEATURE_APP_REGISTRY[0]!,
        id: 'future' as never,
        page: 'future' as never,
        name: '未来 APP',
      },
    ]
    expect(appearanceScopes(appended).find((scope) => scope.appId === 'future')?.value).toBe(
      'app:future',
    )
  })
  it('scopes bundled APP styles to their feature page and preserves unrelated/global content', () => {
    const css = compileAppearancePreset(preset)
    expect(css).toContain('.feature-hub[data-feature-page="frontendWorkshop"]')
    expect(css).not.toContain('data-official-app-ready')
    expect(css).not.toContain('--future')
    const next = removeAppAppearanceCss(css, [preset], 'frontendWorkshop')
    expect(next).not.toContain('color: red')
    expect(next).toContain('--test')
    expect(next).toContain('--album')
    expect(preset.scopedCss.frontend).toContain('red')
  })
  it('upgrades an existing applied legacy block without changing its source or unrelated CSS', () => {
    const old =
      ':root { --test: 1; }\n@scope (.feature-hub[data-feature-page="frontendWorkshop"]) {\n.panel { color: red; }\n}'
    const next = upgradeLegacyAppearanceCss(old, [preset])
    expect(next).toContain('.feature-hub[data-feature-page="frontendWorkshop"]')
    expect(next).not.toContain('data-official-app-ready')
    expect(next).toContain('.panel { color: red; }')
    expect(upgradeLegacyAppearanceCss(next, [preset])).toBe(next)
    expect(removeAppAppearanceCss(old, [preset], 'frontendWorkshop')).toBe(':root { --test: 1; }')
  })
  it('round trips dormant and unknown scopes in an editable preset, with a fresh identity', () => {
    const restored = parseAppearancePreset(
      JSON.parse(JSON.stringify({ format: 'srl-appearance-preset', version: 1, preset })),
    )
    expect(restored.scopedCss).toEqual(preset.scopedCss)
    expect(restored.id).not.toBe(preset.id)
    expect(() =>
      parseAppearancePreset({
        format: 'srl-appearance-preset',
        version: 1,
        preset: { ...preset, scopedCss: { bad: 123 } },
      }),
    ).toThrow()
  })
  it('removes a previously applied local block after a preset edit was rolled back', () => {
    const applied = compileAppearancePreset(preset)
    const edited = {
      ...preset,
      scopedCss: { ...preset.scopedCss, frontend: '.panel { color: blue; }' },
    }
    expect(removeAppAppearanceCss(applied, [edited], 'frontendWorkshop')).not.toContain(
      'color: red',
    )
  })
  it('preserves global blocks, comments, quoted braces and nested rules outside the selected scope', () => {
    const local = String.raw`@media (min-width: 1px) { .a::after { content: "} \" {"; } } /* } */`
    const custom = { ...preset, scopedCss: { ...preset.scopedCss, frontend: local } }
    const block = compileAppearancePreset({
      ...custom,
      globalCss: '',
      scopedCss: { frontend: local },
    })
    custom.globalCss = `${block}\n/* ${block} */\n.a { --escaped: \\{; }`
    const cleaned = removeAppAppearanceCss(
      compileAppearancePreset(custom),
      [custom],
      'frontendWorkshop',
    )
    expect(cleaned.startsWith(custom.globalCss)).toBe(true)
    expect(cleaned.slice(custom.globalCss.length)).not.toContain(local)
    expect(cleaned).toContain('--album')
  })
})
