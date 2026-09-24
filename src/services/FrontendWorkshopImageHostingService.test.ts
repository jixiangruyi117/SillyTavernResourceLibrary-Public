/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { FrontendWorkshopImageHostingService } from './FrontendWorkshopImageHostingService'
import type { LocalCredentialRepository } from './LocalCredentialStore'

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

describe('自建 ImgBed', () => {
  beforeEach(() => {
    localStorage.clear()
    Reflect.deleteProperty(window, 'Capacitor')
  })

  it('上传只连接用户配置的图床，并通过凭据存储传递 Token', async () => {
    const token = `imgbed_${'a'.repeat(64)}`
    const credentials = new MemoryCredentials()
    const request = vi.fn<typeof fetch>(
      async () =>
        new Response(JSON.stringify([{ src: '/file/generated.png' }]), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    )
    const service = new FrontendWorkshopImageHostingService(request, credentials)
    await service.saveSelfHostedConfiguration({
      origin: 'https://imgbed.example.test',
      token,
      remember: true,
    })

    const uploaded = await service.uploadBlobSelfHosted(
      new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }),
      '测试图片',
    )

    expect(request).toHaveBeenCalledTimes(1)
    const uploadUrl = new URL(String(request.mock.calls[0]?.[0]))
    expect(uploadUrl.origin).toBe('https://imgbed.example.test')
    expect(uploadUrl.pathname).toBe('/upload')
    expect(new Headers(request.mock.calls[0]?.[1]?.headers).get('authorization')).toBe(
      `Bearer ${token}`,
    )
    expect(uploaded.url).toBe('https://imgbed.example.test/file/generated.png')
    expect(credentials.values.get('image-hosting:self-hosted')).toBe(token)
    expect(localStorage.getItem('srl-frontend-workshop-self-hosted-imgbed')).not.toContain(token)
  })
})
