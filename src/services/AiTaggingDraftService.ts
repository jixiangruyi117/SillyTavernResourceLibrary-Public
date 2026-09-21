import type {
  AiTaggingEvidenceLevel,
  AiTaggingFailure,
  AiTaggingSuggestedTag,
} from './AiTaggingService'
import type { MainApiConfig } from './MainApiService'

export interface AiTaggingDraftReviewItem {
  resourceId: string
  tags: AiTaggingSuggestedTag[]
  accepted: boolean
  draftTag: string
}

export interface AiTaggingDraft {
  version: 1
  savedAt: number
  stage: 'select' | 'review'
  searchQuery: string
  typeFilter: string
  categoryFilter: string
  tagState: 'all' | 'tagged' | 'untagged'
  tagQuery: string
  selectedIds: string[]
  batchSize: number
  customPrompt: string
  taxonomyTemplateId: string
  mergeAliases: boolean
  api: {
    source: string
    temporaryProtocol: MainApiConfig['protocol']
    temporaryUrl: string
    temporaryModel: string
  }
  reviewItems: AiTaggingDraftReviewItem[]
  failures: AiTaggingFailure[]
  usageText: string
}

export interface AiTaggingUndoAddition {
  resourceId: string
  resourceName: string
  tags: string[]
}

export interface AiTaggingUndoRecord {
  version: 1
  appliedAt: number
  additions: AiTaggingUndoAddition[]
}

const DRAFT_KEY = 'srl.aiTagging.draft.v1'
const UNDO_KEY = 'srl.aiTagging.lastInjection.v1'

function storage(): Storage | undefined {
  try {
    return globalThis.localStorage
  } catch {
    return undefined
  }
}

function text(value: unknown, limit: number): string {
  return typeof value === 'string' ? value.slice(0, limit) : ''
}

function evidenceLevel(value: unknown): AiTaggingEvidenceLevel {
  return value === 'explicit' ? 'explicit' : 'inferred'
}

function suggestedTags(value: unknown): AiTaggingSuggestedTag[] {
  if (!Array.isArray(value)) return []
  return value.slice(0, 12).flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const tag = item as Partial<AiTaggingSuggestedTag>
    const name = text(tag.name, 40).trim()
    if (!name) return []
    return [
      {
        name,
        evidence: text(tag.evidence, 160).trim(),
        level: evidenceLevel(tag.level),
      },
    ]
  })
}

function failures(value: unknown): AiTaggingFailure[] {
  if (!Array.isArray(value)) return []
  return value.slice(0, 50).flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const failure = item as Partial<AiTaggingFailure>
    const resourceIds = Array.isArray(failure.resourceIds)
      ? failure.resourceIds.filter((id): id is string => typeof id === 'string').slice(0, 200)
      : []
    if (!resourceIds.length) return []
    return [
      {
        batch: Number.isFinite(failure.batch) ? Math.max(1, Number(failure.batch)) : 1,
        resourceIds,
        message: text(failure.message, 500) || '识别失败',
        retryable: failure.retryable !== false,
      },
    ]
  })
}

