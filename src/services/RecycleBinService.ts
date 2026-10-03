import type { AppDatabase } from '../database/AppDatabase'
import { includeResourceGalleryIds } from '../types/ResourceGallery'
import type { BackupRecord } from '../types/Resource'
import type { CategoryService } from './CategoryService'
import { createResourceArchiveSource, type ExportService } from './ExportService'
import type { ResourceService } from './ResourceService'
import type { RestoreService } from './RestoreService'
import type { VaultService } from './VaultService'
import type { UserPersonaService } from './UserPersonaService'
import { updatePersonaInBackup } from '../parser/SillyTavernPersonaBackup'
import type { UserPersonaCharacterVariantVersion, UserPersonaDraft } from '../types/UserPersona'

const RECYCLE_BIN_ADAPTER = 'local-recycle-bin'
const RECYCLE_BIN_PERSONA_VERSION_ADAPTER = 'local-recycle-bin-persona-version'

interface PersonaVersionRecyclePayload {
  version: 1
  resourceId: string
  avatarId: string
  personaName: string
  characterId: string
  characterName: string
  versionId: string
  variantVersion: UserPersonaCharacterVariantVersion
  wasDefault: boolean
  chatIds: string[]
}

interface PersonaCharacterRecyclePayload {
  version: 1
  resourceId: string
  avatarId: string
  personaName: string
  characterId: string
  characterName: string
  variant: UserPersonaDraft['profile']['variants'][string]
}

export interface RecycleBinMoveProgress {
  phase: 'archive' | 'save' | 'delete'
  writtenBytes?: number
  completed?: number
  total?: number
}

function recycleArchiveFileName(createdAt: Date): string {
  const timestamp = createdAt.toISOString().replace(/[:.]/g, '-').slice(0, 19)
  return `回收站-${timestamp}.zip`
}

export class RecycleBinService {
  private readonly database: AppDatabase
  private readonly resourceService: ResourceService
  private readonly categoryService: CategoryService
  private readonly exportService: ExportService
  private readonly restoreService: RestoreService
  private readonly vaultService: VaultService
  private readonly userPersonaService: UserPersonaService

  constructor(
    database: AppDatabase,
    resourceService: ResourceService,
    categoryService: CategoryService,
    exportService: ExportService,
    restoreService: RestoreService,
    vaultService: VaultService,
    userPersonaService: UserPersonaService,
  ) {
    this.database = database
    this.resourceService = resourceService
    this.categoryService = categoryService
    this.exportService = exportService
    this.restoreService = restoreService
    this.vaultService = vaultService
    this.userPersonaService = userPersonaService
  }

  async list(): Promise<BackupRecord[]> {
    const records = await this.database.backupRecords
      .where('adapter')
      .anyOf([RECYCLE_BIN_ADAPTER, RECYCLE_BIN_PERSONA_VERSION_ADAPTER])
      .toArray()
    return records.sort((left, right) => right.createdAt - left.createdAt)
  }

