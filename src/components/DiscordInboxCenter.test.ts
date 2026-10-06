/** @vitest-environment jsdom */
import { mount, flushPromises } from '@vue/test-utils'
import { describe, it, expect, vi } from 'vitest'
import DiscordInboxCenter from './DiscordInboxCenter.vue'

const inboxActions = { openCloudCleanup: vi.fn(), openAutomationSettings: vi.fn() }

vi.mock('../services/DiscordSourceSettingsService', () => ({
  loadDiscordSourceConnectionSettings: () => ({
    applicationId: '',
    publicKey: '',
    botToken: '',
    workerBaseUrl: '',
  }),
  saveDiscordSourceConnectionSettings: vi.fn(),
  saveDiscordSourceConnectionStatus: vi.fn(),
}))

const stubs = {
  DiscordInboxPanel: {
    props: ['mode'],
    methods: inboxActions,
    template:
      "<section :data-testid=\"mode === 'pairing' ? 'pairing-settings' : 'post-inbox'\">收件面板</section>",
  },
  DiscordResourceDownloadPanel: {
    template: '<section data-testid="resource-inbox">资源下载</section>',
  },
  DiscordPendingSources: {
    template: '<section data-testid="pending-sources">待整理来源</section>',
  },
}

describe('standalone inbox', () => {
  it('places cleanup and inbox settings in the page header and opens the matching panels', async () => {
    const wrapper = mount(DiscordInboxCenter, { attachTo: document.body, global: { stubs } })
    try {
      const header = wrapper.find('.feature-app-header__trailing')
      expect(header.exists()).toBe(true)
      const cleanup = header.get('[aria-label="清理云端"]')
      const settings = header.get('[aria-label="收件箱设置"]')
      expect(cleanup.find('svg').exists()).toBe(true)
      expect(settings.find('svg').exists()).toBe(true)
      expect(cleanup.find('svg path').attributes('stroke')).toBe('currentColor')
      expect(settings.find('svg path').attributes('stroke')).toBe('currentColor')
      await cleanup.trigger('click')
      await settings.trigger('click')
      expect(inboxActions.openCloudCleanup).toHaveBeenCalledOnce()
      expect(inboxActions.openAutomationSettings).toHaveBeenCalledOnce()
    } finally {
      wrapper.unmount()
      vi.clearAllMocks()
    }
  })

  it('opens the existing connection settings without duplicating the inbox panels', async () => {
    const wrapper = mount(DiscordInboxCenter, { attachTo: document.body, global: { stubs } })
    try {
      expect(wrapper.get('h1').text()).toBe('收件箱')
      expect(wrapper.find('[data-testid="post-inbox"]').exists()).toBe(true)
      expect(wrapper.find('[data-testid="resource-inbox"]').exists()).toBe(true)
      await wrapper
        .findAll('button')
        .find((button) => button.text() === '连接设置')!
        .trigger('click')
      await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).not.toBeNull())
      const back = { handled: false }
      window.dispatchEvent(new CustomEvent('srl:back-request', { detail: back }))
      await flushPromises()
      expect(back.handled).toBe(true)
      expect(document.querySelector('[role="dialog"]')).toBeNull()
      expect(wrapper.get('h1').text()).toBe('收件箱')
      expect(wrapper.find('[data-testid="pending-sources"]').exists()).toBe(true)
      await wrapper
        .findAll('button')
        .find((button) => button.text() === '连接设置')!
        .trigger('click')
      await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).not.toBeNull())
      expect(document.querySelector('h2')?.textContent).toBe('Discord 连接设置')
      expect(document.querySelector('[role="dialog"]')?.textContent).toContain('返回收件箱')
      expect(document.querySelector('[role="dialog"] [data-testid="post-inbox"]')).toBeNull()
      expect(
        document.querySelector('[role="dialog"] [data-testid="pairing-settings"]'),
      ).not.toBeNull()
      expect(document.querySelector('[role="dialog"] [data-testid="resource-inbox"]')).toBeNull()
      expect(document.querySelector('[role="dialog"] [data-testid="pending-sources"]')).toBeNull()
      ;(document.querySelector('.resource-source-advanced__back') as HTMLButtonElement).click()
      await flushPromises()
      expect(document.querySelector('[role="dialog"]')).toBeNull()
      expect(wrapper.find('[data-testid="resource-inbox"]').exists()).toBe(true)
    } finally {
      wrapper.unmount()
    }
  })
})
