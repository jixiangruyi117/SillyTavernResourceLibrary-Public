/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it } from 'vitest'

import { FrontendWorkshopImageDraftService } from './FrontendWorkshopImageDraftService'

describe('FrontendWorkshopImageDraftService completeness', () => {
  beforeEach(() => localStorage.clear())

  it('keeps existing NovelAI text, characters and exact settings together', () => {
    const service = new FrontendWorkshopImageDraftService()
    const saved = service.saveDraft({
      version: 1,
      provider: 'novelai',
      endpoint: 'https://image.novelai.net/ai/generate-image',
      model: 'nai-diffusion-5-full',
      prompt: 'portrait',
      negativePrompt: 'lowres',
      imageText: '今夜营业',
      promptHints: { 人物: 'should not cross provider', 场景: '', 构图: '', 风格: '' },
      novelAiCharacters: [
        {
          prompt: 'black hair',
          negativePrompt: 'hat',
          positioned: true,
          x: 0.35,
          y: 0.65,
        },
      ],
      width: 832,
      height: 1216,
      openAiQuality: 'auto',
      openAiBackground: 'auto',
      outputFormat: 'png',
      outputCompression: 90,
      novelAiSampler: 'k_dpmpp_2m',
      novelAiSteps: 28,
      novelAiScale: 18,
      novelAiSeed: 123,
      novelAiQualityToggle: true,
      novelAiQualityMode: 'light',
      novelAiUcPreset: 'heavy',
      novelAiTransparentBackground: true,
      novelAiSmea: false,
      novelAiSmeaDyn: false,
      savedAt: Date.now(),
    })

    expect(saved).toEqual(
      expect.objectContaining({
        imageText: '今夜营业',
        promptHints: { 人物: '', 场景: '', 构图: '', 风格: '' },
        novelAiCharacters: [
          expect.objectContaining({
            prompt: 'black hair',
            negativePrompt: 'hat',
            positioned: true,
            x: 0.35,
            y: 0.65,
          }),
        ],
        novelAiScale: 10,
        novelAiQualityMode: 'light',
        novelAiUcPreset: 'heavy',
        novelAiTransparentBackground: true,
      }),
    )
  })

  it('isolates provider-only helper state instead of leaking it across drafts', () => {
    const service = new FrontendWorkshopImageDraftService()
    const openai = service.saveDraft({
      version: 1,
      provider: 'openai',
      endpoint: 'https://api.openai.com/v1/images/generations',
      model: 'gpt-image-2',
      prompt: 'portrait',
      negativePrompt: '',
      imageText: 'HELLO',
      promptHints: { 人物: 'black hair', 场景: 'room', 构图: 'portrait', 风格: 'soft' },
      novelAiCharacters: [
        { prompt: 'must not leak', negativePrompt: '', positioned: false, x: 0.5, y: 0.5 },
      ],
      width: 1024,
      height: 1024,
      openAiQuality: 'high',
      openAiBackground: 'auto',
      outputFormat: 'png',
      outputCompression: 90,
      novelAiSampler: 'k_dpmpp_2m',
      novelAiSteps: 28,
      novelAiScale: 5,
      novelAiQualityToggle: true,
      novelAiSmea: false,
      novelAiSmeaDyn: false,
      savedAt: Date.now(),
    })
    const novelai = service.saveDraft({
      ...openai,
      provider: 'novelai',
      endpoint: 'https://image.novelai.net/ai/generate-image',
      model: 'nai-diffusion-5-full',
    })

    expect(openai.promptHints).toEqual({
      人物: 'black hair',
      场景: 'room',
      构图: 'portrait',
      风格: 'soft',
    })
    expect(openai.novelAiCharacters).toEqual([])
    expect(novelai.promptHints).toEqual({ 人物: '', 场景: '', 构图: '', 风格: '' })
    expect(novelai.novelAiCharacters).toEqual([])
  })

  it('maps legacy custom drafts to OpenAI and rewrites the stored provider', () => {
    localStorage.setItem(
      'srl.frontendWorkshop.imageGeneration.draft.v1',
      JSON.stringify({
        version: 2,
        activeProvider: 'custom',
        drafts: {
          custom: {
            version: 1,
            provider: 'custom',
            endpoint: 'https://relay.example/v1/images/generations',
            model: 'relay-image',
            prompt: 'legacy relay prompt',
            negativePrompt: '',
            width: 1024,
            height: 1024,
            openAiQuality: 'auto',
            openAiBackground: 'auto',
            outputFormat: 'png',
            outputCompression: 90,
            novelAiSampler: 'k_dpmpp_2m',
            novelAiSteps: 28,
            novelAiScale: 5,
            novelAiQualityToggle: true,
            novelAiSmea: false,
            novelAiSmeaDyn: false,
            savedAt: 1,
          },
        },
      }),
    )

    const service = new FrontendWorkshopImageDraftService()
    expect(service.loadDraft()).toMatchObject({ provider: 'openai', prompt: 'legacy relay prompt' })
    expect(localStorage.getItem('srl.frontendWorkshop.imageGeneration.draft.v1')).not.toContain(
      '"custom"',
    )
  })
})
