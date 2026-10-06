import { describe, expect, it } from 'vitest'

import { compareDiscordSourceRefresh, parseDiscordMessageUrl } from './DiscordSourceRefreshService'
import {
  COMMUNITY_SOURCE_MESSAGE_KIND,
  COMMUNITY_SOURCE_MESSAGE_REMOTE_STATE,
  COMMUNITY_SOURCE_PLATFORM,
  type CommunitySourceMessage,
  type DiscordCapture,
  type ResourceCommunitySourceView,
} from '../types/CommunitySource'

function message(
  id: string,
  content: string,
  overrides: Partial<CommunitySourceMessage> = {},
): CommunitySourceMessage {
  return {
    id: `source:message:${id}`,
    sourceId: 'source',
    messageKeyHash: `hash-${id}`,
    messageId: id,
    kind: COMMUNITY_SOURCE_MESSAGE_KIND.SELECTED_COMMENT,
    authorId: 'user-other',
    authorName: 'Other',
    content,
    embeds: [],
    attachments: [],
    canonicalUrl: `https://discord.com/channels/11111/22222/${id}`,
    timestamp: '2026-08-27T00:00:00.000Z',
    capturedAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

function capture(
  id: string,
  authorId: string,
  content: string,
  overrides: Partial<DiscordCapture> = {},
): DiscordCapture {
  return {
    guildId: '11111',
    channelId: '22222',
    threadId: '22222',
    starterMessageId: '33333',
    messageId: id,
    canonicalUrl: `https://discord.com/channels/11111/22222/${id}`,
    authorId,
    authorName: authorId === 'author' ? 'Author' : authorId === 'user-other' ? 'Other' : authorId,
    content,
    timestamp: '2026-08-27T00:00:00.000Z',
    forumTags: [],
    embeds: [],
    attachments: [],
    ...overrides,
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
      starterMessageId: '33333',
      canonicalUrl: 'https://discord.com/channels/11111/22222/33333',
      title: '旧标题',
      starterAuthorId: 'author',
      starterAuthorName: 'Author',
      forumTags: ['发布'],
      createdAt: 1,
      updatedAt: 1,
    },
    messages: [
      message('33333', '旧正文', {
        kind: COMMUNITY_SOURCE_MESSAGE_KIND.STARTER,
        authorId: 'author',
        authorName: 'Author',
      }),
      message('44444', '已保存评论'),
    ],
    binding: {
      id: 'resource:source:source',
      resourceId: 'resource',
      sourceId: 'source',
      createdAt: 1,
    },
  }
}

describe('DiscordSourceRefreshService', () => {
  it('parses supported Discord message links without treating a reply as a starter', () => {
    expect(parseDiscordMessageUrl('https://discord.com/channels/11111/22222/33333')).toEqual({
      guildId: '11111',
      channelId: '22222',
      messageId: '33333',
    })
    expect(parseDiscordMessageUrl('https://discord.com/channels/@me/22222/33333')).toEqual({
      channelId: '22222',
      messageId: '33333',
    })
    expect(parseDiscordMessageUrl('https://example.com/channels/11111/22222/33333')).toBeUndefined()
  })

  it('diffs only starter, starter-author, bot and already-saved messages', () => {
    const current = view()
    const compared = compareDiscordSourceRefresh(current, [
      capture('33333', 'author', '新正文', {
        isStarter: true,
        title: '新标题',
        forumTags: ['发布', '更新'],
      }),
      capture('44444', 'user-other', '已保存评论'),
      capture('55555', 'author', '作者补充'),
      capture('66666', 'bot', '自动发布信息', { authorBot: true }),
      capture('77777', 'random-user', '普通路人评论'),
    ])

    expect(compared.captures.map((item) => item.messageId)).toEqual([
      '33333',
      '44444',
      '55555',
      '66666',
    ])
    expect(compared.diff).toEqual({
      hasChanges: true,
      newMessages: 2,
      changedMessages: 1,
      missingMessages: 0,
      restoredMessages: 0,
      contentChanges: 1,
      embedChanges: 0,
      attachmentChanges: 0,
      sourceMetadataChanges: 2,
      changes: [
        {
          messageId: '33333',
          type: 'changed',
          authorName: 'Author',
          authorBot: false,
          summary: '新正文',
          contentChanged: true,
          embedsChanged: false,
          attachmentsChanged: false,
        },
        {
          messageId: '55555',
          type: 'new',
          authorName: 'Author',
          authorBot: false,
          summary: '作者补充',
        },
        {
          messageId: '66666',
          type: 'new',
          authorName: 'bot',
          authorBot: true,
          summary: '自动发布信息',
        },
      ],
    })
  })

  it('does not report an attachment change when only Discord CDN URLs rotate', () => {
    const current = view()
    current.messages[0].attachments = [
      {
        id: 'attachment',
        name: 'card.png',
        size: 1024,
        url: 'https://cdn.discordapp.com/old',
        proxyUrl: 'https://media.discordapp.net/old',
        contentType: 'image/png',
        width: 512,
        height: 768,
      },
    ]
    const compared = compareDiscordSourceRefresh(current, [
      capture('33333', 'author', '旧正文', {
        isStarter: true,
        title: '旧标题',
        forumTags: ['发布'],
        attachments: [
          {
            id: 'attachment',
            name: 'card.png',
            size: 1024,
            url: 'https://cdn.discordapp.com/new',
            proxyUrl: 'https://media.discordapp.net/new',
            contentType: 'image/png',
            width: 512,
            height: 768,
          },
        ],
      }),
    ])

    expect(compared.diff.attachmentChanges).toBe(0)
    expect(compared.diff.hasChanges).toBe(false)
  })

  it('does not repeatedly offer a new message the user explicitly ignored', () => {
    const current = view()
    current.source.ignoredRemoteMessageIds = ['55555']

    const compared = compareDiscordSourceRefresh(current, [
      capture('55555', 'author', '已忽略的作者更新'),
    ])

    expect(compared.captures).toEqual([])
    expect(compared.diff.hasChanges).toBe(false)
  })

  it('reports a previously missing saved message as restored when Discord returns it', () => {
    const current = view()
    current.messages[1].remoteState = COMMUNITY_SOURCE_MESSAGE_REMOTE_STATE.MISSING

    const compared = compareDiscordSourceRefresh(current, [
      capture('44444', 'user-other', '已保存评论'),
    ])

    expect(compared.diff.restoredMessages).toBe(1)
    expect(compared.diff.changes).toContainEqual(
      expect.objectContaining({ messageId: '44444', type: 'restored' }),
    )
  })
})
