/// <reference lib="webworker" />
import { boundedUnzipPackage, type PackageFileLimit } from '../services/ExternalAppUnzip'

self.addEventListener(
  'message',
  async (event: MessageEvent<{ id: string; bytes: ArrayBuffer; maxFiles?: PackageFileLimit }>) => {
    const { id, bytes, maxFiles } = event.data
    try {
      const files = await boundedUnzipPackage(bytes, maxFiles)
      self.postMessage(
        { id, files },
        { transfer: Object.values(files).map((file) => file.buffer as ArrayBuffer) },
      )
    } catch (error) {
      self.postMessage({ id, error: error instanceof Error ? error.message : '无法读取压缩包' })
    }
  },
)
