/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  native: false,
  request: vi.fn(),
  beginSelfHostedImageUpload: vi.fn(),
  appendImageUpload: vi.fn(),
  commitImageUpload: vi.fn(),
  abortImageUpload: vi.fn(),
}))

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => mocks.native,
    getPlatform: () => (mocks.native ? 'android' : 'web'),
  },
  CapacitorHttp: { request: mocks.request },
  registerPlugin: () => ({
    beginSelfHostedImageUpload: mocks.beginSelfHostedImageUpload,
    appendImageUpload: mocks.appendImageUpload,
    commitImageUpload: mocks.commitImageUpload,
    abortImageUpload: mocks.abortImageUpload,
  }),
}))

import { selfHostedImageDelete, selfHostedImageUpload } from './HostedApiTransport'

describe('self-hosted image transport', () => {
  afterEach(() => {
    mocks.native = false
    mocks.request.mockReset()
    mocks.beginSelfHostedImageUpload.mockReset()
    mocks.appendImageUpload.mockReset()
    mocks.commitImageUpload.mockReset()
    mocks.abortImageUpload.mockReset()
    vi.unstubAllGlobals()
  })

  it('uploads to the ImgBed URL supplied by the user', async () => {
    const request = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.method).toBe('POST')
      expect(init?.headers).toEqual({ Authorization: 'Bearer user-owned-token' })
      expect(init?.body).toBeInstanceOf(FormData)
      return new Response('[{"src":"https://img.example/file/a.png"}]', {
        status: 201,
        headers: { 'content-type': 'application/json' },
      })
    })

    const response = await selfHostedImageUpload(request, new URL('https://img.example/upload'), {
      blob: new Blob(['image-bytes'], { type: 'image/png' }),
      fileName: 'image.png',
      authorization: 'Bearer user-owned-token',
    })

    expect(response.status).toBe(201)
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('streams Android uploads only to the user supplied HTTPS URL', async () => {
    mocks.native = true
    mocks.beginSelfHostedImageUpload.mockResolvedValue({ token: 'upload-token' })
    mocks.appendImageUpload.mockResolvedValue(undefined)
    mocks.commitImageUpload.mockResolvedValue({
      status: 201,
      headers: { 'content-type': 'application/json' },
      body: '{"ok":true}',
    })

    const request = vi.fn()
    const response = await selfHostedImageUpload(request, new URL('https://img.example/upload'), {
      blob: new Blob(['image-bytes'], { type: 'image/webp' }),
      fileName: 'image.webp',
      authorization: 'Bearer user-owned-token',
    })

    expect(mocks.beginSelfHostedImageUpload).toHaveBeenCalledWith({
      url: 'https://img.example/upload',
      fileName: 'image.webp',
      mimeType: 'image/webp',
      size: 11,
      authorization: 'Bearer user-owned-token',
    })
    expect(mocks.commitImageUpload).toHaveBeenCalledWith({ token: 'upload-token' })
    expect(request).not.toHaveBeenCalled()
    expect(response.status).toBe(201)
  })

  it('rejects a non-HTTPS Android upload target', async () => {
    mocks.native = true
    await expect(
      selfHostedImageUpload(vi.fn(), new URL('http://img.example/upload'), {
        blob: new Blob(['x'], { type: 'image/png' }),
        fileName: 'image.png',
      }),
    ).rejects.toThrow('HTTPS')
    expect(mocks.beginSelfHostedImageUpload).not.toHaveBeenCalled()
  })

  it('uses a user supplied HTTPS endpoint for native deletion', async () => {
    mocks.native = true
    mocks.request.mockResolvedValue({
      status: 204,
      headers: {},
      data: '',
    })

    const response = await selfHostedImageDelete(
      vi.fn(),
      new URL('https://img.example/api/manage/delete/file-1'),
      { authorization: 'Bearer user-owned-token' },
    )

    expect(mocks.request).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'https://img.example/api/manage/delete/file-1',
        method: 'DELETE',
      }),
    )
    expect(response.status).toBe(204)
  })
})
