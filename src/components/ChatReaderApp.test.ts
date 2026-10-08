/** @vitest-environment jsdom */
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const service = vi.hoisted(() => ({
  inspect: vi.fn(async (_files: readonly File[]) => ({ packageFingerprint: 'shipped' })),
  get: vi.fn(),
  getSummary: vi.fn(),
  install: vi.fn(),
  setEnabled: vi.fn(),
  registerBuiltinReader: vi.fn(),
}))
vi.mock('../core/AppContainer', () => ({ externalAppService: service }))
const wrappers: VueWrapper[] = []
const installed = () => ({
  enabled: true,
  packageFingerprint: 'shipped',
  runtimeMode: 'trustedCompatible',
})
async function open() {
  const { default: Reader } = await import('./ChatReaderApp.vue')
  const wrapper = mount(Reader, {
    global: { stubs: { ExternalAppHost: true, FeatureStateView: true } },
  })
  wrappers.push(wrapper)
  await flushPromises()
  return wrapper
}
beforeEach(() => {
  vi.resetModules()
  Object.values(service).forEach((mock) => mock.mockReset())
  service.inspect.mockResolvedValue({ packageFingerprint: 'shipped' })
  service.get.mockResolvedValue(installed())
  service.getSummary.mockResolvedValue(installed())
})
afterEach(() => wrappers.splice(0).forEach((wrapper) => wrapper.unmount()))
describe('built-in reader package preparation', () => {
  it('prepares shipped bytes once and only reads the live installation summary on reentry', async () => {
    const first = await open()
    first.unmount()
    const second = await open()
    expect(service.inspect).toHaveBeenCalledTimes(1)
    expect(service.getSummary).toHaveBeenCalledTimes(2)
    expect(service.get).not.toHaveBeenCalled()
    expect(service.install).not.toHaveBeenCalled()
    expect(second.find('external-app-host-stub').exists()).toBe(true)
  })
  it.each([
    undefined,
    { ...installed(), packageFingerprint: 'replaced' },
    { ...installed(), runtimeMode: 'isolated' },
    { ...installed(), enabled: false },
  ])('rechecks removal or replacement after a prepared launch: %j', async (next) => {
    const first = await open()
    first.unmount()
    service.get.mockResolvedValue(next)
    service.getSummary.mockResolvedValue(next)
    await open()
    expect(service.inspect).toHaveBeenCalledTimes(1)
    expect(service.install).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ packageFingerprint: 'shipped' }),
      'trustedCompatible',
    )
    expect(service.setEnabled).toHaveBeenCalledTimes(next?.enabled ? 0 : 1)
  })
  it('preserves the error and only prepares again on the next explicit entry', async () => {
    service.inspect.mockRejectedValueOnce(new Error('package invalid'))
    const failed = await open()
    expect(failed.find('external-app-host-stub').exists()).toBe(false)
    expect(service.install).not.toHaveBeenCalled()
    await open()
    expect(service.inspect).toHaveBeenCalledTimes(2)
    expect(service.install).not.toHaveBeenCalled()
  })
  it('does not use a cached installation state after a metadata read failure', async () => {
    const first = await open()
    first.unmount()
    service.getSummary.mockRejectedValueOnce(new Error('storage unavailable'))
    const failed = await open()
    expect(failed.find('external-app-host-stub').exists()).toBe(false)
    expect(service.install).not.toHaveBeenCalled()
    await open()
    expect(service.inspect).toHaveBeenCalledTimes(1)
    expect(service.getSummary).toHaveBeenCalledTimes(3)
  })
})

describe('ChatReaderApp cold entry', () => {
  it('uses the reader paper during package preparation, including night reentry', async () => {
    const { readChatReaderColors, rememberChatReaderColors } =
      await import('../utils/ChatReaderAppearance')
    const colors = readChatReaderColors()
    rememberChatReaderColors({ ...colors, paper: '#202622' })
    service.getSummary.mockImplementationOnce(() => new Promise(() => {}))
    const wrapper = await open()
    expect(wrapper.find('external-app-host-stub').exists()).toBe(false)
    const startup = wrapper.get('.chat-reader-startup').element as HTMLElement
    expect(startup.style.getPropertyValue('--reader-paper')).toBe('#202622')
    expect(wrapper.get('[role="status"]').text()).toBe('正在打开读了么…')
  })
  it('reads only metadata before mounting the host and seeds the official shell before SDK readiness', async () => {
    const wrapper = await open()
    try {
      await flushPromises()
      expect(wrapper.find('external-app-host-stub').exists()).toBe(true)
      expect(service.get).not.toHaveBeenCalled()
      expect(service.getSummary).toHaveBeenCalledWith('com.srl.duleme')
      expect(service.install).not.toHaveBeenCalled()
      const files = service.inspect.mock.calls[0]![0] as unknown as File[]
      const html = await files.find((file) => file.name === 'index.html')!.text()
      const root = new DOMParser().parseFromString(html, 'text/html').documentElement
      expect(root.lang).toBe('zh-CN')
      expect(root.classList.contains('builtin-shell')).toBe(true)
      expect(root.hasAttribute('data-reader-starting')).toBe(true)
      expect(html).toContain('正在读取聊天列表')
    } finally {
      wrapper.unmount()
    }
  })
})
