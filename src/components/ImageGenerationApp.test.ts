/** @vitest-environment jsdom */
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { frontendWorkshopImageDraftService } from '../services/FrontendWorkshopImageDraftService'
import { NOVELAI_MODELS } from '../services/FrontendWorkshopImageGenerationService'
const { generate, album, hosting, confirmAction, saveConfiguration } = vi.hoisted(() => ({
  confirmAction: vi.fn(async () => true),
  saveConfiguration: vi.fn(async (value) => value),
  generate: vi.fn(),
  album: { saveGenerated: vi.fn(), getOriginalBlob: vi.fn(), setHostedUrl: vi.fn() },
  hosting: {
    getSelfHostedConfiguration: vi.fn((): { origin: string } | null => null),
    uploadBlobSelfHosted: vi.fn(),
  },
}))
vi.mock('../core/ImageGenerationContainer', () => ({
  frontendWorkshopImageGenerationService: {
    defaultConfig: (provider: string) => ({
      provider,
      endpoint:
        provider === 'novelai'
          ? 'https://image.novelai.net/ai/generate-image'
          : 'https://api.openai.com/v1/images/generations',
    }),
    getSavedConfig: (provider: string) => ({
      provider,
      model: provider === 'novelai' ? 'nai-diffusion-5-full' : 'gpt-image-2',
      apiKey: 'ui-test-key',
      endpoint:
        provider === 'novelai'
          ? 'https://image.novelai.net/ai/generate-image'
          : 'https://relay.example/v1/images/generations',
    }),
    generate,
    saveConfiguration,
    listModels: vi.fn(async () => ({ options: [], message: '0 models' })),
  },
}))
vi.mock('../core/ImageAlbumContainer', () => ({
  generatedImageAlbumService: album,
  frontendWorkshopImageHostingService: hosting,
}))
vi.mock('../composables/UseConfirmDialog', () => ({ confirmAction }))
vi.mock('../core/NativeFileExport', () => ({
  isNativeFileExportAvailable: () => false,
  saveBlobToNativeDestination: vi.fn(),
}))
import ImageGenerationApp from './ImageGenerationApp.vue'
enableAutoUnmount(afterEach)
const result = {
  id: 'result-one',
  provider: 'novelai',
  dataUrl: 'data:image/png;base64,cG5n',
  prompt: 'portrait',
  seed: 7,
  width: 832,
  height: 1216,
  parameters: {},
  createdAt: 1,
}
function clickTab(wrapper: ReturnType<typeof mount>, label: string) {
  return wrapper
    .findAll('[aria-label="供应商功能"] button')
    .find((b) => b.text() === label)!
    .trigger('click')
}
beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
  generate.mockResolvedValue(result)
  album.saveGenerated.mockResolvedValue({ id: result.id })
  album.getOriginalBlob.mockResolvedValue(new Blob(['png'], { type: 'image/png' }))
  album.setHostedUrl.mockResolvedValue({
    id: result.id,
    hostedUrl: 'https://img.example/result.png',
  })
  hosting.getSelfHostedConfiguration.mockReturnValue({ origin: 'https://img.example/upload' })
  hosting.uploadBlobSelfHosted.mockResolvedValue({ url: 'https://img.example/result.png' })
})

