import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { CloudCredentialStore } from './CloudCredentialStore'

const nativeState = vi.hoisted(() => ({
  available: false,
  credentials: new Map<string, { secret: string; invalid: boolean }>(),
}))

vi.mock('./NativeCloudTransfer', () => ({
  isNativeCloudTransferAvailable: () => nativeState.available,
  saveNativeCloudCredential: async (provider: string, secret: string) => {
    nativeState.credentials.set(provider, { secret, invalid: false })
  },
  readNativeCloudCredential: async (provider: string) => {
    const value = nativeState.credentials.get(provider)
    return value
      ? value.invalid
        ? { state: 'invalid', secret: '' }
        : { state: 'valid', secret: value.secret }
      : { state: 'missing', secret: '' }
  },
  invalidateNativeCloudCredential: async (provider: string) => {
    const value = nativeState.credentials.get(provider)
    if (value) nativeState.credentials.set(provider, { ...value, invalid: true })
  },
  clearNativeCloudCredential: async (provider: string) => {
    nativeState.credentials.delete(provider)
  },
}))

describe('CloudCredentialStore', () => {
  beforeEach(() => {
    vi.stubGlobal('indexedDB', new IDBFactory())
    nativeState.available = false
    nativeState.credentials.clear()
  })

  it('uses one non-extractable device key when two browser instances initialize concurrently', async () => {
    const first = new CloudCredentialStore()
    const second = new CloudCredentialStore()

    await Promise.all([
      first.save('github', 'github-token'),
      second.save('webdav', 'koofr-password'),
    ])

    const reopened = new CloudCredentialStore()
    await expect(reopened.read('github')).resolves.toBe('github-token')
    await expect(reopened.read('webdav')).resolves.toBe('koofr-password')
  })

  it('uses Android Keystore as the active credential store and migrates legacy IndexedDB values', async () => {
    const legacy = new CloudCredentialStore()
    await legacy.save('github', 'legacy-token')
    nativeState.available = true

    const migrated = new CloudCredentialStore()
    await expect(migrated.read('github')).resolves.toBe('legacy-token')
    await migrated.save('webdav', 'new-secret')
    await expect(migrated.read('webdav')).resolves.toBe('new-secret')
    await expect(migrated.state('webdav')).resolves.toEqual({ present: true, valid: true })
    await migrated.markInvalid('webdav')
    await expect(migrated.read('webdav')).resolves.toBe('')
    await migrated.clear('github')
    await expect(migrated.state('github')).resolves.toEqual({ present: false, valid: false })
  })
})
