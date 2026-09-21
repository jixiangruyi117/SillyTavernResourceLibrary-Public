import { describe, expect, it } from 'vitest'

import {
  COMMUNITY_SOURCE_PLATFORM,
  COMMUNITY_SOURCE_REFRESH_MODE,
  toCommunitySourceSummary,
  type CommunitySource,
} from '../types/CommunitySource'
import { parseCommunitySourceBackupData } from './CommunitySourceBackupService'

function source(): CommunitySource {
  return {
    id: 'source',
    platform: COMMUNITY_SOURCE_PLATFORM.DISCORD,
    sourceKeyHash: 'a'.repeat(64),
    guildId: '11111',
    channelId: '22222',
    threadId: '22222',
    starterMessageId: '22222',
    canonicalUrl: 'https://discord.com/channels/11111/22222/22222',
    forumTags: [],
    discordRefreshMode: COMMUNITY_SOURCE_REFRESH_MODE.MANUAL,
    remoteScanCursor: {
      lastSeenMessageId: '60000',
      pendingBeforeMessageId: '59000',
      pendingHighWaterMessageId: '61000',
    },
    savedMessageCheckCursor: '58000',
    createdAt: 1,
    updatedAt: 1,
  }
}

describe('CommunitySource remote sync state', () => {
  it('keeps refresh cursors inside the existing source payload but out of the lightweight directory summary', () => {
    const current = source()
    const summary = toCommunitySourceSummary(current)

    expect(current.remoteScanCursor?.pendingBeforeMessageId).toBe('59000')
    expect(current.savedMessageCheckCursor).toBe('58000')
    expect(summary).not.toHaveProperty('remoteScanCursor')
    expect(summary).not.toHaveProperty('savedMessageCheckCursor')
    expect(summary.discordRefreshMode).toBe(COMMUNITY_SOURCE_REFRESH_MODE.MANUAL)
  })

  it('keeps backup version 1 compatible with optional valid refresh cursors', () => {
    expect(
      parseCommunitySourceBackupData({
        version: 1,
        sources: [source()],
        messages: [],
        bindings: [],
      }).sources[0],
    ).toMatchObject({
      remoteScanCursor: {
        lastSeenMessageId: '60000',
        pendingBeforeMessageId: '59000',
        pendingHighWaterMessageId: '61000',
      },
      savedMessageCheckCursor: '58000',
    })
  })

  it('rejects a partial continuation cursor instead of restoring an ambiguous checkpoint', () => {
    const invalid = source() as unknown as Record<string, unknown>
    invalid.remoteScanCursor = {
      lastSeenMessageId: '60000',
      pendingBeforeMessageId: '59000',
    }

    expect(() =>
      parseCommunitySourceBackupData({
        version: 1,
        sources: [invalid],
        messages: [],
        bindings: [],
      }),
    ).toThrow('社区来源清单无效')
  })
})
