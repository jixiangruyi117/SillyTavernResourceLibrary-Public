/* global fetch, URL */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import {
  auditEnvironment,
  createAuditApiFixture,
  prepareAuditContext,
  setAuditOffline,
  isExpectedOfflineApiError,
} from './AuditEnvironment.mjs'
import { startAuditPreview } from './AuditPreviewServer.mjs'

describe('认证 fixture 与测试身份隔离', () => {
  it('本地测试默认不要求密码，拒绝隐式线上环境与无状态真实认证', () => {
    expect(auditEnvironment({ SRL_AUDIT_RUN: 'chat-a' }).mode).toBe('fixture')
    expect(() => auditEnvironment({ SRL_PREVIEW_URL: 'https://example.com' })).toThrow('本地审计')
    expect(() => auditEnvironment({ SRL_AUDIT_MODE: 'auth' })).toThrow('独立测试账号')
    expect(() => auditEnvironment({ SRL_AUDIT_RUN: '../shared' })).toThrow('运行名称')
  })
  it('会话、访问模式和在线连接使用同一夹具；一个上下文退出不影响另一个', async () => {
    const contexts = []
    for (const run of ['chat-a', 'chat-b']) {
      const callbacks = {}
      const context = {
        addInitScript: async () => {},
        route: async (_url, callback) => {
          callbacks.http = callback
        },
        routeWebSocket: async (_url, callback) => {
          callbacks.socket = callback
        },
      }
      await prepareAuditContext(context, auditEnvironment({ SRL_AUDIT_RUN: run }))
      contexts.push(callbacks)
    }
    const request = async (context, path) => {
      let response
      await context.http({
        request: () => ({ url: () => 'http://127.0.0.1:5173' + path }),
        fulfill: (value) => {
          response = value
        },
      })
      return response
    }
    expect((await request(contexts[0], '/api/auth/session')).json.user.id).toBe('chat-a')
    expect((await request(contexts[1], '/api/auth/session')).json.user.id).toBe('chat-b')
    expect((await request(contexts[0], '/api/access-policy')).json.mode).toBe('required')
    await request(contexts[0], '/api/auth/logout')
    expect((await request(contexts[0], '/api/auth/session')).status).toBe(401)
    expect((await request(contexts[1], '/api/auth/session')).status).toBe(200)
    expect((await request(contexts[1], '/api/unknown')).status).toBe(404)
    expect(contexts[0].socket).toBeTypeOf('function')
  })
  it('真实认证模式不注册任何认证拦截', async () => {
    let intercepted = false
    const context = {
      addInitScript: async () => {},
      route: async () => {
        intercepted = true
      },
    }
    await prepareAuditContext(
      context,
      auditEnvironment({
        SRL_AUDIT_MODE: 'auth',
        SRL_AUDIT_STORAGE_STATE: '.codex-tmp/auth/state.json',
      }),
    )
    expect(intercepted).toBe(false)
  })
  it('性能测量可关闭快照记录，同时仍使用独立认证夹具', async () => {
    const context = {
      addInitScript: vi.fn(),
      route: vi.fn(),
      routeWebSocket: vi.fn(),
      tracing: { start: vi.fn() },
    }
    await prepareAuditContext(context, auditEnvironment({ SRL_AUDIT_RUN: 'perf' }), {
      trace: false,
    })
    expect(context.tracing.start).not.toHaveBeenCalled()
    expect(context.route).toHaveBeenCalledTimes(1)
  })
  it('HTTP夹具不注册会被 Service Worker 绕过的浏览器认证路由', async () => {
    const context = { addInitScript: vi.fn(), route: vi.fn(), routeWebSocket: vi.fn() }
    await prepareAuditContext(context, auditEnvironment({ SRL_AUDIT_FIXTURE_TRANSPORT: 'http' }))
    expect(context.route).not.toHaveBeenCalled()
    expect(context.routeWebSocket).toHaveBeenCalledTimes(1)
  })
  it('Chromium 保留离线仿真，WebKit 禁止操作没有Runner控制权的服务', async () => {
    const context = { setOffline: vi.fn() }
    await setAuditOffline(context, { engine: 'chromium' }, true)
    await setAuditOffline(context, { engine: 'chromium' }, false)
    expect(context.setOffline.mock.calls).toEqual([[true], [false]])
    vi.stubEnv('SRL_AUDIT_NETWORK_CONTROL', '')
    try {
      await expect(setAuditOffline(context, { engine: 'webkit' }, true)).rejects.toThrow(
        'audit:isolated',
      )
    } finally {
      vi.unstubAllEnvs()
    }
  })
  it('仅识别 WebKit 离线期间已声明只读API的Worker网络错误，不能放过资产或应用错误', () => {
    const environment = auditEnvironment({ SRL_AUDIT_ENGINE: 'webkit' })
    const error = {
      name: 'FetchEvent.respondWith received an error',
      message: `no-response :: [{"url":"${environment.baseUrl}/api/image-hosting/membership"}]`,
    }
    expect(isExpectedOfflineApiError(error, environment, true)).toBe(true)
    expect(
      isExpectedOfflineApiError(
        {
          name: 'Fetch API cannot load http',
          message: '/127.0.0.1:5173/api/image-hosting/membership.',
        },
        environment,
        true,
      ),
    ).toBe(true)
    expect(isExpectedOfflineApiError(error, environment, false)).toBe(false)
    expect(isExpectedOfflineApiError(error, { ...environment, engine: 'chromium' }, true)).toBe(
      false,
    )
    for (const invalid of [
      { ...error, name: 'TypeError' },
      {
        ...error,
        message: error.message.replace('/api/image-hosting/membership', '/assets/app.css'),
      },
      {
        ...error,
        message: error.message.replace('/api/image-hosting/membership', '/api/unexpected'),
      },
      { ...error, message: error.message.replace(environment.baseUrl, 'http://127.0.0.1:5189') },
      { ...error, message: '' },
    ])
      expect(isExpectedOfflineApiError(invalid, environment, true)).toBe(false)
  })
})

