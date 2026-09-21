import { localCredentialStore, type LocalCredentialRepository } from './LocalCredentialStore'
import { getNovelAiModelFamily, readRelayCapabilities } from './ImageGenerationCapabilities'
import type { ImageGenerationParameter } from '../types/GeneratedImageAlbum'
import type {
  FrontendWorkshopImageProvider,
  FrontendWorkshopImageGenerationConfig,
  FrontendWorkshopImageModelList,
  FrontendWorkshopImageModelOption,
  FrontendWorkshopGeneratedImage,
  FrontendWorkshopImageGenerationRequest,
  FrontendWorkshopImageGenerationOptions,
  FrontendWorkshopImageFormat,
} from '../types/ImageGeneration'
import { requestNovelAiBinary } from './NovelAiBinaryTransport'
import {
  DEFAULT_ENDPOINTS,
  DEFAULT_MODELS,
  NOVELAI_MODELS,
  requiredHttpsUrl,
  diagnosticEndpoint,
  boundedNumber,
  redactImageRequest,
} from './ImageGenerationRequest'
import { buildNovelAiPayload } from './NovelAiImageRequest'
import { buildOpenAiImageRequest, openAiInputBlob, validateOpenAiMask } from './OpenAiImageRequest'
import { readNovelAiImage } from './NovelAiImageResponse'
import {
  FORMAT_MIME,
  asImageDataUrl,
  imageFormatFromBytes,
  generatedImageToBlob,
} from './GeneratedImageData'
import {
  responseError,
  imageGenerationErrorCategory,
  createProviderError,
} from './ImageGenerationError'

// Keep the public entry stable; provider compilation and decoding have independent owners.
export type * from '../types/ImageGeneration'
export { FrontendWorkshopImageGenerationError } from './ImageGenerationError'
export { NOVELAI_MODELS, redactImageRequest } from './ImageGenerationRequest'
export {
  buildNovelAiPayload,
  compileNovelAiPrompt,
  compileNovelAiNegative,
} from './NovelAiImageRequest'
export {
  compileOpenAiPrompt,
  parseImageAdditionalJson,
  buildOpenAiImageRequest,
  previewOpenAiImageRequest,
} from './OpenAiImageRequest'
export { readNovelAiImage } from './NovelAiImageResponse'
export { decodeGeneratedImageDataUrl, generatedImageToBlob } from './GeneratedImageData'

const IMAGE_GENERATION_CONFIG_KEY = 'srl.frontendWorkshop.imageGeneration.config.v1'
const IMAGE_PROVIDERS = ['openai', 'novelai'] as const

type LegacyImageGenerationConfig = Omit<FrontendWorkshopImageGenerationConfig, 'provider'> & {
  provider: 'custom'
}

function compatibleModelsUrl(value: string, fallback: string): string {
  const url = new URL(requiredHttpsUrl(value, fallback))
  const pathname = url.pathname.replace(/\/+$/u, '')
  if (/\/images\/generations$/u.test(pathname)) {
    url.pathname = pathname.replace(/\/images\/generations$/u, '/models')
  } else if (!/\/models$/u.test(pathname)) {
    url.pathname = `${pathname}/models`
  }
  url.search = ''
  url.hash = ''
  return url.toString()
}

function imageModelPriority(id: string): number {
  return /(?:gpt-image|dall-e|image)/iu.test(id) ? 0 : 1
}

function normalizedDimension(value: number | undefined, fallback: number): number {
  return Math.round(boundedNumber(value, fallback, 64, 1536))
}

function novelAiDimension(value: number | undefined, fallback: number): number {
  return Math.round(normalizedDimension(value, fallback) / 64) * 64
}

export class FrontendWorkshopImageGenerationService {
  private readonly request: typeof fetch
  private readonly credentialStore: LocalCredentialRepository
  private readonly savedConfigs = new Map<
    FrontendWorkshopImageProvider,
    FrontendWorkshopImageGenerationConfig
  >()

  private legacyCustomConfig = false

  private legacyCustomApiKey = ''

