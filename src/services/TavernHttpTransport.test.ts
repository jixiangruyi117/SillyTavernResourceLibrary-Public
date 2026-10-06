import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Capacitor, CapacitorHttp } from '@capacitor/core'
import { tavernHttpFetch } from './TavernHttpTransport'
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: vi.fn(() => true) },
  CapacitorHttp: { request: vi.fn() },
}))
beforeEach(() => vi.stubGlobal('window', { location: { origin: 'https://srl.test' } }))
afterEach(() => {
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})
describe('APK relay transport', () => {
  it('sends bounded binary chunks via native HTTP even when the URL shares the bundled app origin', async () => {
    vi.mocked(CapacitorHttp.request).mockResolvedValue({
      status: 204,
      data: '',
      headers: {},
      url: 'https://srl.test/api/bridge/parcels/upload',
    })
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    await tavernHttpFetch('https://srl.test/api/bridge/parcels/upload', {
      method: 'POST',
      body: new Blob([new Uint8Array([0, 255, 128])]),
      headers: { 'content-type': 'application/octet-stream' },
    })
    expect(CapacitorHttp.request).toHaveBeenCalledWith(
      expect.objectContaining({ data: 'AP+A', dataType: 'file', readTimeout: 45000 }),
    )
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('decodes native binary response and preserves JSON errors', async () => {
    vi.mocked(CapacitorHttp.request).mockResolvedValue({
      status: 200,
      data: 'AP+A',
      headers: {},
      url: '',
    })
    expect([
      ...new Uint8Array(
        await (await tavernHttpFetch('https://srl.test/api/bridge/parcels/download')).arrayBuffer(),
      ),
    ]).toEqual([0, 255, 128])
    vi.mocked(CapacitorHttp.request).mockResolvedValue({
      status: 404,
      data: { error: '已过期' },
      headers: {},
      url: '',
    })
    const error = await tavernHttpFetch('https://srl.test/api/bridge/parcels/download')
    expect(error.status).toBe(404)
    expect(await error.json()).toEqual({ error: '已过期' })
  })
  it('uses ordinary fetch in browsers', async () => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValueOnce(false)
    const fetcher = vi.fn().mockResolvedValue(new Response('{}'))
    vi.stubGlobal('fetch', fetcher)
    await tavernHttpFetch('/api/bridge/join')
    expect(fetcher).toHaveBeenCalledOnce()
  })
})
