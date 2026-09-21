import { Capacitor, registerPlugin } from '@capacitor/core'

export interface NativeSecurityState {
  secureScreen: boolean
  biometricAvailable: boolean
  notificationsGranted: boolean
}

export interface NativeSecretRecoveryState {
  available: boolean
  enabled: boolean
  /** Older APKs omit this field; configured does not guarantee successful decryption. */
  status?: 'unconfigured' | 'configured' | 'invalid'
}

interface NativeSecurityPlugin {
  getSecretRecoveryState(): Promise<NativeSecretRecoveryState>
  saveSecretRecovery(options: { password: string }): Promise<void>
  recoverSecretPassword(): Promise<{ password: string }>
  clearSecretRecovery(): Promise<void>
  getSecurityState(): Promise<NativeSecurityState>
  setSecureScreen(options: { enabled: boolean }): Promise<{ enabled: boolean }>
  authenticate(): Promise<{ authenticated: boolean }>
  requestNotifications(): Promise<{ granted: boolean }>
}

const plugin = registerPlugin<NativeSecurityPlugin>('NativeSecurity')

export async function getNativeSecretRecoveryState(): Promise<NativeSecretRecoveryState | null> {
  if (!isNativeSecurityAvailable()) return null
  return plugin.getSecretRecoveryState()
}
export async function saveNativeSecretRecovery(password: string): Promise<void> {
  if (!isNativeSecurityAvailable()) throw new Error('指纹找回仅支持安卓 APK')
  await plugin.saveSecretRecovery({ password })
}
export async function recoverNativeSecretPassword(): Promise<string> {
  if (!isNativeSecurityAvailable()) throw new Error('指纹找回仅支持安卓 APK')
  return (await plugin.recoverSecretPassword()).password
}
export async function clearNativeSecretRecovery(): Promise<void> {
  if (!isNativeSecurityAvailable()) throw new Error('指纹找回仅支持安卓 APK')
  await plugin.clearSecretRecovery()
}

export function isNativeSecurityAvailable(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android'
}

export async function getNativeSecurityState(): Promise<NativeSecurityState | null> {
  if (!isNativeSecurityAvailable()) return null
  return plugin.getSecurityState()
}

export async function setNativeSecureScreen(enabled: boolean): Promise<void> {
  if (!isNativeSecurityAvailable()) return
  await plugin.setSecureScreen({ enabled })
}

export async function verifyNativeDeviceOwner(): Promise<boolean> {
  if (!isNativeSecurityAvailable()) return false
  return (await plugin.authenticate()).authenticated
}

export async function requestNativeNotifications(): Promise<boolean> {
  if (!isNativeSecurityAvailable()) return false
  return (await plugin.requestNotifications()).granted
}
