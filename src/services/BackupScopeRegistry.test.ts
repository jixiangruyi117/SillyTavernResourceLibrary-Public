import { describe, expect, it } from 'vitest'

import {
  BACKUP_SCOPE_REGISTRY,
  createDefaultBackupSelection,
  registeredBackupScopeIds,
  toArchivePortableSelection,
  toCloudContentSelection,
} from './BackupScopeRegistry'
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
  })

  it('把同一棵树适配到 ZIP 和云备份合同', () => {
    const state = {
      resourceIds: new Set(['resource-0']),
      scopes: new Set([
        'resource.extraStory',
        'extra.credentials',
        'extra.appearance',
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
  })
})
