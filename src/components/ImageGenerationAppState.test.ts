/** @vitest-environment jsdom */
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { generate, toBlob, saveGenerated } = vi.hoisted(() => ({
  generate: vi.fn(),
  toBlob: vi.fn(async () => new Blob(['png'], { type: 'image/png' })),
  saveGenerated: vi.fn(async () => ({ id: 'saved-image', name: 'saved image' })),
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
      apiKey: 'state-test-key',
      endpoint:
        provider === 'novelai'
          ? 'https://image.novelai.net/ai/generate-image'
          : 'https://api.openai.com/v1/images/generations',
    }),
    generate,
    toBlob,
    saveConfiguration: vi.fn(async (value) => value),
    listModels: vi.fn(async () => ({ options: [], message: '0 models' })),
  },
}))
vi.mock('../core/ImageAlbumContainer', () => ({
  generatedImageAlbumService: {
    saveGenerated,
    getOriginalBlob: vi.fn(),
    setHostedUrl: vi.fn(),
  },
  frontendWorkshopImageHostingService: {
    getSelfHostedConfiguration: vi.fn(() => null),
    uploadBlobShared: vi.fn(),
    uploadBlobSelfHosted: vi.fn(),
  },
}))
vi.mock('../composables/UseConfirmDialog', () => ({ confirmAction: vi.fn(async () => true) }))
vi.mock('../core/NativeFileExport', () => ({
  isNativeFileExportAvailable: () => false,
  saveBlobToNativeDestination: vi.fn(),
}))

import ImageGenerationApp from './ImageGenerationApp.vue'
import { frontendWorkshopImageDraftService } from '../services/FrontendWorkshopImageDraftService'
import type { FrontendWorkshopGeneratedImage } from '../services/FrontendWorkshopImageGenerationService'

enableAutoUnmount(afterEach)
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function button(wrapper: ReturnType<typeof mount>, label: string) {
  const found = wrapper.findAll('button').find((item) => item.text() === label)
  if (!found) throw new Error(`Missing button: ${label}`)
  return found
}

function naiSettingSelect(wrapper: ReturnType<typeof mount>, label: string) {
  const owner = wrapper.findAll('label').find((item) => item.text().includes(label))
  if (!owner) throw new Error(`Missing setting: ${label}`)
  return owner.get('select')
}

