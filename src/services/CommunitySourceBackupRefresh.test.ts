import { describe, expect, it } from 'vitest'

import { parseCommunitySourceBackupData } from './CommunitySourceBackupService'
import {
  COMMUNITY_SOURCE_MESSAGE_KIND,
  COMMUNITY_SOURCE_PLATFORM,
  COMMUNITY_SOURCE_REFRESH_MODE,
  COMMUNITY_SOURCE_REMOTE_STATE,
  type CommunitySourceBackupData,
  type CommunitySourceMessage,
} from '../types/CommunitySource'

const SOURCE_ID = 'source-1'
const SOURCE_HASH = 'a'.repeat(64)
const MESSAGE_HASH = 'b'.repeat(64)

function message(content = '正文'): CommunitySourceMessage {
  return {
    id: `${SOURCE_ID}:message:${MESSAGE_HASH}`,
    sourceId: SOURCE_ID,
    messageKeyHash: MESSAGE_HASH,
    messageId: '33333',
    kind: COMMUNITY_SOURCE_MESSAGE_KIND.STARTER,
    authorId: '44444',
    authorName: 'Author',
    content,
    embeds: [],
    attachments: [],
    canonicalUrl: 'https://discord.com/channels/11111/22222/33333',
    timestamp: '2026-08-27T00:00:00.000Z',
    capturedAt: 1,
    updatedAt: 1,
  }
}

function backup(): CommunitySourceBackupData {
  return {
    version: 1,
    sources: [
      {
        id: SOURCE_ID,
        platform: COMMUNITY_SOURCE_PLATFORM.DISCORD,
        sourceKeyHash: SOURCE_HASH,
        guildId: '11111',
        channelId: '22222',
        starterMessageId: '33333',
        canonicalUrl: 'https://discord.com/channels/11111/22222/33333',
        title: '帖子',
        starterAuthorId: '44444',
        starterAuthorName: 'Author',
        forumTags: ['发布'],
        discordRefreshMode: COMMUNITY_SOURCE_REFRESH_MODE.MANUAL,
        remoteState: COMMUNITY_SOURCE_REMOTE_STATE.AVAILABLE,
        hasRemoteUpdate: false,
        lastCheckedAt: 10,
        revisions: [
          {
            id: 'revision-1',
            createdAt: 9,
            source: {
              canonicalUrl: 'https://discord.com/channels/11111/22222/33333',
              title: '旧帖子',
              starterAuthorId: '44444',
              starterAuthorName: 'Author',
              forumTags: ['发布'],
              updatedAt: 8,
            },
            messages: [message('旧正文')],
          },
        ],
        createdAt: 1,
        updatedAt: 10,
      },
    ],
    messages: [message()],
    bindings: [
      {
        id: `resource:source:${SOURCE_ID}`,
        resourceId: 'resource',
        sourceId: SOURCE_ID,
        note: '来源备注',
        createdAt: 1,
      },
    ],
  }
}

describe('CommunitySourceBackupService refresh history', () => {
  it('accepts and preserves refresh state plus nested local revisions', () => {
    const data = backup()
    const parsed = parseCommunitySourceBackupData(data)
    expect(parsed).toEqual(data)
    expect(parsed).not.toBe(data)
    expect(parsed.sources[0].revisions?.[0].messages[0].content).toBe('旧正文')
  })

  it('keeps version-1 backups without refresh fields backwards compatible', () => {
    const data = backup()
    delete data.sources[0].remoteState
    delete data.sources[0].discordRefreshMode
    delete data.sources[0].hasRemoteUpdate
    delete data.sources[0].lastCheckedAt
    delete data.sources[0].revisions
    expect(parseCommunitySourceBackupData(data)).toEqual(data)
  })

  it('rejects a history message that points at a different source', () => {
    const data = backup()
    data.sources[0].revisions![0].messages[0].sourceId = 'other-source'
    expect(() => parseCommunitySourceBackupData(data)).toThrow('社区来源清单无效')
  })

  it('rejects an invented remote state', () => {
    const data = backup() as unknown as {
      sources: Array<Record<string, unknown>>
    }
    data.sources[0].remoteState = 'maybe'
    expect(() => parseCommunitySourceBackupData(data)).toThrow('社区来源清单无效')
  })

  it('rejects an invented Discord refresh mode', () => {
    const data = backup() as unknown as {
      sources: Array<Record<string, unknown>>
    }
    data.sources[0].discordRefreshMode = 'automatic'
    expect(() => parseCommunitySourceBackupData(data)).toThrow('社区来源清单无效')
  })
})