describe('隔离预览 HTTP 边界', () => {
  let preview
  const directory = resolve('.codex-tmp/workflow-gates-verification', `server-${randomUUID()}`)
  beforeAll(async () => {
    await mkdir(directory, { recursive: true })
    await writeFile(resolve(directory, 'index.html'), '<!doctype html><title>test</title>')
    await writeFile(resolve(directory, 'catalog.json'), '{"test":true}')
    preview = await startAuditPreview({ directory, port: 0, run: 'server-unit' })
  })
  afterAll(async () => {
    await preview?.close()
  })
  it('缺失 catalog/API 返回404，不能被 SPA HTML 假冒', async () => {
    expect((await fetch(preview.url + '/')).headers.get('x-srl-audit-run')).toBe('server-unit')
    expect((await fetch(preview.url + '/catalog.json')).headers.get('content-type')).toContain(
      'application/json',
    )
    expect((await fetch(preview.url + '/official-apps/missing/catalog.json')).status).toBe(404)
    expect((await fetch(preview.url + '/api/auth/session')).status).toBe(404)
    expect((await fetch(preview.url + '/%2e%2e%2fpackage.json')).status).toBe(404)
  })
  it('端口占用直接失败，保留原服务且不自动漂移', async () => {
    await expect(
      startAuditPreview({ directory, port: Number(new URL(preview.url).port), run: 'collision' }),
    ).rejects.toMatchObject({ code: 'EADDRINUSE' })
    expect((await fetch(preview.url + '/')).status).toBe(200)
  })
  it('测试断网时真实HTTP请求失败，恢复仅影响本次服务', async () => {
    preview.setNetworkUnavailable(true)
    try {
      await expect(fetch(preview.url + '/catalog.json')).rejects.toThrow()
    } finally {
      preview.setNetworkUnavailable(false)
    }
    expect((await fetch(preview.url + '/catalog.json')).status).toBe(200)
  })
  it('HTTP认证夹具在两个独立测试服务间隔离，并能供 Service Worker 直接请求', async () => {
    const previews = []
    try {
      for (const run of ['server-a', 'server-b'])
        previews.push(
          await startAuditPreview({
            directory,
            port: 0,
            run,
            apiFixture: createAuditApiFixture(run),
          }),
        )
      for (const [index, server] of previews.entries()) {
        const response = await fetch(server.url + '/api/auth/session')
        expect(response.headers.get('content-type')).toContain('application/json')
        expect(response.headers.get('cache-control')).toBe('no-store')
        expect((await response.json()).user.id).toBe(index === 0 ? 'server-a' : 'server-b')
      }
      await fetch(previews[0].url + '/api/auth/logout', { method: 'POST' })
      expect((await fetch(previews[0].url + '/api/auth/session')).status).toBe(401)
      expect((await fetch(previews[1].url + '/api/auth/session')).status).toBe(200)
      expect((await fetch(previews[1].url + '/api/unknown')).status).toBe(404)
    } finally {
      await Promise.all(previews.map((server) => server.close()))
    }
  })
  it('升级只切换本次同源候选，relaunch返回新HTML，丢失旧哈希仍404', async () => {
    const nextDirectory = resolve(directory, 'next')
    await mkdir(nextDirectory)
    await writeFile(resolve(nextDirectory, 'index.html'), '<head><title>next</title></head>')
    const server = await startAuditPreview({
      directory,
      nextDirectory,
      port: 0,
      run: 'upgrade',
      apiFixture: createAuditApiFixture('upgrade'),
    })
    try {
      expect(await (await fetch(server.url + '/')).text()).toContain('<title>test</title>')
      server.activateNext()
      const relaunch = await fetch(server.url + '/api/relaunch?update-recovery=service-worker')
      expect(relaunch.headers.get('content-type')).toContain('text/html')
      expect(relaunch.headers.get('cache-control')).toBe('no-store')
      expect(await relaunch.text()).toContain('<title>next</title>')
      expect((await fetch(server.url + '/assets/old-hash.js')).status).toBe(404)
      expect(await (await fetch(preview.url + '/')).text()).toContain('<title>test</title>')
    } finally {
      await server.close()
    }
  })
})
