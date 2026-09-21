import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { LocalCredentialStore } from './LocalCredentialStore'

describe('LocalCredentialStore', () => {
  beforeEach(() => {
    vi.stubGlobal('indexedDB', new IDBFactory())
  })

  it('encrypts an application credential and reads it after reopening', async () => {
    const first = new LocalCredentialStore()
    await first.save('main-api:default', 'secret-value')

    const reopened = new LocalCredentialStore()
    await expect(reopened.read('main-api:default')).resolves.toBe('secret-value')
  })

  it('rejects identifiers that cannot be safely routed to native storage', async () => {
    const store = new LocalCredentialStore()
    await expect(store.save('../unsafe', 'secret-value')).rejects.toThrow('凭据标识无效')
  })
})