function parseDraft(value: unknown): AiTaggingDraft | undefined {
  if (!value || typeof value !== 'object') return undefined
  const draft = value as Partial<AiTaggingDraft>
  if (draft.version !== 1 || !draft.api || typeof draft.api !== 'object') return undefined
  const selectedIds = Array.isArray(draft.selectedIds)
    ? draft.selectedIds.filter((id): id is string => typeof id === 'string').slice(0, 200)
    : []
  const reviewItems = Array.isArray(draft.reviewItems)
    ? draft.reviewItems.slice(0, 200).flatMap((item) => {
        if (!item || typeof item !== 'object') return []
        const review = item as Partial<AiTaggingDraftReviewItem>
        const resourceId = text(review.resourceId, 160).trim()
        if (!resourceId) return []
        return [
          {
            resourceId,
            tags: suggestedTags(review.tags),
            accepted: review.accepted !== false,
            draftTag: text(review.draftTag, 40),
          },
        ]
      })
    : []
  const parsedFailures = failures(draft.failures)
  return {
    version: 1,
    savedAt: Number.isFinite(draft.savedAt) ? Number(draft.savedAt) : Date.now(),
    stage:
      draft.stage === 'review' && (reviewItems.length || parsedFailures.length)
        ? 'review'
        : 'select',
    searchQuery: text(draft.searchQuery, 160),
    typeFilter: text(draft.typeFilter, 80) || 'all',
    categoryFilter: text(draft.categoryFilter, 160) || 'all',
    tagState: draft.tagState === 'tagged' || draft.tagState === 'untagged' ? draft.tagState : 'all',
    tagQuery: text(draft.tagQuery, 40),
    selectedIds,
    batchSize: Math.min(8, Math.max(1, Math.round(Number(draft.batchSize) || 4))),
    customPrompt: text(draft.customPrompt, 4_000),
    taxonomyTemplateId: text(draft.taxonomyTemplateId, 80) || 'free',
    mergeAliases: draft.mergeAliases === true,
    api: {
      source: text(draft.api.source, 160) || 'active',
      temporaryProtocol:
        draft.api.temporaryProtocol === 'anthropic-compatible'
          ? 'anthropic-compatible'
          : 'openai-compatible',
      temporaryUrl: text(draft.api.temporaryUrl, 2_000),
      temporaryModel: text(draft.api.temporaryModel, 200),
    },
    reviewItems,
    failures: parsedFailures,
    usageText: text(draft.usageText, 200),
  }
}

function parseUndo(value: unknown): AiTaggingUndoRecord | undefined {
  if (!value || typeof value !== 'object') return undefined
  const record = value as Partial<AiTaggingUndoRecord>
  if (record.version !== 1 || !Array.isArray(record.additions)) return undefined
  const additions = record.additions.slice(0, 200).flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const addition = item as Partial<AiTaggingUndoAddition>
    const resourceId = text(addition.resourceId, 160).trim()
    const tags = Array.isArray(addition.tags)
      ? addition.tags.filter((tag): tag is string => typeof tag === 'string').slice(0, 12)
      : []
    if (!resourceId || !tags.length) return []
    return [{ resourceId, resourceName: text(addition.resourceName, 160), tags }]
  })
  if (!additions.length) return undefined
  return {
    version: 1,
    appliedAt: Number.isFinite(record.appliedAt) ? Number(record.appliedAt) : Date.now(),
    additions,
  }
}

export class AiTaggingDraftService {
  loadDraft(): AiTaggingDraft | undefined {
    try {
      return parseDraft(JSON.parse(storage()?.getItem(DRAFT_KEY) ?? 'null'))
    } catch {
      return undefined
    }
  }

  saveDraft(draft: AiTaggingDraft): boolean {
    try {
      const safeDraft = parseDraft(draft)
      if (!safeDraft) return false
      const target = storage()
      if (!target) return false
      target.setItem(DRAFT_KEY, JSON.stringify(safeDraft))
      return true
    } catch {
      return false
    }
  }

  clearDraft(): void {
    try {
      storage()?.removeItem(DRAFT_KEY)
    } catch {
      // 草稿清理失败不阻断当前审核。
    }
  }

  loadUndo(): AiTaggingUndoRecord | undefined {
    try {
      return parseUndo(JSON.parse(storage()?.getItem(UNDO_KEY) ?? 'null'))
    } catch {
      return undefined
    }
  }

  saveUndo(record: AiTaggingUndoRecord): boolean {
    try {
      const safeRecord = parseUndo(record)
      if (!safeRecord) return false
      const target = storage()
      if (!target) return false
      target.setItem(UNDO_KEY, JSON.stringify(safeRecord))
      return true
    } catch {
      return false
    }
  }

  clearUndo(): void {
    try {
      storage()?.removeItem(UNDO_KEY)
    } catch {
      // 撤销记录清理失败不影响资源数据。
    }
  }
}
