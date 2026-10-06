import { afterEach, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

it('keeps the self-hosted APK packaged and uses an independent application ID', async () => {
  vi.stubEnv('CAPACITOR_SERVER_URL', '')
  vi.stubEnv('SRL_PUBLIC_ORIGIN', 'https://library.example.com/')
  const { default: config } = await import('../capacitor.config')
  expect(config.appId).toBe('app.srl.publicedition')
  expect(config.appName).toBe('SRL_Pubilc')
  expect(config.server).toEqual({ hostname: 'library.example.com', androidScheme: 'https' })
  expect(config.webDir).toBe('dist')
})

it.each([
  'http://library.example.com',
  'https://user:password@library.example.com',
  'https://library.example.com:8080',
  'https://library.example.com/path',
  'https://library.example.com/?token=example',
])('rejects an origin that cannot safely identify the local packaged host: %s', async (origin) => {
  vi.stubEnv('SRL_PUBLIC_ORIGIN', origin)
  await expect(import('../capacitor.config')).rejects.toThrow('SRL_PUBLIC_ORIGIN')
})
