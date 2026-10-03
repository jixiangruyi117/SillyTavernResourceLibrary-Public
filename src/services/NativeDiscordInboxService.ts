import { Capacitor, registerPlugin } from '@capacitor/core'
import { requestNativeNotifications } from '../core/NativeSecurity'
import { inboxConnection } from './DiscordHandoffService'

interface Receiver {
  startCloudInbox(options: { workerUrl: string; libraryId: string; secret: string }): Promise<void>
  stopCloudInbox(): Promise<void>
  cloudInboxStatus(): Promise<{ running: boolean; workerUrl?: string; libraryId?: string }>
}
const receiver = registerPlugin<Receiver>('ShareReceiver')
let running = false
let target: { workerUrl: string; libraryId: string } | undefined
export const isNativeDiscordInboxAvailable = () =>
  Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android'
export const isNativeDiscordInboxRunning = () => running
export function publishNativeDiscordInboxState(value: boolean): void {
  running = value
  window.dispatchEvent(new CustomEvent('srl:cloud-inbox-state', { detail: { running } }))
}
export async function readNativeDiscordInboxState(): Promise<boolean> {
  if (!isNativeDiscordInboxAvailable()) return false
  const state = await receiver.cloudInboxStatus()
  target =
    state.running && state.workerUrl && state.libraryId
      ? { workerUrl: state.workerUrl, libraryId: state.libraryId }
      : undefined
  publishNativeDiscordInboxState(state.running === true)
  return running
}
export async function startNativeDiscordInbox(): Promise<void> {
  if (!isNativeDiscordInboxAvailable()) throw new Error('收件模式仅支持新版安卓 APK')
  const connection = inboxConnection()
  if (!(await requestNativeNotifications())) throw new Error('请先允许系统通知，再开启收件模式。')
  // Recheck after the permission dialog, which may outlive a target change.
  const current = inboxConnection()
  if (
    current.workerUrl !== connection.workerUrl ||
    current.libraryId !== connection.libraryId ||
    current.secret !== connection.secret
  )
    throw new Error('配对已改变，请重新开启收件模式。')
  try {
    await receiver.startCloudInbox(connection)
  } catch {
    throw new Error('无法开启收件模式，请更新 APK 并检查配对。')
  }
  target = { workerUrl: connection.workerUrl, libraryId: connection.libraryId }
  publishNativeDiscordInboxState(true)
}
export async function stopNativeDiscordInbox(): Promise<void> {
  if (isNativeDiscordInboxAvailable()) await receiver.stopCloudInbox()
  publishNativeDiscordInboxState(false)
  target = undefined
}
export function checkNativeDiscordInboxTarget(workerUrl: string, libraryId: string): void {
  if (running && (!target || target.workerUrl !== workerUrl || target.libraryId !== libraryId))
    void stopNativeDiscordInbox().catch(() => undefined)
}
