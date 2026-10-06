/** @vitest-environment jsdom */
import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
const { hasPetAssets, clearPetAssets, downloadPetAssets } = vi.hoisted(() => ({
  hasPetAssets: vi.fn(async () => true),
  clearPetAssets: vi.fn(async () => undefined),
  downloadPetAssets: vi.fn(async () => undefined),
}))
vi.mock('../services/ProductAssistantPetAssets', () => ({
  hasDownloadedAssistantPetAssets: hasPetAssets,
  clearAssistantPetAssets: clearPetAssets,
  downloadAssistantPetAssets: downloadPetAssets,
}))
import ProductAssistantSettings from './ProductAssistantSettings.vue'
import { DEFAULT_ASSISTANT_PROMPTS } from '../core/ProductAssistantKnowledge'
import type {
  AssistantPreferences,
  ProductAssistantWorkspaceService,
} from '../services/ProductAssistantWorkspaceService'
vi.mock('../core/AppContainer', () => ({
  mainApiService: { getProfilesState: () => ({ profiles: [] }) },
}))
function render(
  preferences: Partial<AssistantPreferences> = {
    name: '蒜惹菈',
    avatar: '/icons/assistant-avatar.png',
    apiProfileId: '',
  },
) {
  const row = { id: 'chat', title: '旧标题', updatedAt: 1 }
  const rename = vi.fn(async (_id: string, title: string) => {
    row.title = title.trim()
  })
  const workspace = {
    preferences: vi.fn(() => ({
      name: '蒜惹菈',
      avatar: '/icons/assistant-avatar.png',
      apiProfileId: '',
      desktopPet: false,
    })),
    savePreferences: vi.fn(async (value: AssistantPreferences) => ({ ...value })),
    readGitHubCredential: vi.fn(async () => ''),
    list: async () => ({ items: [{ ...row }], total: 1 }),
    rename,
  }
  const wrapper = mount(ProductAssistantSettings, {
    props: {
      workspace: workspace as unknown as ProductAssistantWorkspaceService,
      preferences: {
        name: '蒜惹菈',
        avatar: '/icons/assistant-avatar.png',
        apiProfileId: '',
        ...preferences,
      },
      activeId: 'chat',
      historyPage: true,
      apiPage: false,
    },
  })
  return { wrapper, rename, workspace }
}
describe('history rename', () => {
  it('edits original prompt sections as unsaved drafts, preserves failed writes and restores a selected default', async () => {
    const { wrapper } = render()
    const owner = wrapper.props('workspace')
    owner.savePreferences = vi.fn(async (value) => ({ ...value }))
    try {
      await wrapper.setProps({ historyPage: false })
      expect(wrapper.find('[aria-label="系统提示词内容"]').exists()).toBe(false)
      const links = wrapper.findAll('.chat-settings-links > button')
      const memoryIndex = links.findIndex((link) => link.text().includes('偏好记忆'))
      expect(links[memoryIndex + 1]!.attributes('aria-label')).toBe('系统提示词')
      await links[memoryIndex + 1]!.trigger('click')
      expect(wrapper.emitted('prompt')).toHaveLength(1)
      await wrapper.setProps({ promptPage: true })
      const editor = wrapper.get<HTMLTextAreaElement>('[aria-label="系统提示词内容"]')
      expect(editor.element.value).toBe(DEFAULT_ASSISTANT_PROMPTS.common)
      await editor.setValue('自定义公共提示')
      await wrapper.get('[aria-label="提示词部分"]').setValue('features')
      expect(editor.element.value).toBe(DEFAULT_ASSISTANT_PROMPTS.features)
      await editor.setValue('功能模式只说重点')
      expect(wrapper.props('preferences').promptOverrides).toBeUndefined()
      expect(owner.savePreferences).not.toHaveBeenCalled()
      vi.mocked(owner.savePreferences).mockRejectedValueOnce(new Error('存储失败'))
      await wrapper.get('form').trigger('submit')
      await flushPromises()
      expect(wrapper.get('[role="alert"]').text()).toBe('存储失败')
      expect(editor.element.value).toBe('功能模式只说重点')
      await wrapper.get('form').trigger('submit')
      await flushPromises()
      expect(owner.savePreferences).toHaveBeenLastCalledWith(
        expect.objectContaining({
          promptOverrides: { common: '自定义公共提示', features: '功能模式只说重点' },
        }),
      )
      await wrapper.get('.chat-prompt-tools button').trigger('click')
      expect(editor.element.value).toBe(DEFAULT_ASSISTANT_PROMPTS.features)
      expect(wrapper.text()).toContain('有修改，待保存')
      await wrapper.get('form').trigger('submit')
      await flushPromises()
      expect(owner.savePreferences).toHaveBeenLastCalledWith(
        expect.objectContaining({ promptOverrides: { common: '自定义公共提示' } }),
      )
      expect(wrapper.text()).not.toContain('有修改，待保存')
    } finally {
      wrapper.unmount()
    }
  })
  it('searches message text and opens the original message, then lists favorites through the same storage owner', async () => {
    const { wrapper } = render()
    const search = vi.fn(async () => ({
      items: [
        {
          conversationId: 'old-chat',
          turnId: 'message-50',
          title: '美化方案',
          text: '圆角改为24px',
          updatedAt: 1,
        },
      ],
      total: 1,
    }))
    const owner = wrapper.props('workspace')
    owner.search = search
    try {
      await flushPromises()
      await wrapper.get('[aria-label="搜索聊天记录"]').setValue('圆角')
      await wrapper.get('[role="search"]').trigger('submit')
      await flushPromises()
      expect(search).toHaveBeenCalledWith('圆角', false, 0)
      expect(wrapper.text()).toContain('圆角改为24px')
      await wrapper.get('.chat-history-open').trigger('click')
      expect(wrapper.emitted('open')).toEqual([['old-chat', 'message-50']])
      await wrapper.setProps({ historyPage: false, favoritesPage: true })
      await flushPromises()
      await wrapper.get('[role="search"]').trigger('submit')
      await flushPromises()
      expect(search).toHaveBeenLastCalledWith('圆角', true, 0)
    } finally {
      wrapper.unmount()
    }
  })
  it('edits a current conversation inline, saves its name, and keeps the open action', async () => {
    const { wrapper, rename } = render()
    try {
      await flushPromises()
      await wrapper.get('[aria-label="重命名对话 旧标题"]').trigger('click')
      expect(wrapper.find('dialog').exists()).toBe(false)
      await wrapper.get('[aria-label="对话名称"]').setValue('每日小记')
      await wrapper.get('.chat-history-rename').trigger('submit')
      await flushPromises()
      expect(rename).toHaveBeenCalledWith('chat', '每日小记')
      expect(wrapper.get('.chat-history-open').text()).toContain('每日小记')
      await wrapper.get('.chat-history-open').trigger('click')
      expect(wrapper.emitted('open')).toEqual([['chat']])
    } finally {
      wrapper.unmount()
    }
  })
  it('cancels without changing the title and preserves an input after a failed save', async () => {
    const { wrapper, rename } = render()
    try {
      await flushPromises()
      await wrapper.get('[aria-label="重命名对话 旧标题"]').trigger('click')
      await wrapper.get('[aria-label="对话名称"]').setValue('取消的改名')
      await wrapper.get('[aria-label="对话名称"]').trigger('keydown', { key: 'Escape' })
      expect(rename).not.toHaveBeenCalled()
      expect(wrapper.get('.chat-history-open').text()).toContain('旧标题')
      rename.mockRejectedValueOnce(new Error('存储失败'))
      await wrapper.get('[aria-label="重命名对话 旧标题"]').trigger('click')
      await wrapper.get('[aria-label="对话名称"]').setValue('保留输入')
      await wrapper.get('.chat-history-rename').trigger('submit')
      await flushPromises()
      expect(wrapper.get<HTMLInputElement>('[aria-label="对话名称"]').element.value).toBe(
        '保留输入',
      )
      expect(wrapper.get('[role="alert"]').text()).toBe('存储失败')
    } finally {
      wrapper.unmount()
    }
  })
})