  constructor(
    request: typeof fetch = globalThis.fetch.bind(globalThis),
    credentialStore: LocalCredentialRepository = localCredentialStore,
  ) {
    this.request = request
    this.credentialStore = credentialStore
    this.readSavedConfigurations()
  }

  defaultConfig(provider: FrontendWorkshopImageProvider): FrontendWorkshopImageGenerationConfig {
    return {
      provider,
      endpoint: DEFAULT_ENDPOINTS[provider],
      apiKey: '',
      model: DEFAULT_MODELS[provider],
      credentialPersistence: 'local',
    }
  }

  getSavedConfig(provider: FrontendWorkshopImageProvider): FrontendWorkshopImageGenerationConfig {
    return { ...(this.savedConfigs.get(provider) ?? this.defaultConfig(provider)) }
  }

  async initializeCredentials(): Promise<void> {
    for (const provider of IMAGE_PROVIDERS) {
      const config = this.savedConfigs.get(provider)
      if (!config) continue
      if (config.credentialPersistence === 'session') {
        await this.credentialStore.clear(this.credentialIdentifier(provider))
        if (provider === 'openai' && this.legacyCustomConfig)
          await this.credentialStore.clear(this.credentialIdentifier('custom'))
        continue
      }
      let key =
        config.apiKey.trim() ||
        (await this.credentialStore.read(this.credentialIdentifier(provider)))
      if (!key && provider === 'openai' && this.legacyCustomConfig)
        key =
          this.legacyCustomApiKey ||
          (await this.credentialStore.read(this.credentialIdentifier('custom')))
      if (key) {
        config.apiKey = key
        await this.credentialStore.save(this.credentialIdentifier(provider), key)
      } else config.apiKey = ''
      if (provider === 'openai' && this.legacyCustomConfig)
        await this.credentialStore.clear(this.credentialIdentifier('custom'))
    }
    this.writeSavedConfigurations()
  }

  async saveConfiguration(
    value: FrontendWorkshopImageGenerationConfig,
  ): Promise<FrontendWorkshopImageGenerationConfig> {
    const config: FrontendWorkshopImageGenerationConfig = {
      provider: value.provider,
      endpoint: value.endpoint.trim(),
      apiKey: value.apiKey.trim(),
      model: value.model.trim(),
      credentialPersistence: value.credentialPersistence === 'session' ? 'session' : 'local',
      relayCapabilities: value.relayCapabilities,
    }
    if (!config.apiKey) throw new Error('请先填写当前供应商的 API 密钥')
    if (config.credentialPersistence === 'local')
      await this.credentialStore.save(this.credentialIdentifier(config.provider), config.apiKey)
    else await this.credentialStore.clear(this.credentialIdentifier(config.provider))
    this.savedConfigs.set(config.provider, config)
    this.writeSavedConfigurations()
    return { ...config }
  }

  async clearSavedCredential(provider: FrontendWorkshopImageProvider): Promise<void> {
    await this.credentialStore.clear(this.credentialIdentifier(provider))
    const present = this.savedConfigs.get(provider)
    if (present) this.savedConfigs.set(provider, { ...present, apiKey: '' })
    this.writeSavedConfigurations()
  }

  exportConfigurations(): FrontendWorkshopImageGenerationConfig[] {
    return [...this.savedConfigs.values()]
      .filter((config) => Boolean(config.apiKey))
      .map((config) => ({ ...config }))
  }

  async importConfigurations(
    values: Array<FrontendWorkshopImageGenerationConfig | LegacyImageGenerationConfig>,
  ): Promise<void> {
    await this.initializeCredentials()
    for (const value of values) {
      const provider = value.provider === 'custom' ? 'openai' : value.provider
      if (!IMAGE_PROVIDERS.includes(provider)) continue
      if (value.provider === 'custom' && this.savedConfigs.has('openai')) continue
      await this.saveConfiguration({
        ...value,
        provider,
        credentialPersistence: 'local',
      })
    }
  }

  private credentialIdentifier(provider: FrontendWorkshopImageProvider | 'custom'): string {
    return `image-generation:${provider}`
  }

