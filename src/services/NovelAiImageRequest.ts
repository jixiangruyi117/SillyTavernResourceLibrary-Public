import type {
  FrontendWorkshopImageGenerationRequest,
  FrontendWorkshopNovelAiSampler,
} from '../types/ImageGeneration'
import {
  getImageGenerationCapabilities,
  getNovelAiModelFamily,
  type NovelAiQualityMode,
} from './ImageGenerationCapabilities'
import { DEFAULT_MODELS } from './ImageGenerationRequest'

interface NovelAiPayloadSettings extends FrontendWorkshopImageGenerationRequest {
  prompt: string
  negativePrompt: string
  width: number
  height: number
  seed: number
  sampler: FrontendWorkshopNovelAiSampler
  steps: number
  scale: number
  qualityToggle: boolean
  smea: boolean
  smeaDyn: boolean
}

export function buildNovelAiPayload(
  model: string,
  settings: NovelAiPayloadSettings,
): Record<string, unknown> {
  const normalizedModel = model.trim() || DEFAULT_MODELS.novelai
  const family = getNovelAiModelFamily(normalizedModel)
  if (family === 'unknown') throw new Error('尚未确认此 NovelAI 模型的请求结构，不能回退到 V3')
  const isModern = family !== 'v3'
  const caps = getImageGenerationCapabilities('novelai', normalizedModel)
  const characters = settings.novelAiCharacters ?? []
  if (characters.length > caps.maxCharacters)
    throw new Error(`当前模型最多支持 ${caps.maxCharacters} 个角色`)
  if (characters.some((character) => !character.prompt.trim()))
    throw new Error('请填写每个角色的提示词')
  if (settings.novelAiVibes?.length)
    throw new Error(
      caps.vibeTransfer === 'supported'
        ? 'Vibe Transfer 官方支持，但项目当前尚未接通'
        : '当前模型的 Vibe Transfer 能力未确认，暂不发送',
    )
  if (settings.novelAiPreciseReferences?.length)
    throw new Error(
      caps.preciseReference === 'supported'
        ? 'Precise Reference 官方支持，但项目当前尚未接通'
        : '当前模型不支持 Precise Reference',
    )
  if (settings.novelAiTransparentBackground && caps.transparentBackground !== 'supported')
    throw new Error('当前模型不支持透明背景')
  const mode = settings.novelAiQualityMode
  if (mode && !caps.qualityModes.includes(mode)) throw new Error('当前模型不支持此 Quality Mode')
  const prompt = compileNovelAiPrompt(
    normalizedModel,
    settings.prompt,
    mode,
    settings.novelAiTransparentBackground,
  )
  const negative = compileNovelAiNegative(
    normalizedModel,
    settings.negativePrompt,
    settings.novelAiUcPreset,
  )
  const useCoords = characters.some((character) => character.position)
  const mappedCharacters = characters.map((character) => {
    const position = character.position ?? { x: 0.5, y: 0.5 }
    for (const coordinate of [position.x, position.y]) {
      if (!Number.isFinite(coordinate) || coordinate < 0 || coordinate > 1)
        throw new Error('角色位置必须在 0～1 之间')
      if (!caps.freeCharacterPositioning && ![0.1, 0.3, 0.5, 0.7, 0.9].includes(coordinate))
        throw new Error('V4 / V4.5 请使用五档网格位置')
    }
    return {
      prompt: character.prompt.trim(),
      uc: character.negativePrompt?.trim() ?? '',
      center: position,
    }
  })
  const shared = {
    negative_prompt: negative,
    width: settings.width,
    height: settings.height,
    n_samples: 1,
    sampler: settings.sampler,
    scale: settings.scale,
    steps: settings.steps,
    seed: settings.seed,
    qualityToggle: mode ? mode !== 'off' : settings.qualityToggle,
  }
  if (family === 'v5') delete (shared as Partial<typeof shared>).qualityToggle
  const parameters = isModern
    ? {
        ...shared,
        ...(settings.novelAiTransparentBackground ? { tag_hint_transparent_background: true } : {}),
        ...(family === 'v5' ? {} : { sm: false, sm_dyn: false }),
        params_version: family === 'v5' ? 4 : 3,
        prefer_brownian: true,
        noise_schedule: 'karras',
        ...(family === 'v5' ? {} : { ucPreset: 0 }),
        add_original_image: false,
        controlnet_strength: 1,
        deliberate_euler_ancestral_bug: false,
        dynamic_thresholding: false,
        legacy: false,
        legacy_v3_extend: false,
        uncond_scale: 1,
        use_coords: useCoords,
        characterPrompts: mappedCharacters,
        reference_image_multiple: [],
        reference_information_extracted_multiple: [],
        reference_strength_multiple: [],
        v4_prompt: {
          caption: {
            base_caption: prompt,
            char_captions: mappedCharacters.map((character) => ({
              char_caption: character.prompt,
              centers: [character.center],
            })),
          },
          use_coords: useCoords,
          use_order: true,
        },
        v4_negative_prompt: {
          caption: {
            base_caption: negative,
            char_captions: mappedCharacters.map((character) => ({
              char_caption: character.uc,
              centers: [character.center],
            })),
          },
        },
      }
    : { ...shared, prompt, sm: settings.smea, sm_dyn: settings.smeaDyn }
  return { action: 'generate', input: prompt, model: normalizedModel, parameters }
}

