import type {
  CommunitySource,
  CommunitySourceBackupData,
  CommunitySourceMessage,
  CommunitySourceSummary,
  ResourceSourceBinding,
} from '../types/CommunitySource'

export interface CommunitySourceStorage {
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

  listMessages(sourceId: string): Promise<CommunitySourceMessage[]>
  getMessage(sourceId: string, messageKeyHash: string): Promise<CommunitySourceMessage | undefined>
  putMessage(message: CommunitySourceMessage): Promise<void>
  deleteMessage(id: string): Promise<void>

  listBindingsForResource(resourceId: string): Promise<ResourceSourceBinding[]>
  listBindingsForSource(sourceId: string): Promise<ResourceSourceBinding[]>
  putBinding(binding: ResourceSourceBinding): Promise<void>
  deleteBinding(id: string): Promise<void>

  exportAll(): Promise<CommunitySourceBackupData>
  mergeAll(data: CommunitySourceBackupData): Promise<void>
  replaceAll(data: CommunitySourceBackupData): Promise<void>
}
