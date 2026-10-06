import { describe, expect, it } from 'vitest'

import { hashBlob, hashBytes, hashReadableStream } from './HashService'

describe('HashService', () => {
  it('matches the SHA-256 reference for bytes and blobs', async () => {
    const bytes = new TextEncoder().encode('SRL hash service')
    await expect(hashBytes(bytes)).resolves.toBe(
      'fea7a34717fd0802b63fbaa41d25c00b4ccd493785a2e2538fd9e5905f0b05fd',
    )
    await expect(hashBlob(new Blob([bytes]))).resolves.toBe(
      'fea7a34717fd0802b63fbaa41d25c00b4ccd493785a2e2538fd9e5905f0b05fd',
    )
  })

  it('streams large blobs instead of calling whole-blob arrayBuffer', async () => {
    const blob = new Blob([new Uint8Array(5 * 1024 * 1024).fill(0x61)])
    Object.defineProperty(blob, 'arrayBuffer', {
      value: () => Promise.reject(new Error('large blob must not use arrayBuffer')),
    })
    await expect(hashBlob(blob)).resolves.toBe(
      'a29968fad2e782aa9f2040a35f05adb97ed8979eb1f572c8c8ea78637e275f3c',
    )
  })

  it('hashes a readable stream incrementally and enforces its byte limit', async () => {
    const stream = new Blob(['SRL hash service']).stream()
    await expect(hashReadableStream(stream, { maxBytes: 1024 })).resolves.toEqual({
      hash: 'fea7a34717fd0802b63fbaa41d25c00b4ccd493785a2e2538fd9e5905f0b05fd',
      size: 16,
    })
    await expect(
      hashReadableStream(new Blob(['too large']).stream(), { maxBytes: 2 }),
    ).rejects.toThrow('超过允许')
  })
})
