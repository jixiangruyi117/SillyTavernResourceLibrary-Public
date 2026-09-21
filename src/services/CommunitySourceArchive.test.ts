import { strFromU8, unzipSync } from 'fflate'
import { describe, expect, it, vi } from 'vitest'

import type { ArchiveStorageAdapter } from '../storage/ArchiveStorageAdapter'
import { COMMUNITY_SOURCE_ARCHIVE_PATH } from '../types/Backup'
import type { CommunitySourceBackupData } from '../types/CommunitySource'
import { RESOURCE_TYPE, type Category, type Resource } from '../types/Resource'
import { ExportService } from './ExportService'
import { RestoreService } from './RestoreService'

async function hash(content: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(content))
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('')
}

async function resource(id: string, content: string): Promise<Resource> {
  const bytes = new TextEncoder().encode(content)
  return {
    id,
    type: RESOURCE_TYPE.WORLD_BOOK,
    name: id,
    description: '',
    fileName: `${id}.json`,
    mimeType: 'application/json',
    fileSize: bytes.byteLength,
    contentHash: await hash(content),
    favorite: false,
    categoryId: null,
    categoryIds: [],
    relatedResourceIds: [],
    tags: [],
    metadata: { format: 'json' },
    originalBlob: new Blob([bytes]),
    createdAt: 1,
    updatedAt: 1,
  }
}

function sourceData(resourceId = 'atlas'): CommunitySourceBackupData {
  const sourceId = 'local-source-a'
  const sourceKeyHash = 'a'.repeat(64)
  const messageKeyHash = 'b'.repeat(64)
  return {
    version: 1,
    sources: [
      {
        id: sourceId,
        platform: 'discord',
        sourceKeyHash,
        guildId: 'guild-a',
        channelId: 'thread-a',
        threadId: 'thread-a',
        starterMessageId: 'message-a',
        canonicalUrl: 'https://discord.com/channels/guild-a/thread-a/message-a',
        title: '完整正文测试',
        starterAuthorId: 'author-a',
        starterAuthorName: '作者 A',
        forumTags: ['角色卡'],
        createdAt: 1,
        updatedAt: 2,
      },
    ],
    messages: [
      {
        id: `${sourceId}:message:${messageKeyHash}`,
        sourceId,
        messageKeyHash,
        messageId: 'message-a',
        kind: 'starter',
        authorId: 'author-a',
        authorName: '作者 A',
        content: '这是完整首楼。'.repeat(3_000),
        embeds: [],
        attachments: [],
        canonicalUrl: 'https://discord.com/channels/guild-a/thread-a/message-a',
        timestamp: '2026-08-27T00:00:00.000Z',
        capturedAt: 1,
        updatedAt: 2,
      },
    ],
    bindings: [
      {
        id: `${resourceId}:source:${sourceId}`,
        resourceId,
        sourceId,
        createdAt: 2,
      },
    ],
  }
}

class MemoryArchiveStorage implements ArchiveStorageAdapter {
  categories: Category[] = []
  resources: Resource[] = []
  versions: Resource[] = []

  async restore(
    categories: Category[],
    resources: Resource[],
    versions: Resource[] = [],
  ): Promise<void> {
    this.categories.push(...categories)
    this.resources.push(...resources)
    this.versions.push(...versions)
  }

  async replace(
    categories: Category[],
    resources: Resource[],
    versions: Resource[] = [],
  ): Promise<void> {
    this.categories = [...categories]
    this.resources = [...resources]
    this.versions = [...versions]
  }
}

describe('Discord community source archive', () => {
  it('does not read or include Discord snapshots when the user did not select them', async () => {
    const provider = vi.fn(async () => sourceData())
    const item = await resource('atlas', '{"name":"Atlas"}')
    const archive = await new ExportService(provider).createArchive([item], [], { mode: 'full' })
    const files = unzipSync(new Uint8Array(await archive.blob.arrayBuffer()))

    expect(provider).not.toHaveBeenCalled()
    expect(files[COMMUNITY_SOURCE_ARCHIVE_PATH]).toBeUndefined()
    expect(archive.manifest.communitySources).toBeUndefined()
  })

  it('keeps the complete Discord body in a sidecar when the user selects community sources', async () => {
    const data = sourceData()
    const provider = vi.fn(async () => data)
    const item = await resource('atlas', '{"name":"Atlas"}')
    const archive = await new ExportService(provider).createArchive([item], [], {
      mode: 'full',
      portableSelection: { communitySources: true },
    })
    const files = unzipSync(new Uint8Array(await archive.blob.arrayBuffer()))
    const restored = JSON.parse(
      strFromU8(files[COMMUNITY_SOURCE_ARCHIVE_PATH]!),
    ) as CommunitySourceBackupData

    expect(provider).toHaveBeenCalledTimes(1)
    expect(restored.messages[0]?.content).toBe(data.messages[0]?.content)
    expect(restored.messages[0]?.content.length).toBeGreaterThan(10_000)
    expect(archive.manifest.communitySources).toMatchObject({
      sourceCount: 1,
      messageCount: 1,
      bindingCount: 1,
    })
  })

  it('remaps Discord bindings when an imported resource id conflicts locally, then restores by merge', async () => {
    const data = sourceData()
    const archived = await resource('atlas', '{"name":"Archived"}')
    const archive = await new ExportService(async () => data).createArchive([archived], [], {
      mode: 'full',
      portableSelection: { communitySources: true },
    })
    const file = new File([archive.blob], archive.fileName, { type: 'application/zip' })
    const existing = await resource('atlas', '{"name":"Existing different resource"}')
    const restoreBackup = vi.fn(async () => undefined)
    const storage = new MemoryArchiveStorage()
    const service = new RestoreService(storage, undefined, { restoreBackup })

    const prepared = await service.prepare(file, [existing], [])
    const restoredResourceId = prepared.resources[0]?.id

    expect(restoredResourceId).toBeTruthy()
    expect(restoredResourceId).not.toBe('atlas')
    expect(prepared.communitySourceData?.bindings[0]?.resourceId).toBe(restoredResourceId)

    const report = await service.restore(prepared)
    expect(restoreBackup).toHaveBeenCalledWith(prepared.communitySourceData, 'merge')
    expect(report.restoredCommunityMessages).toBe(1)
  })
})
