import {
  createFrontendWorkshopSourceDocument,
  FRONTEND_WORKSHOP_SOURCE_DOCUMENT_VERSION,
  type FrontendWorkshopSourceDocument,
  type FrontendWorkshopSourceHostProfile,
  type FrontendWorkshopSourceOrigin,
} from '../types/FrontendWorkshopSourceDocument'
import type { FrontendWorkshopSourceDocumentStorage } from '../storage/FrontendWorkshopSourceDocumentStorage'

export interface FrontendWorkshopSourceSaveOptions {
  hostProfile?: FrontendWorkshopSourceHostProfile
  origin?: FrontendWorkshopSourceOrigin
  now?: number
}

export interface FrontendWorkshopSourceRevisionSaveOptions {
  now?: number
  origin?: FrontendWorkshopSourceOrigin
}

export class FrontendWorkshopSourceRevisionConflictError extends Error {
  readonly projectId: string
  readonly expectedRevision: number
  readonly actualRevision?: number

  constructor(projectId: string, expectedRevision: number, actualRevision?: number) {
    super(
      actualRevision === undefined
        ? `Source revision 已失效：期望 ${expectedRevision}，当前 Source 不存在`
        : `Source revision 已失效：期望 ${expectedRevision}，当前为 ${actualRevision}`,
    )
    this.name = 'FrontendWorkshopSourceRevisionConflictError'
    this.projectId = projectId
    this.expectedRevision = expectedRevision
    this.actualRevision = actualRevision
  }
}

export class FrontendWorkshopSourceAlreadyExistsError extends Error {
  readonly projectId: string
  readonly actualRevision?: number

  constructor(projectId: string, actualRevision?: number) {
    super(
      actualRevision === undefined
        ? 'Source 已在接管过程中被创建，请重新载入当前 Source 后再编辑'
        : `Source 已在接管过程中被创建（当前 revision ${actualRevision}），请重新载入后再编辑`,
    )
    this.name = 'FrontendWorkshopSourceAlreadyExistsError'
    this.projectId = projectId
    this.actualRevision = actualRevision
  }
}

function assertProjectId(projectId: string): void {
  if (!projectId) throw new Error('Source Document 缺少 projectId')
}

function assertExpectedRevision(expectedRevision: number): void {
  if (!Number.isInteger(expectedRevision) || expectedRevision < 1) {
    throw new Error('Source writeback expectedRevision 必须是正整数')
  }
}

/**
 * S1 raw source 真源只做类型/关联校验，不做 HTML/CSS/JS 内容归一化。
 * 任何 trim、slice、format、parse/rebuild 都会破坏 Source-first 的 round-trip 保真。
 */
export class FrontendWorkshopSourceDocumentService {
  private readonly storage: FrontendWorkshopSourceDocumentStorage

  constructor(storage: FrontendWorkshopSourceDocumentStorage) {
    this.storage = storage
  }

  async get(projectId: string): Promise<FrontendWorkshopSourceDocument | undefined> {
    assertProjectId(projectId)
    return this.storage.get(projectId)
  }

  private async throwRevisionConflict(projectId: string, expectedRevision: number): Promise<never> {
    const current = await this.storage.get(projectId)
    throw new FrontendWorkshopSourceRevisionConflictError(
      projectId,
      expectedRevision,
      current?.revision,
    )
  }

  private async throwAlreadyExists(projectId: string): Promise<never> {
    const current = await this.storage.get(projectId)
    throw new FrontendWorkshopSourceAlreadyExistsError(projectId, current?.revision)
  }

  /**
   * 通用 S1 保存入口保留给既有迁移/基础设施调用。首次创建也必须走 create-if-absent
   * transaction；已有 Source 继续使用 revision CAS。交互式编辑仍不得用本方法推断用户
   * 打开页面时看到的 revision，必须使用 createAuthorSourceIfMissing() / saveAuthorSourceAtRevision()。
   */
  async saveAuthorSource(
    projectId: string,
    authorSource: string,
    options: FrontendWorkshopSourceSaveOptions = {},
  ): Promise<FrontendWorkshopSourceDocument> {
    assertProjectId(projectId)
    if (typeof authorSource !== 'string') throw new Error('Author Source 必须是字符串')

    const existing = await this.storage.get(projectId)
    const now = options.now ?? Date.now()
    const document = existing
      ? {
          ...existing,
          version: FRONTEND_WORKSHOP_SOURCE_DOCUMENT_VERSION,
          hostProfile: options.hostProfile ?? existing.hostProfile,
          authorSource,
          origin: options.origin ?? existing.origin,
          revision: existing.revision + 1,
          updatedAt: now,
        }
      : createFrontendWorkshopSourceDocument(
          projectId,
          authorSource,
          now,
          options.origin ?? 'new',
          options.hostProfile ?? 'tavern-helper-message',
        )

    if (existing) {
      const saved = await this.storage.putAtomicIfRevision(document, existing.revision)
      if (!saved) return this.throwRevisionConflict(projectId, existing.revision)
    } else {
      const saved = await this.storage.putAtomicIfRevision(document, 0)
      if (!saved) return this.throwAlreadyExists(projectId)
    }
    return structuredClone(document)
  }

