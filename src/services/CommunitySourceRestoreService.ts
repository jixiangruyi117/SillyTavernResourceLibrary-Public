import type { ArchiveStorageAdapter } from '../storage/ArchiveStorageAdapter'
import type { RestoreStagingStore } from '../storage/RestoreStagingStore'
import type { PreparedRestore, RestoreReport } from '../types/Backup'
import type { CommunitySourceAttachmentArchiveEntry } from '../types/CommunitySource'
import {
  readCommunitySourceLocalAttachmentsFromArchive,
  sanitizeCommunitySourceAttachmentRefs,
} from './CommunitySourceAttachmentArchive'
import type { CommunitySourceService } from './CommunitySourceService'
import { RestoreService } from './RestoreService'

type AttachmentRestore = (
  entries: readonly CommunitySourceAttachmentArchiveEntry[],
) => Promise<void>

/**
 * 整库覆盖的语义必须同时覆盖社区来源：
 * - 备份带 community-sources.json：RestoreService 按备份替换；
 * - 旧备份或未选择 Discord 正文：不把缺失 sidecar 当作授权清空已保存评论。
 * - 显式携带空 sidecar：仍按用户选择的覆盖恢复语义清空社区来源。
 * - 新版备份把已经本地化的 Discord 附件作为独立二进制 sidecar；旧备份没有 sidecar 时
 *   会自动清掉失效的 localAssetId，退回远端 URL，而不是恢复一个假的“本机副本”引用。
 * 合并恢复仍由 RestoreService 处理，不会删除当前来源。
 */
export class CommunitySourceRestoreService extends RestoreService {
  private readonly attachmentRestore?: AttachmentRestore

  constructor(
    storage: ArchiveStorageAdapter,
    staging: RestoreStagingStore,
    sourceOwner: Pick<CommunitySourceService, 'restoreBackup' | 'replaceAll'>,
    attachmentRestore?: AttachmentRestore,
  ) {
    super(storage, staging, sourceOwner)
    this.attachmentRestore = attachmentRestore
  }

  override async prepare(...args: Parameters<RestoreService['prepare']>): Promise<PreparedRestore> {
    const prepared = await super.prepare(...args)
    if (!prepared.communitySourceData) return prepared

    const attachments = await readCommunitySourceLocalAttachmentsFromArchive(
      args[0],
      prepared.communitySourceData,
    )
    const availableAssetIds = new Set(attachments.map((entry) => entry.assetId))
    const communitySourceData = sanitizeCommunitySourceAttachmentRefs(
      prepared.communitySourceData,
      availableAssetIds,
    )
    return {
      ...prepared,
      forReplacement: prepared.forReplacement
        ? async () => {
            const replacement = await prepared.forReplacement!()
            return {
              ...replacement,
              communitySourceData: replacement.communitySourceData
                ? sanitizeCommunitySourceAttachmentRefs(
                    replacement.communitySourceData,
                    availableAssetIds,
                  )
                : undefined,
              communitySourceAttachments: attachments,
              preview: { ...replacement.preview, communityAttachmentCount: attachments.length },
            }
          }
        : undefined,
      communitySourceData,
      communitySourceAttachments: attachments,
      preview: {
        ...prepared.preview,
        communityAttachmentCount: attachments.length,
      },
    }
  }

  override async restore(...args: Parameters<RestoreService['restore']>): Promise<RestoreReport> {
    const [prepared] = args
    if (prepared.communitySourceAttachments?.length && this.attachmentRestore) {
      await this.attachmentRestore(prepared.communitySourceAttachments)
    }
    const report = await super.restore(...args)
    return {
      ...report,
      restoredCommunityAttachments: prepared.communitySourceAttachments?.length,
    }
  }

  override async replace(
    prepared: PreparedRestore,
    onProgress?: Parameters<RestoreService['replace']>[1],
  ): Promise<RestoreReport> {
    if (prepared.communitySourceAttachments?.length && this.attachmentRestore) {
      await this.attachmentRestore(prepared.communitySourceAttachments)
    }
    const report = await super.replace(prepared, onProgress)
    return {
      ...report,
      restoredCommunityAttachments: prepared.communitySourceAttachments?.length,
    }
  }
}
