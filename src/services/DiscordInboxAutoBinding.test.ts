import { describe, expect, it, vi } from 'vitest'
const notices = vi.hoisted(() => ({ push: vi.fn() }))
const systemNotice = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
vi.mock('./NativeDiscordInboxService', () => ({ notifyNativeDiscordAutoBinding: systemNotice }))
vi.mock('../core/NoticeCenter', () => ({ noticeCenter: notices }))
import {
  autoBindIncomingCardBatch,
  autoBindPendingPostsToRecentCards,
  autoBindPostToRecentCard,
  beginIncomingCardBindingBatch,
  flushDeferredPostBindings,
  markPostForNextPng,
} from './DiscordInboxAutoBinding'
import type { CommunitySource } from '../types/CommunitySource'
import type { ResourceListSummary } from '../types/Resource'

const card = (id: string, name: string, creator = '作者乙', fileName = `${id}.png`) =>
  ({
    id,
    type: 'characterCard',
    name,
    fileName,
    createdAt: 100,
    metadata: { creator },
  }) as unknown as ResourceListSummary

const post = (id = 'post-1', overrides: Partial<CommunitySource> = {}) =>
  ({
    id,
    title: '阿青的故事',
    createdAt: Number(id.replace(/\D/gu, '')) || 1,
    updatedAt: Number(id.replace(/\D/gu, '')) || 1,
    ...overrides,
  }) as CommunitySource

const starter = (content: string) => ({ content }) as never

function fixture(posts: Array<{ source: CommunitySource; starter?: { content: string } }> = []) {
  const bindings: Array<{ resourceId: string; sourceId: string; rule?: string }> = []
  const communitySources = {
    listUnboundResources: vi.fn(async (resources: readonly ResourceListSummary[]) =>
      resources.filter(
        (resource) => !bindings.some((binding) => binding.resourceId === resource.id),
      ),
    ),
    listUnboundForAutomation: vi.fn(async (_limit?: number, includeUntracked = false) =>
      posts.filter(
        ({ source }) =>
          !bindings.some((b) => b.sourceId === source.id) &&
          (includeUntracked || source.autoBindScan || source.autoBindPendingPng),
      ),
    ),
    bindSource: vi.fn(
      async (resourceId: string, sourceId: string, _note?: string, rule?: string) => {
        bindings.push({ resourceId, sourceId, rule })
        const source = posts.find((item) => item.source.id === sourceId)?.source
        if (source && rule) {
          delete source.autoBindScan
          delete source.autoBindPendingPng
        }
      },
    ),
    updateAutomationPendingPng: vi.fn(async (sourceId: string, pending: boolean) => {
      const source = posts.find(({ source }) => source.id === sourceId)?.source
      if (source) {
        if (pending) source.autoBindPendingPng = true
        else delete source.autoBindPendingPng
      }
    }),
    updateAutoBindScan: vi.fn(async (sourceId: string, state: CommunitySource['autoBindScan']) => {
      const source = posts.find(({ source }) => source.id === sourceId)?.source
      if (source) {
        if (state) source.autoBindScan = structuredClone(state)
        else delete source.autoBindScan
      }
    }),
    getSourceForAutomation: vi.fn(
      async (sourceId: string) => posts.find(({ source }) => source.id === sourceId)?.source,
    ),
    getSourceUsage: vi.fn(async (sourceId: string) =>
      bindings.filter((item) => item.sourceId === sourceId),
    ),
  }
  return { communitySources, posts, bindings }
}

const settings = (
  overrides: Partial<{
    bindSameName: boolean
    bindSameAuthor: boolean
    bindNextPng: boolean
    bindForeground: boolean
    preferPngContainer: boolean
  }> = {},
) => ({
  bindSameName: false,
  bindSameAuthor: false,
  bindNextPng: false,
  bindForeground: false,
  preferPngContainer: false,
  ...overrides,
})

