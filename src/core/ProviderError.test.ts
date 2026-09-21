import { describe, expect, it } from 'vitest'

import { isRetryableProviderCategory } from './ProviderError'

describe('ProviderError', () => {
  it('keeps retry policy consistent across providers', () => {
    expect(isRetryableProviderCategory('network')).toBe(true)
    expect(isRetryableProviderCategory('rate_limit')).toBe(true)
    expect(isRetryableProviderCategory('server')).toBe(true)
    expect(isRetryableProviderCategory('auth')).toBe(false)
    expect(isRetryableProviderCategory('request')).toBe(false)
    expect(isRetryableProviderCategory('response_parse')).toBe(false)
  })
})
