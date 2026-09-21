import { afterEach, describe, expect, it, vi } from 'vitest'

import { BRIDGE_EXTENSION_VERSION } from '../utils/BridgeInstall'
import { TavernBridgeService, TavernHttpRelayPort } from './TavernBridgeService'
import { tavernEnvelope } from './TavernBridgeProtocol'

interface BridgeServiceTestAccess {
  handlePortMessage(message: unknown): Promise<void>
  handleWindowMessage(event: MessageEvent): void
}

describe('TavernBridgeService', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('reports an actionable error when only the server plugin was updated', async () => {
    const service = new TavernBridgeService()

    await (service as unknown as BridgeServiceTestAccess).handlePortMessage(
      tavernEnvelope('st-ready'),
    )

    expect(service.getState().status).toBe('error')
    expect(service.getState().detail).toContain('页面扩展版本过旧')
  })

  it('records the connected front-end extension version', async () => {
    const service = new TavernBridgeService()

    await (service as unknown as BridgeServiceTestAccess).handlePortMessage(
      tavernEnvelope('st-ready', { bridgeVersion: BRIDGE_EXTENSION_VERSION }),
    )

    expect(service.getState()).toMatchObject({
      status: 'connected',
      bridgeVersion: BRIDGE_EXTENSION_VERSION,
    })
  })

  it('reports update instructions when the handshake extension version is behind', async () => {
    const service = new TavernBridgeService()

    await (service as unknown as BridgeServiceTestAccess).handlePortMessage(
      tavernEnvelope('st-ready', { bridgeVersion: '0.3.18' }),
    )

    expect(service.getState().status).toBe('error')
    expect(service.getState().detail).toContain(`资源库要求 ${BRIDGE_EXTENSION_VERSION}`)
    expect(service.getState().detail).toContain('请在酒馆扩展管理中点击更新')
    expect(service.getState().detail).toContain('重新下载最新离线包')
  })

  it('requests an approved local Tavern connection without asking for a device code', async () => {
    vi.stubGlobal('window', {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      setInterval,
      setTimeout,
      clearInterval,
      location: { href: 'https://srl.example.test/', origin: 'https://srl.example.test' },
      Capacitor: { isNativePlatform: () => true, getPlatform: () => 'android' },
    })
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            code: 'AB23CD45',
            participantToken: 'a'.repeat(32),
            relayBase: '/api/plugins/srl-bridge/',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      )
      .mockImplementation(() => new Promise(() => {}))
    vi.stubGlobal('fetch', fetchMock)
    const service = new TavernBridgeService()

    await service.connectLocalTavern()

    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:8000/api/plugins/srl-bridge/local-pair/requests',
      expect.objectContaining({ method: 'POST' }),
    )
    expect(service.getState()).toMatchObject({
      status: 'discovering',
      pairCode: '',
      tavernOrigin: 'http://127.0.0.1:8000',
    })
    service.destroy()
  })

  it('explains when the local Tavern server plugin has not been updated', async () => {
    vi.stubGlobal('window', {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      setInterval,
      setTimeout,
      clearInterval,
      location: { href: 'https://srl.example.test/', origin: 'https://srl.example.test' },
      Capacitor: { isNativePlatform: () => true, getPlatform: () => 'android' },
    })
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({}), { status: 404 })),
    )
    const service = new TavernBridgeService()

    await expect(service.connectLocalTavern()).rejects.toThrow('服务端插件未安装或版本过旧')

    service.destroy()
  })
})

describe('TavernHttpRelayPort', () => {
  it('keeps control messages ordered but allows file chunks to fill the ACK window', async () => {
    let resolveControl: ((response: Response) => void) | undefined
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            resolveControl = resolve
          }),
      )
      .mockResolvedValue(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)
    const port = new TavernHttpRelayPort('https://relay.example.test/', {
      code: 'AB23CD45',
      token: 'temporary-token',
    })

    const firstControl = port.postMessage(tavernEnvelope('file-start'))
    const secondControl = port.postMessage(tavernEnvelope('file-end'))
    await Promise.resolve()
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const firstChunk = port.postFileChunk(tavernEnvelope('file-chunk', { index: 0 }))
    const secondChunk = port.postFileChunk(tavernEnvelope('file-chunk', { index: 1 }))
    expect(fetchMock).toHaveBeenCalledTimes(3)

    resolveControl?.(new Response(null, { status: 204 }))
    await Promise.all([firstControl, secondControl, firstChunk, secondChunk])
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })
})
