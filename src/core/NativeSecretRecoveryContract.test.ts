import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// Source-level guards, not a substitute for Android Keystore/device tests.
const source = readFileSync(
  'android/app/src/main/java/buzz/jixiangruyi1207/srl/NativeSecretRecovery.java',
  'utf8',
)

describe('native secret recovery authorization contract', () => {
  it('submits AAD only after the matching CryptoObject succeeds, before finalizing the cipher', () => {
    const callback = source.indexOf('void onAuthenticationSucceeded(')
    const check = source.indexOf('crypto.getCipher() != cipher', callback)
    const aad = source.indexOf('cipher.updateAAD(AAD)')
    const final = source.indexOf('cipher.doFinal(', callback)
    expect(callback).toBeGreaterThan(0)
    expect(check).toBeGreaterThan(callback)
    expect(aad).toBeGreaterThan(check)
    expect(final).toBeGreaterThan(aad)
    expect(source.match(/\.updateAAD\(/g)).toHaveLength(1)
    expect(source).toContain('.setUserAuthenticationRequired(true)')
    expect(source).toContain(
      'setUserAuthenticationParameters(0, KeyProperties.AUTH_BIOMETRIC_STRONG)',
    )
    expect(source).toContain('setUserAuthenticationValidityDurationSeconds(-1)')
  })

  it('retains both keys when a preference write has uncertain durability', () => {
    expect(source).toContain('if (writeAttempted && !committed) rollback(preferences, previous)')
    expect(source).toContain('else if (!writeAttempted && saving) retireKey(alias)')
    const clear = source.slice(source.indexOf('void clear('), source.indexOf('void authenticate('))
    expect(clear.indexOf('.commit()')).toBeLessThan(clear.indexOf('retireKey(previous.alias)'))
    expect(clear).toContain('if (!cleared && preferences != null && previous != null) rollback')
  })

  it('validates the full record and key presence rather than testing only payload presence', () => {
    const state = source.slice(
      source.indexOf('void state('),
      source.indexOf('private KeyStore store('),
    )
    expect(state).toContain('record.wellFormed() && store().containsAlias(record.alias)')
    expect(state).toContain('"invalid"')
    expect(source).toContain('Arrays.fill(plaintext, (byte) 0)')
    expect(source).toContain('Arrays.fill(recovered, (byte) 0)')
  })
})
