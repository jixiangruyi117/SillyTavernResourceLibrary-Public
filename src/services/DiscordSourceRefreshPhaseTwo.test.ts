import { describe, expect, it } from 'vitest'

import { selectDiscordSavedMessageHealthCheckIds } from './DiscordSourceRefreshService'
import {
  COMMUNITY_SOURCE_MESSAGE_KIND,
  COMMUNITY_SOURCE_PLATFORM,
  type CommunitySourceMessage,
  type ResourceCommunitySourceView,
} from '../types/CommunitySource'

function savedMessage(index: number): CommunitySourceMessage {
  const messageId = String(60000 + index)
  return {
    id: `source:message:${messageId}`,
    sourceId: 'source',
    messageKeyHash: `hash-${messageId}`,
    messageId,
    kind: COMMUNITY_SOURCE_MESSAGE_KIND.SELECTED_COMMENT,
    authorId: '70000',
    authorName: 'Reader',
    content: `saved-${index}`,
    embeds: [],
    attachments: [],
    canonicalUrl: `https://discord.com/channels/11111/22222/${messageId}`,
    timestamp: '2026-08-28T00:00:00.000Z',
    capturedAt: index + 1,
    updatedAt: index + 1,
  }
}

function view(): ResourceCommunitySourceView {
  return {
    source: {
      id: 'source',
      platform: COMMUNITY_SOURCE_PLATFORM.DISCORD,
      sourceKeyHash: 'source-key',
      guildId: '11111',
      channelId: '22222',
      threadId: '22222',
      starterMessageId: '22222',
      canonicalUrl: 'https://discord.com/channels/11111/22222/22222',
      starterAuthorId: '55555',
      forumTags: [],
      lastCheckedAt: 1,
      createdAt: 1,
      updatedAt: 1,
    },
    messages: Array.from({ length: 30 }, (_, index) => savedMessage(index)),
    binding: {
      id: 'resource:source:source',
      resourceId: 'resource',
      sourceId: 'source',
      createdAt: 1,
    },
  }
}

describe('Discord refresh phase two health rotation', () => {
  it('rotates a bounded 12-message health batch across the full saved set', () => {
    const current = view()
    expect(selectDiscordSavedMessageHealthCheckIds(current, [])).toEqual(
      Array.from({ length: 12 }, (_, index) => String(60000 + index)),
    )

    current.source.savedMessageCheckCursor = '60011'
    expect(selectDiscordSavedMessageHealthCheckIds(current, [])).toEqual(
      Array.from({ length: 12 }, (_, index) => String(60012 + index)),
    )

    current.source.savedMessageCheckCursor = '60027'
    expect(selectDiscordSavedMessageHealthCheckIds(current, [])).toEqual([
      '60028',
      '60029',
      ...Array.from({ length: 10 }, (_, index) => String(60000 + index)),
    ])
  })

  it('does not spend the health batch on messages already proven present by the incremental scan', () => {
    const current = view()
    const selected = selectDiscordSavedMessageHealthCheckIds(current, ['60000', '60001', '60002'])

    expect(selected).toHaveLength(12)
    expect(selected[0]).toBe('60003')
    expect(selected).not.toContain('60000')
    expect(selected).not.toContain('60001')
    expect(selected).not.toContain('60002')
  })

  it('ignores a stale rotation cursor after revision restore resets lastCheckedAt', () => {
    const current = view()
    current.source.savedMessageCheckCursor = '60020'
    current.source.lastCheckedAt = undefined

    expect(selectDiscordSavedMessageHealthCheckIds(current, [])[0]).toBe('60000')
  })
})
