import { beforeEach, describe, expect, it, vi } from 'vitest'
import { zipSync } from 'fflate'

import {
  FrontendWorkshopImageGenerationError,
  FrontendWorkshopImageGenerationService,
} from './FrontendWorkshopImageGenerationService'
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

describe('FrontendWorkshopImageGenerationService', () => {
  beforeEach(() => vi.stubGlobal('localStorage', new MemoryStorage()))

  it.each([
    'nai-diffusion-3',
    'nai-diffusion-4-full',
    'nai-diffusion-4-5-full',
    'nai-diffusion-5-full',
    'nai-diffusion-5-curated',
  ])('%s diagnostics match the params_version actually sent', async (model) => {
    const request = vi.fn<typeof fetch>(async () => new Response('upstream error', { status: 500 }))
    const service = new FrontendWorkshopImageGenerationService(request)
    const failure = await service
      .generate(
        { ...service.defaultConfig('novelai'), model, apiKey: 'diagnostic-test-key' },
        { prompt: 'portrait' },
      )
      .catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(FrontendWorkshopImageGenerationError)
    if (!(failure instanceof FrontendWorkshopImageGenerationError))
      throw new Error('Expected provider diagnostic')
    const payload = JSON.parse(String(request.mock.calls[0]?.[1]?.body))
    const expectedVersion =
      model === 'nai-diffusion-3' ? undefined : model.startsWith('nai-diffusion-5-') ? 4 : 3
    expect(payload.parameters.params_version).toBe(expectedVersion)
    expect(failure.diagnostic.parameters.paramsVersion).toBe(payload.parameters.params_version ?? 0)
    expect(JSON.stringify(failure.diagnostic)).not.toContain('diagnostic-test-key')
  })

  it('stores validated provider keys outside localStorage and reloads them', async () => {
    const credentials = new MemoryCredentials()
    const first = new FrontendWorkshopImageGenerationService(vi.fn(), credentials)
    await first.saveConfiguration({
      ...first.defaultConfig('openai'),
      apiKey: 'image-secret',
    })

    expect(localStorage.getItem('srl.frontendWorkshop.imageGeneration.config.v1')).not.toContain(
      'image-secret',
    )
    const reopened = new FrontendWorkshopImageGenerationService(vi.fn(), credentials)
    await reopened.initializeCredentials()
    expect(reopened.getSavedConfig('openai').apiKey).toBe('image-secret')
  })

  it('migrates legacy custom configuration and credentials into OpenAI', async () => {
    const credentials = new MemoryCredentials()
    credentials.values.set('image-generation:custom', 'legacy-relay-secret')
    localStorage.setItem(
      'srl.frontendWorkshop.imageGeneration.config.v1',
      JSON.stringify({
        custom: {
          provider: 'custom',
          endpoint: 'https://relay.example/v1/images/generations',
          model: 'relay-image',
          apiKey: '',
        },
      }),
    )

    const service = new FrontendWorkshopImageGenerationService(vi.fn(), credentials)
    expect(service.getSavedConfig('openai')).toMatchObject({
      endpoint: 'https://relay.example/v1/images/generations',
      model: 'relay-image',
    })
    await service.initializeCredentials()
    expect(service.getSavedConfig('openai').apiKey).toBe('legacy-relay-secret')
    expect(credentials.values.get('image-generation:openai')).toBe('legacy-relay-secret')
    expect(credentials.values.has('image-generation:custom')).toBe(false)
    expect(localStorage.getItem('srl.frontendWorkshop.imageGeneration.config.v1')).not.toContain(
      'custom',
    )
  })

  it('does not overwrite an existing OpenAI configuration when legacy custom data is present', () => {
    localStorage.setItem(
      'srl.frontendWorkshop.imageGeneration.config.v1',
      JSON.stringify({
        openai: {
          provider: 'openai',
          endpoint: 'https://api.openai.com/v1/images/generations',
          model: 'gpt-image-2',
        },
        custom: {
          provider: 'custom',
          endpoint: 'https://relay.example/v1/images/generations',
          model: 'relay-image',
        },
      }),
    )

    const service = new FrontendWorkshopImageGenerationService(vi.fn())
    expect(service.getSavedConfig('openai')).toMatchObject({
      endpoint: 'https://api.openai.com/v1/images/generations',
      model: 'gpt-image-2',
    })
  })

  it('keeps an explicitly session-only provider key out of protected persistence', async () => {
    const credentials = new MemoryCredentials()
    const service = new FrontendWorkshopImageGenerationService(vi.fn(), credentials)
    await service.saveConfiguration({
      ...service.defaultConfig('novelai'),
      apiKey: 'temporary-image-secret',
      credentialPersistence: 'session',
    })

    expect(credentials.values.size).toBe(0)
    expect(service.getSavedConfig('novelai').apiKey).toBe('temporary-image-secret')
  })

  it('按 OpenAI Image API 结构发起单次生成并读取 base64 图片', async () => {
    const request = vi.fn(
      async () =>
        new Response(JSON.stringify({ data: [{ b64_json: 'cG5n' }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    )
    const service = new FrontendWorkshopImageGenerationService(request)
    const config = service.defaultConfig('openai')
    config.apiKey = 'secret'

    const result = await service.generate(config, {
      prompt: '月下档案封面',
      width: 1024,
      height: 1024,
      openAiQuality: 'high',
      openAiBackground: 'transparent',
      outputFormat: 'webp',
      outputCompression: 82,
    })

    expect(result.dataUrl).toBe('data:image/webp;base64,cG5n')
    expect(result.mimeType).toBe('image/webp')
    const options = (request.mock.calls as unknown as Array<[string, RequestInit]>)[0]?.[1]
    expect(options).toBeDefined()
    expect(JSON.parse(String(options?.body))).toMatchObject({
      model: 'gpt-image-2',
      prompt: '月下档案封面',
      size: '1024x1024',
      n: 1,
      quality: 'high',
      background: 'transparent',
      output_format: 'webp',
      output_compression: 82,
    })
  })

  it.each(['nai-diffusion-4-5-full', 'nai-diffusion-5-full', 'nai-diffusion-5-curated'])(
    '%s 使用现代 payload 并禁用旧 SMEA',
    async (model) => {
      const request = vi.fn(
        async () =>
          new Response(JSON.stringify({ images: [{ image: 'bmFp' }] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
      )
      const service = new FrontendWorkshopImageGenerationService(request)
      const config = service.defaultConfig('novelai')
      config.apiKey = 'token'
      config.model = model

      const result = await service.generate(config, {
        prompt: 'portrait',
        negativePrompt: 'low quality',
        width: 832,
        height: 1216,
        seed: 7,
        novelAiSampler: 'k_dpmpp_sde',
        novelAiSteps: 34,
        novelAiScale: 6.5,
        novelAiSmea: true,
        novelAiSmeaDyn: true,
      })

      expect(result.dataUrl).toBe('data:image/png;base64,bmFp')
      expect(result.parameters).toMatchObject({
        smea: false,
        smeaDyn: false,
        smeaSuppressed: true,
      })
      const options = (request.mock.calls as unknown as Array<[string, RequestInit]>)[0]?.[1]
      expect(options).toBeDefined()
      const payload = JSON.parse(String(options?.body))
      expect(payload).toMatchObject({
        action: 'generate',
        input: 'portrait',
        model,
        parameters: {
          params_version: model.startsWith('nai-diffusion-5-') ? 4 : 3,
          prefer_brownian: true,
          noise_schedule: 'karras',
          negative_prompt: 'low quality',
          width: 832,
          height: 1216,
          seed: 7,
          n_samples: 1,
          sampler: 'k_dpmpp_sde',
          steps: 34,
          scale: 6.5,
          v4_prompt: {
            caption: { base_caption: 'portrait', char_captions: [] },
            use_coords: false,
            use_order: true,
          },
          v4_negative_prompt: {
            caption: { base_caption: 'low quality', char_captions: [] },
          },
        },
      })
      if (model.startsWith('nai-diffusion-5-')) {
        for (const key of ['sm', 'sm_dyn', 'ucPreset', 'qualityToggle'])
          expect(payload.parameters).not.toHaveProperty(key)
      } else {
        expect(payload.parameters).toMatchObject({
          sm: false,
          sm_dyn: false,
          noise_schedule: 'karras',
          ucPreset: 0,
        })
      }
      expect(payload.parameters.autoSmea).toBeUndefined()
      expect(payload.parameters.prompt).toBeUndefined()
    },
  )

  it('保留 NovelAI V3 的兼容 payload 与旧 SMEA 字段，不混入 V4 专属字段', async () => {
    const request = vi.fn(
      async () =>
        new Response(JSON.stringify({ image: 'bmFp' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    )
    const service = new FrontendWorkshopImageGenerationService(request)
    const config = service.defaultConfig('novelai')
    config.apiKey = 'token'
    config.model = 'nai-diffusion-3'

    const result = await service.generate(config, {
      prompt: 'portrait',
      negativePrompt: 'bad hands',
      seed: 42,
      novelAiSmea: true,
      novelAiSmeaDyn: true,
    })

    const options = (request.mock.calls as unknown as Array<[string, RequestInit]>)[0]?.[1]
    const payload = JSON.parse(String(options?.body))
    expect(payload.parameters).toMatchObject({
      prompt: 'portrait',
      negative_prompt: 'bad hands',
      seed: 42,
      sm: true,
      sm_dyn: true,
    })
    expect(result.parameters).toMatchObject({
      smea: true,
      smeaDyn: true,
      smeaSuppressed: false,
    })
    expect(payload.parameters.params_version).toBeUndefined()
    expect(payload.parameters.v4_prompt).toBeUndefined()
  })

  it('把 NovelAI HTTP 错误归类为可诊断且不含密钥的错误', async () => {
    const request = vi.fn(
      async () =>
        new Response(JSON.stringify({ message: 'temporary upstream failure' }), {
          status: 500,
          statusText: 'Internal Server Error',
          headers: { 'Content-Type': 'application/json' },
        }),
    )
    const service = new FrontendWorkshopImageGenerationService(request)
    const config = service.defaultConfig('novelai')
    config.apiKey = 'never-log-this'

    await expect(service.generate(config, { prompt: 'portrait' })).rejects.toSatisfy(
      (error: unknown) => {
        expect(error).toBeInstanceOf(FrontendWorkshopImageGenerationError)
        const providerError = error as FrontendWorkshopImageGenerationError
        expect(providerError.message).toContain('HTTP 500')
        expect(providerError.diagnostic).toMatchObject({
          provider: 'novelai',
          category: 'server',
          retryable: true,
          httpStatus: 500,
          model: 'nai-diffusion-4-5-full',
          parameters: {
            paramsVersion: 3,
            noiseSchedule: 'karras',
            sm: false,
            sm_dyn: false,
            smeaSuppressed: false,
          },
        })
        expect(JSON.stringify(providerError.diagnostic)).not.toContain('never-log-this')
        return true
      },
    )
  })

  it('读取 NovelAI 实际返回的 ZIP 图片附件', async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])
    const request = vi.fn(
      async () =>
        new Response(zipSync({ 'image_0.png': png }), {
          status: 201,
          headers: { 'Content-Type': 'application/zip' },
        }),
    )
    const service = new FrontendWorkshopImageGenerationService(request)
    const config = service.defaultConfig('novelai')
    config.apiKey = 'token'

    const result = await service.generate(config, { prompt: 'portrait' })

    expect(result.mimeType).toBe('image/png')
    expect(result.dataUrl).toMatch(/^data:image\/png;base64,/u)
  })

  it('拒绝 HTTP 自定义端点，避免密钥明文传输', async () => {
    const service = new FrontendWorkshopImageGenerationService(vi.fn())
    const config = service.defaultConfig('openai')
    config.apiKey = 'secret'
    config.endpoint = 'http://example.com/images'

    await expect(service.generate(config, { prompt: 'test' })).rejects.toThrow('必须使用 HTTPS')
  })

  it('从 OpenAI 兼容地址推导 models 端点并优先生图模型', async () => {
    const request = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            data: [
              { id: 'text-model', owned_by: 'relay' },
              { id: 'gpt-image-2', owned_by: 'relay' },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
    )
    const service = new FrontendWorkshopImageGenerationService(request)
    const config = service.defaultConfig('openai')
    config.endpoint = 'https://relay.example/openai/v1/images/generations'
    config.apiKey = 'relay-key'

    const result = await service.listModels(config)

    expect(request).toHaveBeenCalledWith(
      'https://relay.example/openai/v1/models',
      expect.objectContaining({
        method: 'GET',
        headers: { Authorization: 'Bearer relay-key' },
      }),
    )
    expect(result.source).toBe('remote')
    expect(result.options.map((option) => option.id)).toEqual(['gpt-image-2', 'text-model'])
  })

  it('NovelAI 使用内置模型清单且无需发送请求', async () => {
    const request = vi.fn()
    const service = new FrontendWorkshopImageGenerationService(request)

    const result = await service.listModels(service.defaultConfig('novelai'))

    expect(request).not.toHaveBeenCalled()
    expect(result.source).toBe('builtin')
    expect(result.options.map((option) => option.id)).toContain('nai-diffusion-4-5-full')
    expect(result.message).toContain('仍可手动填写')
  })

  it('OpenAI-compatible 生图保留 OpenAI Provider 来源', async () => {
    const request = vi.fn(
      async () =>
        new Response(JSON.stringify({ data: [{ b64_json: 'cG5n' }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    )
    const service = new FrontendWorkshopImageGenerationService(request)
    const config = service.defaultConfig('openai')
    config.endpoint = 'https://relay.example/v1/images/generations'
    config.apiKey = 'relay-key'

    const result = await service.generate(config, { prompt: 'test' })

    expect(result.provider).toBe('openai')
  })
})