describe('network settings workflow', () => {
  it('shows the page-script permission switch and clearly explains its access when enabled', async () => {
    const { wrapper } = render()
    try {
      await wrapper.setProps({ historyPage: false })
      const scriptSwitch = wrapper.get<HTMLInputElement>('[aria-label="允许蒜惹菈运行页面脚本"]')
      expect(scriptSwitch.element.checked).toBe(false)
      expect(wrapper.text()).toContain('默认关闭')
      await scriptSwitch.setValue(true)
      expect(wrapper.text()).toContain('可能接触 API 密钥、登录页面及其他隐私')
    } finally {
      wrapper.unmount()
    }
  })
  it('hides pet-only options while off and restores their values when re-enabled', async () => {
    const { wrapper } = render()
    try {
      await wrapper.setProps({ historyPage: false })
      const pet = wrapper.get('[aria-label="启用蒜惹菈桌宠"]')
      expect(wrapper.find('[aria-label="桌宠走动动画"]').exists()).toBe(false)
      expect(wrapper.find('[aria-label="AI 控制表情"]').exists()).toBe(false)
      expect(wrapper.find('[aria-label="允许小助手截图"]').exists()).toBe(true)
      await pet.setValue(true)
      await wrapper.get('[aria-label="桌宠走动动画"]').setValue(false)
      await wrapper.get('[aria-label="AI 控制表情"]').setValue(true)
      await pet.setValue(false)
      expect(wrapper.find('[aria-label="桌宠走动动画"]').exists()).toBe(false)
      await pet.setValue(true)
      expect(wrapper.get<HTMLInputElement>('[aria-label="桌宠走动动画"]').element.checked).toBe(
        false,
      )
      expect(wrapper.get<HTMLInputElement>('[aria-label="AI 控制表情"]').element.checked).toBe(true)
    } finally {
      wrapper.unmount()
    }
  })

  it('keeps switches as drafts until saved and clears stale success after another change', async () => {
    const { wrapper } = render()
    const savePreferences = vi.fn(async (value: AssistantPreferences) => ({ ...value }))
    wrapper.props('workspace').savePreferences = savePreferences
    try {
      await wrapper.setProps({ historyPage: false })
      const screenshots = wrapper.get<HTMLInputElement>('[aria-label="允许小助手截图"]')
      expect(screenshots.element.checked).toBe(true)
      await screenshots.setValue(false)
      const network = wrapper.get<HTMLInputElement>('[aria-label="联网工具"]')
      const tools = wrapper.get<HTMLInputElement>('[aria-label="工具调用"]')
      expect(tools.element.checked).toBe(true)
      const limit = wrapper.get<HTMLInputElement>('[aria-label="每次生成工具调用上限"]')
      expect(limit.element.value).toBe('16')
      await limit.setValue('32')
      const budget = wrapper.get<HTMLInputElement>('[aria-label="自动压缩 token 阈值"]')
      expect(budget.element.placeholder).toBe('留空不自动压缩')
      expect(budget.attributes('max')).toBeUndefined()
      await budget.setValue('1000000')
      await tools.setValue(false)
      expect(network.element.checked).toBe(false)
      expect(wrapper.find('[aria-label="模型原生搜索"]').exists()).toBe(false)
      expect(wrapper.find('[aria-label="公开源码免确认"]').exists()).toBe(false)
      await network.setValue(true)
      await wrapper.get('[aria-label="模型原生搜索"]').setValue(true)
      const skipReadConfirmation = wrapper.get<HTMLInputElement>('[aria-label="公开源码免确认"]')
      expect(skipReadConfirmation.element.checked).toBe(false)
      await skipReadConfirmation.setValue(true)
      expect(savePreferences).not.toHaveBeenCalled()
      await wrapper.get('form').trigger('submit')
      await flushPromises()
      expect(savePreferences).toHaveBeenLastCalledWith(
        expect.objectContaining({
          networkEnabled: true,
          providerSearch: true,
          githubReadWithoutConfirmation: true,
          toolCallingEnabled: false,
          toolCallLimit: 32,
          compressionTokenThreshold: 1000000,
          allowScreenshots: false,
        }),
      )
      expect(wrapper.get('.chat-settings-save [role="status"]').text()).toBe('已保存')
      await network.setValue(false)
      expect(wrapper.get('.chat-settings-save [role="status"]').text()).toBe('有修改，待保存')
      expect(wrapper.find('[aria-label="模型原生搜索"]').exists()).toBe(false)
      expect(wrapper.find('[aria-label="公开源码免确认"]').exists()).toBe(false)
      savePreferences.mockRejectedValueOnce(new Error('存储失败'))
      await wrapper.get('form').trigger('submit')
      await flushPromises()
      expect(wrapper.get('[role="alert"]').text()).toBe('存储失败')
      expect(network.element.checked).toBe(false)
      expect(wrapper.emitted('saved')).toHaveLength(1)
      await wrapper.get('form').trigger('submit')
      await flushPromises()
      expect(savePreferences).toHaveBeenLastCalledWith(
        expect.objectContaining({
          networkEnabled: false,
          providerSearch: true,
          githubReadWithoutConfirmation: true,
        }),
      )
      expect(wrapper.emitted('saved')).toHaveLength(2)
      expect(wrapper.get('.chat-settings-save [role="status"]').text()).toBe('已保存')
    } finally {
      wrapper.unmount()
    }
  })
})

