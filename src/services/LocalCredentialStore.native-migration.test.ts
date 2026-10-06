import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const nativeState = vi.hoisted(() => ({ available: true }))
const nativeCredentials = vi.hoisted(() => new Map<string, string>())

vi.mock('./NativeCloudTransfer', () => ({
  isNativeCloudTransferAvailable: () => nativeState.available,
  saveNativeAppCredential: vi.fn(async (identifier: string, secret: string) => {
    nativeCredentials.set(identifier, secret)
  }),
  readNativeAppCredential: vi.fn(
    async (identifier: string) => nativeCredentials.get(identifier) ?? '',
  ),
  clearNativeAppCredential: vi.fn(async (identifier: string) => {
    nativeCredentials.delete(identifier)
  }),
}))

import { LocalCredentialStore } from './LocalCredentialStore'
import { ProtectedCredentialStore } from './CloudCredentialStore'

describe('LocalCredentialStore Android migration', () => {
  beforeEach(() => {
    vi.stubGlobal('indexedDB', new IDBFactory())
    nativeState.available = true
    nativeCredentials.clear()
  })

  it('migrates an encrypted IndexedDB credential into Keystore and keeps the rollback copy', async () => {
    const oldStore = new ProtectedCredentialStore()
    await oldStore.save('app:discord:primary', 'discord-secret')

    const nativeStore = new LocalCredentialStore()
    await expect(nativeStore.read('discord:primary')).resolves.toBe('discord-secret')
    expect(nativeCredentials.get('app:discord:primary')).toBe('discord-secret')
    await expect(oldStore.read('app:discord:primary')).resolves.toBe('discord-secret')
  })

  it('writes and verifies both native and encrypted rollback copies on Android', async () => {
    const nativeStore = new LocalCredentialStore()
    await nativeStore.save('main-api:default', 'api-secret')

    expect(nativeCredentials.get('app:main-api:default')).toBe('api-secret')
    await expect(new ProtectedCredentialStore().read('app:main-api:default')).resolves.toBe(
      'api-secret',
    )
  })
})