  async movePersonaVersionToRecycleBin(input: {
    resourceId: string
    avatarId: string
    characterId: string
    characterName: string
    versionId: string
  }): Promise<BackupRecord> {
    const { resource, view } = await this.userPersonaService.load(input.resourceId)
    const entry = view.entries.find((item) => item.avatarId === input.avatarId)
    const profile = entry?.profile
    const variant = profile?.variants[input.characterId]
    const version = variant?.versions[input.versionId]
    if (!entry || !profile || !variant || !version)
      throw new Error('要删除的角色人设版本已经不存在，请刷新后重试')

    const payload: PersonaVersionRecyclePayload = {
      version: 1,
      resourceId: resource.id,
      avatarId: entry.avatarId,
      personaName: entry.name,
      characterId: input.characterId,
      characterName: input.characterName,
      versionId: input.versionId,
      variantVersion: JSON.parse(JSON.stringify(version)) as UserPersonaCharacterVariantVersion,
      wasDefault: variant.defaultVersionId === input.versionId,
      chatIds: Object.entries(variant.chatVersions ?? {})
        .filter(([, selectedVersionId]) => selectedVersionId === input.versionId)
        .map(([chatId]) => chatId),
    }
    const createdAt = Date.now()
    let blob = new Blob([JSON.stringify(payload)], { type: 'application/json' })
    let encrypted = false
    let encryptionIv: string | undefined
    if (this.vaultService.isEnabled()) {
      const protectedBlob = await this.vaultService.protectBlob(blob)
      blob = protectedBlob.data
      encrypted = true
      encryptionIv = protectedBlob.iv
    }
    const record: BackupRecord = {
      id: crypto.randomUUID(),
      adapter: RECYCLE_BIN_PERSONA_VERSION_ADAPTER,
      itemKind: 'persona-version',
      objectKey: `user-persona-version-${createdAt}.json`,
      resourceCount: 1,
      createdAt,
      reason: `${entry.name} · ${input.characterName} · ${version.name}`,
      size: blob.size,
      blob,
      encrypted,
      encryptionIv,
    }

    const updatedProfile = JSON.parse(JSON.stringify(profile)) as typeof profile
    const updatedVariant = updatedProfile.variants[input.characterId]!
    delete updatedVariant.versions[input.versionId]
    if (updatedVariant.chatVersions) {
      for (const [chatId, selectedVersionId] of Object.entries(updatedVariant.chatVersions)) {
        if (selectedVersionId === input.versionId) delete updatedVariant.chatVersions[chatId]
      }
    }
    const remainingVersionIds = Object.keys(updatedVariant.versions)
    if (!remainingVersionIds.length) delete updatedProfile.variants[input.characterId]
    else if (updatedVariant.defaultVersionId === input.versionId)
      updatedVariant.defaultVersionId = remainingVersionIds[0]!

    const draft: UserPersonaDraft = {
      avatarId: entry.avatarId,
      name: entry.name,
      title: entry.title,
      description: entry.description,
      position: entry.position,
      depth: entry.depth,
      role: entry.role,
      lorebook: entry.lorebook,
      connections: entry.connections,
      characterBindings: entry.characterBindings,
      profile: updatedProfile,
    }
    const backup = updatePersonaInBackup(view.raw, entry.avatarId, draft)

    await this.database.backupRecords.put(record)
    try {
      await this.userPersonaService.save(
        resource.id,
        backup,
        resource.relatedResourceIds ?? [],
        '移除角色人设版本到回收站',
        undefined,
        false,
      )
    } catch (error) {
      await this.database.backupRecords.delete(record.id)
      throw error
    }
    return record
  }

  async movePersonaCharacterToRecycleBin(input: {
    resourceId: string
    avatarId: string
    characterId: string
    characterName: string
  }): Promise<BackupRecord> {
    const { resource, view } = await this.userPersonaService.load(input.resourceId)
    const entry = view.entries.find((item) => item.avatarId === input.avatarId)
    const variant = entry?.profile.variants[input.characterId]
    if (!entry || !variant) throw new Error('要删除的角色卡人设已经不存在，请刷新后重试')

    const payload: PersonaCharacterRecyclePayload = {
      version: 1,
      resourceId: resource.id,
      avatarId: entry.avatarId,
      personaName: entry.name,
      characterId: input.characterId,
      characterName: input.characterName,
      variant: JSON.parse(JSON.stringify(variant)) as PersonaCharacterRecyclePayload['variant'],
    }
    const createdAt = Date.now()
    let blob = new Blob([JSON.stringify(payload)], { type: 'application/json' })
    let encrypted = false
    let encryptionIv: string | undefined
    if (this.vaultService.isEnabled()) {
      const protectedBlob = await this.vaultService.protectBlob(blob)
      blob = protectedBlob.data
      encrypted = true
      encryptionIv = protectedBlob.iv
    }
    const record: BackupRecord = {
      id: crypto.randomUUID(),
      adapter: RECYCLE_BIN_PERSONA_VERSION_ADAPTER,
      itemKind: 'persona-character',
      objectKey: `user-persona-character-${createdAt}.json`,
      resourceCount: 1,
      createdAt,
      reason: `${entry.name} · ${input.characterName} · 角色人设`,
      size: blob.size,
      blob,
      encrypted,
      encryptionIv,
    }
    const profile = JSON.parse(JSON.stringify(entry.profile)) as typeof entry.profile
    delete profile.variants[input.characterId]
    const draft: UserPersonaDraft = {
      avatarId: entry.avatarId,
      name: entry.name,
      title: entry.title,
      description: entry.description,
      position: entry.position,
      depth: entry.depth,
      role: entry.role,
      lorebook: entry.lorebook,
      connections: entry.connections,
      characterBindings: entry.characterBindings,
      profile,
    }
    const backup = updatePersonaInBackup(view.raw, entry.avatarId, draft)

    await this.database.backupRecords.put(record)
    try {
      await this.userPersonaService.save(
        resource.id,
        backup,
        resource.relatedResourceIds ?? [],
        '移除角色卡人设到回收站',
        undefined,
        false,
      )
    } catch (error) {
      await this.database.backupRecords.delete(record.id)
      throw error
    }
    return record
  }

