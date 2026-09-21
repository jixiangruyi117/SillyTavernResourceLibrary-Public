import { Capacitor, registerPlugin } from '@capacitor/core'
import type { ArchiveStreamWriter } from '../services/ExportService'
import { transferNativeStream } from './NativeStreamTransfer'

export interface NativeSafBackupStatus {
  configured: boolean
  available: boolean
  name?: string
  uri?: string
  availableBytes?: number
  lastBackupAt: number
}

interface NativeSafBackupPlugin {
  chooseDirectory(): Promise<NativeSafBackupStatus>
  getStatus(): Promise<NativeSafBackupStatus>
  clearDirectory(): Promise<NativeSafBackupStatus>
  beginWrite(options: { fileName: string }): Promise<{ token: string }>
  appendWrite(options: { token: string; data: string }): Promise<void>
  commitWrite(options: { token: string }): Promise<{ uri: string; bytes: number }>
  abortWrite(options: { token: string }): Promise<void>
}

const plugin = registerPlugin<NativeSafBackupPlugin>('NativeSafBackup')

export function isNativeSafBackupAvailable(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android'
}

export async function getNativeSafBackupStatus(): Promise<NativeSafBackupStatus | null> {
  if (!isNativeSafBackupAvailable()) return null
  return plugin.getStatus()
}

export async function chooseNativeSafBackupDirectory(): Promise<NativeSafBackupStatus | null> {
  if (!isNativeSafBackupAvailable()) return null
  return plugin.chooseDirectory()
}

export async function clearNativeSafBackupDirectory(): Promise<void> {
  if (!isNativeSafBackupAvailable()) return
  await plugin.clearDirectory()
}

async function appendBinary(token: string, chunk: Uint8Array): Promise<void> {
  await transferNativeStream(new Blob([chunk.slice().buffer]), {
    append: (data) => plugin.appendWrite({ token, data }),
  })
}

/** ZIP 编码器直接写入 SAF OutputStream；不会先在 JS 中合成完整备份 Blob。 */
export async function openNativeSafBackupWriter(
  fileName: string,
): Promise<ArchiveStreamWriter | null> {
  if (!isNativeSafBackupAvailable()) return null
  const status = await plugin.getStatus()
  if (!status.available) return null
  const { token } = await plugin.beginWrite({ fileName })
  return {
    write: (chunk) => appendBinary(token, chunk),
    commit: async () => {
      await plugin.commitWrite({ token })
    },
    abort: async () => {
      await plugin.abortWrite({ token })
    },
  }
}

/** 只在用户已选择且授权仍有效的 SAF 文件夹中写入。失败由调用方回退至常规分享。 */
export async function saveBlobToNativeSafBackup(blob: Blob, fileName: string): Promise<boolean> {
  if (!isNativeSafBackupAvailable()) return false
  const status = await plugin.getStatus()
  if (!status.available) return false
  const { token } = await plugin.beginWrite({ fileName })
  try {
    await transferNativeStream(blob, {
      append: (data) => plugin.appendWrite({ token, data }),
    })
    await plugin.commitWrite({ token })
    return true
  } catch (error) {
    await plugin.abortWrite({ token }).catch(() => undefined)
    throw error
  }
}
