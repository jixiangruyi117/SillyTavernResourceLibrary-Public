import { afterEach, describe, expect, it, vi } from 'vitest'
import { mainApiCancellationNotice, requestMainApiText } from './MainApiTextTransport'

const native = vi.hoisted(() => ({
  platform: 'android',
  available: true,
  request: vi.fn(),
  cancel: vi.fn(async () => undefined),
}))
vi.mock('@capacitor/core', () => ({
  Capacitor: { getPlatform: () => native.platform, isPluginAvailable: () => native.available },
  registerPlugin: () => native,
}))
afterEach(() => {
  vi.unstubAllGlobals()
  native.platform = 'android'
  native.available = true
  native.request.mockReset()
  native.cancel.mockClear()
})

describe('complete-text AI transport', () => {
  it('Android cancel immediately closes the matching native request and discards a late response', async () => {
    let settle!: (value: { status: number; headers: Record<string, string>; body: string }) => void
    native.request.mockImplementation(
      () =>
        new Promise((resolve) => {
          settle = resolve
        }),
    )
    const controller = new AbortController()
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    const pending = requestMainApiText(
      'https://example.com/v1/chat/completions',
      { method: 'POST', body: '{}', signal: controller.signal },
      true,
    )
    const id = native.request.mock.calls[0]![0].requestId
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(native.cancel).toHaveBeenCalledExactlyOnceWith({ requestId: id })
    expect(fetch).not.toHaveBeenCalled()
    settle({ status: 200, headers: {}, body: 'late' })
    await Promise.resolve()
  })
  it('passes only explicit headers/body to native and preserves HTTP errors as Response', async () => {
    native.request.mockResolvedValue({
      status: 429,
      headers: { 'content-type': 'application/json' },
      body: '{"error":"rate limit"}',
    })
    const response = await requestMainApiText(
      'https://example.com/api',
      {
        method: 'POST',
        body: '{"messages":[]}',
        headers: { Authorization: 'Bearer temporary', 'Content-Type': 'application/json' },
      },
      true,
    )
    expect(response.status).toBe(429)
    expect(await response.json()).toEqual({ error: 'rate limit' })
    expect(native.request.mock.calls[0]![0]).toMatchObject({
      headers: { authorization: 'Bearer temporary' },
      body: '{"messages":[]}',
    })
    expect(native.cancel).not.toHaveBeenCalled()
  })
  it('legacy APK stops waiting without replaying a POST and explains its native limitation', async () => {
    native.available = false
    const fetch = vi.fn(() => new Promise<Response>(() => undefined))
    vi.stubGlobal('fetch', fetch)
    const controller = new AbortController()
    const pending = requestMainApiText(
      'https://example.com/api',
      { method: 'POST', body: '{}', signal: controller.signal },
      true,
    )
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetch).toHaveBeenCalledOnce()
    expect(native.request).not.toHaveBeenCalled()
    expect(mainApiCancellationNotice()).toContain('原生连接可能仍在运行')
  })
  it('web uses the existing abortable fetch', async () => {
    native.platform = 'web'
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('ok')),
    )
    expect(await (await requestMainApiText('https://example.com/api', {}, true)).text()).toBe('ok')
    expect(native.request).not.toHaveBeenCalled()
    expect(mainApiCancellationNotice()).toBe('')
  })
})
