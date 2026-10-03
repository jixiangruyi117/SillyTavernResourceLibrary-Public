/** @vitest-environment jsdom */
import { mount, flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
const api = vi.hoisted(() => ({ available: true, list: vi.fn(), ack: vi.fn() }))
vi.mock('../services/DiscordSourceSettingsService', () => ({
  loadDiscordSourceConnectionSettings: () =>
    api.available ? { inboxLibraryId: 'library-1', inboxSecret: 'private' } : {},
}))
vi.mock('../services/DiscordHandoffService', () => ({
  inboxConnection: () => ({ workerUrl: 'https://worker.example', libraryId: 'library-1' }),
}))
vi.mock('../services/DiscordResourceInboxService', () => ({
  listDiscordResourceJobs: api.list,
  acknowledgeDiscordResource: api.ack,
}))
import DiscordResourceDownloadPanel from './DiscordResourceDownloadPanel.vue'
const job = {
  id: '11111111-1111-4111-a111-111111111111',
  libraryId: 'library-1',
  name: '角色卡.json',
  state: 'failed',
  error: '网络未连接',
  createdAt: 1,
  updatedAt: 1,
  expiresAt: 9999999999999,
  size: 10,
}
beforeEach(() => {
  vi.clearAllMocks()
  api.available = true
  api.list.mockResolvedValue({ jobs: [], recent: [], hasMore: false })
  api.ack.mockResolvedValue(undefined)
})
describe('resource download panel', () => {
  it('reuses pairing without exposing another code or secret', async () => {
    api.available = false
    const wrapper = mount(DiscordResourceDownloadPanel)
    await flushPromises()
    expect(wrapper.text()).toContain('先在帖子收件中配对')
    expect(wrapper.get('button').attributes('disabled')).toBeDefined()
    expect(api.list).not.toHaveBeenCalled()
    expect(wrapper.find('input').exists()).toBe(false)
    wrapper.unmount()
  })
  it('updates resource availability when the shared pairing is created or disconnected', async () => {
    api.available = false
    const wrapper = mount(DiscordResourceDownloadPanel)
    await flushPromises()
    api.available = true
    window.dispatchEvent(new Event('srl:receive-discord-inbox'))
    await flushPromises()
    expect(wrapper.get('button').attributes('disabled')).toBeUndefined()
    expect(api.list).toHaveBeenCalledOnce()
    api.available = false
    window.dispatchEvent(new Event('srl:receive-discord-inbox'))
    await flushPromises()
    expect(wrapper.get('button').attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain('先在帖子收件中配对')
    wrapper.unmount()
  })
  it('distinguishes waiting versions from imported resources and retries a failed task in place', async () => {
    api.list.mockResolvedValue({
      jobs: [
        {
          ...job,
          id: '22222222-2222-4222-a222-222222222222',
          state: 'waiting_version',
          error: null,
        },
      ],
      recent: [job],
      hasMore: false,
    })
    const wrapper = mount(DiscordResourceDownloadPanel)
    await flushPromises()
    expect(wrapper.text()).toContain('待选历史版本')
    expect(wrapper.text()).toContain('网络未连接')
    expect(wrapper.text()).not.toContain('已导入')
    await wrapper.get('button[aria-label="重试 角色卡.json"]').trigger('click')
    await flushPromises()
    expect(api.ack).toHaveBeenCalledWith(job.id, 'queued', {
      workerUrl: 'https://worker.example',
      libraryId: 'library-1',
    })
    expect(wrapper.find('details').attributes('open')).toBeUndefined()
    wrapper.unmount()
  })
  it('shows an old Worker error instead of inventing download success', async () => {
    api.list.mockRejectedValue(new Error('Worker 尚未更新'))
    const wrapper = mount(DiscordResourceDownloadPanel)
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toBe('Worker 尚未更新')
    expect(wrapper.find('li').exists()).toBe(false)
    wrapper.unmount()
  })
})
