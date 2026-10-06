import { describe, expect, it } from 'vitest'
import worker from './Worker.js'
import * as workerModule from './Worker.js'

describe('public Worker routes', () => {
  it('exports only the static application Worker entrypoint', () => {
    expect(Object.keys(workerModule)).toEqual(['default'])
  })

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

  it('does not host the separately deployed Koofr proxy', async () => {
    const response = await worker.fetch(
      new Request(
        'https://srl.example.test/api/cloud/proxy/koofr?url=https%3A%2F%2Fevil.example%2F',
      ),
      {},
    )

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('does not host the separately deployed device-code relay', async () => {
    const response = await worker.fetch(
      new Request('https://srl.example.test/api/bridge/health'),
      {},
    )

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toMatchObject({ code: 'NOT_FOUND' })
  })
})
