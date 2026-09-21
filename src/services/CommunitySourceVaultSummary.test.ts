import { describe, expect, it, vi } from 'vitest'

import {
  COMMUNITY_SOURCE_PLATFORM,
  COMMUNITY_SOURCE_REFRESH_MODE,
  type CommunitySource,
  type EncryptedCommunitySourceRecord,
} from '../types/CommunitySource'
import type { EncryptedValue } from '../types/Vault'
import {
  decodeCommunitySourceSummary,
  encodeCommunitySource,
  type CommunitySourceJsonVaultCodec,
} from './CommunitySourceVaultCodec'

function codec() {
  let index = 0
  const protectJson = vi.fn(async (value: unknown): Promise<EncryptedValue> => ({
    iv: `iv-${index++}`,
    data: new Blob([JSON.stringify(value)], { type: 'application/json' }),
  }))
  const revealJsonSpy = vi.fn(async (value: EncryptedValue): Promise<unknown> =>
    JSON.parse(await value.data.text()),
  )
  const revealJson: CommunitySourceJsonVaultCodec['revealJson'] = async <T>(
    value: EncryptedValue,
  ): Promise<T> => (await revealJsonSpy(value)) as T
  return { protectJson, revealJson, revealJsonSpy }
}

function source(): CommunitySource {
  return {
    id: 'source-1',
    platform: COMMUNITY_SOURCE_PLATFORM.DISCORD,
    sourceKeyHash: 'a'.repeat(64),
    guildId: '11111',
    guildName: '社区 A',
    channelId: '22222',
    channelName: '角色发布',
    starterMessageId: '33333',
    canonicalUrl: 'https://discord.com/channels/11111/22222/33333',
    title: '帖子',
    discordRefreshMode: COMMUNITY_SOURCE_REFRESH_MODE.MANUAL,
    forumTags: ['角色卡'],
    messageCount: 3,
    missingMessageCount: 1,
    latestMessagePreview: '最新补充',
    revisions: [
      {
        id: 'revision-1',
        createdAt: 2,
        source: {
          canonicalUrl: 'https://discord.com/channels/11111/22222/33333',
          title: '旧帖子',
          forumTags: [],
          updatedAt: 1,
        },
        messages: [],
      },
    ],
    createdAt: 1,
    updatedAt: 2,
  }
}

describe('CommunitySource Vault directory summary', () => {
  it('stores a separate encrypted summary and decodes it without opening the full source payload', async () => {
    const owner = codec()
    const encrypted = await encodeCommunitySource(source(), owner)

    expect(encrypted.summaryPayload).toBeDefined()
    owner.revealJsonSpy.mockClear()
    const summary = await decodeCommunitySourceSummary(encrypted, owner)

    expect(summary).toMatchObject({
      id: 'source-1',
      guildName: '社区 A',
      channelName: '角色发布',
      messageCount: 3,
      missingMessageCount: 1,
      latestMessagePreview: '最新补充',
      discordRefreshMode: COMMUNITY_SOURCE_REFRESH_MODE.MANUAL,
      revisionCount: 1,
    })
    expect(owner.revealJsonSpy).toHaveBeenCalledTimes(1)
    expect(owner.revealJsonSpy).toHaveBeenCalledWith(encrypted.summaryPayload)
    expect(owner.revealJsonSpy).not.toHaveBeenCalledWith(encrypted.payload)
  })

  it('keeps old encrypted records readable when summaryPayload is absent', async () => {
    const owner = codec()
    const encrypted = await encodeCommunitySource(source(), owner)
    const legacy: EncryptedCommunitySourceRecord = {
      id: encrypted.id,
      platform: encrypted.platform,
      sourceKeyHash: encrypted.sourceKeyHash,
      updatedAt: encrypted.updatedAt,
      encrypted: true,
      payload: encrypted.payload,
    }

    owner.revealJsonSpy.mockClear()
    const summary = await decodeCommunitySourceSummary(legacy, owner)

    expect(summary.revisionCount).toBe(1)
    expect(owner.revealJsonSpy).toHaveBeenCalledWith(legacy.payload)
  })
})
