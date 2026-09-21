import { strFromU8, unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'

import {
  COMMUNITY_SOURCE_ARCHIVE_PATH,
  COMMUNITY_SOURCE_ATTACHMENT_ARCHIVE_PREFIX,
  type ArchiveOptions,
} from '../types/Backup'
import {
  COMMUNITY_SOURCE_ATTACHMENT_LOCAL_STATE,
  COMMUNITY_SOURCE_MESSAGE_KIND,
  COMMUNITY_SOURCE_PLATFORM,
  type CommunitySourceBackupData,
  type CommunitySourceMessage,
} from '../types/CommunitySource'
import { ExportService } from './ExportService'
import { selectPreparedRestore } from './BackupRestoreSelection'
import { RESOURCE_TYPE, type Resource } from '../types/Resource'
import { hashBlob } from './HashService'
import {
  readCommunitySourceLocalAttachmentsFromArchive,
  sanitizeCommunitySourceAttachmentRefs,
} from './CommunitySourceAttachmentArchive'

async function fixture() {
  const blob = new Blob(['saved discord attachment'], { type: 'text/plain' })
  const assetId = `asset-${await hashBlob(blob)}`
  const sourceId = 'source-1'
  const message: CommunitySourceMessage = {
    id: 'message-1',
    sourceId,
    messageKeyHash: 'b'.repeat(64),
    messageId: '44444',
    kind: COMMUNITY_SOURCE_MESSAGE_KIND.STARTER,
    authorId: '33333',
    authorName: 'Author',
    content: '正文',
    embeds: [],
    attachments: [
      {
        id: 'attachment-1',
        name: 'guide.txt',
        size: blob.size,
        url: 'https://cdn.discordapp.com/attachments/a/guide.txt',
        contentType: 'text/plain',
        localAssetId: assetId,
        localState: COMMUNITY_SOURCE_ATTACHMENT_LOCAL_STATE.LOCAL,
      },
    ],
    canonicalUrl: 'https://discord.com/channels/11111/22222/44444',
    timestamp: '2026-08-27T00:00:00.000Z',
    capturedAt: 1,
    updatedAt: 1,
  }
  const data: CommunitySourceBackupData = {
    version: 1,
    sources: [
      {
        id: sourceId,
        platform: COMMUNITY_SOURCE_PLATFORM.DISCORD,
        sourceKeyHash: 'a'.repeat(64),
        guildId: '11111',
        channelId: '22222',
        threadId: '22222',
        starterMessageId: '44444',
        canonicalUrl: message.canonicalUrl,
        starterAuthorId: '33333',
        starterAuthorName: 'Author',
        forumTags: [],
        createdAt: 1,
        updatedAt: 1,
      },
    ],
    messages: [message],
    bindings: [],
  }
  return { blob, assetId, data }
}

describe('CommunitySourceAttachmentArchive', () => {
  it.each(['unbound', 'existing-resource'] as const)(
    'keeps %s comments and attachments when restoring the complete prepared archive',
    async (bindingMode) => {
      const { blob, assetId, data } = await fixture()
      const resource: Resource = {
        id: 'new-resource',
        type: RESOURCE_TYPE.OTHER,
        name: 'new-resource',
        description: '',
        fileName: 'resource.txt',
        mimeType: 'text/plain',
        fileSize: blob.size,
        contentHash: 'e'.repeat(64),
        favorite: false,
        categoryId: null,
        tags: [],
        metadata: {},
        originalBlob: blob,
        createdAt: 1,
        updatedAt: 1,
      }
      if (bindingMode === 'existing-resource') {
        // prepare() already mapped a duplicate's original ID to its existing local ID.
        data.bindings = [
          {
            id: 'existing-binding',
            sourceId: data.sources[0].id,
            resourceId: 'existing-local-duplicate',
            createdAt: 1,
          },
        ]
      }
      const result = selectPreparedRestore(
        {
          resources: [resource],
          versions: [],
          categories: [],
          communitySourceData: data,
          communitySourceAttachments: [{ assetId, blob }],
          preview: {
            fileName: 'complete.zip',
            mode: 'full',
            createdAt: new Date().toISOString(),
            archiveResourceCount: 1,
            resourcesToAdd: 1,
            duplicatesToSkip: 1,
            conflictsToPreserve: 0,
            categoriesToCreate: 0,
            categoriesToReuse: 0,
            communityAttachmentCount: 1,
          },
        },
        new Set([resource.id]),
      )
      expect(result.communitySourceData).toEqual(data)
      expect(result.communitySourceAttachments).toEqual([{ assetId, blob }])
    },
  )

  it('restores only attachments referenced by selected sources, including saved revisions', async () => {
    const { blob, assetId, data } = await fixture()
    const historicalAsset = 'asset-' + 'c'.repeat(64)
    const otherAsset = 'asset-' + 'd'.repeat(64)
    const selected: Resource = {
      id: 'keep',
      type: RESOURCE_TYPE.OTHER,
      name: 'keep',
      description: '',
      fileName: 'keep.txt',
      mimeType: 'text/plain',
      fileSize: blob.size,
      contentHash: 'e'.repeat(64),
      favorite: false,
      categoryId: null,
      tags: [],
      metadata: {},
      originalBlob: blob,
      createdAt: 1,
      updatedAt: 1,
    }
    data.bindings = [
      { id: 'bind-keep', resourceId: 'keep', sourceId: data.sources[0].id, createdAt: 1 },
    ]
    const oldMessage = structuredClone(data.messages[0])
    oldMessage.attachments[0].localAssetId = historicalAsset
    data.sources[0].revisions = [
      {
        id: 'old-revision',
        createdAt: 1,
        source: {
          title: 'old',
          forumTags: [],
          canonicalUrl: data.sources[0].canonicalUrl,
          updatedAt: 1,
        },
        messages: [oldMessage],
      },
    ]
    const otherSource = { ...data.sources[0], id: 'source-other', revisions: undefined }
    data.sources.push(otherSource)
    data.messages.push({
      ...data.messages[0],
      id: 'other-message',
      sourceId: otherSource.id,
      attachments: [{ ...data.messages[0].attachments[0], localAssetId: otherAsset }],
    })
    data.bindings.push({
      id: 'bind-other',
      resourceId: 'other',
      sourceId: otherSource.id,
      createdAt: 1,
    })
    const result = selectPreparedRestore(
      {
        resources: [selected, { ...selected, id: 'other' }],
        versions: [],
        categories: [],
        communitySourceData: data,
        communitySourceAttachments: [assetId, historicalAsset, otherAsset].map((id) => ({
          assetId: id,
          blob,
        })),
        preview: {
          fileName: 'selected.zip',
          mode: 'full',
          createdAt: new Date().toISOString(),
          archiveResourceCount: 2,
          resourcesToAdd: 2,
          duplicatesToSkip: 0,
          conflictsToPreserve: 0,
          categoriesToCreate: 0,
          categoriesToReuse: 0,
          communityAttachmentCount: 3,
        },
      },
      new Set(['keep']),
    )
    expect(result.communitySourceData?.sources.map((source) => source.id)).toEqual(['source-1'])
    expect(result.communitySourceAttachments?.map((entry) => entry.assetId)).toEqual([
      assetId,
      historicalAsset,
    ])
    expect(result.preview.communityAttachmentCount).toBe(2)
  })

  it('puts referenced local Discord attachments beside community-sources.json', async () => {
    const { blob, assetId, data } = await fixture()
    const exporter = new ExportService(
      async () => data,
      async () => [{ assetId, blob }],
    )
    const options: ArchiveOptions = {
      mode: 'full',
      portableSelection: { communitySources: true },
    }
    const archive = await exporter.createArchive([], [], options)
    const entries = unzipSync(new Uint8Array(await archive.blob.arrayBuffer()))

    expect(strFromU8(entries[`${COMMUNITY_SOURCE_ATTACHMENT_ARCHIVE_PREFIX}${assetId}`])).toBe(
      'saved discord attachment',
    )
    const sidecar = JSON.parse(
      strFromU8(entries[COMMUNITY_SOURCE_ARCHIVE_PATH]),
    ) as CommunitySourceBackupData
    expect(sidecar.messages[0].attachments[0].localAssetId).toBe(assetId)
    expect(archive.manifest.communitySources?.attachmentCount).toBe(1)
  })

  it('reads and verifies attachment sidecars by content hash', async () => {
    const { blob, assetId, data } = await fixture()
    const exporter = new ExportService(
      async () => data,
      async () => [{ assetId, blob }],
    )
    const archive = await exporter.createArchive([], [], {
      mode: 'full',
      portableSelection: { communitySources: true },
    })
    const file = new File([archive.blob], 'backup.zip', { type: 'application/zip' })
    const restored = await readCommunitySourceLocalAttachmentsFromArchive(file, data)

    expect(restored).toHaveLength(1)
    expect(restored[0].assetId).toBe(assetId)
    expect(await restored[0].blob.text()).toBe('saved discord attachment')
  })

  it('drops stale localAssetId references when the binary sidecar is unavailable', async () => {
    const { data } = await fixture()
    const sanitized = sanitizeCommunitySourceAttachmentRefs(data, new Set())
    expect(sanitized.messages[0].attachments[0]).toMatchObject({
      localState: COMMUNITY_SOURCE_ATTACHMENT_LOCAL_STATE.REMOTE_ONLY,
    })
    expect(sanitized.messages[0].attachments[0].localAssetId).toBeUndefined()
  })
})
