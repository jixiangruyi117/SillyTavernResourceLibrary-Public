/* global Request, Response */

import { describe, expect, it, vi } from 'vitest'
import { handleRequest } from './src/index.js'

const env = {
  IMGBED_ORIGIN: 'https://imgbed.example.test',
  ALLOWED_ORIGINS: 'https://srl.example.test',
}

function request(path, init = {}) {
  return new Request(`https://proxy.example.test${path}`, {
    ...init,
    headers: { origin: 'https://srl.example.test', ...init.headers },
  })
}

describe('ImgBed proxy template', () => {
  it('rejects origins outside the deployer allowlist', async () => {
    const fetchImpl = vi.fn()
    const response = await handleRequest(
      new Request('https://proxy.example.test/file/image.png', {
        headers: { origin: 'https://attacker.example.test' },
      }),
      env,
      fetchImpl,
    )

    expect(response.status).toBe(403)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('forwards only supported routes to the configured fixed ImgBed origin', async () => {
    const fetchImpl = vi.fn(async () => new Response('image', { status: 200 }))
    const response = await handleRequest(request('/file/image.png'), env, fetchImpl)

    expect(response.status).toBe(200)
    expect(fetchImpl.mock.calls[0]?.[0].toString()).toBe(
      'https://imgbed.example.test/file/image.png',
    )
    expect(fetchImpl.mock.calls[0]?.[1].redirect).toBe('manual')
  })

  it('rejects arbitrary routes and uploads over 10 MiB', async () => {
    const fetchImpl = vi.fn()
    const routeResponse = await handleRequest(
      request('/https://attacker.example.test'),
      env,
      fetchImpl,
    )
    const uploadResponse = await handleRequest(
      request('/upload', {
        method: 'POST',
        headers: {
          authorization: 'Bearer user-token',
          'content-length': String(10 * 1024 * 1024 + 1),
        },
        body: 'x',
      }),
      env,
      fetchImpl,
    )

    expect(routeResponse.status).toBe(404)
    expect(uploadResponse.status).toBe(413)
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})
