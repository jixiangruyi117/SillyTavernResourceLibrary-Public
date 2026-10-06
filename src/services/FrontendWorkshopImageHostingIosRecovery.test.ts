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

const apiToken = `imgbed_${'a'.repeat(64)}`

function imageBlob(): Blob {
  return new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' })
}

describe('iOS/Web 自建 ImgBed 恢复', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', new MemoryStorage())
  })

  it('识别现代 imgbed_ API Token 后首请求直接使用 Bearer', async () => {
    const request = vi.fn<typeof fetch>(
      async () =>
        new Response(JSON.stringify([{ src: '/file/srl-workshop/generated.png' }]), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    )
    const service = new FrontendWorkshopImageHostingService(request, new MemoryCredentials())
    await service.saveSelfHostedConfiguration({
      origin: 'https://mine.example',
      token: apiToken,
      remember: false,
    })

    const result = await service.uploadBlobSelfHosted(imageBlob(), 'iOS 图片')

    expect(request).toHaveBeenCalledTimes(1)
    const [input, init] = request.mock.calls[0]
    const url = new URL(String(input))
    expect(url.pathname).toBe('/upload')
    expect(url.searchParams.has('authCode')).toBe(false)
    expect(new Headers(init?.headers).get('authorization')).toBe(`Bearer ${apiToken}`)
    expect(service.getSelfHostedConfiguration()?.authMode).toBe('bearer')
    expect(result.url).toBe('https://mine.example/file/srl-workshop/generated.png')
  })

  it('安全凭据中的现代 API Token 会修正旧 iOS 记住的 auth-code 模式', async () => {
    localStorage.setItem(
      'srl-frontend-workshop-self-hosted-imgbed',
      JSON.stringify({
        origin: 'https://mine.example/upload',
        token: '',
        remember: true,
        authMode: 'auth-code',
      }),
    )
    const credentials = new MemoryCredentials()
    credentials.values.set('image-hosting:self-hosted', apiToken)
    const service = new FrontendWorkshopImageHostingService(vi.fn(), credentials)

    await service.initializeCredentials()

    expect(service.getSelfHostedConfiguration()).toMatchObject({
      token: apiToken,
      authMode: 'bearer',
    })
    const remembered = localStorage.getItem('srl-frontend-workshop-self-hosted-imgbed') ?? ''
    expect(remembered).toContain('"authMode":"bearer"')
    expect(remembered).not.toContain(apiToken)
  })

  it('旧子路径真实返回 POST 405 时只在同一 origin 回退一次根 /upload', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(new Response('Method Not Allowed', { status: 405 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify([{ src: '/file/srl-workshop/recovered.png' }]), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
    const service = new FrontendWorkshopImageHostingService(request, new MemoryCredentials())
    await service.saveSelfHostedConfiguration({
      origin: 'https://mine.example/legacy/upload?uploadChannel=cfr2',
      token: apiToken,
      remember: false,
    })

    const result = await service.uploadBlobSelfHosted(imageBlob(), '恢复图片')

    expect(request).toHaveBeenCalledTimes(2)
    const firstUrl = new URL(String(request.mock.calls[0][0]))
    const secondUrl = new URL(String(request.mock.calls[1][0]))
    expect(firstUrl.origin).toBe('https://mine.example')
    expect(firstUrl.pathname).toBe('/legacy/upload')
    expect(secondUrl.origin).toBe(firstUrl.origin)
    expect(secondUrl.pathname).toBe('/upload')
    expect(secondUrl.searchParams.get('uploadChannel')).toBe('cfr2')
    expect(new Headers(request.mock.calls[1][1]?.headers).get('authorization')).toBe(
      `Bearer ${apiToken}`,
    )
    expect(service.getSelfHostedConfiguration()?.origin).toContain('https://mine.example/upload?')
    expect(result.url).toBe('https://mine.example/file/srl-workshop/recovered.png')
  })

  it('浏览器 fetch/CORS 失败不会被伪装成 HTTP 405', async () => {
    const request = vi.fn(async () => {
      throw new TypeError('Load failed')
    })
    const service = new FrontendWorkshopImageHostingService(request, new MemoryCredentials())
    await service.saveSelfHostedConfiguration({
      origin: 'https://mine.example',
      token: apiToken,
      remember: false,
    })

    const error = await service
      .uploadBlobSelfHosted(imageBlob(), '跨域图片')
      .catch((cause) => cause)
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toMatch(/CORS\/网络失败/u)
    expect((error as Error).message).toContain('不是 HTTP 405')
    expect((error as Error).message).not.toContain('拒绝了 POST 上传')
  })
})
