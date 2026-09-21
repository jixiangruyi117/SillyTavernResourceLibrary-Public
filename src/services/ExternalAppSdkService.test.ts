import { describe, expect, it, vi } from 'vitest'

import { ExternalAppSdkService } from './ExternalAppSdkService'

const resource = {
  id: 'resource-1',
  type: 'characterCard' as const,
  name: '测试角色',
  description: '可供第三方读取的测试资源',
  fileName: 'test.json',
  mimeType: 'application/json',
  fileSize: 10,
  contentHash: 'hash',
  favorite: false,
  categoryId: null,
  categoryIds: [],
  relatedResourceIds: [],
  tags: ['测试'],
  metadata: { format: 'character-card', parserVersion: 2, safe: true },
  originalBlob: new Blob([]),
  createdAt: 1,
  updatedAt: 2,
}

function createSdk(permissions: string[]) {
  const externalApps = {
    get: vi.fn(async () => ({ id: 'app', enabled: true, manifest: { permissions } })),
    hasPermission: vi.fn(async (_id: string, permission: string) =>
      permissions.includes(permission),
    ),
  }
  const resources = {
    listSummaries: vi.fn(async () => [{ ...resource, originalBlob: undefined }]),
    get: vi.fn(async (id: string) => (id === resource.id ? resource : undefined)),
    updateExternalAppResource: vi.fn(
      async (update: Record<string, unknown> & { resourceId: string }) => ({
        ...resource,
        ...update,
        id: update.resourceId,
        updatedAt: 3,
      }),
    ),
  }
  return {
    sdk: new ExternalAppSdkService(externalApps as never, resources as never),
    resources,
  }
}

describe('ExternalAppSdkService', () => {
  it('only returns lightweight snapshots when listing the library', async () => {
    const { sdk } = createSdk(['resources.library.read'])
    const listed = await sdk.list('app', { limit: 25 })

    expect(listed).toMatchObject({ total: 1, nextOffset: null })
    expect(listed.items[0]).toMatchObject({ id: 'resource-1', type: 'characterCard', revision: 2 })
    expect(listed.items[0]).not.toHaveProperty('data')
  })

  it('requires explicit library and content permissions before returning metadata', async () => {
    const { sdk } = createSdk(['resources.library.read'])
    await expect(sdk.get('app', 'resource-1')).rejects.toThrow('未获得')

    const allowed = createSdk(['resources.library.read', 'resources.content.read'])
    await expect(allowed.sdk.get('app', 'resource-1')).resolves.toMatchObject({
      data: { format: 'character-card', safe: true },
    })
  })

  it('only reads a selected resource after the host picker returns its id', async () => {
    const { sdk } = createSdk(['resources.selected.read'])
    await expect(sdk.listPickable('app', {})).resolves.toHaveLength(1)
    await expect(sdk.getPicked('app', 'resource-1')).resolves.not.toHaveProperty('data')
  })

  it('updates only one normal resource field through the authorized SDK method', async () => {
    const { sdk, resources } = createSdk(['resources.write'])

    await expect(sdk.update('app', { id: 'resource-1', tags: ['已检查'] })).resolves.toMatchObject({
      id: 'resource-1',
      tags: ['已检查'],
      revision: 3,
    })
    expect(resources.updateExternalAppResource).toHaveBeenCalledWith({
      resourceId: 'resource-1',
      tags: ['已检查'],
    })
    await expect(sdk.update('app', { id: 'resource-1', metadata: {} })).rejects.toThrow(
      '至少提供一项',
    )
  })
})