describe('GitHub credential settings', () => {
  it('loads a masked key and submits its draft separately from preferences with session choice', async () => {
    const { wrapper } = render()
    const owner = wrapper.props('workspace')
    owner.readGitHubCredential = vi.fn(async () => 'github_pat_old_reader_fixture')
    owner.savePreferences = vi.fn(async (value) => ({ ...value }))
    try {
      await wrapper.setProps({ historyPage: false })
      await wrapper.get('[aria-label="联网工具"]').setValue(true)
      await flushPromises()
      const input = wrapper.get('[aria-label="GitHub 令牌"]')
      expect(input.attributes('type')).toBe('password')
      expect(wrapper.text()).not.toContain('Jina')
      expect((input.element as HTMLInputElement).value).toBe('github_pat_old_reader_fixture')
      await input.setValue('github_pat_new_reader_fixture')
      await wrapper.get('[aria-label="GitHub 令牌保存方式"]').setValue('session')
      expect(wrapper.text()).toContain('有修改，待保存')
      await wrapper.get('form').trigger('submit')
      await flushPromises()
      expect(owner.savePreferences).toHaveBeenCalledWith(
        expect.objectContaining({
          githubReadPersistence: 'session',
          networkEnabled: true,
          apiProfileId: '',
        }),
        'github_pat_new_reader_fixture',
      )
      expect(JSON.stringify(wrapper.emitted('saved'))).not.toContain(
        'github_pat_new_reader_fixture',
      )
      expect(wrapper.text()).not.toContain('有修改，待保存')
      await wrapper.get('[aria-label="联网工具"]').setValue(false)
      expect(wrapper.find('[aria-label="GitHub 令牌"]').exists()).toBe(false)
    } finally {
      wrapper.unmount()
    }
  })
})

