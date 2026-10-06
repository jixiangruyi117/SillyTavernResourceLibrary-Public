import { describe, expect, it } from 'vitest'
import { settingsRegistry } from './SettingsRegistry'

describe('SettingsRegistry', () => {
  it('keeps device/native/session settings out of portable data when required', () => {
    expect(settingsRegistry.portableKeys()).toContain('srl-theme')
    expect(settingsRegistry.portableKeys()).not.toContain('srl.native.haptics.enabled')
    expect(settingsRegistry.portableKeys()).not.toContain('srl.appResume.v1')
  })

  it('never permits credential keys in a portable record', () => {
    expect(() =>
      settingsRegistry.assertPortableRecord({ 'srl.cloudBackup.localSecrets.v1': '{}' }),
    ).toThrow('不允许带出本机')
  })

  it('falls back to the registered default for invalid values', () => {
    const theme = settingsRegistry.get('srl-theme')!
    expect(settingsRegistry.normalize(theme, 'purple')).toBe('light')
  })
})
