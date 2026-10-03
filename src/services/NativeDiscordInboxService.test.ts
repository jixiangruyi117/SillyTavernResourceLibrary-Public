/** @vitest-environment jsdom */
import { beforeEach, describe, it, expect, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  connection: {
    workerUrl: 'https://worker.example',
    libraryId: 'library-1',
    secret: 'S'.repeat(40),
  },
  start: vi.fn(),
  stop: vi.fn(),
  permission: vi.fn(),
  state: vi.fn(),
}))
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => true, getPlatform: () => 'android' },
  registerPlugin: () => ({
    startCloudInbox: mocks.start,
    stopCloudInbox: mocks.stop,
    cloudInboxStatus: mocks.state,
  }),
}))
vi.mock('../core/NativeSecurity', () => ({ requestNativeNotifications: mocks.permission }))
vi.mock('./DiscordHandoffService', () => ({ inboxConnection: () => ({ ...mocks.connection }) }))
import {
  checkNativeDiscordInboxTarget,
  isNativeDiscordInboxRunning,
  publishNativeDiscordInboxState,
  startNativeDiscordInbox,
  stopNativeDiscordInbox,
} from './NativeDiscordInboxService'
beforeEach(() => {
  vi.clearAllMocks()
  publishNativeDiscordInboxState(false)
  mocks.connection.libraryId = 'library-1'
  mocks.permission.mockResolvedValue(true)
  mocks.start.mockResolvedValue(undefined)
  mocks.stop.mockResolvedValue(undefined)
})
describe('native receive session', () => {
  it('starts only with notifications and the current pairing, and stops on a target change', async () => {
    mocks.permission.mockResolvedValueOnce(false)
    await expect(startNativeDiscordInbox()).rejects.toThrow('系统通知')
    expect(mocks.start).not.toHaveBeenCalled()
    await startNativeDiscordInbox()
    expect(mocks.start).toHaveBeenCalledWith(mocks.connection)
    expect(isNativeDiscordInboxRunning()).toBe(true)
    checkNativeDiscordInboxTarget('https://other.example', 'library-1')
    await vi.waitFor(() => expect(isNativeDiscordInboxRunning()).toBe(false))
    expect(mocks.stop).toHaveBeenCalledTimes(1)
  })
  it('does not use a stale pairing after permission approval or mark failed startup as running', async () => {
    mocks.permission.mockImplementationOnce(async () => {
      mocks.connection.libraryId = 'library-2'
      return true
    })
    await expect(startNativeDiscordInbox()).rejects.toThrow('配对已改变')
    expect(mocks.start).not.toHaveBeenCalled()
    mocks.start.mockRejectedValueOnce(new Error('old APK'))
    await expect(startNativeDiscordInbox()).rejects.toThrow('更新 APK')
    expect(isNativeDiscordInboxRunning()).toBe(false)
    await stopNativeDiscordInbox()
  })
})
