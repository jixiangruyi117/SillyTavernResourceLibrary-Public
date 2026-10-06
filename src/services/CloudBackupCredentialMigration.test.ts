import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const nativeState = vi.hoisted(() => ({ available: true }))
const nativeCredentials = vi.hoisted(
  () => new Map<string, { state: 'valid' | 'invalid'; secret: string }>(),
)

vi.mock('./NativeCloudTransfer', () => ({
  isNativeCloudTransferAvailable: () => nativeState.available,
  saveNativeCloudCredential: vi.fn(async (provider: string, secret: string) => {
    nativeCredentials.set(provider, { state: 'valid', secret })
  }),
  readNativeCloudCredential: vi.fn(async (provider: string) => {
    const saved = nativeCredentials.get(provider)
    return saved ?? { state: 'missing' as const, secret: '' }
  }),
  invalidateNativeCloudCredential: vi.fn(async (provider: string) => {
    nativeCredentials.set(provider, { state: 'invalid', secret: '' })
  }),
  clearNativeCloudCredential: vi.fn(async (provider: string) => {
    nativeCredentials.delete(provider)
  }),
}))

import { CloudBackupConfiguration } from './CloudBackupConfiguration'
import { CloudCredentialStore } from './CloudCredentialStore'

function memoryStorage(): Storage {
  const values = new Map<string, string>()
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
    clear: () => values.clear(),
    key: (index) => [...values.keys()][index] ?? null,
    get length() {
      return values.size
    },
  } as Storage
}

describe('CloudBackupConfiguration credential migration', () => {
  beforeEach(() => {
    vi.stubGlobal('indexedDB', new IDBFactory())
    vi.stubGlobal('localStorage', memoryStorage())
    vi.stubGlobal('sessionStorage', memoryStorage())
    nativeState.available = true
    nativeCredentials.clear()
  })

  it('moves encrypted IndexedDB credentials into Keystore and verifies a rollback copy', async () => {
    const browserStore = new CloudCredentialStore()
    await browserStore.save('github', 'github-secret')
    const configuration = new CloudBackupConfiguration(async () => 'ok')

    await configuration.initializeCredentials()

    expect(nativeCredentials.get('github')).toEqual({ state: 'valid', secret: 'github-secret' })
    expect(configuration.getSecret('github')).toBe('github-secret')
    await expect(browserStore.read('github')).resolves.toBe('github-secret')
  })

  it('preserves an invalid status when moving credentials to Keystore', async () => {
    const browserStore = new CloudCredentialStore()
    await browserStore.save('webdav', 'expired-secret')
    await browserStore.markInvalid('webdav')
    const configuration = new CloudBackupConfiguration(async () => 'ok')

    await configuration.initializeCredentials()

    expect(nativeCredentials.get('webdav')).toEqual({ state: 'invalid', secret: '' })
    expect(configuration.getSecret('webdav')).toBe('')
  })

  it('keeps PWA credentials on IndexedDB', async () => {
    nativeState.available = false
    const browserStore = new CloudCredentialStore()
    await browserStore.save('github', 'pwa-secret')
    const configuration = new CloudBackupConfiguration(async () => 'ok')

    await configuration.initializeCredentials()

    expect(nativeCredentials.size).toBe(0)
    expect(configuration.getSecret('github')).toBe('pwa-secret')
  })
})
