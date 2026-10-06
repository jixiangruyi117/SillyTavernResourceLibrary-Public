import { describe, expect, it } from 'vitest'

import {
  getDiscordWorkerEndpoints,
  normalizeDiscordWorkerBaseUrl,
} from './DiscordSourceConnectionService'

describe('DiscordSourceConnectionService', () => {
  it('accepts a bare workers.dev host and adds https', () => {
    expect(normalizeDiscordWorkerBaseUrl('example.workers.dev')).toBe('https://example.workers.dev')
  })

  it('removes trailing slashes from the base URL', () => {
    expect(normalizeDiscordWorkerBaseUrl(' https://example.workers.dev/// ')).toBe(
      'https://example.workers.dev',
    )
  })

  it('accepts a pasted interactions URL without duplicating the suffix', () => {
    const endpoints = getDiscordWorkerEndpoints('https://example.workers.dev/interactions')
    expect(endpoints).toEqual({
      baseUrl: 'https://example.workers.dev',
      interactionsUrl: 'https://example.workers.dev/interactions',
      healthUrl: 'https://example.workers.dev/health',
      registerUrl: 'https://example.workers.dev/setup/register',
      statusUrl: 'https://example.workers.dev/setup/status',
    })
  })

  it('strips other known endpoint suffixes but preserves an intentional base path', () => {
    expect(normalizeDiscordWorkerBaseUrl('https://example.com/srl/setup/register')).toBe(
      'https://example.com/srl',
    )
    expect(normalizeDiscordWorkerBaseUrl('https://example.com/srl/health')).toBe(
      'https://example.com/srl',
    )
    expect(normalizeDiscordWorkerBaseUrl('https://example.com/srl/setup/status')).toBe(
      'https://example.com/srl',
    )
  })

  it('rejects non-http protocols and credential-bearing URLs', () => {
    expect(normalizeDiscordWorkerBaseUrl('javascript:alert(1)')).toBe('')
    expect(normalizeDiscordWorkerBaseUrl('https://user:pass@example.workers.dev')).toBe('')
  })
})
