import { afterEach, expect, it, vi } from 'vitest'
import { zipSync } from 'fflate'
import type { AppDatabase } from '../database/AppDatabase'

const plugin = vi.hoisted(() => ({
  stageArchive: vi.fn(),
  readArchiveEntry: vi.fn(),
  deleteArchiveJob: vi.fn(),
}))
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => true, convertFileSrc: (uri: string) => uri },
  registerPlugin: () => plugin,
}))
import { NativeRestoreStagingStore } from './NativeRestoreStagingStore'
import { rememberNativeFile, nativeFileSource } from '../core/NativeFileSource'
import { stageArchive } from '../services/ArchiveExtraction'

afterEach(() => {
  vi.resetAllMocks()
  vi.unstubAllGlobals()
})
const archive = () =>
  rememberNativeFile(
    new File(
      [new Uint8Array(zipSync({ 'manifest.json': new TextEncoder().encode('{}') }))],
      'backup.zip',
    ),
    'file:///backup.zip',
  )

it('备份预检使用同一原生解压 Owner，保留可重建的 jobId 和文件引用', async () => {
  const store = new NativeRestoreStagingStore({} as AppDatabase)
  plugin.stageArchive.mockResolvedValue({
    jobId: 'native-zip-checkpoint',
    stagedBytes: 2,
    completedEntries: 1,
  })
  const file = archive()
  expect(await stageArchive(file, store)).toBe('native-zip-checkpoint')
  expect(plugin.stageArchive).toHaveBeenCalledWith({ uri: 'file:///backup.zip', size: file.size })
  plugin.readArchiveEntry.mockResolvedValue({
    entry: {
      jobId: 'native-zip-checkpoint',
      path: 'manifest.json',
      uri: 'file:///staged',
      size: 2,
      sha256: 'hash',
      updatedAt: 1,
    },
  })
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({ ok: true, blob: async () => new Blob(['{}']) }),
  )
  const entry = await store.get('native-zip-checkpoint', 'manifest.json')
  expect(await entry!.blob.text()).toBe('{}')
  expect(nativeFileSource(entry!.blob)).toBe('file:///staged')
  expect(plugin.deleteArchiveJob).not.toHaveBeenCalled()
  await store.deleteJob('native-zip-checkpoint')
  expect(plugin.deleteArchiveJob).toHaveBeenCalledWith({ jobId: 'native-zip-checkpoint' })
})

it('非法 ZIP 在原生暂存前被原有中央目录校验拒绝', async () => {
  const store = new NativeRestoreStagingStore({} as AppDatabase)
  const file = rememberNativeFile(new File(['not a ZIP'], 'bad.zip'), 'file:///bad.zip')
  await expect(stageArchive(file, store)).rejects.toThrow()
  expect(plugin.stageArchive).not.toHaveBeenCalled()
})

it('仅旧 APK 缺能力时降级；磁盘错误不触发第二次解压', async () => {
  const store = new NativeRestoreStagingStore({} as AppDatabase)
  plugin.stageArchive
    .mockRejectedValueOnce({ code: 'UNIMPLEMENTED' })
    .mockRejectedValueOnce(new Error('disk full'))
  expect(await store.stageNativeArchive(archive())).toBeUndefined()
  await expect(store.stageNativeArchive(archive())).rejects.toThrow('disk full')
})
