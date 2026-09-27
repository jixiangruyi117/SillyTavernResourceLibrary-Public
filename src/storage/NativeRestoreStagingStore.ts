import { Capacitor, registerPlugin } from '@capacitor/core'
import { nativeFileSource, rememberNativeFile } from '../core/NativeFileSource'
import type { ArchiveStageProgress } from '../services/ArchiveExtraction'
import type { RestoreStagingEntry, RestoreStagingMetadata } from '../types/RestoreStaging'
import { IndexedDbRestoreStagingStore } from './IndexedDbRestoreStagingStore'
import { zipArchiveChunks } from '../utils/ZipArchiveStream'

interface NativeArchivePlugin {
  stageArchive(options: {
    uri: string
    size: number
  }): Promise<{ jobId: string; stagedBytes: number; completedEntries: number }>
  readArchiveEntry(options: {
    jobId: string
    path: string
  }): Promise<{ entry?: RestoreStagingMetadata & { uri: string } }>
  deleteArchiveJob(options: { jobId: string }): Promise<void>
}
const plugin = registerPlugin<NativeArchivePlugin>('NativeArchive')

/** Native file staging only; manifest validation and restore transactions keep their owners. */
export class NativeRestoreStagingStore extends IndexedDbRestoreStagingStore {
  async stageNativeArchive(
    file: File,
    onProgress?: (progress: ArchiveStageProgress) => void,
  ): Promise<string | undefined> {
    const uri = nativeFileSource(file)
    if (!uri) return undefined
    try {
      // Keep the existing central-directory, overlap and ZIP64 validation owner.
      for await (const _header of zipArchiveChunks(
        file,
        (plan) => {
          if (plan.uncompressedBytes > 4 * 1024 * 1024 * 1024)
            throw new Error('备份解压后超过支持的大小限制')
        },
        true,
      )) {
        /* Native ZipFile owns payload reads and decompression. */
      }
      const result = await plugin.stageArchive({ uri, size: file.size })
      onProgress?.({
        phase: 'complete',
        readBytes: file.size,
        totalBytes: file.size,
        stagedBytes: result.stagedBytes,
        totalStagedBytes: result.stagedBytes,
        entries: result.completedEntries,
        selectedEntries: result.completedEntries,
        completedEntries: result.completedEntries,
      })
      return result.jobId
    } catch (error) {
      if ((error as { code?: string }).code === 'UNIMPLEMENTED') return undefined
      throw error
    }
  }

  override async getMetadata(
    jobId: string,
    path: string,
  ): Promise<RestoreStagingMetadata | undefined> {
    if (!jobId.startsWith('native-zip-')) return super.getMetadata(jobId, path)
    return (await plugin.readArchiveEntry({ jobId, path })).entry
  }

  override async get(jobId: string, path: string): Promise<RestoreStagingEntry | undefined> {
    if (!jobId.startsWith('native-zip-')) return super.get(jobId, path)
    const { entry } = await plugin.readArchiveEntry({ jobId, path })
    if (!entry) return undefined
    const response = await fetch(Capacitor.convertFileSrc(entry.uri), { cache: 'no-store' })
    if (!response.ok) throw new Error('无法读取原生解压暂存文件')
    const blob = await response.blob()
    if (blob.size !== entry.size) throw new Error('原生解压暂存文件大小不一致')
    return { ...entry, blob: rememberNativeFile(blob, entry.uri) }
  }

  override async deleteJob(jobId: string): Promise<void> {
    if (!jobId.startsWith('native-zip-')) return super.deleteJob(jobId)
    await plugin.deleteArchiveJob({ jobId })
  }
}
