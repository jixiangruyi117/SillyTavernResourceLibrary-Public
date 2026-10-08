/** @vitest-environment jsdom */
import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import DiscordManualDeployDrawer from './DiscordManualDeployDrawer.vue'
import DiscordSetupGuideDrawer from './DiscordSetupGuideDrawer.vue'

const props = {
  open: true,
  applicationId: 'application-id',
  publicKey: 'public-key',
  botToken: 'bot-token',
  installationUrl: 'https://discord.com/oauth2/authorize',
  developerAppUrl: 'https://discord.com/developers/applications',
  developerBotUrl: 'https://discord.com/developers/applications/bot',
}

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  )
})

describe('Discord tutorial screenshot previews', () => {
  it('shows the D1 UUID column reference in the GitHub deploy guide', () => {
    const wrapper = mount(DiscordSetupGuideDrawer, {
      props: { ...props, deploymentMode: 'github' },
      global: { stubs: { teleport: true } },
    })
    const screenshot = wrapper
      .findAll('figure.discord-guide-screenshot')
      .find((figure) =>
        figure.get('img').attributes('src')?.includes('d1-database-uuid-column.jpg'),
      )

    expect(screenshot).toBeDefined()
    expect(screenshot?.get('img').attributes('alt')).toContain('UUID 列')
    expect(screenshot?.text()).toContain('复制完整 Database ID')
    wrapper.unmount()
  })

  it.each([
    ['GitHub setup guide', DiscordSetupGuideDrawer],
    ['manual deploy guide', DiscordManualDeployDrawer],
  ])('opens an image viewer immediately from the %s screenshot', async (_name, component) => {
    const wrapper = mount(component, {
      props,
      global: { stubs: { teleport: true } },
    })
    const screenshot = wrapper.get('figure[role="button"]')
    await screenshot.trigger('click')

    const viewer = wrapper.get('.resource-image-viewer--minimal')
    expect(viewer.get('img').attributes('alt')).toContain('Discord')
    expect(viewer.get('img').attributes('src')).toContain('/tutorials/discord-')
    expect(viewer.get('[aria-label="关闭图片"]').text()).toBe('×')

    await viewer.get('[aria-label="关闭图片"]').trigger('click')
    expect(wrapper.find('.resource-image-viewer').exists()).toBe(false)
    wrapper.unmount()
  })
})
