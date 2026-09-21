import { describe, expect, it, vi } from 'vitest'

import {
  fetchUserPersonaAvatar,
  normalizeUserPersonaAvatarId,
  normalizeUserPersonaAvatarUrl,
  prepareUserPersonaAvatar,
} from './UserPersonaAvatar'

function pngBytes(width = 2, height = 3): Uint8Array {
  const bytes = new Uint8Array(45)
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10], 0)
  bytes.set([0, 0, 0, 13, 73, 72, 68, 82], 8)
  new DataView(bytes.buffer).setUint32(16, width)
  new DataView(bytes.buffer).setUint32(20, height)
  bytes.set([0, 0, 0, 0, 73, 69, 78, 68, 0, 0, 0, 0], 33)
  return bytes
}

describe('UserPersonaAvatar', () => {
  it('accepts safe HTTPS image URLs and rejects unsafe avatar identifiers', () => {
    expect(normalizeUserPersonaAvatarUrl(' https://img.example/avatar.png ')).toBe(
      'https://img.example/avatar.png',
    )
    expect(() => normalizeUserPersonaAvatarUrl('http://img.example/avatar.png')).toThrow('HTTPS')
    expect(() => normalizeUserPersonaAvatarUrl('https://user:pass@example.com/avatar.png')).toThrow(
      '账号信息',
    )
    expect(normalizeUserPersonaAvatarId(' alice.png ')).toBe('alice.png')
    expect(() => normalizeUserPersonaAvatarId('../alice.png')).toThrow('文件名')
    expect(() => normalizeUserPersonaAvatarId('alice.webp')).toThrow('.png')
  })

  it('keeps a validated PNG as a real PNG file under the SillyTavern avatar id', async () => {
    const prepared = await prepareUserPersonaAvatar(
      new Blob([pngBytes().buffer as ArrayBuffer], { type: 'image/png' }),
      'alice.png',
    )

    expect(prepared.name).toBe('alice.png')
    expect(prepared.type).toBe('image/png')
    expect(prepared.size).toBe(pngBytes().byteLength)
  })

  it('downloads without credentials or referrer and reports cross-origin failures clearly', async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(new Blob([pngBytes().buffer as ArrayBuffer], { type: 'image/png' }), {
          status: 200,
          headers: { 'Content-Type': 'image/png' },
        }),
    )
    const result = await fetchUserPersonaAvatar(
      'https://img.example/avatar.png',
      'alice.png',
      fetcher,
    )

    expect(result.file.name).toBe('alice.png')
    expect(result.sourceUrl).toBe('https://img.example/avatar.png')
    expect(fetcher).toHaveBeenCalledWith(
      'https://img.example/avatar.png',
      expect.objectContaining({ credentials: 'omit', referrerPolicy: 'no-referrer' }),
    )

    await expect(
      fetchUserPersonaAvatar(
        'https://blocked.example/avatar.png',
        'alice.png',
        vi.fn(async () => {
          throw new TypeError('Failed to fetch')
        }),
      ),
    ).rejects.toThrow('跨域下载')
  })
})
