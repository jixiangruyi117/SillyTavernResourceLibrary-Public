/** @vitest-environment jsdom */
import { mount, flushPromises } from '@vue/test-utils'
import { describe, it, expect, vi } from 'vitest'
import DiscordInboxCenter from './DiscordInboxCenter.vue'

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