  private readSavedConfigurations(): void {
    try {
      const parsed = JSON.parse(
        localStorage.getItem(IMAGE_GENERATION_CONFIG_KEY) ?? '{}',
      ) as Record<string, Partial<FrontendWorkshopImageGenerationConfig>>
      const legacy =
        parsed.custom && typeof parsed.custom === 'object' && !Array.isArray(parsed.custom)
          ? (parsed.custom as Partial<FrontendWorkshopImageGenerationConfig>)
          : undefined
      const openai =
        parsed.openai && typeof parsed.openai === 'object' && !Array.isArray(parsed.openai)
          ? (parsed.openai as Partial<FrontendWorkshopImageGenerationConfig>)
          : undefined
      if (legacy) {
        this.legacyCustomConfig = true
        this.legacyCustomApiKey = String(legacy.apiKey ?? '').trim()
        parsed.openai = {
          ...legacy,
          ...openai,
          endpoint: String(openai?.endpoint ?? '').trim() || String(legacy.endpoint ?? '').trim(),
          model: String(openai?.model ?? '').trim() || String(legacy.model ?? '').trim(),
          apiKey: String(openai?.apiKey ?? '').trim() || this.legacyCustomApiKey,
          credentialPersistence:
            openai?.credentialPersistence ?? legacy.credentialPersistence ?? 'local',
          relayCapabilities: openai?.relayCapabilities ?? legacy.relayCapabilities,
          provider: 'openai',
        }
        delete parsed.custom
      }
      for (const provider of IMAGE_PROVIDERS) {
        const value = parsed[provider] as Partial<FrontendWorkshopImageGenerationConfig> | undefined
        if (!value) continue
        const defaults = this.defaultConfig(provider)
        this.savedConfigs.set(provider, {
          provider,
          endpoint: String(value.endpoint ?? defaults.endpoint).trim(),
          apiKey: String(value.apiKey ?? '').trim(),
          model: String(value.model ?? defaults.model).trim(),
          credentialPersistence: value.credentialPersistence === 'session' ? 'session' : 'local',
          relayCapabilities: value.relayCapabilities,
        })
      }
      if (this.legacyCustomConfig) this.writeSavedConfigurations()
    } catch {
      /* corrupted config falls back */
    }
  }

  private writeSavedConfigurations(): void {
    const value = Object.fromEntries(
      [...this.savedConfigs].map(([provider, config]) => [provider, { ...config, apiKey: '' }]),
    )
    localStorage.setItem(IMAGE_GENERATION_CONFIG_KEY, JSON.stringify(value))
  }

  async listModels(
    config: FrontendWorkshopImageGenerationConfig,
  ): Promise<FrontendWorkshopImageModelList> {
    if (config.provider === 'novelai')
      return {
        options: NOVELAI_MODELS.map((option) => ({ ...option })),
        source: 'builtin',
        message: 'NovelAI 未提供公开模型列表接口，已载入当前内置清单；仍可手动填写模型 ID。',
      }
    if (!config.apiKey.trim()) throw new Error('请先填写当前供应商的 API 密钥，再拉取模型')
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 30_000)
    try {
      const response = await this.request(
        compatibleModelsUrl(config.endpoint, DEFAULT_ENDPOINTS[config.provider]),
        {
          method: 'GET',
          headers: { Authorization: `Bearer ${config.apiKey.trim()}` },
          signal: controller.signal,
        },
      )
      if (!response.ok) {
        const label = 'OpenAI'
        throw new Error(
          `${label}模型拉取失败：${redactImageRequest(await responseError(response), config.apiKey)}`,
        )
      }
      const payload = (await response.json()) as {
        data?: Array<{ id?: unknown; name?: unknown; capabilities?: unknown }>
        models?: Array<{ id?: unknown; name?: unknown; capabilities?: unknown } | string>
      }
      const raw = Array.isArray(payload.data) ? payload.data : payload.models
      const options = (raw ?? [])
        .map((item) => {
          if (typeof item === 'string') return { id: item, name: item }
          const id = typeof item?.id === 'string' ? item.id.trim() : ''
          const name = typeof item?.name === 'string' ? item.name.trim() : id
          return id
            ? { id, name: name || id, capabilities: readRelayCapabilities(item.capabilities) }
            : undefined
        })
        .filter((item): item is FrontendWorkshopImageModelOption => Boolean(item))
        .sort(
          (left, right) =>
            imageModelPriority(left.id) - imageModelPriority(right.id) ||
            left.name.localeCompare(right.name),
        )
      if (!options.length) throw new Error('接口返回了空模型列表；你仍可手动填写模型 ID')
      return {
        options,
        source: 'remote',
        message: `已拉取 ${options.length} 个模型；生图模型已优先排列。`,
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError')
        throw new Error('拉取模型超时；你仍可手动填写模型 ID', { cause: error })
      throw error
    } finally {
      clearTimeout(timeout)
    }
  }

