import type { ComputedRef } from 'vue'
import { mainApiService } from '../core/AppContainer'
import {
  frontendWorkshopLegacyApiPreferenceService,
  type FrontendWorkshopLegacyApiPreference,
} from '../services/FrontendWorkshopLegacyApiPreferenceService'
import type { MainApiConfig } from '../services/MainApiService'
import type { useWorkshopSessionState } from './UseWorkshopSessionState'

interface WorkshopApiPreferencesContext extends Pick<
  ReturnType<typeof useWorkshopSessionState>,
  | 'apiMode'
  | 'apiProfiles'
  | 'savedProfileId'
  | 'customApi'
  | 'customApiCredentialPersistence'
  | 'apiStatus'
  | 'testingApi'
  | 'loadingModels'
  | 'customModelOptions'
> {
  activeApiLabel: ComputedRef<string>
}

export function useWorkshopApiPreferences(getContext: () => WorkshopApiPreferencesContext) {
  function resolveWorkshopApi(): MainApiConfig | undefined {
    const context = getContext()

    if (context.apiMode.value === 'main') return undefined
    if (context.apiMode.value === 'saved') {
      const profile = context.apiProfiles.value.find(
        (item) => item.id === context.savedProfileId.value,
      )
      if (!profile) throw new Error('选择的 API 配置已不存在，请重新选择')
      return profile
    }
    return { ...context.customApi }
  }

  async function saveApiPreference(): Promise<void> {
    const context = getContext()

    await frontendWorkshopLegacyApiPreferenceService.savePreference({
      mode: context.apiMode.value,
      savedProfileId: context.savedProfileId.value,
      custom: { ...context.customApi },
      credentialPersistence: context.customApiCredentialPersistence.value,
    } satisfies FrontendWorkshopLegacyApiPreference)
    context.apiStatus.value = `已保存：${context.activeApiLabel.value}`
  }

  async function testWorkshopApi(): Promise<void> {
    const context = getContext()

    context.testingApi.value = true
    context.apiStatus.value = '正在测试当前选择…'
    try {
      await saveApiPreference()
      context.apiStatus.value = await mainApiService.testConnection(
        resolveWorkshopApi() ?? mainApiService.getConfig(),
      )
    } catch (cause) {
      context.apiStatus.value = cause instanceof Error ? cause.message : '连接测试失败'
    } finally {
      context.testingApi.value = false
    }
  }

  async function loadCustomModels(): Promise<void> {
    const context = getContext()

    context.loadingModels.value = true
    context.apiStatus.value = '正在拉取模型列表…'
    try {
      context.customModelOptions.value = await mainApiService.listModels({ ...context.customApi })
      context.apiStatus.value = context.customModelOptions.value.length
        ? `已拉取 ${context.customModelOptions.value.length} 个模型；可选择或继续手动输入`
        : '接口返回了空模型列表；仍可手动填写模型名'
    } catch (cause) {
      context.customModelOptions.value = []
      context.apiStatus.value = cause instanceof Error ? cause.message : '模型列表拉取失败'
    } finally {
      context.loadingModels.value = false
    }
  }
  return { resolveWorkshopApi, saveApiPreference, testWorkshopApi, loadCustomModels }
}
