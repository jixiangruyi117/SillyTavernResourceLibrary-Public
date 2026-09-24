// @vitest-environment jsdom

import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  COMMUNITY_SOURCE_PLATFORM,
  type ResourceCommunitySourceSummary,
} from '../types/CommunitySource'
import ResourceSourceLinks from './ResourceSourceLinks.vue'

const runtime = vi.hoisted(() => ({
  listSummariesForResource: vi.fn(),
}))

vi.mock('../core/CommunitySourceRuntime', () => ({
  communitySourceService: {
    listSummariesForResource: runtime.listSummariesForResource,
  },
}))

vi.mock('../services/DiscordSourceRefreshService', () => ({
  parseDiscordMessageUrl: vi.fn(),
  readDiscordSourceFromUrl: vi.fn(),
  readDiscordSourceRemote: vi.fn(),
}))

function savedSourceSummary(): ResourceCommunitySourceSummary {
  return {
    source: {
      id: 'source-1',
      platform: COMMUNITY_SOURCE_PLATFORM.DISCORD,
      sourceKeyHash: 'a'.repeat(64),
      channelId: 'channel-1',
      canonicalUrl: 'https://discord.com/channels/guild-1/channel-1/message-1',
      title: '已保存的 Discord 来源',
      revisionCount: 0,
      createdAt: 1,
      updatedAt: 1,
    },
    binding: {
      id: 'binding-1',
      resourceId: 'resource-1',
      sourceId: 'source-1',
      createdAt: 1,
    },
  }
}

describe('ResourceSourceLinks Discord directory lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    runtime.listSummariesForResource.mockResolvedValue([savedSourceSummary()])
  })

  it('keeps the saved-source directory mounted when the Discord group opens', async () => {
    const wrapper = mount(ResourceSourceLinks, {
      props: { resourceId: 'resource-1', links: [] },
      global: {
        stubs: {
          ResourceLinkAdvancedSettings: true,
          ResourceLinkRow: true,
          Teleport: true,
        },
      },
    })
    await flushPromises()

    const discordRow = wrapper.get('.resource-source-platform__row')
    expect(discordRow.text()).toContain('Discord')
    await discordRow.trigger('click')
    await flushPromises()

    expect(wrapper.find('.resource-source-platform--open').exists()).toBe(true)
    expect(wrapper.text()).toContain('已保存的 Discord 来源')
    expect(wrapper.text()).not.toContain('正在读取已保存的 Discord 来源')
    wrapper.unmount()
  })

  it('stores GitHub metadata when a GitHub source link is added', async () => {
    const wrapper = mount(ResourceSourceLinks, {
      props: { resourceId: 'resource-1', links: [] },
      global: {
        stubs: {
          DiscordCommunitySources: true,
          ResourceLinkAdvancedSettings: true,
          ResourceLinkRow: true,
          Teleport: true,
        },
      },
    })
    await flushPromises()

    await wrapper.get('.resource-sources__add').trigger('click')
    await wrapper.get('input[type="url"]').setValue('https://github.com/octocat/Hello-World')
    await wrapper.get('input[type="radio"][value="link"]').setValue(true)
    await wrapper.get('.resource-source-add-actions__primary').trigger('click')

    const updates = wrapper.emitted('update:links') ?? []
    const links = updates.at(-1)?.[0] as Array<{
      type: string
      github?: { owner: string; repo: string }
    }>
    expect(links).toHaveLength(1)
    expect(links[0]).toMatchObject({
      type: 'github',
      github: { owner: 'octocat', repo: 'Hello-World' },
    })
    wrapper.unmount()
  })
})
