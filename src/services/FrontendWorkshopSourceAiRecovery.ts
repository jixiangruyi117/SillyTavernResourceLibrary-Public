import type { FrontendWorkshopAiLocalStore } from '../storage/FrontendWorkshopAiLocalStorage'
import type { FrontendWorkshopSourceAiSessionSnapshot } from './FrontendWorkshopSourceAiSessionService'
import type { StoredFrontendWorkshopSourceCheckpoint } from './FrontendWorkshopSourceCheckpointService'

export interface FrontendWorkshopSourceAiRecoveryRecord {
  version: 1
  snapshot: FrontendWorkshopSourceAiSessionSnapshot
  anchors: StoredFrontendWorkshopSourceCheckpoint[]
  materializedSourceRevision: number | null
}

/** Serial coalesced writes, with cross-tab CAS. Never writes Author Source or API configuration. */
export class FrontendWorkshopSourceAiRecovery {
  private revisions = new Map<string, number>()
  private queued = new Map<string, FrontendWorkshopSourceAiRecoveryRecord | null>()
  private writing = new Map<string, Promise<void>>()
  private readonly storage: FrontendWorkshopAiLocalStore
  constructor(storage: FrontendWorkshopAiLocalStore) {
    this.storage = storage
  }

  async read(projectId: string): Promise<FrontendWorkshopSourceAiRecoveryRecord | undefined> {
    const value = await this.storage.read(`session:${projectId}`)
    this.revisions.set(projectId, value?.revision ?? 0)
    const record = value?.data as FrontendWorkshopSourceAiRecoveryRecord | undefined
    if (!record) return undefined
    if (
      record.version !== 1 ||
      record.snapshot?.projectId !== projectId ||
      !Array.isArray(record.anchors) ||
      !Array.isArray(record.snapshot.turns) ||
      !Array.isArray(record.snapshot.generations)
    )
      throw new Error('AI 恢复记录格式无效')
    const turns = new Map(record.snapshot.turns.map((turn) => [turn.id, turn]))
    const generations = new Map(
      record.snapshot.generations.map((generation) => [generation.id, generation]),
    )
    if (
      turns.size !== record.snapshot.turns.length ||
      generations.size !== record.snapshot.generations.length
    )
      throw new Error('AI 恢复记录存在重复对话')
    for (const turn of turns.values()) {
      if (
        typeof turn.id !== 'string' ||
        typeof turn.content !== 'string' ||
        !Array.isArray(turn.generationIds) ||
        !Array.isArray(turn.referenceImages) ||
        turn.generationIds.some((id: string) => generations.get(id)?.turnId !== turn.id)
      )
        throw new Error('AI 恢复对话关系无效')
      const visited = new Set<string>([turn.id])
      let parent = turn.parentGenerationId
      while (parent) {
        const ancestor = turns.get(generations.get(parent)?.turnId ?? '')
        if (!ancestor || visited.has(ancestor.id)) throw new Error('AI 恢复对话分支无效')
        visited.add(ancestor.id)
        parent = ancestor.parentGenerationId
      }
    }
    for (const generation of generations.values()) {
      if (
        !turns.get(generation.turnId)?.generationIds.includes(generation.id) ||
        !['pending', 'ready', 'failed', 'applied', 'needs-host-reference'].includes(
          generation.status,
        )
      )
        throw new Error('AI 恢复回复关系无效')
    }
    return record
  }

  save(
    projectId: string,
    record: FrontendWorkshopSourceAiRecoveryRecord | null,
    onError: (error: unknown) => void,
  ): void {
    this.queued.set(projectId, structuredClone(record))
    if (this.writing.has(projectId)) return
    const operation = (async () => {
      try {
        while (this.queued.has(projectId)) {
          const next = this.queued.get(projectId)!
          this.queued.delete(projectId)
          const revision = await this.storage.write(
            `session:${projectId}`,
            next,
            this.revisions.get(projectId) ?? 0,
          )
          this.revisions.set(projectId, revision)
        }
      } catch (error) {
        this.queued.delete(projectId)
        onError(error)
      } finally {
        this.writing.delete(projectId)
      }
    })()
    this.writing.set(projectId, operation)
  }

  async flush(projectId: string): Promise<void> {
    await this.writing.get(projectId)
  }
}
