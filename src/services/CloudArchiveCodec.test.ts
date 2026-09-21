import { describe, expect, it } from 'vitest'

import { addTransportHash, hashCloudBlob, readTransportHash } from './CloudArchiveCodec'

describe('CloudArchiveCodec', () => {
  it('embeds a short SHA-256 marker that can be checked after transport', async () => {
    const blob = new Blob(['integrity'])
    const hash = await hashCloudBlob(blob)
    const name = addTransportHash('backup.zip', hash)

    expect(name).toMatch(/backup--sha256-[a-f0-9]{16}\.zip/)
    expect(hash.startsWith(readTransportHash(name) ?? '')).toBe(true)
  })
})
