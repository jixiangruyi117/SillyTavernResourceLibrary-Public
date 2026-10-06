// SRL-PUBLIC-SYNC: BEGIN PUBLIC-ONLY id=worker-url-settings-tests
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  loadPublicWorkerBaseUrl,
  normalizePublicWorkerBaseUrl,
  publicWorkerEndpoint,
  savePublicWorkerBaseUrl,
} from './PublicWorkerSettingsService'

describe('PublicWorkerSettingsService', () => {
  beforeEach(() => {
    const values = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, String(value)),
      removeItem: (key: string) => values.delete(key),
    })
  })
  afterEach(() => vi.unstubAllGlobals())

  it('stores an HTTPS Worker root and builds service endpoint URLs', () => {
    expect(savePublicWorkerBaseUrl(' https://worker.example/ ')).toBe('https://worker.example')
    expect(loadPublicWorkerBaseUrl()).toBe('https://worker.example')
    expect(publicWorkerEndpoint('/api/bridge/join').href).toBe(
      'https://worker.example/api/bridge/join',
    )
  })

  it('accepts only HTTPS or loopback HTTP roots without credentials or paths', () => {
    expect(normalizePublicWorkerBaseUrl('http://localhost:8787')).toBe('http://localhost:8787')
    expect(() => normalizePublicWorkerBaseUrl('http://worker.example')).toThrow('HTTPS')
    expect(() => normalizePublicWorkerBaseUrl('https://user:secret@worker.example')).toThrow(
      '账号、密码',
    )
    expect(() => normalizePublicWorkerBaseUrl('https://worker.example/api')).toThrow('域名根地址')
  })

  it('asks the user to configure a Worker before building an endpoint', () => {
    expect(() => publicWorkerEndpoint('/api/cloud/proxy/koofr')).toThrow('设置 → 自部署 Worker')
  })
})
// SRL-PUBLIC-SYNC: END PUBLIC-ONLY id=worker-url-settings-tests
