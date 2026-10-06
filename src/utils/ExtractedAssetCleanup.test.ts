import { describe, expect, it } from 'vitest'

import type { ResourceSummary } from '../types/Resource'
import {
  EXTRACTED_MODIFIED_GRACE_MS,
  listExtractedCleanupCandidates,
  sourceStillEmbedsAsset,
} from './ExtractedAssetCleanup'

const BASE_TIME = 1_700_000_000_000

function summary(overrides: Partial<ResourceSummary>): ResourceSummary {
  return {
    id: 'id',
    type: 'worldBook',
    name: '资源',
    description: '',
    fileName: 'file.json',
    mimeType: 'application/json',
    fileSize: 10,
    contentHash: 'hash',
    favorite: false,
    categoryId: null,
    categoryIds: [],
    relatedResourceIds: [],
    tags: [],
    metadata: {},
    createdAt: BASE_TIME,
    updatedAt: BASE_TIME,
    ...overrides,
  } as ResourceSummary
}

function cardWithEmbeds(options: { book?: boolean; regex?: boolean }): Record<string, unknown> {
  return {
    spec: 'chara_card_v2',
    data: {
      name: '角色A',
      ...(options.book ? { character_book: { entries: [{ keys: ['a'], content: 'x' }] } } : {}),
      ...(options.regex
        ? {
            extensions: {
              regex_scripts: [{ scriptName: 'r', findRegex: '/a/', replaceString: 'b' }],
            },
          }
        : {}),
    },
  }
}

function makeCharacter(id: string, options: { book?: boolean; regex?: boolean }): ResourceSummary {
  return summary({
    id,
    type: 'characterCard',
    name: `角色卡${id}`,
    metadata: { card: cardWithEmbeds(options) },
  })
}

function makeExtracted(
  id: string,
  sourceId: string,
  kind: 'worldBook' | 'regex',
  extra: Partial<ResourceSummary> = {},
): ResourceSummary {
  return summary({
    id,
    type: kind === 'worldBook' ? 'worldBook' : 'regex',
    name: `副本${id}`,
    metadata: { extractedFromCharacterId: sourceId, extractedAssetKind: kind },
    ...extra,
  })
}

describe('listExtractedCleanupCandidates 三条件扫描', () => {
  it('三条件齐备时列为可清理项', () => {
    const source = makeCharacter('card-1', { book: true, regex: true })
    const bookCopy = makeExtracted('copy-book', 'card-1', 'worldBook')
    const regexCopy = makeExtracted('copy-regex', 'card-1', 'regex')
    const candidates = listExtractedCleanupCandidates([source, bookCopy, regexCopy])
    expect(candidates.map((item) => item.resource.id).sort()).toEqual(['copy-book', 'copy-regex'])
    expect(candidates[0].source.id).toBe('card-1')
  })

  it('普通资源（非拆分产物）不列入', () => {
    const source = makeCharacter('card-1', { book: true })
    const normal = summary({ id: 'normal', type: 'worldBook', name: '手动导入的世界书' })
    expect(listExtractedCleanupCandidates([source, normal])).toEqual([])
  })

  it('溯源卡已删除时绝不列入', () => {
    const orphan = makeExtracted('copy-1', 'gone-card', 'worldBook')
    expect(listExtractedCleanupCandidates([orphan])).toEqual([])
  })

  it('溯源卡当前版已无对应内嵌时绝不列入', () => {
    const noBook = makeCharacter('card-1', { regex: true })
    const bookCopy = makeExtracted('copy-book', 'card-1', 'worldBook')
    const regexCopy = makeExtracted('copy-regex', 'card-1', 'regex')
    const candidates = listExtractedCleanupCandidates([noBook, bookCopy, regexCopy])
    expect(candidates.map((item) => item.resource.id)).toEqual(['copy-regex'])
  })

  it('世界书内嵌存在但条目为空时视为无内嵌', () => {
    const source = summary({
      id: 'card-1',
      type: 'characterCard',
      metadata: { card: { data: { name: 'x', character_book: { entries: [] } } } },
    })
    expect(sourceStillEmbedsAsset(source, 'worldBook')).toBe(false)
  })

  it('预设来源用 presetRegexCount 判断内嵌正则', () => {
    const preset = summary({
      id: 'preset-1',
      type: 'preset',
      metadata: { presetRegexCount: 2 },
    })
    const emptyPreset = summary({
      id: 'preset-2',
      type: 'preset',
      metadata: { presetRegexCount: 0 },
    })
    expect(sourceStillEmbedsAsset(preset, 'regex')).toBe(true)
    expect(sourceStillEmbedsAsset(emptyPreset, 'regex')).toBe(false)
    const copy = summary({
      id: 'copy-1',
      type: 'regex',
      metadata: { extractedFromPresetId: 'preset-1', extractedAssetKind: 'regex' },
    })
    expect(listExtractedCleanupCandidates([preset, copy])).toHaveLength(1)
  })

  it('updatedAt 明显晚于 createdAt 时标记「可能已修改」', () => {
    const source = makeCharacter('card-1', { book: true })
    const fresh = makeExtracted('copy-fresh', 'card-1', 'worldBook', {
      updatedAt: BASE_TIME + EXTRACTED_MODIFIED_GRACE_MS - 1,
    })
    const edited = makeExtracted('copy-edited', 'card-1', 'worldBook', {
      updatedAt: BASE_TIME + EXTRACTED_MODIFIED_GRACE_MS,
    })
    const candidates = listExtractedCleanupCandidates([source, fresh, edited])
    expect(candidates.find((item) => item.resource.id === 'copy-fresh')?.possiblyModified).toBe(
      false,
    )
    expect(candidates.find((item) => item.resource.id === 'copy-edited')?.possiblyModified).toBe(
      true,
    )
  })
})