  async moveToRecycleBin(
    ids: string[],
    onProgress?: (progress: RecycleBinMoveProgress) => void,
  ): Promise<BackupRecord> {
    const selectedIds = Array.from(new Set(ids.filter(Boolean)))
    if (!selectedIds.length) throw new Error('请选择要移入回收站的资源')

    const source = await createResourceArchiveSource(this.resourceService)
    const selected = new Set(selectedIds)
    includeResourceGalleryIds(source.resources, selected, true)
    const resources = source.resources.filter((resource) => selected.has(resource.id))
    if (!resources.length) throw new Error('要删除的资源已经不存在')

    const categories = await this.categoryService.list()
    const resourceIds = new Set(resources.map((resource) => resource.id))
    const versions = source.versions.filter(
      (version) => version.versionGroupId && resourceIds.has(version.versionGroupId),
    )
    onProgress?.({ phase: 'archive' })
    const [archive] = await this.exportService.createArchivesFromSource(
      { ...source, resources, versions },
      categories,
      { mode: 'partial', preserveExternalRelatedResourceIds: true },
      undefined,
      {
        onProgress: ({ writtenBytes }) => onProgress?.({ phase: 'archive', writtenBytes }),
      },
    )
    if (!archive) throw new Error('未能创建回收站恢复记录')
    const createdAt = Date.now()
    let blob = archive.blob
    let encrypted = false
    let encryptionIv: string | undefined
    if (this.vaultService.isEnabled()) {
      const protectedBlob = await this.vaultService.protectBlob(blob)
      blob = protectedBlob.data
      encrypted = true
      encryptionIv = protectedBlob.iv
    }
    const record: BackupRecord = {
      id: crypto.randomUUID(),
      adapter: RECYCLE_BIN_ADAPTER,
      objectKey: recycleArchiveFileName(new Date(createdAt)),
      resourceCount: resources.length,
      createdAt,
      reason:
        resources.length === 1
          ? resources[0]!.name
          : `${resources[0]!.name} 等 ${resources.length} 项资源`,
      size: blob.size,
      blob,
      encrypted,
      encryptionIv,
    }
    onProgress?.({ phase: 'save' })
    await this.database.backupRecords.put(record)
    onProgress?.({ phase: 'delete', completed: 0, total: resources.length + versions.length })
    await this.resourceService.deleteMany(
      resources.map((resource) => resource.id),
      ({ completed, total }) => onProgress?.({ phase: 'delete', completed, total }),
    )
    return record
  }

  async restore(id: string): Promise<void> {
    const record = await this.getRecord(id)
    if (!record.blob) throw new Error('回收站记录已损坏，无法恢复')
    if (record.itemKind === 'persona-version') {
      const payload = await this.readPersonaVersionPayload(record)
      await this.restorePersonaVersion(payload)
      await this.database.backupRecords.delete(record.id)
      return
    }
    if (record.itemKind === 'persona-character') {
      const payload = await this.readPersonaCharacterPayload(record)
      await this.restorePersonaCharacter(payload)
      await this.database.backupRecords.delete(record.id)
      return
    }
    let blob = record.blob
    if (record.encrypted) {
      if (!record.encryptionIv) throw new Error('回收站记录缺少加密参数')
      blob = await this.vaultService.revealBlob(
        { iv: record.encryptionIv, data: record.blob },
        'application/zip',
      )
    }
    const [resources, categories] = await Promise.all([
      this.resourceService.listResourceListSummaries(),
      this.categoryService.list(),
    ])
    const prepared = await this.restoreService.prepare(
      new File([blob], record.objectKey, { type: 'application/zip' }),
      resources,
      categories,
      true,
    )
    if (prepared.preview.mode !== 'partial') throw new Error('回收站记录格式无效')
    await this.restoreService.restore(prepared)
    await this.resourceService.restoreRelatedLinks(prepared.resources)
    await this.database.backupRecords.delete(record.id)
  }

