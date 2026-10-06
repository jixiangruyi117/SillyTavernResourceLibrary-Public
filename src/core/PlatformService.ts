import { Capacitor, registerPlugin } from '@capacitor/core'
import type { NativeExportDestination, NativeExportPreference } from './NativeFileExport'

export interface PlatformNetworkState {
  offline: boolean
  wifi: boolean
  cellular: boolean
  metered: boolean
  validated: boolean
}

export interface PlatformInfo {
  kind: 'web' | 'android'
  apiVersion: number
  capabilities: string[]
  insets: { top: number; bottom: number }
  network: PlatformNetworkState
}

interface NativePlatformApi {
  getInfo(): Promise<Omit<PlatformInfo, 'kind'>>
}

const nativePlatform = registerPlugin<NativePlatformApi>('NativePlatform')

function webNetworkState(): PlatformNetworkState {
  return {
    offline: navigator.onLine === false,
    wifi: false,
    cellular: false,
    metered: false,
    validated: navigator.onLine !== false,
  }
}

export async function getPlatformInfo(): Promise<PlatformInfo> {
  if (
    !Capacitor.isNativePlatform() ||
    Capacitor.getPlatform() !== 'android' ||
    !Capacitor.isPluginAvailable('NativePlatform')
  ) {
    return {
      kind: 'web',
      apiVersion: 0,
      capabilities: [],
      insets: { top: 0, bottom: 0 },
      network: webNetworkState(),
    }
  }
  const info = await nativePlatform.getInfo()
  return { kind: 'android', ...info }
}

export function requirePlatformCapability(info: PlatformInfo, capability: string): void {
  if (!info.capabilities.includes(capability)) {
    throw new Error(`当前 APK 外壳过旧，缺少 ${capability} 能力，请先更新 APK`)
  }
}

/**
 * Web Core 唯一的平台能力入口。具体原生模块使用懒加载，避免 Web/PWA 首屏把 Android
 * 实现打进启动路径；Feature 只依赖这个稳定门面，不自行判断 Capacitor 环境。
 */
export const platform = {
  capabilities: {
    getInfo: getPlatformInfo,
    require: requirePlatformCapability,
    async supports(capability: string): Promise<boolean> {
      return (await getPlatformInfo()).capabilities.includes(capability)
    },
  },
  files: {
    async isAvailable(): Promise<boolean> {
      return (await import('./NativeFileExport')).isNativeFileExportAvailable()
    },
    async isImagePickerAvailable(): Promise<boolean> {
      return (await import('./NativeFilePicker')).isNativeImagePickerAvailable()
    },
    async pickImage(): Promise<File | null> {
      return (await import('./NativeFilePicker')).pickNativeImage()
    },
    async getPreference(kind: 'image' | 'file'): Promise<NativeExportPreference> {
      return (await import('./NativeFileExport')).getNativeExportPreference(kind)
    },
    async setPreference(kind: 'image' | 'file', value: NativeExportPreference): Promise<void> {
      ;(await import('./NativeFileExport')).setNativeExportPreference(kind, value)
    },
    async getDirectoryStatus() {
      return (await import('./NativeFileExport')).getNativeExportDirectoryStatus()
    },
    async chooseDirectory() {
      return (await import('./NativeFileExport')).chooseNativeExportDirectory()
    },
    async clearDirectory(): Promise<void> {
      await (await import('./NativeFileExport')).clearNativeExportDirectory()
    },
    async save(blob: Blob, fileName: string, destination: NativeExportDestination) {
      return (await import('./NativeFileExport')).saveBlobToNativeDestination(
        blob,
        fileName,
        destination,
      )
    },
  },
  backup: {
    async isAvailable(): Promise<boolean> {
      return (await import('./NativeSafBackup')).isNativeSafBackupAvailable()
    },
    async getStatus() {
      return (await import('./NativeSafBackup')).getNativeSafBackupStatus()
    },
    async chooseDirectory() {
      return (await import('./NativeSafBackup')).chooseNativeSafBackupDirectory()
    },
    async clearDirectory(): Promise<void> {
      await (await import('./NativeSafBackup')).clearNativeSafBackupDirectory()
    },
    async openWriter(fileName: string) {
      return (await import('./NativeSafBackup')).openNativeSafBackupWriter(fileName)
    },
    async save(blob: Blob, fileName: string): Promise<boolean> {
      return (await import('./NativeSafBackup')).saveBlobToNativeSafBackup(blob, fileName)
    },
  },
  security: {
    async isAvailable(): Promise<boolean> {
      return (await import('./NativeSecurity')).isNativeSecurityAvailable()
    },
    async getState() {
      return (await import('./NativeSecurity')).getNativeSecurityState()
    },
    async setSecureScreen(enabled: boolean): Promise<void> {
      await (await import('./NativeSecurity')).setNativeSecureScreen(enabled)
    },
    async verifyDeviceOwner(): Promise<boolean> {
      return (await import('./NativeSecurity')).verifyNativeDeviceOwner()
    },
    async requestNotifications(): Promise<boolean> {
      return (await import('./NativeSecurity')).requestNativeNotifications()
    },
  },
  network: {
    async getState(): Promise<PlatformNetworkState> {
      return (await getPlatformInfo()).network
    },
  },
  systemUi: {
    async getState() {
      return (await import('./NativeSystemUi')).getNativeSystemUiState()
    },
    async setStatusBarVisible(show: boolean) {
      return (await import('./NativeSystemUi')).setNativeStatusBarVisible(show)
    },
  },
  share: {
    async blob(blob: Blob, fileName: string): Promise<void> {
      await (await import('../utils/LibraryFormatting')).downloadBlob(blob, fileName)
    },
  },
  update: {
    isAndroidApk(): boolean {
      return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android'
    },
  },
} as const
