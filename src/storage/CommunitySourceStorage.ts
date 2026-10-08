import type {
  CommunitySource,
  CommunitySourceBackupData,
  CommunitySourceMessage,
  CommunitySourceSummary,
  ResourceSourceBinding,
} from '../types/CommunitySource'

export interface CommunitySourceStorage {
  downloadedMediaUsage?(): Promise<{ count: number; bytes: number }>
  clearDownloadedMedia?(): Promise<{ count: number; bytes: number; retainedCount: number }>
  getSource(id: string): Promise<CommunitySource | undefined>
  /** 生产 Owner 可只解密目录摘要；测试替身不实现时 Service 会退回 getSource。 */
  getSourceSummary?(id: string): Promise<CommunitySourceSummary | undefined>
  getSourceByKeyHash(sourceKeyHash: string): Promise<CommunitySource | undefined>
  putSource(source: CommunitySource): Promise<void>
  /**
   * 生产 IndexedDB owner 用于一次 refresh 原子写入 source + 多条 message。
   * 测试替身可不实现；业务层会退回顺序 put。
   */
  putSourceWithMessages?(
    source: CommunitySource,
    messages: readonly CommunitySourceMessage[],
  ): Promise<void>
  /**
   * revision restore 必须把“当前消息集合”完整替换成目标快照，不能只 bulkPut 后留下旧消息。
   */
  replaceSourceWithMessages?(
    source: CommunitySource,
    messages: readonly CommunitySourceMessage[],
  ): Promise<void>
  deleteSource(id: string): Promise<void>
  /** 仅返回最近的未绑定来源，禁止为了“待整理”把整张消息表读进内存。 */
  listUnboundSources(limit?: number): Promise<CommunitySource[]>
  /** 精确计数未绑定来源；生产存储只读轻量主键和关联索引。 */
  countUnboundSources?(): Promise<number>

  listMessages(sourceId: string): Promise<CommunitySourceMessage[]>
  /** Read only the post's first-floor message for bounded auto-matching. */
  getStarterMessage?(sourceId: string): Promise<CommunitySourceMessage | undefined>
  getMessage(sourceId: string, messageKeyHash: string): Promise<CommunitySourceMessage | undefined>
  putMessage(message: CommunitySourceMessage): Promise<void>
  deleteMessage(id: string): Promise<void>

  listBindingsForResource(resourceId: string): Promise<ResourceSourceBinding[]>
  /** Read distinct bound resource IDs through the plaintext index; never decrypt binding rows. */
  listBoundResourceIds?(): Promise<string[]>
  listBindingsForSource(sourceId: string): Promise<ResourceSourceBinding[]>
  listRecentAutoBindings?(limit?: number): Promise<ResourceSourceBinding[]>
  putBinding(binding: ResourceSourceBinding): Promise<void>
  /** Commit an automatic binding together with its completed scan state. */
  putSourceWithBinding?(source: CommunitySource, binding: ResourceSourceBinding): Promise<void>
  deleteBinding(id: string): Promise<void>
  /** Repair only binding rows; current resources are rechecked atomically before removal. */
  repairInvalidResourceBindings?(
    validResourceIds: ReadonlySet<string>,
    galleryVersions: ReadonlyMap<string, number>,
  ): Promise<number>

  exportAll(): Promise<CommunitySourceBackupData>
  mergeAll(data: CommunitySourceBackupData): Promise<void>
  replaceAll(data: CommunitySourceBackupData): Promise<void>
}
