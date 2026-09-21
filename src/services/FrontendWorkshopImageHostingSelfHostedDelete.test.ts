/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { FrontendWorkshopImageHostingService } from './FrontendWorkshopImageHostingService'
import type { LocalCredentialRepository } from './LocalCredentialStore'

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>()
  get length() {
    return this.values.size
  }
  clear() {
    this.values.clear()
  }
  getItem(key: string) {
    return this.values.get(key) ?? null
  }
  key(index: number) {
    return [...this.values.keys()][index] ?? null
  }
  removeItem(key: string) {
    this.values.delete(key)
  }
  setItem(key: string, value: string) {
    this.values.set(key, value)
  }
}

class MemoryCredentials implements LocalCredentialRepository {
  readonly values = new Map<string, string>()
  async save(identifier: string, secret: string) {
    this.values.set(identifier, secret)
  }
  async read(identifier: string) {
    return this.values.get(identifier) ?? ''
  }
  async clear(identifier: string) {
    this.values.delete(identifier)
  }
}

beforeEach(() => {
  vi.stubGlobal('localStorage', new MemoryStorage())
  Reflect.deleteProperty(window, 'Capacitor')
})

describe('self-hosted ImgBed resource management', () => {
  it('uploads directly to user ImgBed, records real fileId, and never touches shared quota APIs', async () => {
    const request = vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify([
            {
              publicUrl: 'https://cdn.example/public/generated.png',
              src: 'https://mine.example/file/srl-workshop/managed.png',
            },
          ]),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    )
    const service = new FrontendWorkshopImageHostingService(request, new MemoryCredentials())
    await service.saveSelfHostedConfiguration({
      origin: 'https://mine.example',
      token: 'user-delete-token',
      remember: false,
      authMode: 'bearer',
    })

    const hosted = await service.uploadBlobSelfHosted(
      new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }),
      '自己的图片',
    )

    expect(hosted.url).toBe('https://cdn.example/public/generated.png')
    expect(hosted.managementOrigin).toBe('https://mine.example')
    expect(hosted.upstreamFileId).toBe('srl-workshop/managed.png')
  })

  it('deletes only through the connected ImgBed delete API and does not consume shared quota', async () => {
    const request = vi.fn<typeof fetch>(
      async () =>
        new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    )
    const service = new FrontendWorkshopImageHostingService(request, new MemoryCredentials())
    await service.saveSelfHostedConfiguration({
      origin: 'https://mine.example/upload?uploadChannel=cfr2',
      token: 'user-delete-token',
      remember: false,
      authMode: 'bearer',
    })

    await service.deleteSelfHosted({
      url: 'https://cdn.example/public/generated.png',
      managementOrigin: 'https://mine.example',
      upstreamFileId: 'srl-workshop/managed.png',
    })

    expect(request).toHaveBeenCalledTimes(1)
    const [input, init] = request.mock.calls[0]
    expect(String(input)).toBe('https://mine.example/api/manage/delete/srl-workshop/managed.png')
    expect(init?.method).toBe('DELETE')
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer user-delete-token')
  })

  it('can derive the fileId for old same-origin ImgBed links without new metadata', async () => {
    const request = vi.fn<typeof fetch>(async () => new Response('{}', { status: 200 }))
    const service = new FrontendWorkshopImageHostingService(request, new MemoryCredentials())
    await service.saveSelfHostedConfiguration({
      origin: 'https://mine.example',
      token: 'user-delete-token',
      remember: false,
      authMode: 'bearer',
    })

    await service.deleteSelfHosted({
      url: 'https://mine.example/file/old-folder/old.png',
    })

    expect(String(request.mock.calls[0]?.[0])).toBe(
      'https://mine.example/api/manage/delete/old-folder/old.png',
    )
  })

  it('does not send the current token to a different historical ImgBed origin', async () => {
    const request = vi.fn<typeof fetch>()
    const service = new FrontendWorkshopImageHostingService(request, new MemoryCredentials())
    await service.saveSelfHostedConfiguration({
      origin: 'https://current.example',
      token: 'current-secret-token',
      remember: false,
      authMode: 'bearer',
    })

    await expect(
      service.deleteSelfHosted({
        url: 'https://old.example/file/a.png',
        managementOrigin: 'https://old.example',
        upstreamFileId: 'a.png',
      }),
    ).rejects.toThrow('请先重新连接该图床')
    expect(request).not.toHaveBeenCalled()
  })

  it('keeps AUTH_CODE upload-only and requires an API Token with delete permission for deletion', async () => {
    const request = vi.fn<typeof fetch>()
    const service = new FrontendWorkshopImageHostingService(request, new MemoryCredentials())
    await service.saveSelfHostedConfiguration({
      origin: 'https://mine.example?authCode=classic-code',
      token: 'ignored',
      remember: false,
    })

    await expect(
      service.deleteSelfHosted({
        url: 'https://mine.example/file/a.png',
        upstreamFileId: 'a.png',
      }),
    ).rejects.toThrow('AUTH_CODE')
    expect(request).not.toHaveBeenCalled()
  })

  it('turns ImgBed 401/403 into a precise delete-permission error', async () => {
    const request = vi.fn<typeof fetch>(
      async () => new Response('You need to login', { status: 401 }),
    )
    const service = new FrontendWorkshopImageHostingService(request, new MemoryCredentials())
    await service.saveSelfHostedConfiguration({
      origin: 'https://mine.example',
      token: 'upload-only-token',
      remember: false,
      authMode: 'bearer',
    })

    await expect(
      service.deleteSelfHosted({
        url: 'https://mine.example/file/a.png',
        upstreamFileId: 'a.png',
      }),
    ).rejects.toThrow('没有图片删除权限')
  })
})
