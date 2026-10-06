import { Capacitor, registerPlugin } from '@capacitor/core'
import { transferNativeStream, type NativeStreamProgress } from './NativeStreamTransfer'
import { taskCenter } from './TaskCenter'

const IMAGE_DESTINATION_KEY = 'srl.native-export.image-destination'
const FILE_DESTINATION_KEY = 'srl.native-export.file-destination'

export type NativeExportDestination = 'pictures' | 'downloads' | 'directory'
export type NativeExportPreference = NativeExportDestination | 'ask'

export interface NativeExportDirectoryStatus {
  configured: boolean
  available: boolean
  name?: string
}

interface NativeFileExportPlugin {
  downloadResourceToWrite(options: {
    token: string
    resourceId: string
    expectedSize: number
  }): Promise<void>
  downloadResourceForImport(options: {
    resourceId: string
    expectedSize: number
  }): Promise<{ token: string; uri: string; bytes: number }>
  releaseImportedResource(options: { token: string }): Promise<void>
  chooseDirectory(): Promise<NativeExportDirectoryStatus>
  getDirectoryStatus(): Promise<NativeExportDirectoryStatus>
  clearDirectory(): Promise<NativeExportDirectoryStatus>
  beginWrite(options: {
    destination: NativeExportDestination
    fileName: string
    mimeType: string
  }): Promise<{ token: string }>
  appendWrite(options: { token: string; data: string }): Promise<void>
  commitWrite(options: { token: string }): Promise<{ uri: string; bytes: number }>
  abortWrite(options: { token: string }): Promise<void>
}

const plugin = registerPlugin<NativeFileExportPlugin>('NativeFileExport')

export async function readPlazaResourceForImport(
  resourceId: string,
  fileName: string,
  expectedSize: number,
): Promise<File> {
  if (!isNativeFileExportAvailable()) throw new Error('当前设备不支持资源广场导入')
  const staged = await plugin.downloadResourceForImport({ resourceId, expectedSize })
  try {
    if (staged.bytes !== expectedSize) throw new Error('暂存资源大小不一致')
    const response = await fetch(Capacitor.convertFileSrc(staged.uri), { cache: 'no-store' })
    if (!response.ok) throw new Error('无法读取暂存资源文件')
    const blob = await response.blob()
    if (blob.size !== expectedSize) throw new Error('读取的资源文件大小不一致')
    return new File([blob], fileName, { type: blob.type })
  } finally {
    await plugin.releaseImportedResource({ token: staged.token })
  }
}

export async function savePlazaResourceToDownloads(
  resourceId: string,
  fileName: string,
  expectedSize: number,
): Promise<void> {
  const task = taskCenter.start({
    name: `下载 ${fileName}`,
    phase: '保存到下载目录 / SRL',
    cancelable: false,
  })
  let token = ''
  try {
    const staged = await plugin.beginWrite({
      destination: 'downloads',
      fileName,
      mimeType: 'application/octet-stream',
    })
    token = staged.token
    await plugin.downloadResourceToWrite({ token, resourceId, expectedSize })
    const result = await plugin.commitWrite({ token })
    token = ''
    if (result.bytes !== expectedSize) throw new Error('保存的资源大小不一致')
    taskCenter.complete(task)
  } catch (error) {
    if (token) await plugin.abortWrite({ token }).catch(() => undefined)
    taskCenter.fail(task, error)
    throw error
  }
}

export function isNativeFileExportAvailable(): boolean {
  return (
    Capacitor.isNativePlatform() &&
    Capacitor.getPlatform() === 'android' &&
    Capacitor.isPluginAvailable('NativeFileExport')
  )
}

export function getNativeExportPreference(kind: 'image' | 'file'): NativeExportPreference {
  const key = kind === 'image' ? IMAGE_DESTINATION_KEY : FILE_DESTINATION_KEY
  try {
    const value = localStorage.getItem(key)
    return value === 'pictures' || value === 'downloads' || value === 'directory' ? value : 'ask'
  } catch {
    return 'ask'
  }
}

export function setNativeExportPreference(
  kind: 'image' | 'file',
  value: NativeExportPreference,
): void {
  const key = kind === 'image' ? IMAGE_DESTINATION_KEY : FILE_DESTINATION_KEY
  try {
    if (value === 'ask') localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    // 私密模式或受限 WebView 中不能持久化时，仍允许本次导出。
  }
}

export async function getNativeExportDirectoryStatus(): Promise<NativeExportDirectoryStatus | null> {
  if (!isNativeFileExportAvailable()) return null
  return plugin.getDirectoryStatus()
}

export async function chooseNativeExportDirectory(): Promise<NativeExportDirectoryStatus | null> {
  if (!isNativeFileExportAvailable()) return null
  return plugin.chooseDirectory()
}

export async function clearNativeExportDirectory(): Promise<void> {
  if (!isNativeFileExportAvailable()) return
  await plugin.clearDirectory()
}

export async function saveBlobToNativeDestination(
  blob: Blob,
  fileName: string,
  destination: NativeExportDestination,
  options: { signal?: AbortSignal; onProgress?: (progress: NativeStreamProgress) => void } = {},
): Promise<{ uri: string; bytes: number }> {
  if (!isNativeFileExportAvailable()) throw new Error('当前设备不支持直接保存到系统目录')
  const controller = new AbortController()
  const abort = (): void => controller.abort(options.signal?.reason)
  if (options.signal?.aborted) abort()
  else options.signal?.addEventListener('abort', abort, { once: true })
  const throwIfAborted = (): void => {
    if (controller.signal.aborted) {
      throw controller.signal.reason ?? new DOMException('保存已取消', 'AbortError')
    }
  }
  const operationId = taskCenter.start({
    name: `保存 ${fileName}`,
    phase: '准备系统文件',
    cancelable: true,
    cancel: () => controller.abort(new DOMException('保存已取消', 'AbortError')),
  })
  let token: string | undefined
  try {
    throwIfAborted()
    const write = await plugin.beginWrite({
      destination,
      fileName,
      mimeType: blob.type || 'application/octet-stream',
    })
    token = write.token
    throwIfAborted()
    taskCenter.update(operationId, { phase: '写入本机' })
    taskCenter.updateTransfer(operationId, { transferredBytes: 0, totalBytes: blob.size })
    await transferNativeStream(blob, {
      signal: controller.signal,
      append: (data) => plugin.appendWrite({ token: write.token, data }),
      onProgress: (progress) => {
        taskCenter.updateTransfer(operationId, progress)
        options.onProgress?.(progress)
      },
    })
    throwIfAborted()
    taskCenter.update(operationId, { phase: '确认保存结果', cancelable: false })
    const result = await plugin.commitWrite({ token: write.token })
    taskCenter.complete(operationId)
    return result
  } catch (error) {
    if (token) await plugin.abortWrite({ token }).catch(() => undefined)
    if (controller.signal.aborted) taskCenter.cancelled(operationId)
    else taskCenter.fail(operationId, error)
    throw error
  } finally {
    options.signal?.removeEventListener('abort', abort)
  }
}