describe('Discord cloud inbox automatic binding', () => {
  it('matches a newly activated version of an older unscanned card and counts its resource ID only once', async () => {
    const source = post('version-post', {
      createdAt: 150,
      title: '一篇故事',
      autoBindScan: {
        version: 1,
        status: 'scanning',
        scannedResourceIds: [],
        futureResourceIds: [],
      },
    })
    const { communitySources, bindings } = fixture([{ source, starter: starter('这里提到了封越') }])
    const incoming = { ...card('old-card', '封越'), createdAt: 10, versionImportedAt: 200 }
    const automation = settings({ bindSameName: true })
    await autoBindIncomingCardBatch(communitySources as never, [incoming, incoming], automation)
    expect(bindings).toEqual([
      { sourceId: 'version-post', resourceId: 'old-card', rule: 'same-name' },
    ])
    await autoBindIncomingCardBatch(communitySources as never, [incoming], automation)
    expect(bindings).toHaveLength(1)
  })
  it('does not treat a metadata edit as a newly imported version or rescan an already counted card', async () => {
    for (const scanned of [false, true]) {
      const source = post('post', {
        createdAt: 150,
        autoBindScan: {
          version: 1,
          status: 'scanning',
          scannedResourceIds: scanned ? ['old-card'] : [],
          futureResourceIds: scanned ? ['old-card'] : [],
        },
      })
      const { communitySources, bindings } = fixture([
        { source, starter: starter('这里提到了封越') },
      ])
      const incoming = {
        ...card('old-card', '封越'),
        createdAt: 10,
        versionImportedAt: scanned ? 200 : 10,
        updatedAt: 200,
      }
      await autoBindIncomingCardBatch(
        communitySources as never,
        [incoming],
        settings({ bindSameName: true }),
      )
      expect(bindings).toEqual([])
      expect(source.autoBindScan?.futureResourceIds).toEqual(scanned ? ['old-card'] : [])
    }
  })
  it('continues from A to B and considers only the unbound same-author card in the last five', async () => {
    systemNotice.mockClear()
    const sources = [
      post('post-1', { title: '青龙的故事' }),
      post('post-2', { title: '另一篇故事' }),
    ]
    const { communitySources, bindings } = fixture(sources.map((source) => ({ source })))
    const recent = {
      listRecentCharacterCards: vi.fn(async () => [card('a', '青龙'), card('b', '白虎')]),
    }
    const automation = settings({ bindSameName: true, bindSameAuthor: true, bindForeground: true })
    await autoBindPostToRecentCard(
      communitySources as never,
      recent,
      sources[0]!,
      '作者：作者乙',
      automation,
    )
    await autoBindPostToRecentCard(
      communitySources as never,
      recent,
      sources[1]!,
      '作者：作者乙',
      automation,
    )
    expect(bindings.map((binding) => [binding.sourceId, binding.resourceId])).toEqual([
      ['post-1', 'a'],
      ['post-2', 'b'],
    ])
    expect(systemNotice.mock.calls).toEqual([
      ['青龙的故事', '青龙', { sourceId: 'post-1', resourceId: 'a' }],
      ['另一篇故事', '白虎', { sourceId: 'post-2', resourceId: 'b' }],
    ])
    expect(sources[1]!.autoBindScan).toBeUndefined()
  })

  it('excludes resources claimed by earlier posts while completing the same queue batch', async () => {
    const sources = [
      post('post-1', {
        title: '青龙的故事',
        autoBindScan: {
          version: 1,
          status: 'scanning',
          scannedResourceIds: [],
          futureResourceIds: [],
        },
      }),
      post('post-2', {
        title: '另一篇故事',
        autoBindScan: {
          version: 1,
          status: 'scanning',
          scannedResourceIds: [],
          futureResourceIds: [],
        },
      }),
    ]
    const { communitySources, bindings } = fixture(
      sources.map((source) => ({ source, starter: starter('作者：作者乙') })),
    )
    await autoBindIncomingCardBatch(
      communitySources as never,
      [card('a', '青龙'), card('b', '白虎')],
      settings({ bindSameName: true, bindSameAuthor: true }),
    )
    expect(bindings.map((binding) => [binding.sourceId, binding.resourceId])).toEqual([
      ['post-1', 'a'],
      ['post-2', 'b'],
    ])
  })
  it('binds both uniquely matched posts in one cohort and publishes both results before review', async () => {
    systemNotice.mockClear()
    const sources = [
      post('post-1', {
        title: '青龙的故事',
        autoBindScan: {
          version: 1,
          status: 'scanning',
          scannedResourceIds: [],
          futureResourceIds: [],
        },
      }),
      post('post-2', {
        title: '白虎的故事',
        autoBindScan: {
          version: 1,
          status: 'scanning',
          scannedResourceIds: [],
          futureResourceIds: [],
        },
      }),
    ]
    const { communitySources, bindings } = fixture(sources.map((source) => ({ source })))
    const result = await autoBindIncomingCardBatch(
      communitySources as never,
      [card('a', '青龙'), card('b', '白虎')],
      settings({ bindSameName: true, bindSameAuthor: true }),
    )
    expect(result.map((item) => item.sourceId)).toEqual(['post-1', 'post-2'])
    expect(bindings).toHaveLength(2)
    expect(sources.every((source) => source.autoBindScan === undefined)).toBe(true)
    expect(systemNotice.mock.calls).toEqual([
      ['青龙的故事', '青龙', { sourceId: 'post-1', resourceId: 'a' }],
      ['白虎的故事', '白虎', { sourceId: 'post-2', resourceId: 'b' }],
    ])
  })
  it('defers a post saved during import until both same-author cards can be reviewed together', async () => {
    const source = post('post-1', { title: '帖子' })
    const { communitySources, bindings } = fixture([{ source }])
    const resourceService = {
      listRecentCharacterCards: vi.fn().mockResolvedValue([card('a', '青龙')]),
    }
    const automation = settings({ bindSameAuthor: true })
    const finish = beginIncomingCardBindingBatch()
    try {
      await autoBindPostToRecentCard(
        communitySources as never,
        resourceService,
        source,
        '作者：作者乙',
        automation,
      )
      expect(resourceService.listRecentCharacterCards).not.toHaveBeenCalled()
      expect(bindings).toHaveLength(0)
      resourceService.listRecentCharacterCards.mockResolvedValue([
        card('a', '青龙'),
        card('b', '白虎'),
      ])
      finish()
      await flushDeferredPostBindings(communitySources as never, resourceService, automation)
      expect(bindings).toHaveLength(0)
      expect(source.autoBindScan?.status).toBe('review')
      expect(
        source.autoBindScan?.reviewCandidates?.map((candidate) => candidate.resourceId),
      ).toEqual(['a', 'b'])
    } finally {
      finish(true)
    }
  })
  it('scans only the five newest logical cards when a post arrives and prioritizes names', async () => {
    const source = post()
    const { communitySources, posts, bindings } = fixture([
      { source, starter: starter('作者：作者乙') },
    ])
    const recent = [card('card-1', '阿青'), card('card-2', '其他')]
    const resourceService = { listRecentCharacterCards: vi.fn(async () => recent) }
    const result = await autoBindPostToRecentCard(
      communitySources as never,
      resourceService,
      source,
      '作者：作者乙',
      settings({ bindSameName: true, bindSameAuthor: true }),
    )
    expect(resourceService.listRecentCharacterCards).toHaveBeenCalledWith(5)
    expect(result).toEqual({ resourceId: 'card-1', rule: 'same-name' })
    expect(notices.push).toHaveBeenCalledWith({
      id: 'discord-auto-binding:post-1:card-1',
      type: 'success',
      persistent: true,
      message: '帖子“阿青的故事”已绑定角色卡“阿青”',
    })
    expect(bindings).toEqual([{ resourceId: 'card-1', sourceId: 'post-1', rule: 'same-name' }])
    expect(systemNotice).toHaveBeenCalledWith('阿青的故事', '阿青', {
      sourceId: 'post-1',
      resourceId: 'card-1',
    })
    expect(posts[0]?.source.autoBindScan).toBeUndefined()
  })

  it('persists ambiguous name candidates and never falls through to author matching', async () => {
    const source = post()
    const { communitySources } = fixture([{ source, starter: starter('作者：作者乙，阿青在此') }])
    await autoBindPostToRecentCard(
      communitySources as never,
      { listRecentCharacterCards: async () => [card('one', '阿青'), card('two', '阿青')] },
      source,
      '作者：作者乙，阿青在此',
      settings({ bindSameName: true, bindSameAuthor: true }),
    )
    expect(source.autoBindScan?.status).toBe('review')
    expect(
      source.autoBindScan?.reviewCandidates?.map(({ resourceId, rule }) => [resourceId, rule]),
    ).toEqual([
      ['one', 'same-name'],
      ['two', 'same-name'],
    ])
    expect(communitySources.bindSource).not.toHaveBeenCalled()
    await markPostForNextPng(communitySources as never, source.id, true)
    expect(source.autoBindPendingPng).toBeUndefined()
  })

  it('normalizes a leading dc prefix for the labeled author rule', async () => {
    const source = post()
    const { communitySources, bindings } = fixture([{ source, starter: starter('作者：老鼠药') }])
    const result = await autoBindPostToRecentCard(
      communitySources as never,
      { listRecentCharacterCards: async () => [card('rat', '小鼠', 'dc 老鼠药')] },
      source,
      '作者：老鼠药',
      settings({ bindSameAuthor: true }),
    )
    expect(result).toEqual({ resourceId: 'rat', rule: 'same-author' })
    expect(bindings[0]?.rule).toBe('same-author')
  })

  it('backfills an untracked post against the five most recent cards when a rule is enabled late', async () => {
    const source = post('post-10', { title: '阿青的故事', createdAt: 10 })
    const { communitySources, bindings } = fixture([
      { source, starter: starter('首楼没有作者字段') },
    ])
    const cards = [card('card-1', '阿青'), card('card-2', '其它')]
    const resourceService = { listRecentCharacterCards: vi.fn(async () => cards) }

    const result = await autoBindPendingPostsToRecentCards(
      communitySources as never,
      resourceService,
      settings({ bindSameName: true }),
    )

    expect(resourceService.listRecentCharacterCards).toHaveBeenCalledWith(5)
    expect(communitySources.listUnboundForAutomation).toHaveBeenCalledWith(100, true)
    expect(result).toEqual([{ sourceId: 'post-10', resourceId: 'card-1', rule: 'same-name' }])
    expect(notices.push).toHaveBeenCalledWith(
      expect.objectContaining({
        message: '帖子“阿青的故事”已绑定角色卡“阿青”',
      }),
    )
    expect(bindings).toEqual([{ resourceId: 'card-1', sourceId: 'post-10', rule: 'same-name' }])
  })

  it('queues ambiguous late-enabled matches for review and records the five cards after no match', async () => {
    const ambiguous = post('post-1', { title: '无卡名命中' })
    const unmatched = post('post-2', { title: '也无命中' })
    const { communitySources, posts, bindings } = fixture([
      { source: ambiguous, starter: starter('作者：作者乙') },
      { source: unmatched, starter: starter('没有作者字段') },
    ])
    const recent = [card('one', '甲'), card('two', '乙')]

    await autoBindPendingPostsToRecentCards(
      communitySources as never,
      { listRecentCharacterCards: async () => recent },
      settings({ bindSameAuthor: true }),
    )

    expect(ambiguous.autoBindScan?.status).toBe('review')
    expect(
      ambiguous.autoBindScan?.reviewCandidates?.map((candidate) => candidate.resourceId),
    ).toEqual(['one', 'two'])
    expect(unmatched.autoBindScan).toEqual({
      version: 1,
      status: 'scanning',
      scannedResourceIds: ['one', 'two'],
      futureResourceIds: [],
    })
    expect(bindings).toHaveLength(0)
    await autoBindIncomingCardBatch(
      communitySources as never,
      [card('next', '新资源')],
      settings({ bindSameAuthor: true }),
    )
    expect(posts[1]?.source.autoBindScan?.futureResourceIds).toEqual(['next'])
  })

  it('matches all distinct resources in a completed batch before deciding author ambiguity', async () => {
    const source = post()
    const { communitySources, bindings } = fixture([
      {
        source: {
          ...source,
          autoBindScan: {
            version: 1,
            status: 'scanning',
            scannedResourceIds: [],
            futureResourceIds: [],
          },
        },
        starter: starter('作者：作者乙'),
      },
    ])
    const result = await autoBindIncomingCardBatch(
      communitySources as never,
      [card('a', '青龙'), card('b', '白虎'), card('b', '白虎 PNG alias')],
      settings({ bindSameName: true, bindSameAuthor: true }),
    )
    expect(result).toHaveLength(0)
    const current = (await communitySources.listUnboundForAutomation())[0]?.source
    expect(current?.autoBindScan?.status).toBe('review')
    expect(
      current?.autoBindScan?.reviewCandidates?.map(({ resourceId, rule }) => [resourceId, rule]),
    ).toEqual([
      ['a', 'same-author'],
      ['b', 'same-author'],
    ])
    expect(bindings).toHaveLength(0)
  })

  it('remembers scan progress across batches, ignores duplicate IDs, and stops after five new resources', async () => {
    const source = post()
    source.autoBindScan = {
      version: 1,
      status: 'scanning',
      scannedResourceIds: ['old-1', 'old-2', 'old-3', 'old-4', 'old-5'],
      futureResourceIds: [],
    }
    const { communitySources, bindings } = fixture([{ source, starter: starter('作者：无人') }])
    await autoBindIncomingCardBatch(
      communitySources as never,
      [card('b', '甲'), card('c', '乙')],
      settings({ bindSameName: true, bindSameAuthor: true }),
    )
    expect(source.autoBindScan?.futureResourceIds).toEqual(['b', 'c'])
    await autoBindIncomingCardBatch(
      communitySources as never,
      [card('c', '乙'), card('d', '丙'), card('e', '丁'), card('f', '戊')],
      settings({ bindSameName: true, bindSameAuthor: true }),
    )
    expect(source.autoBindScan?.status).toBe('exhausted')
    expect(source.autoBindScan?.futureResourceIds).toEqual(['b', 'c', 'd', 'e', 'f'])
    await autoBindIncomingCardBatch(
      communitySources as never,
      [card('g', '阿青')],
      settings({ bindSameName: true }),
    )
    expect(bindings).toHaveLength(0)
  })

  it('does not retroactively match resources imported before a post was saved', async () => {
    const source = post('post-10', {
      createdAt: 10,
      autoBindScan: {
        version: 1,
        status: 'scanning',
        scannedResourceIds: [],
        futureResourceIds: [],
      },
    })
    const { communitySources, bindings } = fixture([{ source, starter: starter('作者：作者乙') }])
    await autoBindIncomingCardBatch(
      communitySources as never,
      [
        { ...card('before', '阿青', '作者乙'), createdAt: 9 },
        { ...card('after', '其他', '其他'), createdAt: 11 },
      ],
      settings({ bindSameName: true, bindSameAuthor: true }),
    )
    expect(bindings).toHaveLength(0)
    expect(source.autoBindScan?.futureResourceIds).toEqual(['after'])
  })

  it('does not consume an older PNG for a post waiting for its next PNG', async () => {
    const source = post('post-10', {
      createdAt: 10,
      autoBindPendingPng: true,
      autoBindScan: {
        version: 1,
        status: 'exhausted',
        scannedResourceIds: [],
        futureResourceIds: [],
      },
    })
    const { communitySources, bindings } = fixture([{ source, starter: starter('无匹配内容') }])
    const result = await autoBindIncomingCardBatch(
      communitySources as never,
      [
        { ...card('old-png', '旧卡', '', 'old.png'), createdAt: 9 },
        { ...card('new-png', '新卡', '', 'new.png'), createdAt: 11 },
      ],
      settings({ bindNextPng: true }),
    )
    expect(result).toEqual([{ sourceId: 'post-10', resourceId: 'new-png', rule: 'next-png' }])
    expect(bindings[0]?.resourceId).toBe('new-png')
  })

  it('applies next-PNG only after name and author checks and consumes the first future PNG once', async () => {
    const source = post('post-1', {
      autoBindPendingPng: true,
      autoBindScan: {
        version: 1,
        status: 'scanning',
        scannedResourceIds: ['before'],
        futureResourceIds: [],
      },
    })
    const { communitySources, bindings } = fixture([{ source, starter: starter('作者：作者乙') }])
    const result = await autoBindIncomingCardBatch(
      communitySources as never,
      [
        card('json', '另一张', '作者乙', 'another.json'),
        card('png-1', '第一张', '其他', 'one.png'),
        card('png-2', '第二张', '其他', 'two.png'),
      ],
      settings({ bindSameAuthor: true, bindNextPng: true }),
    )
    expect(result).toEqual([{ sourceId: 'post-1', resourceId: 'json', rule: 'same-author' }])
    expect(bindings[0]?.resourceId).toBe('json')
    expect(source.autoBindPendingPng).toBeUndefined()

    const next = post('post-2', {
      autoBindPendingPng: true,
      autoBindScan: {
        version: 1,
        status: 'exhausted',
        scannedResourceIds: [],
        futureResourceIds: [],
      },
    })
    const second = fixture([{ source: next, starter: starter('无匹配内容') }])
    const pngResult = await autoBindIncomingCardBatch(
      second.communitySources as never,
      [card('first-png', '卡一', '', 'one.png'), card('second-png', '卡二', '', 'two.png')],
      settings({ bindNextPng: true }),
    )
    expect(pngResult).toEqual([{ sourceId: 'post-2', resourceId: 'first-png', rule: 'next-png' }])
    expect(next.autoBindPendingPng).toBeUndefined()
  })

  it('assigns next PNGs in arrival order to the oldest pending posts without reusing a PNG', async () => {
    const oldest = post('post-1', { autoBindPendingPng: true })
    const newer = post('post-2', { createdAt: 2, autoBindPendingPng: true })
    const { communitySources, bindings } = fixture([
      { source: newer, starter: starter('没有匹配内容') },
      { source: oldest, starter: starter('没有匹配内容') },
    ])
    const result = await autoBindIncomingCardBatch(
      communitySources as never,
      [card('png-1', '卡一', '', 'one.png'), card('png-2', '卡二', '', 'two.png')],
      settings({ bindNextPng: true }),
    )
    expect(result.map(({ sourceId, resourceId }) => [sourceId, resourceId])).toEqual([
      ['post-1', 'png-1'],
      ['post-2', 'png-2'],
    ])
    expect(bindings).toHaveLength(2)
  })
})