export function compileNovelAiPrompt(
  model: string,
  prompt: string,
  mode?: NovelAiQualityMode,
  transparent?: boolean,
): string {
  const family = getNovelAiModelFamily(model)
  let suffix = ''
  if (mode && mode !== 'off') {
    if (family === 'v5')
      suffix =
        mode === 'light'
          ? 'very aesthetic, amazing quality, no text'
          : 'very aesthetic, masterpiece, no text'
    else if (family === 'v4.5')
      suffix = model.endsWith('curated')
        ? 'very aesthetic, masterpiece, no text, -0.8::feet::, rating:general'
        : 'very aesthetic, masterpiece, no text'
    else if (family === 'v4')
      suffix = model.endsWith('full')
        ? 'no text, best quality, very aesthetic, absurdres'
        : 'rating:general, best quality, very aesthetic, absurdres'
    else
      suffix = model.includes('furry')
        ? '{best quality}, {amazing quality}'
        : 'best quality, amazing quality, very aesthetic, absurdres'
  }
  return [prompt.trim(), transparent ? 'transparent background' : '', suffix]
    .filter(Boolean)
    .join(', ')
}

export function compileNovelAiNegative(
  model: string,
  negative: string,
  preset?: string | number,
): string {
  if (preset === undefined || preset === 'none') return negative
  const family = getNovelAiModelFamily(model)
  const id = typeof preset === 'number' ? ['heavy', 'light'][preset] : preset
  const heavy =
    'lowres, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, dithering, halftone, screentone, multiple views, logo, too many watermarks, negative space, blank page'
  const presets: Record<string, { heavy: string; light: string }> = {
    v5: {
      heavy,
      light:
        'lowres, bad hands, bad anatomy, artistic error, sepia, white haze, worst quality, very displeasing, jpeg artifacts, 0::ai-generated::',
    },
    'v4.5': {
      heavy,
      light:
        'lowres, artistic error, scan artifacts, worst quality, bad quality, jpeg artifacts, multiple views, very displeasing, too many watermarks, negative space, blank page',
    },
    v4: {
      heavy:
        'blurry, lowres, error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, multiple views, logo, too many watermarks, white blank page, blank page',
      light:
        'blurry, lowres, error, worst quality, bad quality, jpeg artifacts, very displeasing, white blank page, blank page',
    },
    v3: {
      heavy:
        'lowres, {bad}, error, fewer, extra, missing, worst quality, jpeg artifacts, bad quality, watermark, unfinished, displeasing, chromatic aberration, signature, extra digits, artistic error, username, scan, [abstract]',
      light: 'lowres, jpeg artifacts, worst quality, watermark, blurry, very displeasing',
    },
  }
  if (id !== 'heavy' && id !== 'light')
    throw new Error('此 UC Preset 尚未确认；请选择 None / Heavy / Light')
  if (family === 'v4.5' && model.endsWith('curated'))
    presets['v4.5'] = {
      heavy:
        'blurry, lowres, upscaled, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, halftone, multiple views, logo, too many watermarks, negative space, blank page',
      light:
        'blurry, lowres, upscaled, artistic error, scan artifacts, jpeg artifacts, logo, too many watermarks, negative space, blank page',
    }
  if (family === 'v4' && model.endsWith('curated-preview'))
    presets.v4 = {
      heavy:
        'blurry, lowres, error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, logo, dated, signature, multiple views, gigantic breasts, white blank page, blank page',
      light:
        'blurry, lowres, error, worst quality, bad quality, jpeg artifacts, very displeasing, logo, dated, signature, white blank page, blank page',
    }
  if (model === 'nai-diffusion-furry-3')
    presets.v3 = {
      heavy:
        '{{worst quality}}, [displeasing], {unusual pupils}, guide lines, {{unfinished}}, {bad}, url, artist name, {{tall image}}, mosaic, {sketch page}, comic panel, impact (font), [dated], {logo}, ych, {what}, {where is your god now}, {distorted text}, repeated text, {floating head}, {1994}, {widescreen}, absolutely everyone, sequence, {compression artifacts}, hard translated, {cropped}, {commissioner name}, unknown text, high contrast',
      light:
        '{worst quality}, guide lines, unfinished, bad, url, tall image, widescreen, compression artifacts, unknown text',
    }
  return [presets[family]?.[id], negative].filter(Boolean).join(', ')
}
