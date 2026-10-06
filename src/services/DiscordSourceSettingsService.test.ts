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

  // SRL-PUBLIC-SYNC: BEGIN PUBLIC-ONLY id=discord-local-installation-identity-test
  it('keeps the Public receipt identity across module reloads without an account', async () => {
    const first = await import('./DiscordSourceSettingsService')
    const id = first.getDiscordClientId()
    expect(id).toMatch(/^[a-f0-9-]{36}$/u)
    expect(localStorage.getItem('srl-auth-device-id')).toBeNull()
    vi.resetModules()
    const next = await import('./DiscordSourceSettingsService')
    expect(next.getDiscordClientId()).toBe(id)
  })
  // SRL-PUBLIC-SYNC: END PUBLIC-ONLY id=discord-local-installation-identity-test

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

  it('protects inbox credentials and restores the same address after reload without persisting the pairing code', async () => {
    const store = new MemoryCredentialStore()
    let service = await import('./DiscordSourceSettingsService')
    await service.saveDiscordSourceConnectionSettings(
      {
        applicationId: '123',
        publicKey: 'public',
        botToken: 'bot-secret',
        workerBaseUrl: 'https://one.workers.dev',
      },
      store,
    )
    await service.saveDiscordInboxPairing(
      {
        libraryId: 'library-1',
        name: '我的手机',
        secret: 'inbox-secret',
        code: 'PAIRCODE',
        expiresAt: 1000,
      },
      store,
    )
    expect(store.values.get('discord-source:inbox-secret')).toBe('inbox-secret')
    const stored = localStorage.getItem('srl.discord-source.connection.v1') ?? ''
    expect(stored).toContain('library-1')
    expect(stored).not.toContain('inbox-secret')
    expect(stored).not.toContain('PAIRCODE')
    vi.resetModules()
    service = await import('./DiscordSourceSettingsService')
    await service.initializeDiscordSourceCredentials(store)
    expect(service.loadDiscordSourceConnectionSettings()).toMatchObject({
      inboxLibraryId: 'library-1',
      inboxSecret: 'inbox-secret',
    })
    expect(service.loadDiscordSourceConnectionSettings().inboxPairCode).toBeUndefined()
  })

  it.each([
    { owner: 'Worker', patch: { workerBaseUrl: 'https://two.workers.dev' } },
    { owner: 'Application', patch: { applicationId: '456' } },
  ])(
    'preserves paired credentials when rejecting a $owner change, then allows it after explicit disconnect',
    async ({ patch }) => {
      const store = new MemoryCredentialStore()
      const service = await import('./DiscordSourceSettingsService')
      const settings = {
        applicationId: '123',
        publicKey: 'public',
        botToken: 'bot-secret',
        workerBaseUrl: 'https://one.workers.dev',
      }
      await service.saveDiscordSourceConnectionSettings(settings, store)
      await service.saveDiscordInboxPairing(
        {
          libraryId: 'library-1',
          name: '手机',
          secret: 'inbox-secret',
          code: 'PAIRCODE',
          expiresAt: 1000,
        },
        store,
      )
      await service.saveDiscordSourceConnectionSettings(
        { ...settings, botToken: 'new-bot-secret' },
        store,
      )
      expect(service.loadDiscordSourceConnectionSettings().inboxLibraryId).toBe('library-1')
      expect(store.values.get('discord-source:inbox-secret')).toBe('inbox-secret')
      const before = service.loadDiscordSourceConnectionSettings()
      const persisted = localStorage.getItem('srl.discord-source.connection.v1')
      const credentials = new Map(store.values)
      const save = vi.spyOn(store, 'save')
      const clear = vi.spyOn(store, 'clear')
      await expect(
        service.saveDiscordSourceConnectionSettings({ ...settings, ...patch }, store),
      ).rejects.toThrow('先领取待收帖子及资源任务并断开')
      expect(service.loadDiscordSourceConnectionSettings()).toEqual(before)
      expect(localStorage.getItem('srl.discord-source.connection.v1')).toBe(persisted)
      expect(store.values).toEqual(credentials)
      expect(save).not.toHaveBeenCalled()
      expect(clear).not.toHaveBeenCalled()
      await service.clearLocalDiscordInboxPairing(store)
      const changed = await service.saveDiscordSourceConnectionSettings(
        { ...settings, ...patch },
        store,
      )
      expect(changed).toMatchObject(patch)
      expect(service.loadDiscordSourceConnectionSettings().inboxLibraryId).toBeUndefined()
      expect(store.values.has('discord-source:inbox-secret')).toBe(false)
    },
  )

  it.each([false, true])(
    'rejects clearing a paired Worker even if its secret is unavailable (%s)',
    async (lostSecret) => {
      const store = new MemoryCredentialStore()
      let service = await import('./DiscordSourceSettingsService')
      await service.saveDiscordSourceConnectionSettings(
        {
          applicationId: '123',
          publicKey: 'public',
          botToken: 'bot-secret',
          workerBaseUrl: 'https://one.workers.dev',
        },
        store,
      )
      await service.saveDiscordInboxPairing(
        {
          libraryId: 'library-1',
          name: '手机',
          secret: 'inbox-secret',
          code: 'PAIRCODE',
          expiresAt: 1000,
        },
        store,
      )
      if (lostSecret) {
        store.values.delete('discord-source:inbox-secret')
        vi.resetModules()
        service = await import('./DiscordSourceSettingsService')
        await service.initializeDiscordSourceCredentials(store)
      }
      const before = service.loadDiscordSourceConnectionSettings()
      const persisted = localStorage.getItem('srl.discord-source.connection.v1')
      const credentials = new Map(store.values)
      const save = vi.spyOn(store, 'save')
      const clear = vi.spyOn(store, 'clear')
      await expect(service.clearDiscordSourceConnectionSettings(store)).rejects.toThrow(
        '先领取待收帖子及资源任务并断开',
      )
      expect(service.loadDiscordSourceConnectionSettings()).toEqual(before)
      expect(localStorage.getItem('srl.discord-source.connection.v1')).toBe(persisted)
      expect(store.values).toEqual(credentials)
      expect(save).not.toHaveBeenCalled()
      expect(clear).not.toHaveBeenCalled()
      await service.clearLocalDiscordInboxPairing(store)
      await service.clearDiscordSourceConnectionSettings(store)
      expect(service.loadDiscordSourceConnectionSettings().workerBaseUrl).toBe('')
      expect(localStorage.getItem('srl.discord-source.connection.v1')).toBeNull()
      expect(store.values.size).toBe(0)
    },
  )

  it('does not replace the local inbox when protecting its new credential fails', async () => {
    const store = new MemoryCredentialStore()
    const service = await import('./DiscordSourceSettingsService')
    await service.saveDiscordSourceConnectionSettings(
      {
        applicationId: '123',
        publicKey: 'public',
        botToken: 'bot-secret',
        workerBaseUrl: 'https://one.workers.dev',
      },
      store,
    )
    const failed: LocalCredentialRepository = {
      ...store,
      save: async () => {
        throw new Error('blocked storage')
      },
      read: store.read.bind(store),
      clear: store.clear.bind(store),
    }
    await expect(
      service.saveDiscordInboxPairing(
        {
          libraryId: 'library-1',
          name: '手机',
          secret: 'inbox-secret',
          code: 'PAIRCODE',
          expiresAt: 1000,
        },
        failed,
      ),
    ).rejects.toThrow('blocked storage')
    expect(service.loadDiscordSourceConnectionSettings().inboxLibraryId).toBeUndefined()
  })

  it('rejects a Worker change queued after pairing without poisoning later settings writes', async () => {
    const store = new MemoryCredentialStore()
    const service = await import('./DiscordSourceSettingsService')
    const original = {
      applicationId: '123',
      publicKey: 'public',
      botToken: 'bot-secret',
      workerBaseUrl: 'https://one.workers.dev',
    }
    await service.saveDiscordSourceConnectionSettings(original, store)
    let release!: () => void
    let entered!: () => void
    const started = new Promise<void>((resolve) => {
      entered = resolve
    })
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const guarded: LocalCredentialRepository = {
      save: async (identifier, secret) => {
        if (identifier === 'discord-source:inbox-secret') {
          entered()
          await gate
        }
        await store.save(identifier, secret)
      },
      read: store.read.bind(store),
      clear: store.clear.bind(store),
    }
    const pair = service.saveDiscordInboxPairing(
      {
        libraryId: 'library-1',
        name: '手机',
        secret: 'inbox-secret',
        code: 'PAIRCODE',
        expiresAt: 1000,
      },
      guarded,
    )
    await started
    const change = service.saveDiscordSourceConnectionSettings(
      { ...original, workerBaseUrl: 'https://two.workers.dev' },
      store,
    )
    const rejectedChange = expect(change).rejects.toThrow('先领取待收帖子及资源任务并断开')
    release()
    await pair
    await rejectedChange
    expect(service.loadDiscordSourceConnectionSettings()).toMatchObject({
      workerBaseUrl: original.workerBaseUrl,
      inboxLibraryId: 'library-1',
      inboxSecret: 'inbox-secret',
    })
    expect(store.values.get('discord-source:bot-token')).toBe('bot-secret')
    expect(store.values.get('discord-source:inbox-secret')).toBe('inbox-secret')
    await service.saveDiscordSourceConnectionSettings(
      { ...original, botToken: 'edited-token' },
      store,
    )
    expect(service.loadDiscordSourceConnectionSettings().botToken).toBe('edited-token')
    expect(store.values.get('discord-source:inbox-secret')).toBe('inbox-secret')
    await service.clearLocalDiscordInboxPairing(store)
    await service.saveDiscordSourceConnectionSettings(
      { ...original, workerBaseUrl: 'https://two.workers.dev' },
      store,
    )
    expect(service.loadDiscordSourceConnectionSettings().workerBaseUrl).toBe(
      'https://two.workers.dev',
    )
    expect(service.loadDiscordSourceConnectionSettings().inboxLibraryId).toBeUndefined()
    expect(store.values.has('discord-source:inbox-secret')).toBe(false)
    await expect(
      service.saveDiscordInboxPairing(
        {
          libraryId: 'late-library',
          name: '手机',
          secret: 'late-secret',
          code: 'PAIRCODE',
          expiresAt: 1000,
        },
        store,
        { workerBaseUrl: original.workerBaseUrl, applicationId: original.applicationId },
      ),
    ).rejects.toThrow('已改变')
    expect(store.values.has('discord-source:inbox-secret')).toBe(false)
  })
})
