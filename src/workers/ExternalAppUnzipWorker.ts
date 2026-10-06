/// <reference lib="webworker" />
import { boundedUnzipPackage } from '../services/ExternalAppUnzip'

self.addEventListener(
  'message',
  async (event: MessageEvent<{ id: string; bytes: ArrayBuffer }>) => {
    const { id, bytes } = event.data
    try {
      const files = await boundedUnzipPackage(bytes)
      self.postMessage(
        { id, files },
        { transfer: Object.values(files).map((file) => file.buffer as ArrayBuffer) },
      )
    } catch (error) {
      self.postMessage({ id, error: error instanceof Error ? error.message : '无法读取压缩包' })
    }
  },
)
