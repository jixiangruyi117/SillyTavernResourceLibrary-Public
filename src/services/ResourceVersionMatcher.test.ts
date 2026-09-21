import { describe, expect, it } from 'vitest'

import type { ParsedResource } from '../types/Import'
import { RESOURCE_TYPE, type ResourceSummary } from '../types/Resource'
import {
  buildStoredVersionRecognitionReport,
  createVersionMatchEntries,
  findHistoricalDuplicateGroups,
  findStoredVersionGroups,
  findVersionCandidates,
} from './ResourceVersionMatcher'

function summary(overrides: Partial<ResourceSummary> = {}): ResourceSummary {
  return {
    id: 'existing',
    type: RESOURCE_TYPE.CHARACTER_CARD,
    name: '温以礼',
    description: '温和安静的医生，住在海边城市。',
    fileName: '温以礼-v1.png',
    mimeType: 'image/png',
    fileSize: 10,
    contentHash: 'a'.repeat(64),
    favorite: false,
    categoryId: null,
    categoryIds: [],
    relatedResourceIds: [],
    tags: [],
    metadata: { creator: 'Alice' },
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

function match(
  parsed: ParsedResource,
  fileName: string,
  resources: ResourceSummary[],
  versions: ResourceSummary[] = [],
) {
  return findVersionCandidates(parsed, fileName, createVersionMatchEntries(resources, versions))
}

describe('ResourceVersionMatcher', () => {
  it('ranks matching name and creator as a likely version', () => {
    const parsed: ParsedResource = {
      type: RESOURCE_TYPE.CHARACTER_CARD,
      name: '温以礼',
      description: '温和安静的外科医生，现居海边城市。',
      metadata: { creator: 'Alice', characterVersion: '2.0' },
    }

    const [candidate] = match(parsed, '温以礼-v2.png', [summary()])
    expect(candidate?.score).toBeGreaterThanOrEqual(70)
    expect(candidate?.reasons).toContain('名称相同')
    expect(candidate?.reasons).toContain('作者相同')
  })

  it('does not suggest same-name resources from a different known creator', () => {
    const parsed: ParsedResource = {
      type: RESOURCE_TYPE.CHARACTER_CARD,
      name: '温以礼',
      description: '完全不同的角色设定。',
      metadata: { creator: 'Bob' },
    }

    expect(match(parsed, 'unrelated.json', [summary()])).toEqual([])
  })

  it('offers a candidate when name and version-stripped filename both match', () => {
    const parsed: ParsedResource = {
      type: RESOURCE_TYPE.WORLD_BOOK,
      name: '无作者世界书',
      description: '第二版内容',
      metadata: {},
    }
    const existing = summary({
      type: RESOURCE_TYPE.WORLD_BOOK,
      name: '无作者世界书',
      fileName: '无作者世界书-v1.json',
      description: '第一版内容',
      metadata: {},
    })

    expect(match(parsed, '无作者世界书-v2.json', [existing])[0]).toMatchObject({
      resource: { id: existing.id },
      score: 60,
    })
  })

  it('treats an identical stable UUID as a certain match', () => {
    const parsed: ParsedResource = {
      type: RESOURCE_TYPE.PRESET,
      name: '新版名称',
      description: '',
      metadata: { uuid: 'preset-123' },
    }
    const [candidate] = match(parsed, 'new.json', [
      summary({
        type: RESOURCE_TYPE.PRESET,
        name: '旧版名称',
        metadata: { uuid: 'preset-123' },
      }),
    ])

    expect(candidate?.score).toBe(100)
  })
})

describe('卡内容指纹匹配', () => {
  it('完整指纹一致时给满分候选，即使名称与作者都不同', () => {
    const parsed = {
      type: RESOURCE_TYPE.CHARACTER_CARD,
      name: '导出副本',
      description: '',
      metadata: { cardContentHash: 'full-1', cardCoreHash: 'core-1' },
    } as unknown as ParsedResource
    const existing = {
      id: 'r1',
      type: RESOURCE_TYPE.CHARACTER_CARD,
      name: '完全不同的名字',
      description: '',
      fileName: 'other.png',
      metadata: { cardContentHash: 'full-1', cardCoreHash: 'core-1' },
      updatedAt: 1,
    } as unknown as ResourceSummary

    const candidates = match(parsed, 'card.json', [existing])
    expect(candidates).toHaveLength(1)
    expect(candidates[0].score).toBe(100)
    expect(candidates[0].matchKind).toBe('containerVariant')
    expect(candidates[0].reasons).toContain('卡数据一致，仅立绘或文件封装可能不同')
  })

  it('仅核心指纹一致时给 90 分候选', () => {
    const parsed = {
      type: RESOURCE_TYPE.CHARACTER_CARD,
      name: 'A',
      description: '',
      metadata: { cardContentHash: 'full-a', cardCoreHash: 'core-1' },
    } as unknown as ParsedResource
    const existing = {
      id: 'r1',
      type: RESOURCE_TYPE.CHARACTER_CARD,
      name: 'B',
      description: '',
      fileName: 'b.png',
      metadata: { cardContentHash: 'full-b', cardCoreHash: 'core-1' },
      updatedAt: 1,
    } as unknown as ResourceSummary

    const candidates = match(parsed, 'a.json', [existing])
    expect(candidates[0]?.score).toBe(90)
    expect(candidates[0]?.reasons).toContain('核心内容一致，附加字段不同')
  })

  it('指纹都不同时回落原有启发式', () => {
    const parsed = {
      type: RESOURCE_TYPE.CHARACTER_CARD,
      name: '同名卡',
      description: '同一段简介内容用于相似度计算测试',
      metadata: { cardContentHash: 'full-x', cardCoreHash: 'core-x', creator: '作者' },
    } as unknown as ParsedResource
    const existing = {
      id: 'r1',
      type: RESOURCE_TYPE.CHARACTER_CARD,
      name: '同名卡',
      description: '同一段简介内容用于相似度计算测试',
      fileName: 'card.png',
      metadata: { cardContentHash: 'full-y', cardCoreHash: 'core-y', creator: '作者' },
      updatedAt: 1,
    } as unknown as ResourceSummary

    const candidates = match(parsed, 'card-v2.json', [existing])
    expect(candidates[0]?.reasons).toContain('名称相同')
    expect(candidates[0]?.matchKind).toBe('heuristic')
  })

  it('命中历史版本时返回所属主资源，并把同组结果合并为一项', () => {
    const parsed = {
      type: RESOURCE_TYPE.CHARACTER_CARD,
      name: '历史副本',
      description: '',
      metadata: { cardContentHash: 'historical-full', cardCoreHash: 'historical-core' },
    } as unknown as ParsedResource
    const active = summary({
      id: 'group-1',
      fileName: 'current.json',
      metadata: { cardContentHash: 'current-full', cardCoreHash: 'historical-core' },
    })
    const historical = summary({
      id: 'history-1',
      versionGroupId: active.id,
      versionLabel: '最初版本',
      fileName: 'history.json',
      metadata: { cardContentHash: 'historical-full', cardCoreHash: 'historical-core' },
    })

    const candidates = match(parsed, 'copy.json', [active], [historical])

    expect(candidates).toHaveLength(1)
    expect(candidates[0]).toMatchObject({
      resource: { id: active.id },
      matchedResource: { id: historical.id },
      matchedHistorical: true,
      matchKind: 'contentDuplicate',
      score: 100,
    })
  })
})

describe('已导入资源批量版本重识别', () => {
  it('扫描报告会说明覆盖量、候选以及被分流到重复清理的内容', () => {
    const resources = [
      summary({
        id: 'png',
        fileName: 'card.png',
        contentHash: 'png-file',
        metadata: { cardContentHash: 'same-full', cardCoreHash: 'same-core' },
      }),
      summary({
        id: 'json-a',
        fileName: 'card-a.json',
        mimeType: 'application/json',
        contentHash: 'json-a',
        metadata: { cardContentHash: 'same-full', cardCoreHash: 'same-core' },
      }),
      summary({
        id: 'json-b',
        fileName: 'card-b.json',
        mimeType: 'application/json',
        contentHash: 'json-b',
        metadata: { cardContentHash: 'same-full', cardCoreHash: 'same-core' },
      }),
      summary({ id: 'duplicate', contentHash: 'png-file' }),
    ]
    const report = buildStoredVersionRecognitionReport(resources)

    expect(report).toMatchObject({
      currentResources: 4,
      historicalVersions: 0,
      fingerprintedCards: 3,
      totalCards: 4,
      exactDuplicateGroups: 1,
      equivalentJsonGroups: 1,
    })
    expect(report.candidateGroups).toBeGreaterThan(0)
  })

  it('把核心指纹一致但完整指纹不同的资源列为版本组', () => {
    const groups = findStoredVersionGroups([
      summary({
        id: 'v1',
        contentHash: 'file-v1',
        metadata: { cardContentHash: 'full-v1', cardCoreHash: 'same-core' },
        updatedAt: 1,
      }),
      summary({
        id: 'v2',
        contentHash: 'file-v2',
        metadata: { cardContentHash: 'full-v2', cardCoreHash: 'same-core' },
        updatedAt: 2,
      }),
    ])

    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({
      matchKind: 'version',
      recommendedKeeperId: 'v2',
    })
  })

  it('相同卡数据的 PNG 与 JSON 作为封装变体，并优先保留 PNG', () => {
    const groups = findStoredVersionGroups([
      summary({
        id: 'json',
        fileName: 'card.json',
        mimeType: 'application/json',
        contentHash: 'json-file',
        metadata: { cardContentHash: 'same-full', cardCoreHash: 'same-core' },
        updatedAt: 2,
      }),
      summary({
        id: 'png',
        fileName: 'card.png',
        mimeType: 'image/png',
        contentHash: 'png-file',
        metadata: { cardContentHash: 'same-full', cardCoreHash: 'same-core' },
        updatedAt: 1,
      }),
    ])

    expect(groups[0]).toMatchObject({
      matchKind: 'containerVariant',
      recommendedKeeperId: 'png',
    })
  })

  it('不把完全相同文件或两个相同卡数据 JSON 自动并入历史版本', () => {
    expect(
      findStoredVersionGroups([
        summary({
          id: 'a',
          fileName: 'a.json',
          mimeType: 'application/json',
          contentHash: 'same-file',
          metadata: { cardContentHash: 'same-full', cardCoreHash: 'same-core' },
        }),
        summary({
          id: 'b',
          fileName: 'b.json',
          mimeType: 'application/json',
          contentHash: 'same-file',
          metadata: { cardContentHash: 'same-full', cardCoreHash: 'same-core' },
        }),
      ]),
    ).toEqual([])
  })

  it('独立资源只命中另一组历史版本时也能重新归组', () => {
    const target = summary({
      id: 'target',
      contentHash: 'target-current-file',
      metadata: { cardContentHash: 'target-current', cardCoreHash: 'target-current-core' },
    })
    const source = summary({
      id: 'source',
      contentHash: 'source-file',
      metadata: { cardContentHash: 'source-full', cardCoreHash: 'historical-core' },
    })
    const historical = summary({
      id: 'target-history',
      versionGroupId: target.id,
      contentHash: 'historical-file',
      metadata: { cardContentHash: 'historical-full', cardCoreHash: 'historical-core' },
    })

    const groups = findStoredVersionGroups([target, source], [historical])

    expect(groups).toHaveLength(1)
    expect(groups[0].resources.map((resource) => resource.id).sort()).toEqual(['source', 'target'])
    expect(groups[0].reasons.join('')).toContain('命中历史版本')
  })

  it('不同资源组的等价 JSON 历史版本可以作为跨组强证据', () => {
    const left = summary({
      id: 'left',
      contentHash: 'left-current',
      metadata: { cardContentHash: 'left-full', cardCoreHash: 'left-core' },
    })
    const right = summary({
      id: 'right',
      contentHash: 'right-current',
      metadata: { cardContentHash: 'right-full', cardCoreHash: 'right-core' },
    })
    const versions = [
      summary({
        id: 'left-history',
        versionGroupId: left.id,
        fileName: 'left-history.json',
        mimeType: 'application/json',
        contentHash: 'left-history-file',
        metadata: { cardContentHash: 'shared-history-full' },
      }),
      summary({
        id: 'right-history',
        versionGroupId: right.id,
        fileName: 'right-history.json',
        mimeType: 'application/json',
        contentHash: 'right-history-file',
        metadata: { cardContentHash: 'shared-history-full' },
      }),
    ]

    const groups = findStoredVersionGroups([left, right], versions)

    expect(groups).toHaveLength(1)
    expect(groups[0].resources.map((resource) => resource.id).sort()).toEqual(['left', 'right'])
    expect(groups[0].reasons.join('')).toContain('等价 JSON 卡数据')
  })

  it('报告同一时间线内已经归组的相同历史完整指纹', () => {
    const current = summary({ id: 'current' })
    const report = buildStoredVersionRecognitionReport(
      [current],
      [
        summary({
          id: 'history-a',
          versionGroupId: current.id,
          metadata: { cardContentHash: 'same-history-full' },
        }),
        summary({
          id: 'history-b',
          versionGroupId: current.id,
          metadata: { cardContentHash: 'same-history-full' },
        }),
      ],
    )

    expect(report.sameGroupHistoricalFingerprintGroups).toBe(1)
    expect(report.candidateGroups).toBe(0)
  })

  it('把同一时间线内与当前版完全相同的历史文件列为可安全删除', () => {
    const current = summary({ id: 'current', contentHash: 'same-file', updatedAt: 3 })
    const duplicate = summary({
      id: 'history-duplicate',
      versionGroupId: current.id,
      contentHash: 'same-file',
      updatedAt: 1,
    })

    const groups = findHistoricalDuplicateGroups([current], [duplicate])

    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({
      ownerResourceId: current.id,
      kind: 'exactFile',
      safeToDelete: true,
      keeper: { id: current.id },
    })
    expect(groups[0].duplicates.map((resource) => resource.id)).toEqual([duplicate.id])
  })

  it('同一时间线的旧分类不同也按完整文件指纹清理', () => {
    const current = summary({
      id: 'current',
      type: 'characterCard',
      contentHash: 'same-file',
      updatedAt: 3,
    })
    const legacyDuplicate = summary({
      id: 'history-legacy-other',
      type: 'other',
      versionGroupId: current.id,
      contentHash: 'same-file',
      updatedAt: 1,
    })

    const groups = findHistoricalDuplicateGroups([current], [legacyDuplicate])

    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({
      ownerResourceId: current.id,
      kind: 'exactFile',
      safeToDelete: true,
      keeper: { id: current.id },
      duplicates: [{ id: legacyDuplicate.id }],
    })
  })

  it('把同一卡数据的 JSON 历史副本列为可安全删除', () => {
    const current = summary({
      id: 'current',
      fileName: 'current.json',
      mimeType: 'application/json',
      contentHash: 'json-current',
      metadata: { cardContentHash: 'same-full' },
    })
    const duplicate = summary({
      id: 'history-json',
      versionGroupId: current.id,
      fileName: 'history.json',
      mimeType: 'application/json',
      contentHash: 'json-history',
      metadata: { cardContentHash: 'same-full' },
    })

    expect(findHistoricalDuplicateGroups([current], [duplicate])[0]).toMatchObject({
      kind: 'equivalentJson',
      safeToDelete: true,
      duplicates: [{ id: duplicate.id }],
    })
  })

  it('同一时间线的 JSON 旧分类不同也按完整卡指纹清理', () => {
    const current = summary({
      id: 'current',
      type: 'characterCard',
      fileName: 'current.json',
      mimeType: 'application/json',
      contentHash: 'json-current',
      metadata: { cardContentHash: 'same-full' },
    })
    const legacyDuplicate = summary({
      id: 'history-legacy-other',
      type: 'other',
      versionGroupId: current.id,
      fileName: 'legacy.json',
      mimeType: 'application/json',
      contentHash: 'json-history',
      metadata: { cardContentHash: 'same-full' },
    })

    expect(findHistoricalDuplicateGroups([current], [legacyDuplicate])[0]).toMatchObject({
      kind: 'equivalentJson',
      safeToDelete: true,
      duplicates: [{ id: legacyDuplicate.id }],
    })
  })

  it('把文件名仅为 json 的旧版 JSON 载体纳入安全清理', () => {
    const current = summary({
      id: 'current',
      fileName: 'json',
      mimeType: '',
      contentHash: 'legacy-json-current',
      metadata: { cardContentHash: 'same-full' },
    })
    const duplicate = summary({
      id: 'history-json',
      versionGroupId: current.id,
      fileName: '1.json',
      mimeType: 'application/json',
      contentHash: 'legacy-json-history',
      metadata: { cardContentHash: 'same-full' },
    })

    expect(findHistoricalDuplicateGroups([current], [duplicate])[0]).toMatchObject({
      kind: 'equivalentJson',
      safeToDelete: true,
      duplicates: [{ id: duplicate.id }],
    })
  })

  it('完整指纹相同但 PNG 文件不同会作为受保护封装变体保留', () => {
    const current = summary({
      id: 'current',
      contentHash: 'png-current',
      metadata: { cardContentHash: 'same-full' },
    })
    const alternateArtwork = summary({
      id: 'history-art',
      versionGroupId: current.id,
      contentHash: 'png-other-art',
      metadata: { cardContentHash: 'same-full' },
    })

    expect(findHistoricalDuplicateGroups([current], [alternateArtwork])[0]).toMatchObject({
      kind: 'containerVariant',
      safeToDelete: false,
      duplicates: [],
    })
  })
})