  async purge(
    id: string,
    onProgress?: (progress: { completed: number; total: number }) => void,
  ): Promise<void> {
    await this.getRecord(id)
    onProgress?.({ completed: 0, total: 1 })
    await this.database.backupRecords.delete(id)
    onProgress?.({ completed: 1, total: 1 })
  }

  async empty(
    onProgress?: (progress: { completed: number; total: number }) => void,
  ): Promise<void> {
    const records = await this.list()
    if (!records.length) return
    const total = records.length
    const batchSize = 16
    let completed = 0
    onProgress?.({ completed, total })
    for (let offset = 0; offset < total; offset += batchSize) {
      const batch = records.slice(offset, offset + batchSize)
      await this.database.backupRecords.bulkDelete(batch.map((record) => record.id))
      completed += batch.length
      onProgress?.({ completed, total })
    }
  }

  private async getRecord(id: string): Promise<BackupRecord> {
    const record = await this.database.backupRecords.get(id)
    if (
      !record ||
      ![RECYCLE_BIN_ADAPTER, RECYCLE_BIN_PERSONA_VERSION_ADAPTER].includes(record.adapter)
    )
      throw new Error('回收站记录已经不存在')
    return record
  }

  private async readPersonaVersionPayload(
    record: BackupRecord,
  ): Promise<PersonaVersionRecyclePayload> {
    let blob = record.blob!
    if (record.encrypted) {
      if (!record.encryptionIv) throw new Error('回收站记录缺少加密参数')
      blob = await this.vaultService.revealBlob(
        { iv: record.encryptionIv, data: blob },
        'application/json',
      )
    }
    const payload: unknown = JSON.parse(await blob.text())
    if (
      !payload ||
      typeof payload !== 'object' ||
      (payload as PersonaVersionRecyclePayload).version !== 1 ||
      typeof (payload as PersonaVersionRecyclePayload).resourceId !== 'string' ||
      typeof (payload as PersonaVersionRecyclePayload).avatarId !== 'string' ||
      typeof (payload as PersonaVersionRecyclePayload).characterId !== 'string' ||
      typeof (payload as PersonaVersionRecyclePayload).versionId !== 'string' ||
      !(payload as PersonaVersionRecyclePayload).variantVersion ||
      typeof (payload as PersonaVersionRecyclePayload).variantVersion.name !== 'string' ||
      !Array.isArray((payload as PersonaVersionRecyclePayload).chatIds)
    )
      throw new Error('回收站的人设版本记录无效')
    return payload as PersonaVersionRecyclePayload
  }

  private async restorePersonaVersion(payload: PersonaVersionRecyclePayload): Promise<void> {
    const { resource, view } = await this.userPersonaService.load(payload.resourceId)
    const entry = view.entries.find((item) => item.avatarId === payload.avatarId)
    if (!entry) throw new Error('原 user 人设已不存在，请先从回收站恢复对应人设资源')
    const profile = JSON.parse(JSON.stringify(entry.profile)) as typeof entry.profile
    let variant = profile.variants[payload.characterId]
    if (!variant) {
      variant = { versions: {}, defaultVersionId: '' }
      profile.variants[payload.characterId] = variant
    }
    const versionId = variant.versions[payload.versionId] ? crypto.randomUUID() : payload.versionId
    variant.versions[versionId] = JSON.parse(
      JSON.stringify(payload.variantVersion),
    ) as UserPersonaCharacterVariantVersion
    if (payload.wasDefault || !variant.defaultVersionId) variant.defaultVersionId = versionId
    if (payload.chatIds.length) {
      variant.chatVersions ||= {}
      for (const chatId of payload.chatIds) variant.chatVersions[chatId] = versionId
    }
    const draft: UserPersonaDraft = {
      avatarId: entry.avatarId,
      name: entry.name,
      title: entry.title,
      description: entry.description,
      position: entry.position,
      depth: entry.depth,
      role: entry.role,
      lorebook: entry.lorebook,
      connections: entry.connections,
      characterBindings: entry.characterBindings,
      profile,
    }
    const backup = updatePersonaInBackup(view.raw, entry.avatarId, draft)
    await this.userPersonaService.save(
      resource.id,
      backup,
      resource.relatedResourceIds ?? [],
      '从回收站恢复角色人设版本',
      undefined,
      false,
    )
  }

