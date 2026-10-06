/** @vitest-environment jsdom */
import { readFileSync } from 'node:fs'

import { beforeEach, describe, expect, it } from 'vitest'

import {
  FrontendWorkshopImageDraftService,
  type FrontendWorkshopImageDraft,
} from './FrontendWorkshopImageDraftService'

function novelAiDraft(): FrontendWorkshopImageDraft {
  return {
    version: 1,
    provider: 'novelai',
    endpoint: 'https://image.novelai.net/ai/generate-image',
    model: 'nai-diffusion-5-full',
    prompt: 'black hair, cool male character',
    negativePrompt: 'lowres',
    width: 832,
    height: 1216,
    openAiQuality: 'auto',
    openAiBackground: 'auto',
    outputFormat: 'png',
    outputCompression: 90,
    novelAiSampler: 'k_dpmpp_2m',
    novelAiSteps: 28,
    novelAiScale: 5,
    novelAiSeed: 12345,
    novelAiQualityToggle: true,
    novelAiQualityMode: 'light',
    novelAiUcPreset: 'heavy',
    novelAiTransparentBackground: true,
    novelAiSmea: false,
    novelAiSmeaDyn: false,
    savedAt: Date.now(),
  }
}

describe('FrontendWorkshopImageDraftService', () => {
  beforeEach(() => localStorage.clear())

  it.each([
    ['off', 'none', false],
    ['light', 'heavy', true],
    ['standard', 'light', false],
  ] as const)(
    'round-trips %s / %s / transparent=%s in drafts and templates',
    (quality, uc, transparent) => {
      const service = new FrontendWorkshopImageDraftService()
      const draft = {
        ...novelAiDraft(),
        novelAiQualityMode: quality,
        novelAiUcPreset: uc,
        novelAiTransparentBackground: transparent,
      }
      service.saveDraft(draft)
      service.saveTemplate('settings', draft)
      const reopened = new FrontendWorkshopImageDraftService()
      for (const restored of [reopened.loadDraft('novelai'), reopened.listTemplates()[0]?.draft]) {
        expect(restored).toMatchObject({
          novelAiQualityMode: quality,
          novelAiQualityToggle: quality !== 'off',
          novelAiUcPreset: uc,
          novelAiTransparentBackground: transparent,
        })
      }
    },
  )

  it.each([
    [-1, 0],
    [0, 0],
    [4.2, 4.2],
    [10, 10],
    [18, 10],
  ])('normalizes Guidance %s to %s on both persistence paths', (input, expected) => {
    const service = new FrontendWorkshopImageDraftService()
    const draft = { ...novelAiDraft(), novelAiScale: input }
    service.saveDraft(draft)
    service.saveTemplate('scale', draft)
    expect(service.loadDraft('novelai')?.novelAiScale).toBe(expected)
    expect(service.listTemplates()[0]?.draft.novelAiScale).toBe(expected)
  })

  it('strips injected credential fields from saved, overwritten and reloaded data', () => {
    const service = new FrontendWorkshopImageDraftService()
    const draft = {
      ...novelAiDraft(),
      apiKey: 'injected-key',
      credentialPersistence: 'device',
      headers: { Authorization: 'injected-auth' },
      token: 'injected-token',
      novelAiCharacters: [
        {
          prompt: 'person',
          negativePrompt: '',
          positioned: false,
          x: 0.5,
          y: 0.5,
          apiKey: 'nested-key',
        },
      ],
    }
    service.saveDraft(draft)
    const template = service.saveTemplate('secure', draft)
    service.overwriteTemplate(template.id, draft)
    const serialized = JSON.stringify({ ...localStorage })
    for (const secret of [
      'apiKey',
      'credentialPersistence',
      'Authorization',
      'injected-',
      'nested-key',
    ]) {
      expect(serialized).not.toContain(secret)
      expect(JSON.stringify(service.loadDraft())).not.toContain(secret)
      expect(JSON.stringify(service.listTemplates())).not.toContain(secret)
    }
  })

  it('在当前设备完整恢复现有 NAI 设置，但存储结构不包含 API Key', () => {
    const service = new FrontendWorkshopImageDraftService()
    const saved = service.saveDraft(novelAiDraft())

    expect(service.loadDraft()).toEqual(
      expect.objectContaining({
        provider: 'novelai',
        model: 'nai-diffusion-5-full',
        prompt: 'black hair, cool male character',
        width: 832,
        height: 1216,
        novelAiQualityMode: 'light',
        novelAiUcPreset: 'heavy',
        novelAiTransparentBackground: true,
      }),
    )
    expect(saved.savedAt).toBeGreaterThan(0)
    expect(JSON.stringify(saved)).not.toContain('apiKey')
    expect(JSON.stringify(saved)).not.toContain('credentialPersistence')
  })

  it('将 Guidance 草稿约束到与生成请求一致的 0～10', () => {
    const service = new FrontendWorkshopImageDraftService()
    const saved = service.saveDraft({ ...novelAiDraft(), novelAiScale: 18 })

    expect(saved.novelAiScale).toBe(10)
    expect(service.loadDraft('novelai')?.novelAiScale).toBe(10)
  })

  it('支持命名、覆盖和删除模板，并且模板不携带凭据', () => {
    const service = new FrontendWorkshopImageDraftService()
    const first = service.saveTemplate('V5 人物立绘', novelAiDraft())

    expect(service.listTemplates()).toHaveLength(1)
    expect(service.listTemplates()[0]).toEqual(expect.objectContaining({ name: 'V5 人物立绘' }))

    const updated = service.overwriteTemplate(first.id, {
      ...novelAiDraft(),
      prompt: 'silver hair, winter coat',
      novelAiSteps: 32,
      novelAiQualityMode: 'standard',
      novelAiUcPreset: 'light',
      novelAiTransparentBackground: false,
    })
    expect(updated?.draft.prompt).toBe('silver hair, winter coat')
    expect(updated?.draft.novelAiSteps).toBe(32)
    expect(updated?.draft.novelAiQualityMode).toBe('standard')
    expect(updated?.draft.novelAiUcPreset).toBe('light')
    expect(updated?.draft.novelAiTransparentBackground).toBe(false)
    expect(JSON.stringify(service.listTemplates())).not.toContain('apiKey')

    service.deleteTemplate(first.id)
    expect(service.listTemplates()).toEqual([])
  })

  it('按 provider 隔离草稿，并兼容迁移旧单草稿结构', () => {
    const service = new FrontendWorkshopImageDraftService()
    const openAi = service.saveDraft({
      ...novelAiDraft(),
      provider: 'openai',
      prompt: 'openai portrait',
      model: 'gpt-image-1',
    })
    const novelAi = service.saveDraft({ ...novelAiDraft(), prompt: 'novelai portrait' })

    expect(service.loadDraft('openai')?.prompt).toBe('openai portrait')
    expect(service.loadDraft('novelai')?.prompt).toBe('novelai portrait')
    expect(service.loadDraft()).toEqual(novelAi)
    service.clearDraft('novelai')
    expect(service.loadDraft('novelai')).toBeUndefined()
    expect(service.loadDraft()).toEqual(openAi)

    const legacy = {
      ...novelAiDraft(),
      prompt: 'legacy draft',
      apiKey: 'must-not-survive',
    } as Record<string, unknown>
    delete legacy.novelAiQualityMode
    delete legacy.novelAiUcPreset
    delete legacy.novelAiTransparentBackground
    legacy.novelAiQualityToggle = false
    localStorage.setItem('srl.frontendWorkshop.imageGeneration.draft.v1', JSON.stringify(legacy))

    expect(service.loadDraft('novelai')).toEqual(
      expect.objectContaining({
        prompt: 'legacy draft',
        novelAiQualityMode: 'off',
        novelAiUcPreset: 'none',
        novelAiTransparentBackground: false,
      }),
    )
    expect(JSON.stringify(service.loadDraft('novelai'))).not.toContain('must-not-survive')
  })

  it('新备份不导出生图 Key，但旧备份字段仍路由到凭据 Owner 恢复', () => {
    const source = readFileSync('src/core/AppContainer.ts', 'utf8')
    const exportContract = source.slice(
      source.indexOf('export async function exportPortableCredentialBundle'),
      source.indexOf('export async function importPortableCredentialBundle'),
    )
    const importContract = source.slice(
      source.indexOf('export async function importPortableCredentialBundle'),
      source.indexOf('/** 首次切换到内置 Vue APK'),
    )

    expect(exportContract).not.toContain('exportConfigurations()')
    expect(exportContract).not.toMatch(/imageGeneration\s*:/u)
    expect(importContract).toContain('value.imageGeneration')
    expect(importContract).toContain(
      'frontendWorkshopImageGenerationService.importConfigurations(value.imageGeneration)',
    )
  })
})
