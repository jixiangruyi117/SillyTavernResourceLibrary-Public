import type { FrontendWorkshopSourceDocument } from './FrontendWorkshopSourceDocument'
import {
  FRONTEND_WORKSHOP_SOURCE_OFFSET_UNIT,
  type FrontendWorkshopSourceAnalysisSnapshot,
  type FrontendWorkshopSourceRange,
} from '../utils/FrontendWorkshopSourceAnalysis'
import type { FrontendWorkshopResolvedSourceSelection } from '../utils/FrontendWorkshopSourceSelection'
import { FRONTEND_WORKSHOP_SOURCE_AI_CONTEXT_VERSION } from '../utils/FrontendWorkshopSourceAiContextPolicy'

export type FrontendWorkshopSourceAiTaskMode =
  'plan' | 'explain' | 'edit' | 'edit-selection' | 'runtime-fix'

export type FrontendWorkshopSourceAiContextSectionKind =
  | 'core-prompt'
  | 'runtime-contract'
  | 'task-mode'
  | 'reply-repair'
  | 'runtime-diagnostics'
  | 'write-scope'
  | 'relevant-source'
  | 'host-reference'
  | 'registry'
  | 'conversation'
  | 'output-contract'

export interface FrontendWorkshopSourceAiMessage {
  role: 'system' | 'user'
  content: string
}

export interface FrontendWorkshopSourceAiConversationTurn {
  role: 'user' | 'assistant'
  content: string
}

export interface FrontendWorkshopSourceAiReferenceImage {
  id: string
  name: string
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'
  dataUrl: string
  size: number
}

export interface FrontendWorkshopSourceAiHostReference {
  cached?: boolean
  id: string
  title: string
  content: string
}

export interface FrontendWorkshopSourceAiRegistryContext {
  label: string
  content: string
}

export type FrontendWorkshopSourceAiWriteScopeRequest =
  | { kind: 'read-only' }
  | { kind: 'whole-source' }
  | { kind: 'ranges'; ranges: readonly FrontendWorkshopSourceRange[] }

export interface FrontendWorkshopSourceAiResolvedWriteScope {
  kind: FrontendWorkshopSourceAiWriteScopeRequest['kind']
  projectId: string
  sourceRevision: number
  sourceCreatedAt: number
  offsetUnit: typeof FRONTEND_WORKSHOP_SOURCE_OFFSET_UNIT
  allowedRanges: readonly FrontendWorkshopSourceRange[]
  maxEdits: number
  application: string
}

export interface FrontendWorkshopSourceAiRuntimeErrorContext {
  kind: string
  message: string
}

export interface FrontendWorkshopSourceAiRuntimeDiagnosticContext {
  category: string
  severity: 'error' | 'warning' | 'info'
  title: string
  message: string
  sourceRange?: FrontendWorkshopSourceRange
}

export interface FrontendWorkshopSourceAiContextOptions {
  maxSourceTextUnits?: number
  maxSourceChunkTextUnits?: number
  maxSourceChunks?: number
  selectionPadding?: number
  relationPadding?: number
  maxRelatedChunks?: number
  maxHostReferenceTextUnits?: number
  maxRegistryTextUnits?: number
  maxConversationTextUnits?: number
}

export interface FrontendWorkshopSourceAiContextInput {
  source: FrontendWorkshopSourceDocument
  mode: FrontendWorkshopSourceAiTaskMode
  instruction: string
  replyRepair?: { rawText: string; error: string; finishReason?: string }
  writeScope?: FrontendWorkshopSourceAiWriteScopeRequest
  selections?: readonly FrontendWorkshopResolvedSourceSelection[]
  analysis?: FrontendWorkshopSourceAnalysisSnapshot
  runtimeError?: FrontendWorkshopSourceAiRuntimeErrorContext
  runtimeDiagnostics?: readonly FrontendWorkshopSourceAiRuntimeDiagnosticContext[]
  hostReferences?: readonly FrontendWorkshopSourceAiHostReference[]
  registry?: FrontendWorkshopSourceAiRegistryContext
  conversation?: readonly FrontendWorkshopSourceAiConversationTurn[]
  referenceImages?: readonly FrontendWorkshopSourceAiReferenceImage[]
  hostResearch?: {
    maxAdditionalRequests: number
    tavernHelperVersion: string
    sillyTavernVersion: string
  }
  options?: FrontendWorkshopSourceAiContextOptions
}

export interface FrontendWorkshopSourceAiSourceChunk {
  range: FrontendWorkshopSourceRange
  reasons: readonly string[]
  text: string
}

export interface FrontendWorkshopSourceAiSourceCoverage {
  sourceLength: number
  complete: boolean
  coveredTextUnits: number
  omittedTextUnits: number
  chunks: readonly FrontendWorkshopSourceAiSourceChunk[]
}

export interface FrontendWorkshopSourceAiContextSection {
  kind: FrontendWorkshopSourceAiContextSectionKind
  title: string
  content: string
}

export interface FrontendWorkshopSourceAiContextDiagnostics {
  sourceContextComplete: boolean
  selectionUsed: boolean
  selectionCount: number
  hostReferenceTruncated: boolean
  registryTruncated: boolean
  conversationTruncated: boolean
  referenceImageCount: number
}

export interface FrontendWorkshopSourceAiContextBundle {
  version: typeof FRONTEND_WORKSHOP_SOURCE_AI_CONTEXT_VERSION
  projectId: string
  sourceRevision: number
  sourceCreatedAt: number
  mode: FrontendWorkshopSourceAiTaskMode
  runtimeError?: FrontendWorkshopSourceAiRuntimeErrorContext
  runtimeDiagnostics: readonly FrontendWorkshopSourceAiRuntimeDiagnosticContext[]
  writeScope: FrontendWorkshopSourceAiResolvedWriteScope
  sections: readonly FrontendWorkshopSourceAiContextSection[]
  messages: readonly FrontendWorkshopSourceAiMessage[]
  sourceCoverage: FrontendWorkshopSourceAiSourceCoverage
  diagnostics: FrontendWorkshopSourceAiContextDiagnostics
}

export interface ResolvedContextOptions {
  maxSourceTextUnits: number
  maxSourceChunkTextUnits: number
  maxSourceChunks: number
  selectionPadding: number
  relationPadding: number
  maxRelatedChunks: number
  maxHostReferenceTextUnits: number
  maxRegistryTextUnits: number
  maxConversationTextUnits: number
}

export interface SourceRangeCandidate {
  range: FrontendWorkshopSourceRange
  reason: string
}

export interface BoundedTextResult {
  content: string
  truncated: boolean
}

export interface NormalizedRuntimeFixContext {
  runtimeError?: FrontendWorkshopSourceAiRuntimeErrorContext
  runtimeDiagnostics: FrontendWorkshopSourceAiRuntimeDiagnosticContext[]
}
