import type { ProviderError, ProviderErrorCategory } from '../core/ProviderError'
import type {
  NovelAiQualityMode,
  RelayCapabilityDeclaration,
  RelayCapabilityEvidence,
} from '../services/ImageGenerationCapabilities'
import type { ImageGenerationManifest } from './GeneratedImageAlbum'

export type FrontendWorkshopImageProvider = 'openai' | 'novelai'

export interface FrontendWorkshopImageModelOption {
  id: string
  name: string
  capabilities?: RelayCapabilityDeclaration
}

export interface FrontendWorkshopImageModelList {
  options: FrontendWorkshopImageModelOption[]
  source: 'remote' | 'builtin'
  message: string
}

export type FrontendWorkshopOpenAiQuality = 'auto' | 'low' | 'medium' | 'high'

export type FrontendWorkshopOpenAiBackground = 'auto' | 'opaque' | 'transparent'

export type FrontendWorkshopImageFormat = 'png' | 'jpeg' | 'webp'

export type FrontendWorkshopNovelAiSampler =
  | 'k_dpmpp_2m'
  | 'k_euler_ancestral'
  | 'k_euler'
  | 'k_dpm_2'
  | 'k_dpmpp_2s_ancestral'
  | 'k_dpmpp_sde'
  | 'k_dpm_fast'
  | 'ddim'

export interface FrontendWorkshopImageGenerationConfig {
  provider: FrontendWorkshopImageProvider
  endpoint: string
  apiKey: string
  model: string
  credentialPersistence?: 'local' | 'session'
  relayCapabilities?: RelayCapabilityEvidence
}

export interface FrontendWorkshopImageGenerationRequest {
  prompt: string
  negativePrompt?: string
  width?: number
  height?: number
  seed?: number
  openAiQuality?: FrontendWorkshopOpenAiQuality
  openAiBackground?: FrontendWorkshopOpenAiBackground
  outputFormat?: FrontendWorkshopImageFormat
  outputCompression?: number
  novelAiSampler?: FrontendWorkshopNovelAiSampler
  novelAiSteps?: number
  novelAiScale?: number
  novelAiQualityToggle?: boolean
  novelAiSmea?: boolean
  novelAiSmeaDyn?: boolean
  novelAiCharacters?: Array<{
    prompt: string
    negativePrompt?: string
    position?: { x: number; y: number }
  }>
  novelAiQualityMode?: NovelAiQualityMode
  novelAiUcPreset?: string | number
  novelAiTransparentBackground?: boolean
  novelAiVibes?: Array<{ image: string; strength: number; informationExtracted: number }>
  novelAiPreciseReferences?: Array<{
    image: string
    strength: number
    fidelity: number
    type?: 'character' | 'style'
  }>
  openAiInputImages?: Array<{
    blob?: Blob
    dataUrl?: string
    role?: 'identity' | 'outfit' | 'composition' | 'scene' | 'reference'
  }>
  openAiEditInstruction?: string
  openAiPreserve?: Partial<
    Record<'identity' | 'face' | 'hairstyle' | 'composition' | 'background' | 'lighting', boolean>
  >
  openAiMask?: Blob | string
  parentImageId?: string
  additionalJson?: string
}

export interface FrontendWorkshopGeneratedImage {
  id: string
  provider: FrontendWorkshopImageProvider
  dataUrl?: string
  temporaryUrl?: string
  seed?: number
  mimeType: string
  extension: FrontendWorkshopImageFormat
  width: number
  height: number
  prompt: string
  negativePrompt?: string
  parameters: Record<string, string | number | boolean>
  createdAt: number
  manifest?: ImageGenerationManifest
}

export type FrontendWorkshopImageGenerationErrorCategory = ProviderErrorCategory

export interface FrontendWorkshopImageGenerationDiagnostic extends ProviderError {
  provider: FrontendWorkshopImageProvider
  endpoint: string
  model: string
  category: FrontendWorkshopImageGenerationErrorCategory
  retryable: boolean
  httpStatus?: number
  statusText?: string
  responseContentType?: string
  responseBody?: string
  parameters: Record<string, string | number | boolean>
}

export interface FrontendWorkshopImageGenerationOptions {
  signal?: AbortSignal
  requestId?: string
}
