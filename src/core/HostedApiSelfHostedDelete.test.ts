/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  native: false,
  request: vi.fn(),
}))

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => mocks.native,
    getPlatform: () => (mocks.native ? 'android' : 'web'),
  },
  CapacitorHttp: { request: mocks.request },
  registerPlugin: () => ({}),
}))

import { selfHostedImageDelete } from './SelfHostedImageTransport'

describe('selfHostedImageDelete', () => {
  afterEach(() => {
    mocks.native = false
    mocks.request.mockReset()
  })

  it('browser sends only the standard ImgBed DELETE request supplied by the image owner', async () => {
    const request = vi.fn(async () => new Response('{}', { status: 200 }))

    const response = await selfHostedImageDelete(
      request,
      new URL('https://mine.example/api/manage/delete/folder/image.png'),
      { authorization: 'Bearer delete-token' },
    )

    expect(response.status).toBe(200)
    expect(request).toHaveBeenCalledWith(
      new URL('https://mine.example/api/manage/delete/folder/image.png'),
      expect.objectContaining({
        method: 'DELETE',
        headers: { Authorization: 'Bearer delete-token' },
      }),
    )
  })

  it('rejects arbitrary self-hosted admin endpoints instead of becoming a generic management proxy', async () => {
    const request = vi.fn()

    await expect(
      selfHostedImageDelete(request, new URL('https://mine.example/api/manage/sysConfig'), {
        authorization: 'Bearer full-admin-token',
      }),
    ).rejects.toThrow('图片删除接口')
    expect(request).not.toHaveBeenCalled()
  })

  it('native delete uses CapacitorHttp directly and keeps the operation constrained to DELETE', async () => {
    mocks.native = true
    mocks.request.mockResolvedValue({
      status: 200,
      data: { success: true },
      headers: { 'content-type': 'application/json' },
    })
    const browserRequest = vi.fn()

    const response = await selfHostedImageDelete(
      browserRequest,
      new URL('https://mine.example/api/manage/delete/folder/image.png'),
      { authorization: 'Bearer delete-token' },
    )

    expect(browserRequest).not.toHaveBeenCalled()
    expect(mocks.request).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'https://mine.example/api/manage/delete/folder/image.png',
        method: 'DELETE',
        headers: {
          Authorization: 'Bearer delete-token',
          Accept: 'application/json',
        },
      }),
    )
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ success: true })
  })
})
