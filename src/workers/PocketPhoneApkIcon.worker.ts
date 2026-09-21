import { createBrowserParser } from 'simple-apk-parser'
import { readIconResponse } from '../services/PocketPhoneIconService'

self.onmessage = async ({ data }: MessageEvent<File>) => {
  try {
    const parser = createBrowserParser({
      inflateRaw: async (bytes: Uint8Array) => {
        const stream = new Blob([new Uint8Array(bytes)])
          .stream()
          .pipeThrough(new DecompressionStream('deflate-raw'))
        return new Uint8Array(
          await (await readIconResponse(new Response(stream), 32 * 1024 * 1024)).arrayBuffer(),
        )
      },
    })
    const result = await parser.parseApkFile(data)
    self.postMessage({ blob: result.iconBlob })
  } catch {
    self.postMessage({ error: 'APK 中没有可解析的图片图标' })
  }
}
