import type { FrontendWorkshopSourceDocument } from '../types/FrontendWorkshopSourceDocument'
import {
  analyzeFrontendWorkshopSource,
  FRONTEND_WORKSHOP_SOURCE_ANALYSIS_VERSION,
  type FrontendWorkshopSourceAnalysisSnapshot,
} from './FrontendWorkshopSourceAnalysis'

export const FRONTEND_WORKSHOP_SOURCE_ANALYSIS_CACHE_DEFAULT_MAX_ENTRIES = 32 as const

interface FrontendWorkshopSourceAnalysisCacheEntry {
  authorSource: string
  snapshot: FrontendWorkshopSourceAnalysisSnapshot
}

function cacheKey(source: Pick<FrontendWorkshopSourceDocument, 'projectId' | 'revision'>): string {
  return JSON.stringify([source.projectId, source.revision])
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child)
  return Object.freeze(value)
}

/**
 * Disposable S3 analysis cache. Author Source remains the only truth: a cache hit requires the
 * exact project/revision identity and exact source string. The cache is memory-only, bounded, and
 * may be discarded at any time without changing Source or Runtime behavior.
 */
export class FrontendWorkshopSourceAnalysisCache {
  private readonly values = new Map<string, FrontendWorkshopSourceAnalysisCacheEntry>()
  private readonly maxEntries: number

  constructor(maxEntries: number = FRONTEND_WORKSHOP_SOURCE_ANALYSIS_CACHE_DEFAULT_MAX_ENTRIES) {
    if (!Number.isInteger(maxEntries) || maxEntries < 1) {
      throw new Error('Source Analysis cache maxEntries 必须是正整数')
    }
    this.maxEntries = maxEntries
  }

  analyze(source: FrontendWorkshopSourceDocument): FrontendWorkshopSourceAnalysisSnapshot {
    const key = cacheKey(source)
    const cached = this.values.get(key)
    if (
      cached?.authorSource === source.authorSource &&
      cached.snapshot.version === FRONTEND_WORKSHOP_SOURCE_ANALYSIS_VERSION
    ) {
      this.values.delete(key)
      this.values.set(key, cached)
      return cached.snapshot
    }

    if (cached) this.values.delete(key)
    const snapshot = deepFreeze(analyzeFrontendWorkshopSource(source))
    this.values.set(key, { authorSource: source.authorSource, snapshot })
    while (this.values.size > this.maxEntries) {
      const oldest = this.values.keys().next().value as string | undefined
      if (oldest === undefined) break
      this.values.delete(oldest)
    }
    return snapshot
  }

  invalidateProject(projectId: string): void {
    for (const [key, entry] of this.values) {
      if (entry.snapshot.projectId === projectId) this.values.delete(key)
    }
  }

  clear(): void {
    this.values.clear()
  }

  get size(): number {
    return this.values.size
  }
}
