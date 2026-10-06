import { describe, expect, it } from 'vitest'

import { shouldMakeIncomingPngCurrent } from './ResourceImportOperations'

describe('preferred PNG container import', () => {
  it('promotes a matching current-version PNG, but never activates a historical container', () => {
    expect(shouldMakeIncomingPngCurrent(true, false)).toBe(true)
    expect(shouldMakeIncomingPngCurrent(false, false)).toBe(false)
    expect(shouldMakeIncomingPngCurrent(true, true)).toBe(false)
    expect(shouldMakeIncomingPngCurrent(false, true)).toBe(false)
  })
})
