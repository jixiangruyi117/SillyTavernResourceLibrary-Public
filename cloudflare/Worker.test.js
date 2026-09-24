import { describe, expect, it, vi } from 'vitest'
import worker from './Worker.js'

describe('public Worker routes', () => {
  it('does not expose the removed account API', async () => {
    const response = await worker.fetch(
      new Request('https://srl.example.test/api/auth/session'),
      {},
    )

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('serves the deployment version without account state', async () => {
    const response = await worker.fetch(new Request('https://srl.example.test/api/version'), {})

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ version: expect.any(String) })
    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  it('rejects proxy targets outside the provider allowlist', async () => {
    const response = await worker.fetch(
      new Request(
        'https://srl.example.test/api/cloud/proxy/koofr?url=https%3A%2F%2Fevil.example%2F',
      ),
      {},
    )

    expect(response.status).toBe(400)
    expect(response.headers.get('x-srl-cloud-proxy')).toBe('1')
    await expect(response.json()).resolves.toMatchObject({ code: 'INVALID_TARGET' })
  })

  it('blocks cross-origin API requests before routing', async () => {
    const response = await worker.fetch(
      new Request('https://srl.example.test/api/bridge/health', {
        headers: { origin: 'https://other.example.test' },
      }),
      { BRIDGE_SESSIONS: { get: vi.fn() } },
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toMatchObject({ code: 'ORIGIN_REJECTED' })
  })
})
