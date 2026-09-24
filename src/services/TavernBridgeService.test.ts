import { afterEach, describe, expect, it, vi } from 'vitest'

import { BRIDGE_EXTENSION_VERSION } from '../utils/BridgeInstall'
import { TavernBridgeService, TavernHttpRelayPort } from './TavernBridgeService'
import { tavernEnvelope } from './TavernBridgeProtocol'

interface BridgeServiceTestAccess {
  handlePortMessage(message: unknown): Promise<void>
  handleWindowMessage(event: MessageEvent): void
  relayOrigin: string
  relayWindow: Window
}

describe('TavernBridgeService', () => {
  it('acknowledges identical repeated chunks without counting them twice and rejects invalid indices', async () => {
    const service = new TavernBridgeService()
    const access = service as unknown as BridgeServiceTestAccess & {
      port: { postMessage: () => void }
      incoming: Map<string, { received: number }>
    }
    access.port = { postMessage: () => {} }
    await access.handlePortMessage(
      tavernEnvelope('file-start', {
        requestId: 'pull',
        transferId: 'same',
        direction: 'to-srl',
        size: 3,
      }),
    )
    const chunk = tavernEnvelope('file-chunk', {
      requestId: 'pull',
      transferId: 'same',
      index: 0,
      data: new Uint8Array([1, 2, 3]).buffer,
    })
    await access.handlePortMessage(chunk)
    await access.handlePortMessage(chunk)
    expect(access.incoming.get('same')?.received).toBe(3)
    await expect(access.handlePortMessage({ ...chunk, index: -1 })).rejects.toThrow('序号')
    await expect(
      access.handlePortMessage({ ...chunk, data: new Uint8Array([9, 2, 3]).buffer }),
    ).rejects.toThrow('不一致')
  })
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

  it('round-trips an avatar existence check only with a capable connected Bridge', async () => {
    const service = new TavernBridgeService()
    vi.stubGlobal('window', {
      setTimeout,
      clearTimeout,
      removeEventListener: vi.fn(),
      location: { href: 'https://srl.example.test/', origin: 'https://srl.example.test' },
    })
    const messages: Array<{ type: string; requestId?: string }> = []
    ;(
      service as unknown as { port: { postMessage: (message: unknown) => void; close: () => void } }
    ).port = {
      postMessage: (message) => messages.push(message as { type: string; requestId?: string }),
      close: () => undefined,
    }
    await (service as unknown as BridgeServiceTestAccess).handlePortMessage(
      tavernEnvelope('st-ready', {
        bridgeVersion: '0.3.31',
        capabilities: ['persona-avatar-check-v1'],
      }),
    )
    const pending = service.checkUserAvatarIds(['one.png', 'two.png'])
    const request = messages.find((message) => message.type === 'persona-avatar-check-request')
    expect(request?.requestId).toBeTruthy()
    await (service as unknown as BridgeServiceTestAccess).handlePortMessage(
      tavernEnvelope('persona-avatar-check-response', {
        requestId: request!.requestId,
        existingIds: ['one.png'],
      }),
    )
    expect(await pending).toEqual(new Set(['one.png']))
    service.destroy()
  })

  it('断开或中继故障会立即结束正在接收的请求，而不等待两分钟超时', async () => {
    vi.stubGlobal('window', {
      setTimeout,
      clearTimeout,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      location: { href: 'https://srl.example.test/', origin: 'https://srl.example.test' },
    })
    for (const failure of ['manual', 'relay'] as const) {
      const service = new TavernBridgeService()
      const port = { postMessage: vi.fn(), close: vi.fn() }
      ;(service as unknown as { port: typeof port }).port = port
      await (service as unknown as BridgeServiceTestAccess).handlePortMessage(
        tavernEnvelope('st-ready', { bridgeVersion: BRIDGE_EXTENSION_VERSION }),
      )
      const pending = service.pullResources([
        {
          id: 'userPersona:one.png',
          kind: 'userPersona',
          name: '人设',
          fileName: 'one.json',
          detail: '',
        },
      ])
      await Promise.resolve()
      if (failure === 'manual') service.disconnect('已手动断开酒馆连接')
      else
        (
          service as unknown as { failConnection(error: Error, detail: string): void }
        ).failConnection(new Error('设备码中继已关闭'), '设备码中继已断开')
      await expect(pending).rejects.toThrow(
        failure === 'manual' ? '已手动断开酒馆连接' : '设备码中继已关闭',
      )
      expect(port.close).toHaveBeenCalled()
      expect(service.getState().status).toBe(failure === 'manual' ? 'idle' : 'error')
      service.destroy()
    }
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

  it('joins the HTTPS relay in the current resource-library page', async () => {
    vi.stubGlobal('window', {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      setInterval,
      setTimeout,
      clearInterval,
      location: {
        origin: 'https://srl.example.test',
        href: 'https://srl.example.test/',
      },
    })
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            pairCode: '123456',
            participantToken: 'participant-token',
            relayBase: '/api/bridge/',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      )
      .mockImplementation(() => new Promise(() => {}))
    vi.stubGlobal('fetch', fetchMock)
    const service = new TavernBridgeService()

    await service.joinSecureRelay('AB23CD45')

    expect(fetchMock).toHaveBeenCalledWith(
      'https://srl.example.test/api/bridge/join',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ code: 'AB23CD45' }),
      }),
    )
    expect(service.getState()).toMatchObject({
      status: 'pairing',
      pairCode: '123456',
      tavernOrigin: 'https://srl.example.test',
    })
    service.destroy()
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

  it('keeps an active relay popup as transport instead of fetching local HTTP from HTTPS SRL', () => {
    vi.useFakeTimers()
    vi.stubGlobal('window', {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      setInterval,
      setTimeout,
      clearInterval,
      location: { href: 'https://srl.example.test/' },
    })
    const service = new TavernBridgeService()
    const postMessage = vi.fn()
    const relayWindow = {
      closed: false,
      close: vi.fn(),
      postMessage,
    } as unknown as Window
    const access = service as unknown as BridgeServiceTestAccess
    access.relayWindow = relayWindow
    access.relayOrigin = 'http://127.0.0.1:8000'

    access.handleWindowMessage({
      data: tavernEnvelope('relay-invitation', {
        channel: 'relay-AB23CD45',
        pairCode: '123456',
        relayBase: 'http://127.0.0.1:8000/api/plugins/srl-bridge/',
        participantToken: 'temporary-token',
      }),
      origin: 'http://127.0.0.1:8000',
      source: relayWindow,
    } as MessageEvent)

    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'srl-hello', channel: 'relay-AB23CD45' }),
      'http://127.0.0.1:8000',
    )
    expect(service.getState().status).toBe('discovering')
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
