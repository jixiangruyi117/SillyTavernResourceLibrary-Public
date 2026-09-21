import type { MainApiRequestOptions, MainApiTokenUsage } from '../services/MainApiService'
import type { FrontendWorkshopSourceAiContextBundle } from './FrontendWorkshopSourceAiContext'

export interface FrontendWorkshopSourceAiReceipt {
  id: string
  rawText: string
  status: 'receiving' | 'complete' | 'invalid' | 'interrupted'
  finishReason?: string
  usage?: MainApiTokenUsage
  error?: string
}

export interface FrontendWorkshopSourceAiLookup {
  request: string
  status: 'found' | 'not-found' | 'unavailable'
  sources: { title: string; url?: string; version?: string; lines?: number[]; cached?: boolean }[]
}

export interface FrontendWorkshopSourceAiRequestOptions extends MainApiRequestOptions {
  onReceipt?: (
    receipt: FrontendWorkshopSourceAiReceipt,
    bundle: FrontendWorkshopSourceAiContextBundle,
  ) => void
  onLookup?: (lookup: FrontendWorkshopSourceAiLookup) => void
}
