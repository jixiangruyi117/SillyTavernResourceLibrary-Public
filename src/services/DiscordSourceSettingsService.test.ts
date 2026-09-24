// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { LocalCredentialRepository } from './LocalCredentialStore'

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

describe('DiscordSourceSettingsService', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.resetModules()
  })

  it('migrates a legacy plaintext Bot Token into protected local storage', async () => {
    localStorage.setItem(
      'srl.discord-source.connection.v1',
      JSON.stringify({
        applicationId: '123',
        publicKey: 'public',
        botToken: 'discord-secret',
        workerBaseUrl: 'https://example.workers.dev',
      }),
    )
    const store = new MemoryCredentialStore()
    const service = await import('./DiscordSourceSettingsService')

    await service.initializeDiscordSourceCredentials(store)

    expect(store.values.get('discord-source:bot-token')).toBe('discord-secret')
    expect(service.loadDiscordSourceConnectionSettings().botToken).toBe('discord-secret')
    expect(localStorage.getItem('srl.discord-source.connection.v1')).not.toContain('discord-secret')
  })

  it('keeps a session-only Bot Token out of protected storage', async () => {
    const store = new MemoryCredentialStore()
    const service = await import('./DiscordSourceSettingsService')

    await service.saveDiscordSourceConnectionSettings(
      {
        applicationId: '123',
        publicKey: 'public',
        botToken: 'temporary-secret',
        workerBaseUrl: 'https://example.workers.dev',
        credentialPersistence: 'session',
      },
      store,
    )

    expect(store.values.size).toBe(0)
    expect(service.loadDiscordSourceConnectionSettings().botToken).toBe('temporary-secret')
    expect(localStorage.getItem('srl.discord-source.connection.v1')).not.toContain(
      'temporary-secret',
    )
  })

  it('does not erase legacy plaintext when protected migration fails', async () => {
    localStorage.setItem(
      'srl.discord-source.connection.v1',
      JSON.stringify({ botToken: 'keep-on-failure' }),
    )
    const service = await import('./DiscordSourceSettingsService')
    const store: LocalCredentialRepository = {
      save: async () => {
        throw new Error('store failed')
      },
      read: async () => '',
      clear: async () => undefined,
    }

    await expect(service.initializeDiscordSourceCredentials(store)).rejects.toThrow('store failed')
    expect(localStorage.getItem('srl.discord-source.connection.v1')).toContain('keep-on-failure')
  })

  it('persists verified Worker and command state without exposing the Bot Token', async () => {
    const store = new MemoryCredentialStore()
    const service = await import('./DiscordSourceSettingsService')
    await service.saveDiscordSourceConnectionSettings(
      {
        applicationId: '123',
        publicKey: 'public',
        botToken: 'discord-secret',
        workerBaseUrl: 'https://example.workers.dev',
      },
      store,
    )

    service.saveDiscordSourceConnectionStatus({
      workerVerifiedAt: 100,
      commandCheckedAt: 101,
      commandRegistered: true,
    })

    expect(service.loadDiscordSourceConnectionSettings()).toMatchObject({
      workerVerifiedAt: 100,
      commandCheckedAt: 101,
      commandRegistered: true,
    })
    const persisted = localStorage.getItem('srl.discord-source.connection.v1') ?? ''
    expect(persisted).toContain('"commandRegistered":true')
    expect(persisted).not.toContain('discord-secret')
  })

  it('clears cached verification when Worker identity changes', async () => {
    const store = new MemoryCredentialStore()
    const service = await import('./DiscordSourceSettingsService')
    await service.saveDiscordSourceConnectionSettings(
      {
        applicationId: '123',
        publicKey: 'public',
        botToken: 'discord-secret',
        workerBaseUrl: 'https://one.workers.dev',
      },
      store,
    )
    service.saveDiscordSourceConnectionStatus({
      workerVerifiedAt: 100,
      commandCheckedAt: 101,
      commandRegistered: true,
    })

    const changed = await service.saveDiscordSourceConnectionSettings(
      {
        ...service.loadDiscordSourceConnectionSettings(),
        workerBaseUrl: 'https://two.workers.dev',
      },
      store,
    )

    expect(changed.workerVerifiedAt).toBeUndefined()
    expect(changed.commandCheckedAt).toBeUndefined()
    expect(changed.commandRegistered).toBeUndefined()
  })
})