describe('ImageGenerationApp editing state', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
    generate.mockResolvedValue({
      id: 'v5-result',
      provider: 'novelai',
      dataUrl: 'data:image/png;base64,cG5n',
      mimeType: 'image/png',
      extension: 'png',
      prompt: 'portrait',
      seed: 7,
      width: 832,
      height: 1216,
      parameters: {},
      manifest: {
        version: 1,
        provider: 'novelai',
        model: 'nai-diffusion-5-full',
        prompt: 'portrait',
        width: 832,
        height: 1216,
        outputFormat: 'png',
        createdAt: 1,
        parameters: {},
      },
      createdAt: 1,
    })
  })

  it('restores exact NAI quality mode, UC preset and transparent-background state', async () => {
    const wrapper = mount(ImageGenerationApp)
    await button(wrapper, '设置').trigger('click')
    await naiSettingSelect(wrapper, 'Quality Mode').setValue('light')
    await naiSettingSelect(wrapper, 'UC Preset').setValue('heavy')
    await wrapper.get('input.switch').setValue(true)

    await button(wrapper, 'OpenAI').trigger('click')
    await button(wrapper, 'NovelAI').trigger('click')
    await button(wrapper, '设置').trigger('click')

    expect(naiSettingSelect(wrapper, 'Quality Mode').element).toHaveProperty('value', 'light')
    expect(naiSettingSelect(wrapper, 'UC Preset').element).toHaveProperty('value', 'heavy')
    expect((wrapper.get('input.switch').element as HTMLInputElement).checked).toBe(true)

    wrapper.unmount()
    const reopened = mount(ImageGenerationApp)
    await button(reopened, '设置').trigger('click')
    expect(naiSettingSelect(reopened, 'Quality Mode').element).toHaveProperty('value', 'light')
    expect(naiSettingSelect(reopened, 'UC Preset').element).toHaveProperty('value', 'heavy')
    expect((reopened.get('input.switch').element as HTMLInputElement).checked).toBe(true)
  })

  it('keeps preview metadata tied to the displayed result instead of later editor changes', async () => {
    const wrapper = mount(ImageGenerationApp)
    await wrapper.get('[aria-label="画面描述"]').setValue('portrait')
    await button(wrapper, '生成图片').trigger('click')
    await flushPromises()

    expect(wrapper.get('.mini-meta').text()).toBe('nai-diffusion-5-full · 832 × 1216')
    await wrapper.get('[aria-label="模型列表"]').setValue('nai-diffusion-4-5-full')
    expect(wrapper.get('.mini-meta').text()).toBe('nai-diffusion-5-full · 832 × 1216')
    await button(wrapper, '设置').trigger('click')
    await naiSettingSelect(wrapper, '尺寸').setValue('1024x1024')
    await button(wrapper, 'OpenAI').trigger('click')
    expect(wrapper.get('.mini-meta').text()).toBe('nai-diffusion-5-full · 832 × 1216')
    expect(button(wrapper, '复用提示 / Seed').exists()).toBe(true)
    await button(wrapper, '复用提示 / Seed').trigger('click')
    await button(wrapper, '设置').trigger('click')
    expect(naiSettingSelect(wrapper, '尺寸').element).toHaveProperty('value', '832x1216')
    const seed = wrapper.findAll('label').find((label) => label.text().startsWith('Seed'))!
    expect(seed.get('input').element).toHaveProperty('value', '7')
  })

  it('does not invent a model for a legacy result without a manifest', async () => {
    generate.mockResolvedValueOnce({
      id: 'legacy',
      provider: 'novelai',
      dataUrl: 'data:image/png;base64,cG5n',
      prompt: 'portrait',
      width: 832,
      height: 1216,
      parameters: {},
      createdAt: 1,
    })
    const wrapper = mount(ImageGenerationApp)
    await wrapper.get('[aria-label="画面描述"]').setValue('portrait')
    await button(wrapper, '生成图片').trigger('click')
    await flushPromises()
    const original = wrapper.get('.mini-meta').text()
    expect.soft(original).not.toContain('nai-diffusion-5-full')
    await wrapper.get('[aria-label="模型列表"]').setValue('nai-diffusion-4-5-full')
    expect(wrapper.get('.mini-meta').text()).toBe(original)
  })

  it('uses OpenAI for compatible endpoints and preserves additional request fields', async () => {
    const wrapper = mount(ImageGenerationApp)
    await button(wrapper, 'OpenAI').trigger('click')
    await button(wrapper, 'Prompt').trigger('click')
    await wrapper.get('[aria-label="画面描述"]').setValue('openai-compatible only')
    await button(wrapper, '请求').trigger('click')
    await wrapper.get('textarea').setValue('{"vendor_option":true}')
    expect(wrapper.get('pre').text()).toContain('vendor_option')
    await button(wrapper, '生成图片').trigger('click')
    await flushPromises()
    expect(generate.mock.calls.at(-1)?.[1].prompt).toBe('openai-compatible only')
    expect(generate.mock.calls.at(-1)?.[1].additionalJson).toBe('{"vendor_option":true}')
  })

  it('does not leak OpenAI edit instructions, masks or references into NovelAI', async () => {
    vi.stubGlobal(
      'URL',
      class extends URL {
        static createObjectURL = vi.fn(() => 'blob:reference')
        static revokeObjectURL = vi.fn()
      },
    )
    const wrapper = mount(ImageGenerationApp)
    await button(wrapper, 'OpenAI').trigger('click')
    await button(wrapper, '参考').trigger('click')
    const file = new File(['png'], 'reference.png', { type: 'image/png' })
    const upload = wrapper.get('input[type="file"]')
    Object.defineProperty(upload.element, 'files', { value: [file], configurable: true })
    await upload.trigger('change')
    await button(wrapper, '编辑').trigger('click')
    await wrapper.get('[aria-label="修改指令"]').setValue('private edit')
    await wrapper.get('input.switch').setValue(true)
    const maskInput = wrapper.get('input[type="file"]')
    Object.defineProperty(maskInput.element, 'files', { value: [file], configurable: true })
    await maskInput.trigger('change')
    await button(wrapper, 'NovelAI').trigger('click')
    await button(wrapper, 'Prompt').trigger('click')
    await wrapper.get('[aria-label="画面描述"]').setValue('novelai only')
    await button(wrapper, '生成图片').trigger('click')
    await flushPromises()
    expect(generate).toHaveBeenCalledOnce()
    expect(generate.mock.calls[0]?.[1].prompt).toBe('novelai only')
    expect(generate.mock.calls[0]?.[1]).not.toHaveProperty('openAiInputImages')
    expect(generate.mock.calls[0]?.[1]).not.toHaveProperty('openAiEditInstruction')
    expect(generate.mock.calls[0]?.[1]).not.toHaveProperty('openAiMask')
  })

  it('gates hidden NAI text helpers after changing to a model without text support', async () => {
    const wrapper = mount(ImageGenerationApp)
    await wrapper.get('[aria-label="画面描述"]').setValue('portrait')
    await wrapper.get('[aria-label="图片中的文字"]').setValue('HIDDEN TEXT')
    await wrapper.get('[aria-label="模型列表"]').setValue('nai-diffusion-3')
    expect(wrapper.find('[aria-label="图片中的文字"]').exists()).toBe(false)
    await button(wrapper, '生成图片').trigger('click')
    await flushPromises()
    expect.soft(generate.mock.calls[0]?.[1].prompt).toBe('portrait')
    expect(generate.mock.calls[0]?.[1].novelAiQualityMode).toBe('standard')
  })

  it('restores NAI characters and OpenAI structured helpers via template and remount', async () => {
    const wrapper = mount(ImageGenerationApp)
    await wrapper.get('[aria-label="画面描述"]').setValue('portrait')
    await wrapper.get('[aria-label="图片中的文字"]').setValue('NAI text')
    await button(wrapper, '角色').trigger('click')
    await button(wrapper, '添加角色').trigger('click')
    await wrapper.get('[aria-label="角色 1 Prompt"]').setValue('red hair')
    await wrapper.get('[aria-label="角色 1 Negative"]').setValue('hat')
    await wrapper.get('.image-generation-entry input[type="checkbox"]').setValue(true)
    const coords = wrapper.findAll('.image-generation-entry input[type="number"]')
    await coords[0]!.setValue('0.35')
    await coords[1]!.setValue('0.65')
    await button(wrapper, 'Prompt').trigger('click')
    await wrapper.get('[aria-label="模板名称"]').setValue('NAI complete')
    await wrapper.get('form').trigger('submit')
    await button(wrapper, 'OpenAI').trigger('click')
    await wrapper.get('[aria-label="图片中的文字"]').setValue('GPT text')
    for (const label of ['人物', '场景', '构图', '风格'])
      await wrapper.get(`[aria-label="${label}"]`).setValue(label + ' value')
    wrapper.unmount()
    const reopened = mount(ImageGenerationApp)
    expect(reopened.get('[aria-label="图片中的文字"]').element).toHaveProperty('value', 'GPT text')
    for (const label of ['人物', '场景', '构图', '风格'])
      expect(reopened.get(`[aria-label="${label}"]`).element).toHaveProperty(
        'value',
        label + ' value',
      )
    await button(reopened, '套用').trigger('click')
    expect(reopened.get('[aria-label="图片中的文字"]').element).toHaveProperty('value', 'NAI text')
    await button(reopened, '角色').trigger('click')
    expect(reopened.get('[aria-label="角色 1 Prompt"]').element).toHaveProperty('value', 'red hair')
    expect(reopened.get('[aria-label="角色 1 Negative"]').element).toHaveProperty('value', 'hat')
    expect(reopened.get('.image-generation-entry input[type="checkbox"]').element).toHaveProperty(
      'checked',
      true,
    )
    expect(
      reopened
        .findAll('.image-generation-entry input[type="number"]')
        .map((input) => (input.element as HTMLInputElement).value),
    ).toEqual(['0.35', '0.65'])
  })

  it('debounces for 300ms but flushes the latest input on provider switch and unmount', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const save = vi.spyOn(frontendWorkshopImageDraftService, 'saveDraft')
    const wrapper = mount(ImageGenerationApp)
    await wrapper.get('[aria-label="画面描述"]').setValue('first')
    await vi.advanceTimersByTimeAsync(299)
    expect(save).not.toHaveBeenCalled()
    await wrapper.get('[aria-label="画面描述"]').setValue('last NAI')
    await button(wrapper, 'OpenAI').trigger('click')
    expect(frontendWorkshopImageDraftService.loadDraft('novelai')?.prompt).toBe('last NAI')
    await wrapper.get('[aria-label="画面描述"]').setValue('last GPT')
    wrapper.unmount()
    expect(frontendWorkshopImageDraftService.loadDraft('openai')?.prompt).toBe('last GPT')
    const count = save.mock.calls.length
    await vi.advanceTimersByTimeAsync(1000)
    expect(save).toHaveBeenCalledTimes(count)
    const reopened = mount(ImageGenerationApp)
    expect(reopened.get('[aria-label="画面描述"]').element).toHaveProperty('value', 'last GPT')
    await reopened.get('[aria-label="画面描述"]').setValue('debounced')
    await vi.advanceTimersByTimeAsync(299)
    expect(save).toHaveBeenCalledTimes(count)
    await vi.advanceTimersByTimeAsync(1)
    expect(save).toHaveBeenCalledTimes(count + 1)
    expect(frontendWorkshopImageDraftService.loadDraft('openai')?.prompt).toBe('debounced')
  })

  it('saves and overwrites templates from current state before debounce fires', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const wrapper = mount(ImageGenerationApp)
    await wrapper.get('[aria-label="画面描述"]').setValue('latest template')
    await wrapper.get('[aria-label="模板名称"]').setValue('instant')
    await wrapper.get('form').trigger('submit')
    expect(frontendWorkshopImageDraftService.listTemplates()[0]?.draft.prompt).toBe(
      'latest template',
    )
    await wrapper.get('[aria-label="画面描述"]').setValue('latest overwrite')
    await button(wrapper, '覆盖').trigger('click')
    expect(frontendWorkshopImageDraftService.listTemplates()[0]?.draft.prompt).toBe(
      'latest overwrite',
    )
  })

  it('keeps a saved square NovelAI size when returning from another provider', async () => {
    const wrapper = mount(ImageGenerationApp)
    await button(wrapper, '设置').trigger('click')
    await naiSettingSelect(wrapper, '尺寸').setValue('1024x1024')
    await button(wrapper, 'OpenAI').trigger('click')
    expect(frontendWorkshopImageDraftService.loadDraft('novelai')).toMatchObject({
      width: 1024,
      height: 1024,
    })
    await button(wrapper, 'NovelAI').trigger('click')
    await button(wrapper, '设置').trigger('click')
    expect(naiSettingSelect(wrapper, '尺寸').element).toHaveProperty('value', '1024x1024')
  })

  it('continues editing an OpenAI result after switching the editor to NovelAI', async () => {
    vi.stubGlobal(
      'URL',
      class extends URL {
        static createObjectURL = vi.fn(() => 'blob:result')
        static revokeObjectURL = vi.fn()
      },
    )
    const image: FrontendWorkshopGeneratedImage = {
      id: 'openai-result',
      provider: 'openai',
      dataUrl: 'data:image/png;base64,cG5n',
      mimeType: 'image/png',
      extension: 'png',
      prompt: 'GPT portrait',
      width: 1024,
      height: 1024,
      parameters: {},
      createdAt: 1,
    }
    generate.mockResolvedValueOnce(image)
    const wrapper = mount(ImageGenerationApp)
    await button(wrapper, 'OpenAI').trigger('click')
    await wrapper.get('[aria-label="画面描述"]').setValue('GPT portrait')
    await button(wrapper, '生成图片').trigger('click')
    await flushPromises()
    await button(wrapper, 'NovelAI').trigger('click')
    expect(button(wrapper, '复用提示词').exists()).toBe(true)
    await button(wrapper, '继续编辑').trigger('click')
    await flushPromises()
    expect(toBlob).toHaveBeenCalledWith(image)
    expect(saveGenerated).toHaveBeenCalledWith(image)
    await wrapper.get('[aria-label="修改指令"]').setValue('white coat')
    await button(wrapper, '生成图片').trigger('click')
    await flushPromises()
    expect(generate.mock.calls.at(-1)?.[0].provider).toBe('openai')
    expect(generate.mock.calls.at(-1)?.[1]).toMatchObject({
      parentImageId: 'saved-image',
      openAiInputImages: [{ role: 'reference' }],
      openAiEditInstruction: 'white coat',
    })
  })
})