  private async readPersonaCharacterPayload(
    record: BackupRecord,
  ): Promise<PersonaCharacterRecyclePayload> {
    let blob = record.blob!
    if (record.encrypted) {
      if (!record.encryptionIv) throw new Error('回收站记录缺少加密参数')
      blob = await this.vaultService.revealBlob(
        { iv: record.encryptionIv, data: blob },
        'application/json',
      )
    }
    const payload: unknown = JSON.parse(await blob.text())
    if (
      !payload ||
      typeof payload !== 'object' ||
      (payload as PersonaCharacterRecyclePayload).version !== 1 ||
      typeof (payload as PersonaCharacterRecyclePayload).resourceId !== 'string' ||
      typeof (payload as PersonaCharacterRecyclePayload).avatarId !== 'string' ||
      typeof (payload as PersonaCharacterRecyclePayload).characterId !== 'string' ||
      !(payload as PersonaCharacterRecyclePayload).variant ||
      typeof (payload as PersonaCharacterRecyclePayload).variant.defaultVersionId !== 'string' ||
      !(payload as PersonaCharacterRecyclePayload).variant.versions
    )
      throw new Error('回收站的角色卡人设记录无效')
    return payload as PersonaCharacterRecyclePayload
  }

  private async restorePersonaCharacter(payload: PersonaCharacterRecyclePayload): Promise<void> {
    const { resource, view } = await this.userPersonaService.load(payload.resourceId)
    const entry = view.entries.find((item) => item.avatarId === payload.avatarId)
    if (!entry) throw new Error('原 user 人设已不存在，请先从回收站恢复对应人设资源')
    const profile = JSON.parse(JSON.stringify(entry.profile)) as typeof entry.profile
    const existing = profile.variants[payload.characterId]
    if (!existing) profile.variants[payload.characterId] = payload.variant
    else {
      const restoredIdMap = new Map<string, string>()
      for (const [versionId, version] of Object.entries(payload.variant.versions)) {
        const restoredId = existing.versions[versionId] ? crypto.randomUUID() : versionId
        restoredIdMap.set(versionId, restoredId)
        existing.versions[restoredId] = JSON.parse(JSON.stringify(version))
      }
      if (!existing.defaultVersionId || !existing.versions[existing.defaultVersionId])
        existing.defaultVersionId = restoredIdMap.get(payload.variant.defaultVersionId) ?? ''
      if (payload.variant.chatVersions) {
        existing.chatVersions ||= {}
        for (const [chatId, versionId] of Object.entries(payload.variant.chatVersions)) {
          const restoredId = restoredIdMap.get(versionId)
          if (restoredId) existing.chatVersions[chatId] = restoredId
        }
      }
    }
    const draft: UserPersonaDraft = {
      avatarId: entry.avatarId,
      name: entry.name,
      title: entry.title,
      description: entry.description,
      position: entry.position,
      depth: entry.depth,
      role: entry.role,
      lorebook: entry.lorebook,
      connections: entry.connections,
      characterBindings: entry.characterBindings,
      profile,
    }
    const backup = updatePersonaInBackup(view.raw, entry.avatarId, draft)
    await this.userPersonaService.save(
      resource.id,
      backup,
      resource.relatedResourceIds ?? [],
      '从回收站恢复角色卡人设',
      undefined,
      false,
    )
  }
}
