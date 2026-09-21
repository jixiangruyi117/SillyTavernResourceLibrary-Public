import { beforeEach, describe, expect, it, vi } from 'vitest'

import { FrontendWorkshopImageGenerationService } from './FrontendWorkshopImageGenerationService'

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

function successfulNovelAiResponse() {
  return new Response(JSON.stringify({ image: 'bmFp' }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('NovelAI request contract', () => {
  beforeEach(() => vi.stubGlobal('localStorage', new MemoryStorage()))

  it.each([
    [
      'nai-diffusion-4-full',
      'no text, best quality, very aesthetic, absurdres',
      'blurry, lowres, error',
    ],
    ['nai-diffusion-4-5-full', 'very aesthetic, masterpiece, no text', 'lowres, artistic error'],
    [
      'nai-diffusion-4-curated-preview',
      'rating:general, best quality, very aesthetic, absurdres',
      'blurry, lowres, error',
    ],
    [
      'nai-diffusion-4-5-curated',
      'very aesthetic, masterpiece, no text, -0.8::feet::, rating:general',
      'blurry, lowres, upscaled',
    ],
  ])(
    'compiles approved Quality / UC for %s without changing transport fields',
    async (model, quality, uc) => {
      const request = vi.fn<typeof fetch>(async () => successfulNovelAiResponse())
      const service = new FrontendWorkshopImageGenerationService(request)
      const config = service.defaultConfig('novelai')
      config.apiKey = 'test-token'
      config.model = model

      await service.generate(config, {
        prompt: 'portrait',
        negativePrompt: 'bad anatomy',
        novelAiQualityMode: 'standard',
        novelAiUcPreset: 'heavy',
      })

      const options = request.mock.calls[0]?.[1]
      const headers = options?.headers as Record<string, string>
      const body = JSON.parse(String(options?.body)) as {
        input: string
        parameters: {
          params_version: number
          noise_schedule: string
          qualityToggle: boolean
          negative_prompt: string
          v4_prompt: { caption: { base_caption: string } }
          v4_negative_prompt: { caption: { base_caption: string } }
        }
      }
      expect(request.mock.calls[0]?.[0]).toBe('https://image.novelai.net/ai/generate-image')
      expect(headers.Accept).toBe('application/zip, text/event-stream, application/json')
      expect(headers['Content-Type']).toBe('application/json')
      expect(headers.Authorization).toBe('Bearer test-token')
      expect(body.parameters.params_version).toBe(3)
      expect(body.parameters.noise_schedule).toBe('karras')
      expect(body.parameters.qualityToggle).toBe(true)
      expect(body.input).toBe(`portrait, ${quality}`)
      expect(body.parameters.negative_prompt).toMatch(new RegExp(`^${uc},`))
      expect(body.parameters.negative_prompt).toMatch(/, bad anatomy$/u)
      expect(body.parameters.v4_prompt.caption.base_caption).toBe(body.input)
      expect(body.parameters.v4_negative_prompt.caption.base_caption).toBe(
        body.parameters.negative_prompt,
      )
    },
  )

  it.each([
    ['nai-diffusion-4-full', 'none', 'bad anatomy'],
    ['nai-diffusion-4-5-full', 'none', 'bad anatomy'],
    [
      'nai-diffusion-4-full',
      'light',
      'blurry, lowres, error, worst quality, bad quality, jpeg artifacts, very displeasing, white blank page, blank page, bad anatomy',
    ],
    [
      'nai-diffusion-4-5-full',
      'light',
      'lowres, artistic error, scan artifacts, worst quality, bad quality, jpeg artifacts, multiple views, very displeasing, too many watermarks, negative space, blank page, bad anatomy',
    ],
  ] as const)('keeps Quality off and UC %s / %s effective', async (model, preset, negative) => {
    const request = vi.fn<typeof fetch>(async () => successfulNovelAiResponse())
    const service = new FrontendWorkshopImageGenerationService(request)
    const config = { ...service.defaultConfig('novelai'), model, apiKey: 'test-token' }
    await service.generate(config, {
      prompt: 'portrait',
      negativePrompt: 'bad anatomy',
      novelAiQualityMode: 'off',
      novelAiUcPreset: preset,
    })
    const body = JSON.parse(String(request.mock.calls[0]?.[1]?.body))
    expect(body.input).toBe('portrait')
    expect(body.parameters.negative_prompt).toBe(negative)
    expect(body.parameters.qualityToggle).toBe(false)
  })

  it('keeps the current V5 request contract unchanged', async () => {
    const request = vi.fn<typeof fetch>(async () => successfulNovelAiResponse())
    const service = new FrontendWorkshopImageGenerationService(request)
    const config = service.defaultConfig('novelai')
    config.apiKey = 'test-token'
    config.model = 'nai-diffusion-5-full'

    await service.generate(config, { prompt: 'portrait', novelAiQualityMode: 'standard' })

    const options = request.mock.calls[0]?.[1]
    const headers = options?.headers as Record<string, string>
    const body = JSON.parse(String(options?.body)) as { input: string }
    expect(headers.Accept).toBe('*/*')
    expect(body.input).toContain('very aesthetic')
  })
})