  toBlob(image: FrontendWorkshopGeneratedImage): Promise<Blob> {
    return generatedImageToBlob(this.request, image)
  }

  async generate(
    config: FrontendWorkshopImageGenerationConfig,
    request: FrontendWorkshopImageGenerationRequest,
    options: FrontendWorkshopImageGenerationOptions = {},
  ): Promise<FrontendWorkshopGeneratedImage> {
    const prompt = request.prompt.trim()
    if (!prompt && (config.provider === 'novelai' || !request.openAiEditInstruction?.trim()))
      throw new Error('请先填写生图提示词或编辑指令')
    if (!config.apiKey.trim()) throw new Error('请先填写当前供应商的 API 密钥')
    return config.provider === 'novelai'
      ? this.generateNovelAi(config, { ...request, prompt }, options)
      : this.generateOpenAi(config, { ...request, prompt }, options)
  }

  private async generateOpenAi(
    config: FrontendWorkshopImageGenerationConfig,
    request: FrontendWorkshopImageGenerationRequest,
    options: FrontendWorkshopImageGenerationOptions,
  ): Promise<FrontendWorkshopGeneratedImage> {
    const prepared = buildOpenAiImageRequest(config, request)
    const { endpoint, body, edit, images, size, outputFormat } = prepared
    const [actualWidth, actualHeight] = size.split('x').map(Number)
    const model = String(body.model)
    const diagnosticParameters = redactImageRequest(
      {
        prompt: String(body.prompt),
        width: actualWidth,
        height: actualHeight,
        size,
        outputFormat,
        edit,
        inputImages: images.length,
      },
      config.apiKey,
    )
    let requestBody: string | FormData = JSON.stringify(body)
    const headers: Record<string, string> = { Authorization: `Bearer ${config.apiKey.trim()}` }
    if (edit) {
      const form = new FormData()
      for (const [key, value] of Object.entries(body))
        form.append(key, typeof value === 'object' ? JSON.stringify(value) : String(value))
      for (const [index, image] of images.entries()) {
        const blob = openAiInputBlob(image)
        form.append('image[]', blob, `input-${index + 1}.${blob.type.split('/')[1]}`)
      }
      if (request.openAiMask) {
        const mask = openAiInputBlob(
          typeof request.openAiMask === 'string'
            ? { dataUrl: request.openAiMask }
            : { blob: request.openAiMask },
        )
        if (mask.type !== 'image/png')
          throw new Error('Mask 必须为带透明通道的 PNG，与第一张图片尺寸一致')
        await validateOpenAiMask(openAiInputBlob(images[0]), mask)
        form.append('mask', mask, 'mask.png')
      }
      requestBody = form
    } else headers['Content-Type'] = 'application/json'
    let response: Response
    try {
      response = await this.request(endpoint, {
        method: 'POST',
        headers,
        body: requestBody,
        signal: options.signal,
      })
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error
      throw createProviderError(
        config.provider,
        redactImageRequest(diagnosticEndpoint(endpoint), config.apiKey),
        model,
        diagnosticParameters,
        'network',
        { requestId: options.requestId },
      )
    }
    if (!response.ok)
      throw createProviderError(
        config.provider,
        redactImageRequest(diagnosticEndpoint(endpoint), config.apiKey),
        model,
        diagnosticParameters,
        imageGenerationErrorCategory(response.status),
        {
          requestId: options.requestId,
          httpStatus: response.status,
          statusText: response.statusText,
          responseContentType: response.headers.get('content-type') ?? undefined,
          responseBody: redactImageRequest(await responseError(response), config.apiKey),
        },
      )
    let payload: {
      data?: Array<{ b64_json?: string; url?: string }>
      output_format?: FrontendWorkshopImageFormat
    }
    try {
      payload = await response.json()
    } catch {
      throw createProviderError(
        config.provider,
        redactImageRequest(diagnosticEndpoint(endpoint), config.apiKey),
        model,
        diagnosticParameters,
        'response_parse',
      )
    }
    const source = payload.data?.[0]
    const declaredFormat =
      payload.output_format && FORMAT_MIME[payload.output_format]
        ? payload.output_format
        : outputFormat
    let format = declaredFormat
    if (source?.b64_json) {
      const encoded = source.b64_json.startsWith('data:')
        ? source.b64_json.split(',')[1]
        : source.b64_json
      try {
        const prefix = Uint8Array.from(atob((encoded ?? '').slice(0, 64)), (character) =>
          character.charCodeAt(0),
        )
        format = imageFormatFromBytes(prefix)?.extension ?? declaredFormat
      } catch {
        throw createProviderError(
          config.provider,
          redactImageRequest(diagnosticEndpoint(endpoint), config.apiKey),
          model,
          diagnosticParameters,
          'response_parse',
        )
      }
    }
    const mimeType = FORMAT_MIME[format]
    const dataUrl = asImageDataUrl(source?.b64_json, mimeType)
    const temporaryUrl = source?.url?.startsWith('https://') ? source.url : undefined
    if (!dataUrl && !temporaryUrl) throw new Error('OpenAI 没有返回可用图片')
    return {
      id: crypto.randomUUID(),
      provider: config.provider,
      dataUrl,
      temporaryUrl,
      mimeType,
      extension: format,
      width: actualWidth,
      height: actualHeight,
      prompt: request.prompt,
      parameters: { ...diagnosticParameters },
      manifest: {
        version: 1,
        provider: config.provider,
        model,
        prompt: request.prompt,
        width: actualWidth,
        height: actualHeight,
        outputFormat: format,
        parentImageId: edit ? request.parentImageId : undefined,
        createdAt: Date.now(),
        parameters: redactImageRequest(
          {
            ...(body as Record<string, ImageGenerationParameter>),
            compiledPrompt: String(body.prompt),
            size,
            edit,
            ...(body.quality ? { quality: String(body.quality) } : {}),
            ...(body.background ? { background: String(body.background) } : {}),
            ...(body.output_format ? { output_format: String(body.output_format) } : {}),
            ...(body.output_compression !== undefined
              ? { output_compression: Number(body.output_compression) }
              : {}),
            inputRoles: images.map((image) => image.role ?? 'reference'),
            editInstruction: request.openAiEditInstruction ?? '',
            preserve: { ...request.openAiPreserve },
            hasMask: Boolean(request.openAiMask),
          },
          config.apiKey,
        ),
      },
      createdAt: Date.now(),
    }
  }

