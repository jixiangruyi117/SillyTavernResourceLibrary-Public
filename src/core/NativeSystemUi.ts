import { Capacitor, registerPlugin } from '@capacitor/core'

export interface NativeSystemUiState {
  showStatusBar: boolean
}

interface NativeSystemUiPlugin {
  getState(): Promise<NativeSystemUiState>
  setShowStatusBar(options: { show: boolean }): Promise<NativeSystemUiState>
}

const plugin = registerPlugin<NativeSystemUiPlugin>('NativeSystemUi')

function isAvailable(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android'
}

export async function getNativeSystemUiState(): Promise<NativeSystemUiState | null> {
  return isAvailable() ? plugin.getState() : null
}

export async function setNativeStatusBarVisible(
  show: boolean,
): Promise<NativeSystemUiState | null> {
  if (!isAvailable()) return null
  const state = await plugin.setShowStatusBar({ show })
  window.dispatchEvent(new CustomEvent('srl:system-ui-changed', { detail: state }))
  return state
}