describe('pet artwork settings', () => {
  it('notifies the running pet after artwork downloads and preferences are saved', async () => {
    const { wrapper, workspace } = render({ desktopPet: true, petAssetMode: 'svg' })
    const updated = vi.fn()
    window.addEventListener('srl:assistant-pet-assets-updated', updated)
    try {
      await wrapper.setProps({ historyPage: false })
      await wrapper.get('.chat-pet-assets button').trigger('click')
      await flushPromises()

      expect(downloadPetAssets).toHaveBeenCalledOnce()
      expect(workspace.savePreferences).toHaveBeenCalledWith(
        expect.objectContaining({ petAssetMode: 'images' }),
      )
      expect(updated).toHaveBeenCalledOnce()
    } finally {
      window.removeEventListener('srl:assistant-pet-assets-updated', updated)
      wrapper.unmount()
    }
  })

  it('lets users clear artwork even after turning the pet off', async () => {
    downloadPetAssets.mockClear()
    const { wrapper, workspace } = render({ desktopPet: false, petAssetMode: 'images' })
    try {
      await wrapper.setProps({ historyPage: false })
      await flushPromises()
      expect(wrapper.text()).toContain('桌宠图片已下载')
      const clear = wrapper.get('.chat-pet-assets button')
      expect(clear.text()).toBe('清除图片')
      await clear.trigger('click')
      await flushPromises()
      expect(clearPetAssets).toHaveBeenCalledOnce()
      expect(workspace.savePreferences).toHaveBeenCalledWith(
        expect.objectContaining({ petAssetMode: 'svg' }),
      )
      expect(wrapper.text()).toContain('图片已清除，已切换为 SVG 悬浮球')
      expect(downloadPetAssets).not.toHaveBeenCalled()
    } finally {
      wrapper.unmount()
    }
  })
})
