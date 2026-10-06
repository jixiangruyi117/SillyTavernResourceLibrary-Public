import { describe, expect, it } from 'vitest'
import type { Resource } from '../types/Resource'
import {
  cloneBlob,
  hydrateResourceFromIndexedDb,
  materializeResourceForIndexedDb,
} from './ResourceStorageClone'

describe('cloneBlob', () => {
  it('materializes File bytes as a detached Blob for WebKit IndexedDB persistence', async () => {
    const file = new File(['preset'], 'preset.json', { type: 'application/json' })
    const cloned = await cloneBlob(file)

    expect(cloned).toBeInstanceOf(Blob)
    expect(cloned).not.toBe(file)
    expect(cloned?.type).toBe('application/json')
    expect(await cloned?.text()).toBe('preset')
  })
})

describe('IndexedDB binary boundary', () => {
  it('stores resource bodies as ArrayBuffer and hydrates them back to Blob', async () => {
    const resource = {
      id: 'resource-1',
      type: 'preset',
      name: '预设',
      description: '',
      fileName: 'preset.json',
      mimeType: 'application/json',
      fileSize: 6,
      contentHash: 'a'.repeat(64),
      favorite: false,
      categoryId: null,
      tags: [],
      metadata: {},
      originalBlob: new Blob(['preset'], { type: 'application/json' }),
      createdAt: 1,
      updatedAt: 1,
    } as Resource

    const stored = await materializeResourceForIndexedDb(resource)
    const storedBlob = (stored as { originalBlob: unknown }).originalBlob
    expect(storedBlob).toBeInstanceOf(ArrayBuffer)

    const hydrated = hydrateResourceFromIndexedDb(stored)
    expect(hydrated.originalBlob).toBeInstanceOf(Blob)
    expect(await hydrated.originalBlob.text()).toBe('preset')
  })
})
