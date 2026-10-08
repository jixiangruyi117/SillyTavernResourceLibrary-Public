/** @vitest-environment jsdom */
import { beforeEach, describe, it, expect, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  connection: {
    workerUrl: 'https://worker.example',
    libraryId: 'library-1',
    secret: 'S'.repeat(40),
  },
  start: vi.fn(),
  notify: vi.fn(),
  autoBinding: vi.fn(),
  stop: vi.fn(),
  permission: vi.fn(),
  state: vi.fn(),
}))
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => true, getPlatform: () => 'android' },
  registerPlugin: () => ({
    startCloudInbox: mocks.start,
    notifyCloudInboxResult: mocks.notify,
    notifyCloudInboxAutoBinding: mocks.autoBinding,
    stopCloudInbox: mocks.stop,
    cloudInboxStatus: mocks.state,
  }),
}))
vi.mock('../core/NativeSecurity', () => ({ requestNativeNotifications: mocks.permission }))
vi.mock('./DiscordHandoffService', () => ({ inboxConnection: () => ({ ...mocks.connection }) }))
import {
  checkNativeDiscordInboxTarget,
  notifyNativeDiscordInboxResult,
  notifyNativeDiscordAutoBinding,
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
  mocks.start.mockResolvedValue({ running: true })
  mocks.stop.mockResolvedValue(undefined)
  mocks.state.mockImplementation(async () => ({
    running: true,
    workerUrl: mocks.connection.workerUrl,
    libraryId: mocks.connection.libraryId,
  }))
})
describe('native receive session', () => {
  it('publishes a binding result independently of whether the background receive service is running', async () => {
    await notifyNativeDiscordAutoBinding('帖子 A', '角色卡 A')
    expect(mocks.autoBinding).toHaveBeenCalledWith({
      sourceTitle: '帖子 A',
      resourceName: '角色卡 A',
    })
    mocks.autoBinding.mockRejectedValueOnce(new Error('permission denied'))
    await expect(notifyNativeDiscordAutoBinding('帖子 B', '角色卡 B')).resolves.toBeUndefined()
  })
  it('passes stable binding identities without forwarding pairing credentials', async () => {
    await notifyNativeDiscordAutoBinding('帖子 A', '角色卡 A', {
      sourceId: 'post-a',
      resourceId: 'card-a',
    })
    expect(mocks.autoBinding).toHaveBeenCalledWith({
      sourceTitle: '帖子 A',
      resourceName: '角色卡 A',
      sourceId: 'post-a',
      resourceId: 'card-a',
    })
    expect(mocks.autoBinding.mock.lastCall?.[0]).not.toHaveProperty('secret')
  })
  it('does not show enabled when native startup only accepted an Intent or reported failure', async () => {
    mocks.start.mockImplementationOnce(async () => {
      publishNativeDiscordInboxState(true) // Older native code emits this before its empty reply.
      return undefined
    })
    await expect(startNativeDiscordInbox()).rejects.toThrow('更新 APK')
    expect(isNativeDiscordInboxRunning()).toBe(false)
    mocks.start.mockResolvedValueOnce({ running: false })
    await expect(startNativeDiscordInbox()).rejects.toThrow('启动')
    expect(isNativeDiscordInboxRunning()).toBe(false)
  })
  it('does not resurrect a service stopped before the native reply reached the WebView', async () => {
    mocks.state.mockResolvedValueOnce({ running: false })
    await expect(startNativeDiscordInbox()).rejects.toThrow('已停止')
    expect(isNativeDiscordInboxRunning()).toBe(false)
  })
  it('shows only safe startup exception types, never an arbitrary native message', async () => {
    mocks.start.mockResolvedValueOnce({ running: false, reason: 'SecurityException' })
    await expect(startNativeDiscordInbox()).rejects.toThrow('SecurityException')
    mocks.start.mockResolvedValueOnce({
      running: false,
      reason: 'https://private.example/?secret=fixture',
    })
    try {
      await startNativeDiscordInbox()
    } catch (error) {
      expect((error as Error).message).not.toContain('private.example')
      expect((error as Error).message).not.toContain('secret')
    }
    expect(isNativeDiscordInboxRunning()).toBe(false)
  })
  it('waits for native foreground-service acknowledgement before publishing running', async () => {
    let confirm!: (value: { running: boolean }) => void
    mocks.start.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          confirm = resolve
        }),
    )
    const starting = startNativeDiscordInbox()
    await vi.waitFor(() => expect(mocks.start).toHaveBeenCalledOnce())
    expect(isNativeDiscordInboxRunning()).toBe(false)
    confirm({ running: true })
    await starting
    expect(isNativeDiscordInboxRunning()).toBe(true)
    await stopNativeDiscordInbox()
  })
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

it('reports the committed result without a notification failure changing its outcome', async () => {
  const result = {
    kind: 'resource' as const,
    state: 'imported' as const,
    id: '11111111-1111-4111-a111-111111111111',
    ...mocks.connection,
    name: 'card.json',
  }
  await notifyNativeDiscordInboxResult(result)
  expect(mocks.notify).toHaveBeenCalledWith({
    kind: result.kind,
    id: result.id,
    workerUrl: result.workerUrl,
    libraryId: result.libraryId,
    name: result.name,
    state: result.state,
  })
  expect(mocks.notify.mock.lastCall?.[0]).not.toHaveProperty('secret')
  mocks.notify.mockRejectedValue(new Error('permission denied'))
  await expect(notifyNativeDiscordInboxResult(result)).resolves.toBeUndefined()
})
