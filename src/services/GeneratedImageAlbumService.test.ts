import { describe, expect, it, vi } from 'vitest'
import { reactive } from 'vue'

import type { GeneratedImageAlbumStorage } from '../storage/GeneratedImageAlbumStorage'
import type { GeneratedImageAlbumFile, GeneratedImageAlbumItem } from '../types/GeneratedImageAlbum'
import { GeneratedImageAlbumService } from './GeneratedImageAlbumService'

function memoryStorage(): GeneratedImageAlbumStorage {
  const items = new Map<string, GeneratedImageAlbumItem>()
  const files = new Map<string, GeneratedImageAlbumFile>()
  return {
    list: async () => Array.from(items.values()),
    get: async (id) => items.get(id),
    getFile: async (id) => files.get(id),
    put: async (item, file) => {
      items.set(item.id, item)
      files.set(file.id, file)
    },
    update: async (item) => {
      items.set(item.id, item)
    },
    delete: async (id) => {
      items.delete(id)
      files.delete(id)
    },
  }
}

describe('GeneratedImageAlbumService', () => {
  it('persists a JSON manifest from a reactive result and preserves it through hosting without migrating old items', async () => {
    const storage = memoryStorage()
    const service = new GeneratedImageAlbumService(
      storage,
      async () => new Blob(['png'], { type: 'image/png' }),
    )
    const image = reactive({
      id: 'manifest-image',
      provider: 'openai' as const,
      mimeType: 'image/png',
      extension: 'png' as const,
      width: 1024,
      height: 1024,
      prompt: 'edit',
      parameters: {},
      createdAt: 1,
      manifest: {
        version: 1 as const,
        provider: 'openai' as const,
        model: 'gpt-image-2',
        prompt: 'edit',
        width: 1024,
        height: 1024,
        outputFormat: 'png' as const,
        createdAt: 1,
        parentImageId: 'parent',
        parameters: { preserve: { identity: true }, inputRoles: ['identity'] },
      },
    })
    await service.saveGenerated(image)
    image.manifest.parameters.preserve.identity = false
    await service.setHostedUrl(image.id, { url: 'https://img.example/manifest.png' }, 'shared')
    const saved = await service.get(image.id)
    expect(saved?.generationManifest).toMatchObject({
      model: 'gpt-image-2',
      parentImageId: 'parent',
      parameters: { preserve: { identity: true } },
    })
    expect((await service.list({ hostedStatus: 'hosted' })).items).toHaveLength(1)
    expect((await service.list({ hostedStatus: 'local' })).items).toHaveLength(0)
    await service.clearHostedUrl(image.id)
    expect((await service.list({ hostedStatus: 'all' })).items).toHaveLength(1)
    expect((await service.list({ hostedStatus: 'local' })).items).toHaveLength(1)
    expect((await service.get(image.id))?.generationManifest).toEqual(saved?.generationManifest)
  })
  it('saves generated metadata separately and does not duplicate the same candidate', async () => {
    const storage = memoryStorage()
    const resolve = vi.fn(async () => new Blob(['png'], { type: 'image/png' }))
    const service = new GeneratedImageAlbumService(storage, resolve)
    const generated = {
      id: 'candidate-a',
      provider: 'openai' as const,
      dataUrl: 'data:image/png;base64,cG5n',
      mimeType: 'image/png',
      extension: 'png' as const,
      width: 1024,
      height: 1024,
      prompt: '月下庭院',
      parameters: { quality: 'high' },
      createdAt: 10,
    }

    await service.saveGenerated(generated, { category: '背景' })
    await service.saveGenerated(generated, { category: '其他' })

    expect(resolve).toHaveBeenCalledTimes(1)
    await expect(service.list()).resolves.toMatchObject({
      total: 1,
      items: [expect.objectContaining({ id: 'candidate-a', category: '背景' })],
    })
    await expect(service.getOriginalBlob('candidate-a')).resolves.toBeInstanceOf(Blob)
    const stored = await storage.getFile('candidate-a')
    expect(stored?.originalBlob).toBeInstanceOf(Blob)
    expect(stored?.originalBase64).toBeUndefined()
  })

  it('filters by format, category and prompt then records the hosted URL', async () => {
    const storage = memoryStorage()
    const service = new GeneratedImageAlbumService(storage, async () => new Blob())
    await storage.put(
      {
        id: 'one',
        name: '封面',
        source: 'generated',
        prompt: 'blue moon',
        category: '背景',
        mimeType: 'image/webp',
        sizeBytes: 4,
        createdAt: 2,
        updatedAt: 2,
      },
      {
        id: 'one',
        originalBase64: 'd2VicA==',
        originalMimeType: 'image/webp',
        updatedAt: 2,
      },
    )

    const result = await service.list({ search: 'moon', category: '背景', mimeType: 'image/webp' })
    expect(result.items).toHaveLength(1)
    await service.setHostedUrl(
      'one',
      { url: 'https://img.example/one.webp', id: 'remote' },
      'shared',
    )
    await expect(service.get('one')).resolves.toMatchObject({
      hostedUrl: 'https://img.example/one.webp',
      hostedImageId: 'remote',
      hostingMode: 'shared',
    })
  })

  it('persists self-hosted file identity and can clear only remote hosting metadata', async () => {
    const storage = memoryStorage()
    const service = new GeneratedImageAlbumService(storage, async () => new Blob())
    await storage.put(
      {
        id: 'self-one',
        name: '自己的图',
        source: 'generated',
        category: '',
        mimeType: 'image/png',
        sizeBytes: 8,
        createdAt: 3,
        updatedAt: 3,
      },
      {
        id: 'self-one',
        originalBase64: 'cG5n',
        originalMimeType: 'image/png',
        updatedAt: 3,
      },
    )

    await service.setHostedUrl(
      'self-one',
      {
        url: 'https://cdn.example/image.png',
        managementOrigin: 'https://mine.example',
        upstreamFileId: 'srl-workshop/abc.png',
      },
      'self-hosted',
    )
    await expect(service.get('self-one')).resolves.toMatchObject({
      hostedUrl: 'https://cdn.example/image.png',
      hostingMode: 'self-hosted',
      hostedOrigin: 'https://mine.example',
      hostedFileId: 'srl-workshop/abc.png',
    })

    const cleared = await service.clearHostedUrl('self-one')
    expect(cleared.hostedUrl).toBeUndefined()
    expect(cleared.hostingMode).toBeUndefined()
    expect(cleared.hostedOrigin).toBeUndefined()
    expect(cleared.hostedFileId).toBeUndefined()
    await expect(service.getOriginalBlob('self-one')).resolves.toBeInstanceOf(Blob)
  })
})
