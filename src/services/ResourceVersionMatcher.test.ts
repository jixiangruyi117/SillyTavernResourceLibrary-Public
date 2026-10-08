import { describe, expect, it } from 'vitest'

import type { ParsedResource } from '../types/Import'
import { computeCardFingerprints } from '../utils/CharacterCardFingerprint'
import { RESOURCE_TYPE, type ResourceSummary } from '../types/Resource'
import {
  buildStoredVersionRecognitionReport,
  createVersionMatchEntries,
  createVersionCandidateIndex,
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

it('avoids reading 5000 descriptions during indexing and reuses only the matched candidate text', () => {
  let reads = 0
  const resources = Array.from({ length: 5000 }, (_, index) => {
    const item = summary({
      id: `lazy-${index}`,
      name: `唯一角色 ${index}`,
      metadata: { cardCoreHash: `core-${index}` },
    })
    Object.defineProperty(item, 'description', {
      get: () => {
        reads += 1
        return '需要按需读取的长正文'.repeat(1000)
      },
    })
    return item
  })
  const index = createVersionCandidateIndex(createVersionMatchEntries(resources, []))
  expect(reads).toBe(0)
  const parsed: ParsedResource = {
    type: RESOURCE_TYPE.CHARACTER_CARD,
    name: '唯一角色 4999',
    description: '',
    metadata: { cardCoreHash: 'core-4999' },
  }
  expect(findVersionCandidates(parsed, 'different.json', index)).toHaveLength(1)
  expect(reads).toBe(0)
  parsed.metadata = {}
  expect(
    findVersionCandidates(parsed, 'different.json', index, { sameNameVersionCandidates: true }),
  ).toHaveLength(1)
  expect(reads).toBe(1)
  findVersionCandidates(parsed, 'different.json', index, { sameNameVersionCandidates: true })
  expect(reads).toBe(1)
})

function match(
  parsed: ParsedResource,
  fileName: string,
  resources: ResourceSummary[],
  versions: ResourceSummary[] = [],
) {
  return findVersionCandidates(parsed, fileName, createVersionMatchEntries(resources, versions))
}

describe('ResourceVersionMatcher', () => {
  it('only offers unrelated same-name cards when opted in, with weak evidence and type boundaries', () => {
    const incoming: ParsedResource = {
      type: RESOURCE_TYPE.CHARACTER_CARD,
      name: ' 同名角色 ',
      description: '星际战争',
      metadata: { creator: '另一作者' },
    }
    const existing = summary({
      name: '同名角色',
      description: '古代宫廷',
      fileName: 'unrelated.png',
    })
    const entries = createVersionMatchEntries([existing], [])
    expect(findVersionCandidates(incoming, 'new-file.json', entries)).toEqual([])
    expect(
      findVersionCandidates(incoming, 'new-file.json', entries, {
        sameNameVersionCandidates: true,
      }),
    ).toMatchObject([
      { matchKind: 'sameName', score: 60, reasons: expect.arrayContaining(['作者不同']) },
    ])
    expect(
      findVersionCandidates({ ...incoming, type: RESOURCE_TYPE.PRESET }, 'new-file.json', entries, {
        sameNameVersionCandidates: true,
      }),
    ).toEqual([])
    expect(
      findStoredVersionGroups([existing, { ...existing, id: 'other', contentHash: 'other-file' }]),
    ).toEqual([])
    expect(
      findStoredVersionGroups(
        [existing, { ...existing, id: 'other', contentHash: 'other-file' }],
        [],
        { sameNameVersionCandidates: true },
      ),
    ).toMatchObject([{ matchKind: 'sameName' }])
    expect(
      findStoredVersionGroups(
        [
          { ...existing, name: '' },
          { ...existing, name: '', id: 'empty', contentHash: 'empty-file' },
        ],
        [],
        { sameNameVersionCandidates: true },
      ),
    ).toEqual([])
  })

  it('retains all same-name choices beyond the former top-three cutoff and keeps strong matches first', () => {
    const resources = Array.from({ length: 8 }, (_, index) =>
      summary({
        id: `same-${index}`,
        name: '同名',
        fileName: `unrelated-${index}.png`,
        description: '原版',
        contentHash: `file-${index}`,
        metadata: { cardContentHash: `full-${index}` },
      }),
    )
    const parsed: ParsedResource = {
      type: RESOURCE_TYPE.CHARACTER_CARD,
      name: '同名',
      description: '不同内容',
      metadata: { cardContentHash: 'full-7' },
    }
    const candidates = findVersionCandidates(
      parsed,
      'different.png',
      createVersionMatchEntries(resources, []),
      { sameNameVersionCandidates: true },
    )
    expect(candidates).toHaveLength(8)
    expect(candidates[0]).toMatchObject({
      resource: { id: 'same-7' },
      matchKind: 'containerVariant',
      score: 100,
    })
    expect(candidates.slice(1).every((item) => item.matchKind === 'sameName')).toBe(true)
  })

  it('uses a narrow prepared index and admits newly imported resources without rebuilding the library', () => {
    const resources = Array.from({ length: 2501 }, (_, index) =>
      summary({ id: `resource-${index}`, name: `唯一角色 ${index}`, contentHash: `file-${index}` }),
    )
    const index = createVersionCandidateIndex(createVersionMatchEntries(resources, []))
    const parsed: ParsedResource = {
      type: RESOURCE_TYPE.CHARACTER_CARD,
      name: '唯一角色 2400',
      description: '',
      metadata: {},
    }
    expect(index.select(parsed)).toHaveLength(1)
    expect(
      findVersionCandidates(parsed, 'different.json', index, { sameNameVersionCandidates: true })[0]
        ?.resource.id,
    ).toBe('resource-2400')
    const added = summary({ id: 'new', name: '刚导入' })
    index.add({ resource: added, groupResource: added, historical: false })
    expect(
      findVersionCandidates({ ...parsed, name: '刚导入' }, 'different.json', index, {
        sameNameVersionCandidates: true,
      })[0]?.resource.id,
    ).toBe('new')
    expect(index.select({ ...parsed, name: '不存在' })).toEqual([])
  })
  it('groups stored greeting revisions as versions while keeping them out of duplicate cleanup', async () => {
    const makeCard = async (id: string, greetings: string[]) => {
      const metadata = {
        card: {
          data: {
            name: '夜航船',
            description: '航海者的相同设定',
            first_mes: '你好',
            alternate_greetings: greetings,
          },
        },
      }
      const fingerprints = await computeCardFingerprints(metadata)
      return summary({
        id,
        contentHash: id,
        fileName: `${id}.json`,
        mimeType: 'application/json',
        metadata: {
          ...metadata,
          cardContentHash: fingerprints!.full,
          cardCoreHash: fingerprints!.core,
        },
      })
    }
    const first = await makeCard('first', ['旧开场'])
    const revised = await makeCard('revised', ['旧开场', '新增开场'])
    expect(findStoredVersionGroups([first, revised])).toMatchObject([
      { matchKind: 'version', resources: expect.arrayContaining([first, revised]) },
    ])
    expect(
      findHistoricalDuplicateGroups([first], [{ ...revised, versionGroupId: first.id }]),
    ).toEqual([])
  })
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
    expect(candidates[0]?.reasons).toContain('核心设定一致，其他卡内字段不同')
  })

  it('用卡数据直接确认内容一致，哈希不一致不阻止封装匹配', () => {
    const card = {
      data: {
        name: 'CTE',
        description: '相同设定',
        character_book: { entries: [{ uid: 1, comment: '甲', content: '条目' }] },
      },
    }
    const parsed = {
      type: RESOURCE_TYPE.CHARACTER_CARD,
      name: 'CTE',
      description: '',
      metadata: {
        cardContentHash: 'new-hash',
        cardCoreHash: 'new-core',
        card: {
          ...card,
          data: {
            ...card.data,
            character_book: { entries: [{ id: 88, comment: '甲', content: '条目' }] },
          },
        },
      },
    } as unknown as ParsedResource
    const existing = {
      id: 'r1',
      type: RESOURCE_TYPE.CHARACTER_CARD,
      name: 'CTE',
      description: '',
      fileName: 'CTE.png',
      mimeType: 'image/png',
      metadata: { cardContentHash: 'old-hash', cardCoreHash: 'old-core', card },
      updatedAt: 1,
    } as unknown as ResourceSummary

    const candidate = findVersionCandidates(parsed, 'CTE.json', [
      { resource: existing, groupResource: existing, historical: false },
    ])[0]

    expect(candidate?.matchKind).toBe('containerVariant')
    expect(candidate?.score).toBe(100)
  })

  it('相同哈希不能替代卡数据比较而把不同内容判为封装变体', () => {
    const parsed = {
      type: RESOURCE_TYPE.CHARACTER_CARD,
      name: 'CTE',
      description: '',
      metadata: {
        cardContentHash: 'stale-hash',
        cardCoreHash: 'stale-core',
        card: { data: { name: 'CTE', description: '同一核心', first_mes: '新版开场白' } },
      },
    } as unknown as ParsedResource
    const existing = {
      id: 'r1',
      type: RESOURCE_TYPE.CHARACTER_CARD,
      name: 'CTE',
      description: '',
      fileName: 'CTE.png',
      mimeType: 'image/png',
      metadata: {
        cardContentHash: 'stale-hash',
        cardCoreHash: 'stale-core',
        card: { data: { name: 'CTE', description: '同一核心', first_mes: '旧版开场白' } },
      },
      updatedAt: 1,
    } as unknown as ResourceSummary

    const candidate = findVersionCandidates(parsed, 'CTE.json', [
      { resource: existing, groupResource: existing, historical: false },
    ])[0]

    expect(candidate?.matchKind).toBe('version')
    expect(candidate?.score).toBe(90)
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

  it('当前版本与历史版本仅核心设定相同时优先当前版本，避免误报旧版本命中', () => {
    const parsed = {
      type: RESOURCE_TYPE.CHARACTER_CARD,
      name: '同一角色',
      description: '',
      metadata: { cardContentHash: 'incoming-full', cardCoreHash: 'same-core' },
    } as unknown as ParsedResource
    const active = summary({
      id: 'group-current',
      fileName: 'card-v7.4.png',
      metadata: { cardContentHash: 'current-full', cardCoreHash: 'same-core' },
    })
    const historical = summary({
      id: 'history-v7.0',
      versionGroupId: active.id,
      versionLabel: 'V7.0',
      fileName: 'card-v7.0.png',
      metadata: { cardContentHash: 'history-full', cardCoreHash: 'same-core' },
    })

    const candidates = match(parsed, 'card-v7.4.json', [active], [historical])

    expect(candidates).toHaveLength(1)
    expect(candidates[0]).toMatchObject({
      resource: { id: active.id },
      matchedResource: { id: active.id, fileName: 'card-v7.4.png' },
      matchedHistorical: false,
      matchKind: 'version',
      score: 90,
    })
  })
})

it('内容相似度同分时当前版本优先于匹配类型更强的历史版本', () => {
  const parsed = {
    type: RESOURCE_TYPE.CHARACTER_CARD,
    name: '同一角色',
    description: '',
    metadata: { cardContentHash: 'same-full', cardCoreHash: 'same-core' },
  } as unknown as ParsedResource
  const active = summary({
    id: 'group-current',
    fileName: 'card-v7.4.json',
    mimeType: 'application/json',
    contentHash: 'current-file',
    metadata: {
      cardContentHash: 'same-full',
      cardCoreHash: 'different-core',
    },
  })
  const historical = summary({
    id: 'history-exact',
    versionGroupId: active.id,
    versionLabel: 'V7.0',
    fileName: 'card-v7.0.json',
    mimeType: 'application/json',
    contentHash: 'history-file',
    metadata: { cardContentHash: 'same-full', cardCoreHash: 'same-core' },
  })

  const [candidate] = match(parsed, 'copy.json', [active], [historical])

  expect(candidate).toMatchObject({
    matchedResource: { id: active.id },
    matchedHistorical: false,
    score: 100,
  })
})

it('角色卡稳定来源 ID 不覆盖更高的卡内容相似度', () => {
  const parsed = {
    type: RESOURCE_TYPE.CHARACTER_CARD,
    name: '角色',
    description: '',
    metadata: { cardContentHash: 'incoming-full', cardCoreHash: 'shared-core', uuid: 'same-id' },
  } as unknown as ParsedResource
  const stableIdOnly = summary({
    id: 'stable-id-only',
    metadata: { cardContentHash: 'other-full', cardCoreHash: 'other-core', uuid: 'same-id' },
  })
  const sameCore = summary({
    id: 'same-core',
    metadata: { cardContentHash: 'different-full', cardCoreHash: 'shared-core' },
  })

  const candidates = match(parsed, 'incoming.json', [stableIdOnly, sameCore])

  expect(candidates[0]).toMatchObject({ resource: { id: 'same-core' }, score: 90 })
  expect(candidates.find((candidate) => candidate.resource.id === 'stable-id-only')?.score).toBe(85)
})

describe('已导入资源批量版本重识别', () => {
  it('旧哈希与完整指纹交叉重叠时，仍能通过不同哈希的第四项连全强版本组', () => {
    const resources = ['a', 'b', 'c', 'd'].map((id, index) =>
      summary({
        id,
        fileName: `${id}.json`,
        mimeType: 'application/json',
        contentHash: index < 3 ? 'old-shared-hash' : 'different-file',
        metadata: { cardContentHash: `full-${id}`, cardCoreHash: 'same-core' },
        updatedAt: index + 1,
      }),
    )
    for (const sameNameVersionCandidates of [false, true]) {
      const groups = findStoredVersionGroups(resources, [], { sameNameVersionCandidates })
      expect(groups).toHaveLength(1)
      expect(groups[0]).toMatchObject({ matchKind: 'version', recommendedKeeperId: 'd' })
      expect(groups[0]!.resources.map((entry) => entry.id)).toEqual(['d', 'c'])
    }
  })

  it('万项共享核心指纹保持一个候选组与最新保留项', () => {
    const resources = Array.from({ length: 10000 }, (_, index) =>
      summary({
        id: `scale-${index}`,
        contentHash: `file-${index}`,
        metadata: { cardContentHash: `full-${index}`, cardCoreHash: 'shared-core' },
        updatedAt: index,
      }),
    )
    const groups = findStoredVersionGroups(resources)
    expect(groups).toHaveLength(1)
    expect(groups[0]!.resources).toHaveLength(10000)
    expect(groups[0]!.recommendedKeeperId).toBe('scale-9999')
  })
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
