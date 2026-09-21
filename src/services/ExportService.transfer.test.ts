/** @vitest-environment node */
import { strFromU8, unzipSync } from 'fflate'
import { describe, expect, it, vi } from 'vitest'
import { RESOURCE_TYPE, type Resource } from '../types/Resource'
import { ExportService, type ArchiveSource } from './ExportService'

function fixture(blob = new Blob(['{"name":"unchanged"}'])): {
  resource: Resource
  source: ArchiveSource
} {
  const resource: Resource = {
    id: 'progress-source',
    type: RESOURCE_TYPE.WORLD_BOOK,
    name: 'progress-source',
    description: '',
    fileName: 'original.json',
    mimeType: 'application/json',
    fileSize: blob.size,
    contentHash: 'original-hash',
    favorite: false,
    categoryId: null,
    tags: [],
    metadata: { format: 'json' },
    originalBlob: blob,
    createdAt: 1,
    updatedAt: 1,
  }
  return { resource, source: { resources: [resource], versions: [], read: async () => resource } }
}

describe('archive transfer lifecycle', () => {
  it('reports generated ZIP bytes through the existing lazy export path without changing originals', async () => {
    const { resource, source } = fixture()
    const progress: Array<{ writtenBytes: number; fileName?: string }> = []
    const [result] = await new ExportService().createArchivesFromSource(
      source,
      [],
      { mode: 'full' },
      undefined,
      { onProgress: (value) => progress.push(value) },
    )
    expect(progress.length).toBeGreaterThan(1)
    expect(progress.at(-1)?.writtenBytes).toBe(result!.blob.size)
    expect(progress.at(-1)?.fileName).toBe(result!.fileName)
    expect(
      progress.every(
        (value, index) => !index || value.writtenBytes >= progress[index - 1]!.writtenBytes,
      ),
    ).toBe(true)
    const entries = unzipSync(new Uint8Array(await result!.blob.arrayBuffer()))
    const manifest = JSON.parse(strFromU8(entries['manifest.json']!))
    expect(strFromU8(entries[manifest.resources[0].archivePath]!)).toBe(
      await resource.originalBlob.text(),
    )
    expect(manifest.signal).toBeUndefined()
    expect(manifest.onProgress).toBeUndefined()
  })

  it('rejects a pre-cancelled export before opening a writer or reading an original', async () => {
    const { source } = fixture()
    const read = vi.fn(source.read)
    source.read = read
    const writerFactory = vi.fn()
    const controller = new AbortController()
    controller.abort(new Error('cancel before export'))
    await expect(
      new ExportService().createArchivesFromSource(source, [], { mode: 'full' }, writerFactory, {
        signal: controller.signal,
      }),
    ).rejects.toThrow('cancel before export')
    expect(writerFactory).not.toHaveBeenCalled()
    expect(read).not.toHaveBeenCalled()
  })

  it('aborts the native archive writer instead of committing when cancellation occurs during the last write', async () => {
    const { source } = fixture()
    const controller = new AbortController()
    const writer = {
      write: vi.fn(async () => controller.abort(new Error('cancel write'))),
      commit: vi.fn(async () => undefined),
      abort: vi.fn(async () => undefined),
    }
    await expect(
      new ExportService().createArchivesFromSource(
        source,
        [],
        { mode: 'full' },
        async () => writer,
        { signal: controller.signal },
      ),
    ).rejects.toThrow('cancel write')
    expect(writer.abort).toHaveBeenCalledOnce()
    expect(writer.commit).not.toHaveBeenCalled()
  })

  it('interrupts a blocked original stream and does not wait for a hung source cancel', async () => {
    let acquired: () => void = () => undefined
    const reading = new Promise<void>((resolve) => (acquired = resolve))
    const cancel = vi.fn(() => new Promise<void>(() => undefined))
    const blob = new Blob(['source'])
    Object.defineProperty(blob, 'stream', {
      value: () => {
        acquired()
        return new ReadableStream<Uint8Array>({ cancel })
      },
    })
    const { source } = fixture(blob)
    const controller = new AbortController()
    const writer = {
      write: vi.fn(async () => undefined),
      commit: vi.fn(async () => undefined),
      abort: vi.fn(async () => undefined),
    }
    const operation = new ExportService().createArchivesFromSource(
      source,
      [],
      { mode: 'full' },
      async () => writer,
      { signal: controller.signal },
    )
    const rejected = expect(operation).rejects.toThrow('cancel blocked source')
    await reading
    controller.abort(new Error('cancel blocked source'))
    await rejected
    expect(cancel).toHaveBeenCalledOnce()
    expect(writer.abort).toHaveBeenCalledOnce()
    expect(writer.commit).not.toHaveBeenCalled()
  })
})
