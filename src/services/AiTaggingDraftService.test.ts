/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it } from 'vitest'

import { AiTaggingDraftService, type AiTaggingDraft } from './AiTaggingDraftService'

describe('AiTaggingDraftService', () => {
  beforeEach(() => localStorage.clear())

  it('保存并恢复审核草稿，但永远不持久化临时 API Key', () => {
    const service = new AiTaggingDraftService()
    const draft: AiTaggingDraft = {
      version: 1,
      savedAt: 100,
      stage: 'review',
      searchQuery: '古风',
      typeFilter: 'all',
      categoryFilter: 'all',
      tagState: 'untagged',
      tagQuery: '',
      selectedIds: ['r1'],
      batchSize: 4,
      customPrompt: '只依据正文',
      taxonomyTemplateId: 'story-resource',
      mergeAliases: true,
      api: {
        source: 'temporary',
        temporaryProtocol: 'openai-compatible',
        temporaryUrl: 'https://example.com/v1',
        temporaryModel: 'model-a',
      },
      reviewItems: [
        {
          resourceId: 'r1',
          tags: [{ name: '古风', evidence: '场景明确', level: 'explicit' }],
          accepted: true,
          draftTag: '',
        },
      ],
      failures: [],
      usageText: '120 Token',
    }

    service.saveDraft({
      ...draft,
      api: { ...draft.api, apiKey: 'must-not-persist' } as typeof draft.api,
    })

    const serialized = localStorage.getItem(localStorage.key(0) ?? '') ?? ''
    expect(serialized).toContain('https://example.com/v1')
    expect(serialized).not.toContain('must-not-persist')
    expect(service.loadDraft()).toEqual(draft)
  })

  it('撤销记录只保存资源和本次新增标签', () => {
    const service = new AiTaggingDraftService()
    const record = {
      version: 1 as const,
      appliedAt: 200,
      additions: [{ resourceId: 'r1', resourceName: '角色一', tags: ['甜宠'] }],
    }

    expect(service.saveUndo(record)).toBe(true)
    expect(service.loadUndo()).toEqual(record)
    service.clearUndo()
    expect(service.loadUndo()).toBeUndefined()
  })
})