  /**
   * 用户显式把当前可视化项目第一次接管为 Source 时使用。
   * expectedRevision=0 只表示“当前必须仍不存在 Source”，由 storage transaction 原子判断；
   * 如果接管期间另一路已经创建了 Source，则 fail closed，绝不覆盖新真源。
   */
  async createAuthorSourceIfMissing(
    projectId: string,
    authorSource: string,
    options: FrontendWorkshopSourceSaveOptions = {},
  ): Promise<FrontendWorkshopSourceDocument> {
    assertProjectId(projectId)
    if (typeof authorSource !== 'string') throw new Error('Author Source 必须是字符串')

    const document = createFrontendWorkshopSourceDocument(
      projectId,
      authorSource,
      options.now ?? Date.now(),
      options.origin ?? 'new',
      options.hostProfile ?? 'tavern-helper-message',
    )
    const saved = await this.storage.putAtomicIfRevision(document, 0)
    if (!saved) return this.throwAlreadyExists(projectId)
    return structuredClone(document)
  }

  /**
   * S4 exact writeback path. This never creates a missing Source Document and never accepts a stale
   * revision. The storage compare-and-swap is authoritative so a race after the initial read cannot
   * overwrite a newer Source revision.
   */
  async saveAuthorSourceAtRevision(
    projectId: string,
    expectedRevision: number,
    authorSource: string,
    options: FrontendWorkshopSourceRevisionSaveOptions = {},
  ): Promise<FrontendWorkshopSourceDocument> {
    assertProjectId(projectId)
    assertExpectedRevision(expectedRevision)
    if (typeof authorSource !== 'string') throw new Error('Author Source 必须是字符串')

    const existing = await this.storage.get(projectId)
    if (!existing || existing.revision !== expectedRevision) {
      throw new FrontendWorkshopSourceRevisionConflictError(
        projectId,
        expectedRevision,
        existing?.revision,
      )
    }

    const document: FrontendWorkshopSourceDocument = {
      ...existing,
      version: FRONTEND_WORKSHOP_SOURCE_DOCUMENT_VERSION,
      authorSource,
      origin: options.origin ?? existing.origin,
      revision: expectedRevision + 1,
      updatedAt: options.now ?? Date.now(),
    }
    const saved = await this.storage.putAtomicIfRevision(document, expectedRevision)
    if (!saved) return this.throwRevisionConflict(projectId, expectedRevision)
    return structuredClone(document)
  }

  /**
   * 恢复上一份原样 Source，并把恢复前的当前版本反向保存为 last_good，
   * 因此连续 restore 可以在最近两个版本之间安全切换。已有 current 时也使用 revision
   * compare-and-swap，避免恢复操作用旧快照覆盖刚完成的 S4 写回。
   */
  async restoreLastGood(
    projectId: string,
    now = Date.now(),
  ): Promise<FrontendWorkshopSourceDocument | undefined> {
    assertProjectId(projectId)
    const record = await this.storage.getLastGood(projectId)
    if (!record) return undefined
    const current = await this.storage.get(projectId)
    const revision = Math.max(current?.revision ?? 0, record.document.revision) + 1
    const restored: FrontendWorkshopSourceDocument = {
      ...record.document,
      version: FRONTEND_WORKSHOP_SOURCE_DOCUMENT_VERSION,
      projectId,
      revision,
      createdAt: current?.createdAt ?? record.document.createdAt,
      updatedAt: now,
    }
    if (current) {
      const saved = await this.storage.putAtomicIfRevision(restored, current.revision)
      if (!saved) return this.throwRevisionConflict(projectId, current.revision)
    } else {
      const saved = await this.storage.putAtomicIfRevision(restored, 0)
      if (!saved) return this.throwAlreadyExists(projectId)
    }
    return structuredClone(restored)
  }

  async delete(projectId: string): Promise<void> {
    assertProjectId(projectId)
    await this.storage.delete(projectId)
  }
}
