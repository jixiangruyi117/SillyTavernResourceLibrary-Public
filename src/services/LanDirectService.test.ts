import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  LOCAL_TAVERN_ORIGIN,
  canUseLocalTavernDirect,
  createLocalTavernDirectSession,
  isTrustedLocalTavernOrigin,
  uploadLocalTavernDirectFile,
} from './LanDirectService'

describe('LanDirectService', () => {
  beforeEach(() => {
    vi.stubGlobal('window', {})
  })

  afterEach(() => {
    delete (window as { Capacitor?: unknown }).Capacitor
    vi.unstubAllGlobals()
  })

  it('只在 Android Capacitor 中允许本机酒馆直传', () => {
    expect(canUseLocalTavernDirect()).toBe(false)

    ;(window as { Capacitor?: unknown }).Capacitor = {
      isNativePlatform: () => true,
      getPlatform: () => 'android',
    }
    expect(canUseLocalTavernDirect()).toBe(true)

    ;(window as { Capacitor?: unknown }).Capacitor = {
      isNativePlatform: () => true,
      getPlatform: () => 'ios',
    }
    expect(canUseLocalTavernDirect()).toBe(false)
  })

  it('拒绝任意内网和伪装过的本机地址', () => {
    expect(isTrustedLocalTavernOrigin(LOCAL_TAVERN_ORIGIN)).toBe(true)
    expect(isTrustedLocalTavernOrigin('http://127.0.0.1:8001')).toBe(false)
    expect(isTrustedLocalTavernOrigin('http://127.0.0.1:8000.evil.example')).toBe(false)
    expect(isTrustedLocalTavernOrigin('http://192.168.1.2:8000')).toBe(false)
  })

  it('验证会话并把压缩后的 Blob 以原文件名写入受限端点', async () => {
    const session = createLocalTavernDirectSession({
      sessionId: 'session_123456',
      token: 'token_123456789012345678901234567890',
      origin: LOCAL_TAVERN_ORIGIN,
      maxFileSize: 1024,
    })
    expect(session).toBeDefined()

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ size: 4, sha256: 'a'.repeat(64) }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const blob = new Blob(['gzip'])
    Object.defineProperty(blob, 'arrayBuffer', {
      value: () => Promise.reject(new Error('direct upload must not create a whole ArrayBuffer')),
    })
    await expect(uploadLocalTavernDirectFile(session!, blob, 'resource.json')).resolves.toEqual({
      size: 4,
      sha256: 'a'.repeat(64),
    })

    expect(fetchMock).toHaveBeenCalledWith(
      `${LOCAL_TAVERN_ORIGIN}/api/plugins/srl-bridge/direct/sessions/session_123456`,
      expect.objectContaining({
        method: 'PUT',
        headers: expect.objectContaining({
          'X-SRL-Direct-Token': 'token_123456789012345678901234567890',
          'X-SRL-File-Name': 'resource.json',
        }),
      }),
    )
    expect(fetchMock.mock.calls[0]?.[1]?.body).toBe(blob)
  })
})
