// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest'

import { FrontendWorkshopLegacyApiPreferenceService } from './FrontendWorkshopLegacyApiPreferenceService'
import type { LocalCredentialRepository } from './LocalCredentialStore'
import type { MainApiConfig } from './MainApiService'

class MemoryCredentialStore implements LocalCredentialRepository {
  readonly values = new Map<string, string>()

  async save(identifier: string, secret: string): Promise<void> {
    this.values.set(identifier, secret)
  }

  async read(identifier: string): Promise<string> {
    return this.values.get(identifier) ?? ''
  }

  async clear(identifier: string): Promise<void> {
    this.values.delete(identifier)
  }
}

const custom: MainApiConfig = {
  url: 'https://api.example.com/v1',
  apiKey: '',
  model: 'example-model',
  protocol: 'openai-compatible',
  temperature: 1,
  topP: 1,
  stream: false,
  reasoningEffort: 'auto',
  maxTokens: 0,
  frequencyPenalty: 0,
  presencePenalty: 0,
}

const fallback = {
  mode: 'main' as const,
  savedProfileId: 'main',
  custom,
  credentialPersistence: 'local' as const,
}

describe('FrontendWorkshopLegacyApiPreferenceService', () => {
  beforeEach(() => localStorage.clear())

  it('migrates the legacy status API key and sanitizes localStorage', async () => {
    localStorage.setItem(
      'srl.frontendWorkshop.api.v1',
      JSON.stringify({ ...fallback, mode: 'custom', custom: { ...custom, apiKey: 'legacy-key' } }),
    )
    const store = new MemoryCredentialStore()
    const service = new FrontendWorkshopLegacyApiPreferenceService(store)

    await service.initializeCredentials(fallback)

    expect(store.values.get('frontend-workshop-legacy:custom-api')).toBe('legacy-key')
    expect(service.getPreference(fallback).custom.apiKey).toBe('legacy-key')
    expect(localStorage.getItem('srl.frontendWorkshop.api.v1')).not.toContain('legacy-key')
  })

  it('persists a validated custom API key in the protected store by default', async () => {
    const store = new MemoryCredentialStore()
    const service = new FrontendWorkshopLegacyApiPreferenceService(store)

    await service.savePreference({
      ...fallback,
      mode: 'custom',
      custom: { ...custom, apiKey: 'protected-key' },
    })

    expect(store.values.get('frontend-workshop-legacy:custom-api')).toBe('protected-key')
    expect(localStorage.getItem('srl.frontendWorkshop.api.v1')).not.toContain('protected-key')
  })

  it('does not persist a session-only custom API key', async () => {
    const store = new MemoryCredentialStore()
    const service = new FrontendWorkshopLegacyApiPreferenceService(store)

    await service.savePreference({
      ...fallback,
      mode: 'custom',
      custom: { ...custom, apiKey: 'session-key' },
      credentialPersistence: 'session',
    })

    expect(store.values.size).toBe(0)
    expect(service.getPreference(fallback).custom.apiKey).toBe('session-key')
    expect(localStorage.getItem('srl.frontendWorkshop.api.v1')).not.toContain('session-key')
  })
})
