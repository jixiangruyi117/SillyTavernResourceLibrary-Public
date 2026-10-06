import { describe, expect, it } from 'vitest'

import { buildNovelAiPayload } from './NovelAiImageRequest'
import { getImageGenerationCapabilities } from './ImageGenerationCapabilities'

const BASE_SETTINGS = {
  prompt: '1girl, city night',
  negativePrompt: 'lowres',
  width: 832,
  height: 1216,
  seed: 123456,
  sampler: 'k_dpmpp_2m' as const,
  steps: 28,
  scale: 5,
  qualityToggle: true,
  smea: false,
  smeaDyn: false,
}

describe('NovelAI V5 regression coverage', () => {
  it.each(['nai-diffusion-5-full', 'nai-diffusion-5-curated'])(
    '%s must use the modern V4+ payload instead of the V3 legacy payload',
    (model) => {
      const payload = buildNovelAiPayload(model, BASE_SETTINGS)
      const parameters = payload.parameters as Record<string, unknown>

      expect(parameters.params_version).toBe(4)
      expect(parameters.noise_schedule).toBe('karras')
      expect(parameters.v4_prompt).toBeTruthy()
      expect(parameters.v4_negative_prompt).toBeTruthy()
      expect(parameters.characterPrompts).toEqual([])
      expect(parameters).not.toHaveProperty('prompt')
    },
  )

  it.each(['nai-diffusion-5-full', 'nai-diffusion-5-curated'])(
    '%s exposes Vibe but not Precise Reference',
    (model) => {
      const capabilities = getImageGenerationCapabilities('novelai', model)
      expect(capabilities.vibeTransfer).toBe('supported')
      expect(capabilities.preciseReference).toBe('unsupported')
      expect(capabilities.transparentBackground).toBe('supported')
      expect(capabilities.maxCharacters).toBe(22)
    },
  )
})
