import { describe, expect, it } from 'vitest'

import { isRecord } from './UnknownValue'

describe('isRecord', () => {
  it('accepts non-array objects', () => {
    expect(isRecord({ value: 1 })).toBe(true)
    expect(isRecord(Object.create(null))).toBe(true)
    expect(isRecord(new Date(0))).toBe(true)
  })

  it('rejects null, arrays, functions and primitives', () => {
    expect(isRecord(null)).toBe(false)
    expect(isRecord([])).toBe(false)
    expect(isRecord(() => undefined)).toBe(false)
    expect(isRecord('value')).toBe(false)
    expect(isRecord(1)).toBe(false)
    expect(isRecord(false)).toBe(false)
    expect(isRecord(undefined)).toBe(false)
  })
})
