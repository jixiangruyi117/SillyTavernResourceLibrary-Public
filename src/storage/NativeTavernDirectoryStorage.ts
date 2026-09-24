import { Capacitor, registerPlugin } from '@capacitor/core'
import { transferNativeStream } from '../core/NativeStreamTransfer'
import { base64ToBuffer } from '../services/TavernHttpRelayPort'
import type { TavernDirectoryStorage, TavernDirectoryEntry } from './TavernDirectoryStorage'

interface DirectoryPlugin {
  chooseDirectory(): Promise<{ name: string }>
  status(): Promise<{ name: string }>
  list(options: { path: string }): Promise<{ entries: TavernDirectoryEntry[] }>
  beginRead(options: { path: string }): Promise<{
    missing?: boolean
    token: string
    name: string
    size: number
    type: string
    modified: number
  }>
  readChunk(options: { token: string }): Promise<{ done: boolean; data: string }>
  endRead(options: { token: string }): Promise<void>
  beginWrite(options: { path: string; expectedHash: string | null }): Promise<{ token: string }>
  appendWrite(options: { token: string; data: string }): Promise<void>
  commitWrite(options: { token: string }): Promise<void>
  abortWrite(options: { token: string }): Promise<void>
}
const plugin = registerPlugin<DirectoryPlugin>('NativeTavernDirectory')
export function supportsNativeTavernDirectory(): boolean {
  return (
    Capacitor.getPlatform() === 'android' && Capacitor.isPluginAvailable('NativeTavernDirectory')
  )
}
export class NativeTavernDirectory implements TavernDirectoryStorage {
  readonly name: string
  constructor(name: string) {
    this.name = name
  }
  async list(path: string): Promise<TavernDirectoryEntry[]> {
    return (await plugin.list({ path })).entries
  }
  async read(path: string): Promise<File | null> {
    const meta = await plugin.beginRead({ path })
    if (meta.missing) return null
    let size = 0
    try {
      const chunks: ArrayBuffer[] = []
      while (true) {
        const chunk = await plugin.readChunk({ token: meta.token })
        if (chunk.done) break
        const bytes = base64ToBuffer(chunk.data)
        size += bytes.byteLength
        if (size > 256 * 1024 * 1024 || size > meta.size)
          throw new Error('酒馆文件在读取中变化或超过大小限制')
        chunks.push(bytes)
      }
      if (size !== meta.size) throw new Error('酒馆文件读取不完整')
      return new File(chunks, meta.name, { type: meta.type || '', lastModified: meta.modified })
    } finally {
      await plugin.endRead({ token: meta.token })
    }
  }
  async write(path: string, blob: Blob, expectedHash: string | null): Promise<void> {
    const { token } = await plugin.beginWrite({ path, expectedHash })
    try {
      await transferNativeStream(blob, { append: (data) => plugin.appendWrite({ token, data }) })
      await plugin.commitWrite({ token })
    } catch (error) {
      await plugin.abortWrite({ token }).catch(() => undefined)
      throw error
    }
  }
}
export async function chooseNativeTavernDirectory(reuse = true): Promise<NativeTavernDirectory> {
  if (reuse) {
    try {
      return new NativeTavernDirectory((await plugin.status()).name)
    } catch {
      /* user must choose again */
    }
  }
  return new NativeTavernDirectory((await plugin.chooseDirectory()).name)
}
