import { expect, it, vi, afterEach } from 'vitest'
import type { ArchiveEncoding } from '../services/ArchiveZipWriter'
import { ARCHIVE_FORMAT, ARCHIVE_VERSION } from '../types/Backup'
import { RESOURCE_TYPE, type Resource } from '../types/Resource'

const native = vi.hoisted(() => ({
  beginArchive: vi.fn(),
  getArchiveEntry: vi.fn(),
  resetArchiveInput: vi.fn(),
  appendArchiveInput: vi.fn(),
  compressArchiveEntry: vi.fn(),
  assembleArchive: vi.fn(),
  publishArchive: vi.fn(),
  discardArchiveTask: vi.fn(),
}))
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => true },
  registerPlugin: () => native,
}))
import { openCheckpointArchiveWriter } from './NativeArchiveExport'
import { rememberNativeFile } from './NativeFileSource'

afterEach(() => vi.resetAllMocks())

it('reuses compressed resources without reading originals and routes remaining native files directly', async () => {
  const resource: Resource = {
    id: 'a',
    type: RESOURCE_TYPE.OTHER,
    name: 'a',
    description: '',
    fileName: 'a.txt',
    mimeType: 'text/plain',
    fileSize: 3,
    contentHash: 'a'.repeat(64),
    favorite: false,
    categoryId: null,
    tags: [],
    metadata: {},
    createdAt: 1,
    updatedAt: 1,
    originalBlob: new Blob(['abc']),
  }
  const second = {
    ...resource,
    id: 'b',
    originalBlob: rememberNativeFile(new Blob(['abc']), 'file:///native-b'),
  }
  const read = vi.fn(async (r: Resource) => r)
  native.beginArchive.mockResolvedValue({ id: 'job' })
  native.getArchiveEntry.mockImplementation(async ({ path }: { path: string }) =>
    path === 'files/a'
      ? { entry: { bytes: 11, descriptor: { ...resource, archivePath: path } } }
      : {},
  )
  native.compressArchiveEntry.mockResolvedValue({ bytes: 12 })
  native.assembleArchive.mockResolvedValue({ bytes: 99 })
  const options: ArchiveEncoding = {
    resources: [resource, second],
    versions: [],
    communitySourceAttachments: [],
    manifest: {
      format: ARCHIVE_FORMAT,
      version: ARCHIVE_VERSION,
      mode: 'full',
      createdAt: new Date(1).toISOString(),
      resourceCount: 2,
      categoryCount: 0,
      categories: [],
      resources: [],
      versions: [],
      versionCount: 0,
    },
    read,
    path: (r) => `files/${r.id}`,
    describe: (r) => ({ ...r, archivePath: `files/${r.id}` }),
  }
  const writer = await openCheckpointArchiveWriter('task', 'archive.zip')
  expect(await writer.encode!(options)).toBe(99)
  expect(read.mock.calls.map(([r]) => r.id)).toEqual(['b'])
  expect(native.compressArchiveEntry).toHaveBeenCalledWith(
    expect.objectContaining({ path: 'files/b', uri: 'file:///native-b', size: 3 }),
  )
  expect(native.resetArchiveInput.mock.calls.map(([arg]) => arg.path)).toEqual(['manifest.json'])
  expect(native.assembleArchive).toHaveBeenCalledWith({
    id: 'job',
    paths: ['files/a', 'files/b', 'manifest.json'],
  })
  await writer.abort()
  expect(native.discardArchiveTask).not.toHaveBeenCalled()
  await writer.commit()
  expect(native.publishArchive).toHaveBeenCalledWith({ id: 'job' })
})
