/** @vitest-environment jsdom */
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mainApiService } from '../core/AppContainer'
import { DEFAULT_MAIN_API_CONFIG } from '../services/MainApiService'
import MainApiSettings from './MainApiSettings.vue'

vi.mock('../core/AppContainer', async () => {
  const { MainApiService } = await import('../services/MainApiService')
  return {
    mainApiService: new MainApiService({
      read: async () => '',
      save: async () => {},
      clear: async () => {},
    }),
  }
})
vi.mock('../composables/UseConfirmDialog', () => ({ confirmAction: async () => true }))

beforeEach(async () => {
  mainApiService.importProfilesState({
    activeProfileId: 'main',
    profiles: [
      {
        ...DEFAULT_MAIN_API_CONFIG,
        id: 'main',
        name: '日常主 API',
        url: 'https://main.example/v1',
        model: 'main-model',
      },
    ],
  })
  await mainApiService.initializeCredentials()
  await mainApiService.awaitCredentialWrites()
})
describe('shared API editor', () => {
  it.each([false, true])(
    'defaults output limits to blank and preserves filled or cleared values (assistant=%s)',
    async (assistant) => {
      const profile = mainApiService.createProfile('输出设置')
      const render = () => mount(MainApiSettings, { props: { assistant, profileId: profile.id } })
      let wrapper = render()
      try {
        if (!assistant)
          await wrapper.get('.main-api-settings__profilebar select').setValue(profile.id)
        const field = () => wrapper.get<HTMLInputElement>('input[placeholder="留空不限制"]')
        expect(field().element.value).toBe('')
        expect(field().attributes('max')).toBeUndefined()
        await field().setValue('1000000')
        await wrapper.get('.main-api-settings__actions button').trigger('click')
        await flushPromises()
        expect(mainApiService.getProfiles().find((p) => p.id === profile.id)?.maxTokens).toBe(
          1000000,
        )
        await field().setValue('')
        await wrapper.get('.main-api-settings__actions button').trigger('click')
        await flushPromises()
        expect(mainApiService.getProfiles().find((p) => p.id === profile.id)?.maxTokens).toBe(0)
        wrapper.unmount()
        wrapper = render()
        if (!assistant)
          await wrapper.get('.main-api-settings__profilebar select').setValue(profile.id)
        expect(field().element.value).toBe('')
      } finally {
        wrapper.unmount()
      }
    },
  )
  it.each([false, true])(
    'preserves advanced values in the compact editor (assistant=%s)',
    async (assistant) => {
      const profile = mainApiService.createProfile('紧凑配置')
      mainApiService.saveProfile({
        ...profile,
        url: 'https://assistant.example/v1',
        model: 'test-model',
        temperature: 0.8,
        maxTokens: 2048,
      })
      await mainApiService.awaitCredentialWrites()
      const wrapper = mount(MainApiSettings, { props: { assistant, profileId: profile.id } })
      try {
        if (!assistant)
          await wrapper.get('.main-api-settings__profilebar select').setValue(profile.id)
        const advanced = wrapper.get('.main-api-settings__advanced')
        expect((advanced.element as HTMLDetailsElement).open).toBe(false)
        expect(wrapper.get('.main-api-settings__basic').find('input[type="range"]').exists()).toBe(
          false,
        )
        ;(advanced.element as HTMLDetailsElement).open = true
        await advanced.trigger('toggle')
        await advanced.get('input[type="range"]').setValue('1.15')
        ;(advanced.element as HTMLDetailsElement).open = false
        await advanced.trigger('toggle')
        await wrapper.get('.main-api-settings__actions button').trigger('click')
        await flushPromises()
        expect(mainApiService.getProfiles().find((p) => p.id === profile.id)).toMatchObject({
          temperature: 1.15,
          maxTokens: 2048,
        })
        expect(mainApiService.getActiveProfile().id).toBe('main')
      } finally {
        wrapper.unmount()
      }
    },
  )
  it('shows main fallback without exposing editable main fields when an assistant profile was deleted', () => {
    const original = mainApiService.getActiveProfile()
    const wrapper = mount(MainApiSettings, { props: { assistant: true, profileId: 'deleted' } })
    try {
      expect(
        (wrapper.get('.main-api-settings__profilebar select').element as HTMLSelectElement).value,
      ).toBe('')
      expect(wrapper.find('.main-api-settings__grid').exists()).toBe(false)
      expect(mainApiService.getActiveProfile()).toEqual(original)
    } finally {
      wrapper.unmount()
    }
  })
  it('saves an independent assistant profile through the existing owner without activating it as main', async () => {
    const original = mainApiService.getActiveProfile()
    const wrapper = mount(MainApiSettings, { props: { assistant: true } })
    const button = (name: string) =>
      wrapper
        .findAll('button')
        .find((b) => b.text() === name || b.attributes('aria-label') === name)!
    try {
      expect(wrapper.find('.main-api-settings__grid').exists()).toBe(false)
      await button('新增').trigger('click')
      await flushPromises()
      await wrapper.get('input[placeholder="例如：日常生成"]').setValue('小助理专用')
      await wrapper.get('input[inputmode="url"]').setValue('https://assistant.example/v1')
      await wrapper.get('.inline-model-picker__field input').setValue('assistant-model')
      await wrapper.get('input[type="password"]').setValue('SECRET')
      await button('保存并用于助手').trigger('click')
      await flushPromises()
      const id = wrapper.emitted('selected')![0]![0] as string
      expect(mainApiService.getActiveProfile()).toEqual(original)
      expect(mainApiService.getProfiles().find((p) => p.id === id)).toMatchObject({
        name: '小助理专用',
        model: 'assistant-model',
        apiKey: 'SECRET',
      })
      expect(wrapper.text()).not.toContain('设为主 API')
      await wrapper.get('.main-api-settings__profilebar select').setValue('')
      expect(wrapper.emitted('selected')!.at(-1)).toEqual([''])
      expect(wrapper.find('.main-api-settings__grid').exists()).toBe(false)
    } finally {
      wrapper.unmount()
    }
  })
  it('retains main API activation behavior in the default editor', async () => {
    const profile = mainApiService.createProfile('另一个 API')
    await mainApiService.awaitCredentialWrites()
    const wrapper = mount(MainApiSettings)
    try {
      await wrapper.get('.main-api-settings__profilebar select').setValue(profile.id)
      await wrapper
        .findAll('button')
        .find((b) => b.text() === '设为主 API')!
        .trigger('click')
      await flushPromises()
      expect(mainApiService.getActiveProfile().id).toBe(profile.id)
      expect(wrapper.emitted('selected')).toBeUndefined()
    } finally {
      wrapper.unmount()
    }
  })
})