  private async generateNovelAi(
    config: FrontendWorkshopImageGenerationConfig,
    request: FrontendWorkshopImageGenerationRequest,
    options: FrontendWorkshopImageGenerationOptions,
  ): Promise<FrontendWorkshopGeneratedImage> {
    const width = novelAiDimension(request.width, 832)
    const height = novelAiDimension(request.height, 1216)
    const seed = Number.isFinite(request.seed)
      ? Math.min(4_294_967_295, Math.max(0, Math.round(Number(request.seed))))
      : Math.floor(Math.random() * 4_294_967_295)
    const sampler = request.novelAiSampler ?? 'k_dpmpp_2m'
    const steps = Math.round(boundedNumber(request.novelAiSteps, 28, 1, 50))
    const scale = boundedNumber(request.novelAiScale, 5, 0, 10)
    const qualityToggle = request.novelAiQualityMode
      ? request.novelAiQualityMode !== 'off'
      : (request.novelAiQualityToggle ?? true)
    const endpoint = requiredHttpsUrl(config.endpoint, DEFAULT_ENDPOINTS.novelai)
    const model = config.model.trim() || DEFAULT_MODELS.novelai
    const family = getNovelAiModelFamily(model)
    const isModern = family !== 'v3'
    const requestedSmea = request.novelAiSmea ?? false
    const requestedSmeaDyn = requestedSmea && (request.novelAiSmeaDyn ?? false)
    const smea = isModern ? false : requestedSmea
    const smeaDyn = isModern ? false : requestedSmeaDyn
    const smeaSuppressed = isModern && (requestedSmea || requestedSmeaDyn)
    const negativePrompt = request.negativePrompt?.trim() || ''
    const diagnosticParameters = {
      prompt: request.prompt,
      negativePrompt,
      width,
      height,
      sampler,
      steps,
      scale,
      qualityToggle,
      sm: smea,
      sm_dyn: smeaDyn,
      smeaSuppressed,
      paramsVersion: family === 'v5' ? 4 : isModern ? 3 : 0,
      noiseSchedule: isModern ? 'karras' : 'legacy',
    }
    const payload = buildNovelAiPayload(model, {
      ...request,
      prompt: request.prompt,
      negativePrompt,
      width,
      height,
      seed,
      sampler,
      steps,
      scale,
      qualityToggle,
      smea,
      smeaDyn,
    })
    let received: Awaited<ReturnType<typeof requestNovelAiBinary>>
    try {
      received = await requestNovelAiBinary(this.request, endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.apiKey.trim()}`,
          Accept:
            family === 'v4' || family === 'v4.5'
              ? 'application/zip, text/event-stream, application/json'
              : '*/*',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: options.signal,
      })
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error
      throw createProviderError(
        'novelai',
        redactImageRequest(diagnosticEndpoint(endpoint), config.apiKey),
        model,
        diagnosticParameters,
        'network',
        { requestId: options.requestId },
      )
    }
    const { response, novelAiTransport } = received
    if (!response.ok)
      throw createProviderError(
        'novelai',
        redactImageRequest(diagnosticEndpoint(endpoint), config.apiKey),
        model,
        diagnosticParameters,
        imageGenerationErrorCategory(response.status),
        {
          httpStatus: response.status,
          statusText: response.statusText,
          responseContentType: response.headers.get('content-type') ?? undefined,
          responseBody: redactImageRequest(await responseError(response), config.apiKey),
          requestId: options.requestId,
        },
      )
    let output: Awaited<ReturnType<typeof readNovelAiImage>>
    try {
      output = await readNovelAiImage(response, novelAiTransport)
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') throw cause
      throw createProviderError(
        'novelai',
        redactImageRequest(diagnosticEndpoint(endpoint), config.apiKey),
        model,
        diagnosticParameters,
        'response_parse',
        {
          responseContentType: response.headers.get('content-type') ?? undefined,
          responseBody:
            cause instanceof Error ? redactImageRequest(cause.message, config.apiKey) : '解析失败',
          requestId: options.requestId,
        },
      )
    }
    return {
      id: crypto.randomUUID(),
      provider: 'novelai',
      manifest: {
        version: 1,
        provider: 'novelai',
        model,
        prompt: request.prompt,
        negativePrompt,
        width,
        height,
        outputFormat: output.extension,
        seed,
        createdAt: Date.now(),
        parameters: JSON.parse(JSON.stringify(payload.parameters)),
      },
      dataUrl: output.dataUrl,
      seed,
      mimeType: output.mimeType,
      extension: output.extension,
      width,
      height,
      prompt: request.prompt,
      negativePrompt: negativePrompt || undefined,
      parameters: { sampler, steps, scale, qualityToggle, smea, smeaDyn, smeaSuppressed, seed },
      createdAt: Date.now(),
    }
  }
}