describe('ImageGenerationApp', () => {
  const click = (wrapper: ReturnType<typeof mount>, label: string) => {
    const control = wrapper.findAll('button').find((button) => button.text() === label)
    if (!control) throw new Error(`Missing button: ${label}`)
    return control.trigger('click')
  }
  it('marks the full-screen workspace as the mobile input focus scope', () => {
    const wrapper = mount(ImageGenerationApp)
    expect(wrapper.get('.image-generation-app').attributes()).toMatchObject({
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': 'AI 生图',
    })
    expect(wrapper.get('.image-generation-controls').classes()).toContain('scroll')
  })
  it('preserves provider drafts and session keys without serializing credentials', async () => {
    const wrapper = mount(ImageGenerationApp)
    await wrapper.get('[aria-label="画面描述"]').setValue('NAI draft')
    await click(wrapper, '模型 / 连接')
    await wrapper.get('input[type="password"]').setValue('nai-session-key')
    await click(wrapper, 'OpenAI')
    expect(wrapper.get('[aria-label="画面描述"]').element).toHaveProperty('value', '')
    await wrapper.get('[aria-label="画面描述"]').setValue('GPT draft')
    await click(wrapper, 'NovelAI')
    expect(wrapper.get('[aria-label="画面描述"]').element).toHaveProperty('value', 'NAI draft')
    await click(wrapper, '模型 / 连接')
    expect(wrapper.get('input[type="password"]').element).toHaveProperty('value', 'nai-session-key')
    wrapper.unmount()
    const reopened = mount(ImageGenerationApp)
    expect(reopened.get('[aria-label="画面描述"]').element).toHaveProperty('value', 'NAI draft')
    expect(frontendWorkshopImageDraftService.loadDraft('openai')?.prompt).toBe('GPT draft')
    expect(JSON.stringify(Object.values(localStorage))).not.toContain('session-key')
  })
  it('preserves template apply, overwrite and confirmed deletion through the existing owner', async () => {
    const wrapper = mount(ImageGenerationApp)
    await wrapper.get('[aria-label="画面描述"]').setValue('portrait template')
    await wrapper.get('[aria-label="模板名称"]').setValue('portrait')
    await wrapper.get('form').trigger('submit')
    await wrapper.get('[aria-label="画面描述"]').setValue('temporary')
    await click(wrapper, '套用')
    expect(wrapper.get('[aria-label="画面描述"]').element).toHaveProperty(
      'value',
      'portrait template',
    )
    await wrapper.get('[aria-label="画面描述"]').setValue('overwritten')
    await click(wrapper, '覆盖')
    expect(frontendWorkshopImageDraftService.listTemplates()[0]?.draft.prompt).toBe('overwritten')
    expect(JSON.stringify(frontendWorkshopImageDraftService.listTemplates())).not.toContain(
      'ui-test-key',
    )
    confirmAction.mockResolvedValueOnce(false)
    await click(wrapper, '删除')
    await flushPromises()
    expect(frontendWorkshopImageDraftService.listTemplates()).toHaveLength(1)
    await click(wrapper, '删除')
    await flushPromises()
    expect(frontendWorkshopImageDraftService.listTemplates()).toEqual([])
  })
  it('retains candidates and their independent save state and does not pretend native export is available', async () => {
    generate
      .mockResolvedValueOnce({ ...result, id: 'first' })
      .mockResolvedValueOnce({ ...result, id: 'second', dataUrl: 'data:image/png;base64,c2Vjb25k' })
    const wrapper = mount(ImageGenerationApp)
    await wrapper.get('[aria-label="画面描述"]').setValue('portrait')
    await click(wrapper, '生成图片')
    await flushPromises()
    await click(wrapper, '保存')
    await click(wrapper, '保存到生图相册')
    await flushPromises()
    expect(
      wrapper
        .findAll('button')
        .find((button) => button.text() === '保存到手机相册')
        ?.attributes('disabled'),
    ).toBeDefined()
    await click(wrapper, '返回')
    await click(wrapper, '生成图片')
    await flushPromises()
    await click(wrapper, '结果')
    expect(wrapper.get('[aria-label="生成候选"]').text()).toContain('2 / 2')
    await wrapper.get('[aria-label="上一张生成结果"]').trigger('click')
    expect(wrapper.get('.image-generation-result img').attributes('src')).toBe(result.dataUrl)
    await click(wrapper, '保存结果')
    expect(
      wrapper
        .findAll('button')
        .find((button) => button.text() === '已保存到生图相册')
        ?.attributes('disabled'),
    ).toBeDefined()
    await click(wrapper, '返回')
    await click(wrapper, '结果')
    await wrapper.get('[aria-label="下一张生成结果"]').trigger('click')
    await click(wrapper, '保存结果')
    expect(
      wrapper
        .findAll('button')
        .find((button) => button.text() === '保存到生图相册')
        ?.attributes('disabled'),
    ).toBeUndefined()
  })
  it('allows both providers to edit endpoints and keeps manual OpenAI-compatible models', async () => {
    const wrapper = mount(ImageGenerationApp)
    expect(wrapper.get('[aria-label="模型列表"]').findAll('option')).toHaveLength(
      NOVELAI_MODELS.length,
    )
    await click(wrapper, '模型 / 连接')
    expect(wrapper.get('input[type="url"]').attributes('readonly')).toBeUndefined()
    await click(wrapper, 'OpenAI')
    await click(wrapper, '模型 / 连接')
    const endpoint = wrapper.get('input[type="url"]')
    expect(endpoint.attributes('readonly')).toBeUndefined()
    await endpoint.setValue('https://relay.test/v1/images/generations')
    await wrapper.get('input[type="password"]').setValue('relay-key')
    await wrapper.get('.image-generation-connection input[type="text"]').setValue('future-model')
    expect(wrapper.get('[aria-label="模型列表"]').element).toHaveProperty('value', 'future-model')
    await click(wrapper, '恢复默认地址')
    expect(endpoint.element).toHaveProperty('value', 'https://api.openai.com/v1/images/generations')
    expect(wrapper.get('input[type="password"]').element).toHaveProperty('value', 'relay-key')
  })
  it('prevents provider switching during generation and retains the other provider configuration', async () => {
    let resolve!: (value: typeof result) => void
    generate.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done
      }),
    )
    const wrapper = mount(ImageGenerationApp)
    await wrapper.get('[aria-label="画面描述"]').setValue('portrait')
    await click(wrapper, '生成图片')
    expect(
      wrapper
        .findAll('button')
        .find((button) => button.text() === 'OpenAI')
        ?.attributes('disabled'),
    ).toBeDefined()
    await click(wrapper, 'OpenAI')
    resolve(result)
    await flushPromises()
    expect(saveConfiguration).toHaveBeenLastCalledWith(
      expect.objectContaining({ provider: 'novelai' }),
    )
    await click(wrapper, 'OpenAI')
    expect(wrapper.get('[aria-label="模型列表"]').element).toHaveProperty('value', 'gpt-image-2')
  })
  it('uses the approved workspace hierarchy and gates NAI character/settings/reference content', async () => {
    const wrapper = mount(ImageGenerationApp)
    expect(wrapper.find('[aria-label="生图流程"]').exists()).toBe(false)
    expect(wrapper.find('.editor > .mobile-preview').exists()).toBe(true)
    expect(wrapper.find('.shell > .preview').exists()).toBe(true)
    await clickTab(wrapper, '角色')
    await wrapper
      .findAll('button')
      .find((b) => b.text() === '添加角色')!
      .trigger('click')
    expect(wrapper.findAll('.image-generation-entry')).toHaveLength(1)
    await wrapper.get('.image-generation-entry textarea').setValue('red hair')
    await clickTab(wrapper, '设置')
    expect(wrapper.text()).toContain('Seed')
    expect(wrapper.text()).toContain('透明背景')
    expect(wrapper.text()).not.toContain('SMEA')
    await clickTab(wrapper, '参考')
    expect(wrapper.text()).toContain('官方支持，但项目当前尚未接通')
    expect(wrapper.findAll('.ref .small').map((status) => status.text())).toEqual([
      '官方支持，但项目当前尚未接通',
      '当前模型不支持',
    ])
    expect(wrapper.findAll('input[type="file"]')).toHaveLength(0)
    await wrapper.get('[aria-label="模型列表"]').setValue('nai-diffusion-4-5-full')
    expect(wrapper.findAll('.ref .small').map((status) => status.text())).toEqual([
      '官方支持，但项目当前尚未接通',
      '官方支持，但项目当前尚未接通',
    ])
    expect(wrapper.findAll('input[type="file"]')).toHaveLength(0)
    await wrapper.get('[aria-label="模型列表"]').setValue('nai-diffusion-5-full')
    await clickTab(wrapper, 'Prompt')
    await wrapper.get('textarea').setValue('portrait')
    await wrapper.get('.image-generation-generate-bar button').trigger('click')
    await flushPromises()
    expect(generate.mock.calls[0]?.[1]).toMatchObject({
      novelAiCharacters: [{ prompt: 'red hair' }],
    })
    expect(wrapper.get('img[alt="生成结果"]').attributes('src')).toBe(result.dataUrl)
    await wrapper.get('.preview-actions .primary').trigger('click')
    await wrapper
      .findAll('button')
      .find((b) => b.text() === '云端生成直链')!
      .trigger('click')
    await wrapper.get('.image-generation-primary').trigger('click')
    await flushPromises()
    expect(album.setHostedUrl).toHaveBeenCalledWith(
      result.id,
      { url: 'https://img.example/result.png' },
      'self-hosted',
    )
    expect(wrapper.find('input[readonly]').attributes('value')).toBe(
      'https://img.example/result.png',
    )
  })
  it('does not show diffusion controls for GPT and blocks JPEG when transparency is selected', async () => {
    const wrapper = mount(ImageGenerationApp)
    await wrapper
      .findAll('.image-generation-provider__switch button')
      .find((b) => b.text() === 'OpenAI')!
      .trigger('click')
    await clickTab(wrapper, '设置')
    expect(wrapper.text()).not.toMatch(/Seed|Sampler|Steps|Guidance/)
    await wrapper.get('input.switch').setValue(true)
    expect(wrapper.get('option[value="jpeg"]').attributes('disabled')).toBeDefined()
    await clickTab(wrapper, '编辑')
    expect(wrapper.text()).toContain('保持人物身份')
    expect(wrapper.text()).toContain('保持构图')
  })
  it('keeps unknown OpenAI-compatible capabilities unknown and prevents malformed additional JSON submission', async () => {
    const wrapper = mount(ImageGenerationApp)
    await wrapper
      .findAll('.image-generation-provider__switch button')
      .find((b) => b.text() === 'OpenAI')!
      .trigger('click')
    await click(wrapper, '模型 / 连接')
    await wrapper.get('.image-generation-connection input[type="text"]').setValue('relay-image')
    expect(wrapper.text()).toContain('? 未确认')
    await clickTab(wrapper, 'Prompt')
    await wrapper.get('textarea').setValue('portrait')
    await clickTab(wrapper, '请求')
    expect(wrapper.get('pre').text()).not.toContain('ui-test-key')
    expect(wrapper.get('pre').text()).not.toContain('quality')
    await wrapper.get('textarea').setValue('{invalid')
    expect(
      wrapper.get('.image-generation-generate-bar button').attributes('disabled'),
    ).toBeDefined()
    expect(wrapper.text()).toContain('阻止提交')
    expect(generate).not.toHaveBeenCalled()
  })
  it('does not claim a hosted album writeback when saving the original fails', async () => {
    const wrapper = mount(ImageGenerationApp)
    await wrapper.get('textarea').setValue('portrait')
    await wrapper.get('.image-generation-generate-bar button').trigger('click')
    await flushPromises()
    album.saveGenerated.mockRejectedValueOnce(new Error('storage full'))
    await wrapper.get('.preview-actions .primary').trigger('click')
    await wrapper
      .findAll('button')
      .find((b) => b.text() === '云端生成直链')!
      .trigger('click')
    await wrapper.get('.image-generation-primary').trigger('click')
    await flushPromises()
    expect(hosting.uploadBlobSelfHosted).not.toHaveBeenCalled()
    expect(wrapper.text()).not.toContain('已生成稳定 HTTPS')
    expect(wrapper.text()).toContain('storage full')
  })
})
