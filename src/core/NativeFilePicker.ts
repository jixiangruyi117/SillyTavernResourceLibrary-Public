import { Capacitor, registerPlugin } from '@capacitor/core'

interface NativePickedFile {
  cancelled: boolean
  uri?: string
  name?: string
  mimeType?: string
  size?: number
}

interface NativeFilePickerPlugin {
  pickImage(): Promise<NativePickedFile>
}

const plugin = registerPlugin<NativeFilePickerPlugin>('NativeFilePicker')

export function isNativeImagePickerAvailable(): boolean {
  return (
    Capacitor.isNativePlatform() &&
    Capacitor.getPlatform() === 'android' &&
    Capacitor.isPluginAvailable('NativeFilePicker')
  )
}

export async function pickNativeImage(): Promise<File | null> {
  if (!isNativeImagePickerAvailable()) return null
  const picked = await plugin.pickImage()
  if (picked.cancelled || !picked.uri) return null
  const response = await fetch(Capacitor.convertFileSrc(picked.uri), { cache: 'no-store' })
  if (!response.ok) throw new Error(`读取系统图片失败（HTTP ${response.status}）`)
  const blob = await response.blob()
  const type = picked.mimeType || blob.type || 'application/octet-stream'
  if (!type.startsWith('image/')) throw new Error('系统返回的文件不是图片')
  return new File([blob], picked.name || 'image', { type, lastModified: Date.now() })
}
