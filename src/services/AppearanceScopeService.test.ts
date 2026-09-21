/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it } from 'vitest'
import { BrowserStorageService } from './BrowserStorageService'
import { compileAppearancePreset } from '../core/AppearanceScopes'
import { clearOfficialAppAppearance } from './AppearanceScopeService'
import { appearanceTransaction } from '../core/AppearanceSafety'
import type { CustomCssPreset } from '../types/BrowserPreferences'
beforeEach(() => localStorage.clear())
describe('APP style ownership', () => {
  it('rolls back unconfirmed changes before deleting a local style, without reviving it later', () => {
    const storage = new BrowserStorageService()
    const preset: CustomCssPreset = {
      id: 'pending',
      name: '待确认',
      globalCss: 'body { color: blue; }',
      scopedCss: { draw: ':scope { --draw: new; }' },
      createdAt: '',
      updatedAt: '',
    }
    storage.setCustomUiPresets([preset])
    appearanceTransaction.begin({
      previousCss: compileAppearancePreset({
        ...preset,
        globalCss: 'body { color: red; }',
        scopedCss: { draw: ':scope { --draw: old; }' },
      }),
      nextCss: compileAppearancePreset(preset),
      apply: () => {},
      persist: (css) => storage.setCustomUiCss(css),
    })
    clearOfficialAppAppearance('draw')
    expect(storage.getCustomUiCss()).toBe('body { color: red; }')
    expect(document.getElementById('srl-appearance-safe-layer')).toBeNull()
    expect(localStorage.getItem('srl.appearance.pending.v1')).toBeNull()
    appearanceTransaction.rollback()
    expect(storage.getCustomUiCss()).toBe('body { color: red; }')
  })
  it('removes only the selected APP across presets and retains global and dormant styles through backup restore', () => {
    const storage = new BrowserStorageService()
    const preset: CustomCssPreset = {
      id: 'a',
      name: '主题',
      globalCss: 'body { color: red; }',
      scopedCss: { draw: ':scope { --draw: 1; }', 'app:imageAlbum': ':scope { --album: 1; }' },
      createdAt: '',
      updatedAt: '',
    }
    storage.setCustomUiPresets([preset, { ...preset, id: 'b' }])
    storage.setActiveCustomUiPresetId('a')
    storage.setCustomUiCss(compileAppearancePreset(preset))
    const backup = storage.exportAppearanceSettings()
    localStorage.clear()
    storage.importAppearanceSettings(backup)
    expect(storage.getCustomUiPresets()[0]?.scopedCss).toEqual(preset.scopedCss)
    clearOfficialAppAppearance('draw')
    expect(storage.getCustomUiPresets().every((item) => item.scopedCss.draw === undefined)).toBe(
      true,
    )
    expect(storage.getCustomUiCss()).not.toContain('--draw')
    expect(storage.getCustomUiCss()).toContain('--album')
    expect(storage.getCustomUiCss()).toContain('body { color: red; }')
    expect(storage.getActiveCustomUiPresetId()).toBe('a')
  })
})
