import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { CloudCredentialStore } from './CloudCredentialStore'

describe('CloudCredentialStore', () => {
  beforeEach(() => {
    vi.stubGlobal('indexedDB', new IDBFactory())
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
})
