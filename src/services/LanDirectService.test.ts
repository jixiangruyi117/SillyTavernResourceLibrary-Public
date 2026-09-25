import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  LOCAL_TAVERN_ORIGIN,
  canUseLocalTavernDirect,
  createLocalTavernDirectSession,
  downloadLocalTavernDirectFile,
  isTrustedLocalTavernOrigin,
  uploadLocalTavernDirectFile,
} from './LanDirectService'

describe('LanDirectService', () => {
  const session = {
    sessionId: 'session_123456',
    token: 'a'.repeat(32),
    origin: LOCAL_TAVERN_ORIGIN,
    maxFileSize: 1024,
  }
  const dataHash = '3a6eb0790f39ac87c94f3856b2dd2c5d110e6811602261a9a923d3bb23adc8b7'

  it.each<Record<string, string>>([
    {},
    { 'content-encoding': 'gzip' },
    { 'content-encoding': 'gzip', 'content-length': '24' },
    { 'content-length': '4' },
  ])('按实际解压后的字节与哈希验证直传内容 %j', async (headers) => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('data', {
          headers: { ...headers, 'x-srl-direct-sha256': dataHash },
        }),
      ),
    )
    const result = await downloadLocalTavernDirectFile(
      session,
      '中文聊天.srlchat',
      'application/json',
    )
    expect(result.file.size).toBe(4)
    expect(result.file.name).toBe('中文聊天.srlchat')
    expect(result.sha256).toBe(dataHash)
  })

  it.each([
    [{ 'content-length': '5' }, '大小不一致'],
    [{ 'content-length': 'invalid' }, '大小无效'],
    [{ 'x-srl-direct-sha256': 'a'.repeat(64) }, '完整性校验失败'],
    [{ 'x-srl-direct-sha256': '' }, '有效完整性校验'],
  ])('仍拒绝损坏或无校验的直传 %j', async (headers, error) => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('data', {
          headers: { 'x-srl-direct-sha256': dataHash, ...headers },
        }),
      ),
    )
    await expect(downloadLocalTavernDirectFile(session, 'test', '')).rejects.toThrow(error)
  })

  it('未知响应长度仍受流式读取上限约束', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('data', {
          headers: { 'x-srl-direct-sha256': dataHash },
        }),
      ),
    )
    await expect(
      downloadLocalTavernDirectFile({ ...session, maxFileSize: 3 }, 'test', ''),
    ).rejects.toThrow()
  })
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
        }),
      }),
    )
    expect(fetchMock.mock.calls[0]?.[1]?.body).toBe(blob)
  })

  it('中文及长文件名不进入 HTTP ByteString 请求头', async () => {
    const fetchMock = vi.fn(async (_url, init) => {
      const headers = new Headers(init.headers)
      expect(headers.has('X-SRL-File-Name')).toBe(false)
      return Response.json({ size: 4, sha256: 'a'.repeat(64) })
    })
    vi.stubGlobal('fetch', fetchMock)
    await uploadLocalTavernDirectFile(
      {
        sessionId: 'session_123456',
        token: 'a'.repeat(32),
        origin: LOCAL_TAVERN_ORIGIN,
        maxFileSize: 1024,
      },
      new Blob(['data']),
      '中文人设与聊天'.repeat(50) + '.srlchat',
    )
    expect(fetchMock).toHaveBeenCalledOnce()
  })
})
