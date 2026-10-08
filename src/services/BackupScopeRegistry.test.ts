import { describe, expect, it } from 'vitest'

import {
  BACKUP_SCOPE_REGISTRY,
  createDefaultBackupSelection,
  registeredBackupScopeIds,
  toArchivePortableSelection,
  toCloudContentSelection,
} from './BackupScopeRegistry'
import { portableRestoreScopeIds, selectRestorePortableData } from './BackupRestoreSelection'
import type { ArchivePortableData } from '../types/Backup'
import { RESOURCE_TYPE, type ResourceSummary } from '../types/Resource'

const resources = Object.values(RESOURCE_TYPE).map((type, index) => ({
  id: `resource-${index}`,
  name: type,
  fileName: `${type}.json`,
  fileSize: 10,
  type,
  categoryId: null,
  metadata: {},
})) as ResourceSummary[]

describe('BackupScopeRegistry', () => {
  it('restores only selected portable fields, including empty collections and grouped credentials', () => {
    const data: ArchivePortableData = {
      version: 1,
      assistantData: [],
      chatReader: [],
      credentials: { version: 1, cloudBackup: { github: 'fixture-token' } },
    }
    expect(portableRestoreScopeIds(data)).toEqual([
      'extra.chatReader',
      'extra.assistantData',
      'extra.credentials',
    ])
    expect(selectRestorePortableData(data, ['extra.chatReader'])).toEqual({
      version: 1,
      chatReader: [],
    })
    expect(selectRestorePortableData(data, [])).toEqual({ version: 1 })
    expect(selectRestorePortableData(data)).toBe(data)
    expect(selectRestorePortableData(data, ['extra.credentials'])).toEqual({
      version: 1,
      credentials: data.credentials,
    })
  })
  it('为每种资源类型提供唯一注册范围', () => {
    const ids = BACKUP_SCOPE_REGISTRY.map((scope) => scope.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const type of Object.values(RESOURCE_TYPE)) {
      expect(BACKUP_SCOPE_REGISTRY.some((scope) => scope.resourceType === type)).toBe(true)
    }
    expect(registeredBackupScopeIds().size).toBe(ids.length)
  })

  it('默认不选择密钥、凭据和明文副本，并保留本地额外范围', () => {
    const local = createDefaultBackupSelection(resources, 'local')
    expect(local.scopes.has('resource.secret')).toBe(false)
    expect(local.scopes.has('extra.credentials')).toBe(false)
    expect(local.scopes.has('extra.plaintextSecretCopy')).toBe(false)
    expect(local.scopes.has('extra.communitySources')).toBe(true)
    expect(local.scopes.has('extra.assistantData')).toBe(false)
  })

  it('把同一棵树适配到 ZIP 和云备份合同', () => {
    const state = {
      resourceIds: new Set(['resource-0']),
      scopes: new Set([
        'resource.extraStory',
        'extra.credentials',
        'extra.appearance',
        'extra.frontendWorkshopComponents',
        'extra.assistantData',
        'extra.plaintextSecretCopy',
      ] as const),
    }
    const archive = toArchivePortableSelection(state)
    const cloud = toCloudContentSelection(state)
    expect(archive.personalResources).toEqual({
      extraStory: true,
      pocketPhone: false,
      secret: false,
    })
    expect(archive.mainApiProfiles).toBe(true)
    expect(archive.plaintextSecretCopy).toBe(true)
    expect(cloud.resourceIds).toEqual(['resource-0'])
    expect(cloud.credentials).toBe(true)
    expect(cloud.appearance).toBe(true)
    expect(archive.frontendWorkshopComponents).toBe(true)
    expect(cloud.frontendWorkshopComponents).toBe(true)
    expect(archive.assistantData).toBe(true)
    expect(cloud.assistantData).toBe(true)
  })
})
