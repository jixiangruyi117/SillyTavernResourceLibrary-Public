import { describe, expect, it } from 'vitest'

import { negotiateTavernCapabilities } from './TavernCapabilities'

describe('negotiateTavernCapabilities', () => {
  it('distinguishes automatic actions from upload-only and user-confirmed fallbacks', () => {
    expect(
      negotiateTavernCapabilities(['character', 'preset', 'set-current-character-v1']),
    ).toMatchObject({
      upload: 'automatic',
      setCurrentCharacter: 'automatic',
      switchPreset: 'upload-only',
      openChat: 'confirmation-required',
    })
  })
})
