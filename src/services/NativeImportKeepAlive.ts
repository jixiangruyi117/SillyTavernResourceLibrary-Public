import { Capacitor, registerPlugin } from '@capacitor/core'

interface NativeImportKeepAlivePlugin {
  start(options: { title: string; phase: string; progress?: number }): Promise<void>
  update(options: { title: string; phase: string; progress?: number }): Promise<void>
  stop(options: {
    title: string
    message: string
    successful: boolean
    notify?: boolean
  }): Promise<void>
  notifyAwaitingChoice(options: { title: string; message: string }): Promise<void>
}

const nativeImport = registerPlugin<NativeImportKeepAlivePlugin>('NativeImportKeepAlive')
let lastNotificationUpdate = 0
let activeTasks = 0
let lifecycle = Promise.resolve()

function serializeLifecycle<T>(action: () => Promise<T>): Promise<T> {
  const result = lifecycle.then(action)
  lifecycle = result.then(
    () => undefined,
    () => undefined,
  )
  return result
}

export function isNativeImportKeepAliveAvailable(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android'
}

export async function startNativeImportKeepAlive(title: string, phase: string): Promise<boolean> {
  if (!isNativeImportKeepAliveAvailable()) return false
  return serializeLifecycle(async () => {
    try {
      await nativeImport.start({ title, phase })
      activeTasks += 1
      lastNotificationUpdate = Date.now()
      return true
    } catch {
      return false
    }
  })
}

export function updateNativeImportKeepAlive(title: string, phase: string, progress?: number): void {
  if (!isNativeImportKeepAliveAvailable() || !activeTasks) return
  const now = Date.now()
  if (now - lastNotificationUpdate < 700 && progress !== 1) return
  lastNotificationUpdate = now
  void nativeImport
    .update({
      title,
      phase,
      progress: progress === undefined ? undefined : Math.round(progress * 100),
    })
    .catch(() => {})
}

export async function stopNativeImportKeepAlive(result: {
  title: string
  message: string
  successful: boolean
  notify?: boolean
}): Promise<void> {
  if (!isNativeImportKeepAliveAvailable()) return
  await serializeLifecycle(async () => {
    if (!activeTasks) return
    activeTasks -= 1
    if (activeTasks) return
    try {
      await nativeImport.stop(result)
    } catch {
      // Cleanup must not replace the import result or failure.
    }
  })
}

export async function notifyNativeImportAwaitingChoice(
  title: string,
  message: string,
): Promise<void> {
  if (!isNativeImportKeepAliveAvailable()) return
  try {
    await nativeImport.notifyAwaitingChoice({ title, message })
  } catch {
    // The prepared restore stays available in the open panel if the OS rejects notifications.
  }
}
