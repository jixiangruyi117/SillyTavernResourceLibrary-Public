import { describe, expect, it, vi } from 'vitest'
import { autoBindIncomingCard, autoBindPostToRecentCard } from './DiscordInboxAutoBinding'
import type { ResourceListSummary } from '../types/Resource'

const card = (overrides: Partial<ResourceListSummary> = {}) =>
  ({
    id: 'card-1',
    type: 'characterCard',
    name: '阿青',
    fileName: 'qing.png',
    metadata: { creator: '作者乙' },
    ...overrides,
  }) as ResourceListSummary

const source = (overrides: Record<string, unknown> = {}) => ({
  id: 'source-1',
  title: '阿青的故事',
  autoBindPendingPng: false,
  ...overrides,
})

function fixture(
  sources: Array<{ source: Record<string, unknown>; starter?: Record<string, unknown> }>,
) {
  const communitySources = {
    listUnboundForAutomation: vi.fn(async () => sources),
    bindSource: vi.fn(async () => undefined),
    updateAutomationPendingPng: vi.fn(async () => undefined),
  }
  return { communitySources, sources }
}

describe('Discord cloud inbox automatic binding', () => {
  it('checks only the bounded recent cards when an automatic post arrives', async () => {
    const { communitySources } = fixture([])
    const resources = { listRecentCharacterCards: vi.fn(async () => [card()]) }
    const result = await autoBindPostToRecentCard(
      communitySources as never,
      resources,
      { id: 'post-1', title: '阿青的新故事' },
      '作者：作者乙',
      { bindSameName: true, bindSameAuthor: true, bindNextPng: true, preferPngContainer: false },
    )
    expect(resources.listRecentCharacterCards).toHaveBeenCalledWith(10)
    expect(result).toEqual({ resourceId: 'card-1', rule: 'same-name' })
    expect(communitySources.bindSource).toHaveBeenCalledWith(
      'card-1',
      'post-1',
      '自动关联：同名 · 阿青',
      'same-name',
    )
  })

  it('uses same-name before author and compares at most the five newest unbound posts', async () => {
    const { communitySources, sources } = fixture([
      { source: source(), starter: { kind: 'starter', content: '作者：作者乙' } },
    ])
    const result = await autoBindIncomingCard(communitySources as never, card(), {
      bindSameName: true,
      bindSameAuthor: true,
      bindNextPng: true,
      preferPngContainer: false,
    })
    expect(communitySources.listUnboundForAutomation).toHaveBeenCalledWith(5)
    expect(result?.rule).toBe('same-name')
    expect(communitySources.bindSource).toHaveBeenCalledWith(
      'card-1',
      'source-1',
      '自动关联：同名 · 阿青',
      'same-name',
    )
    expect(sources).toHaveLength(1)
  })

  it('matches the labeled creator only, ignores non-card resources, and consumes next PNG FIFO', async () => {
    const { communitySources } = fixture([
      {
        source: source({ id: 'new', autoBindPendingPng: true }),
        starter: { kind: 'starter', content: '作者：作者乙' },
      },
      {
        source: source({ id: 'old', autoBindPendingPng: true }),
        starter: { kind: 'starter', content: '作者：其他人' },
      },
    ])
    const settings = {
      bindSameName: false,
      bindSameAuthor: true,
      bindNextPng: true,
      preferPngContainer: false,
    }
    await autoBindIncomingCard(communitySources as never, card({ type: 'worldBook' }), settings)
    expect(communitySources.bindSource).not.toHaveBeenCalled()
    const pngResult = await autoBindIncomingCard(communitySources as never, card(), settings)
    expect(pngResult?.rule).toBe('same-author')
    expect(communitySources.bindSource).toHaveBeenCalledWith(
      'card-1',
      'new',
      '自动关联：同作者 · 阿青',
      'same-author',
    )
    communitySources.bindSource.mockClear()
    const fifo = await autoBindIncomingCard(
      communitySources as never,
      card({ metadata: { creator: '' } }),
      { bindSameName: false, bindSameAuthor: false, bindNextPng: true, preferPngContainer: false },
    )
    expect(fifo?.sourceId).toBe('old')
    expect(communitySources.updateAutomationPendingPng).toHaveBeenCalledWith('old', false)
  })

  it('does not auto-bind an ambiguous name match and keeps JSON away from the next-PNG rule', async () => {
    const { communitySources } = fixture([
      { source: source({ id: 'one' }), starter: { kind: 'starter', content: '阿青在此' } },
      { source: source({ id: 'two' }), starter: { kind: 'starter', content: '阿青又出现' } },
    ])
    const result = await autoBindIncomingCard(
      communitySources as never,
      card({ fileName: 'qing.json' }),
      { bindSameName: true, bindSameAuthor: false, bindNextPng: true, preferPngContainer: false },
    )
    expect(result).toBeUndefined()
    expect(communitySources.bindSource).not.toHaveBeenCalled()
  })

  it('does not fall through to a lower-priority rule when the higher-priority match is ambiguous', async () => {
    const { communitySources } = fixture([
      { source: source({ id: 'newer', title: '阿青' }), starter: { content: '作者：作者乙' } },
      { source: source({ id: 'older', title: '阿青' }), starter: { content: '作者：作者乙' } },
    ])
    const result = await autoBindIncomingCard(communitySources as never, card(), {
      bindSameName: true,
      bindSameAuthor: true,
      bindNextPng: true,
      preferPngContainer: false,
    })
    expect(result).toBeUndefined()
    expect(communitySources.bindSource).not.toHaveBeenCalled()
  })
})
