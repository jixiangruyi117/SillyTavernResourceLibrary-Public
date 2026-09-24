import type { ComputedRef } from 'vue'
import { computed } from 'vue'
import { mainApiService } from '../core/AppContainer'
import type { MainApiConfig } from '../services/MainApiService'
import { estimateMainApiTokens } from '../services/MainApiService'
import type { WorkshopGenerationRequest, WorkshopVersion } from '../types/FrontendWorkshopLegacyApp'
import { type FrontendWorkshopArtifact } from '../utils/FrontendWorkshop'
import type { useWorkshopSessionState } from './UseWorkshopSessionState'

interface WorkshopPromptPreviewContext extends Pick<
  ReturnType<typeof useWorkshopSessionState>,
  'source' | 'style' | 'blocks'
> {
  createGenerationRequest: (isRefinement: boolean) => WorkshopGenerationRequest
  current: ComputedRef<WorkshopVersion | undefined>
  templateWithPlaceholders: (artifact: FrontendWorkshopArtifact) => string
  resolveWorkshopApi: () => MainApiConfig | undefined
}

export function useWorkshopPromptPreview(context: WorkshopPromptPreviewContext) {
  const initialPromptPreview = computed(() => {
    try {
      return { request: context.createGenerationRequest(false), error: '' }
    } catch (cause) {
      return {
        request: undefined,
        error: cause instanceof Error ? cause.message : '提示词暂时无法生成',
      }
    }
  })

  const refinementPromptPreview = computed(() => {
    if (!context.current.value) return { request: undefined, error: '' }
    try {
      return { request: context.createGenerationRequest(true), error: '' }
    } catch (cause) {
      return {
        request: undefined,
        error: cause instanceof Error ? cause.message : '提示词暂时无法生成',
      }
    }
  })

  function extractSystemPromptSection(
    prompt: string,
    heading: string,
    nextHeading: string,
  ): string {
    const start = prompt.indexOf(`${heading}：`)
    if (start < 0) return ''
    const end = prompt.indexOf(`\n\n${nextHeading}：`, start)
    return prompt.slice(start, end < 0 ? undefined : end).trim()
  }

  const modulePromptPreviews = computed(() => {
    const prompt = initialPromptPreview.value.request?.systemPrompt ?? ''
    return {
      material: extractSystemPromptSection(prompt, '可视化设计令牌', '目标尺寸'),
      conditions: extractSystemPromptSection(prompt, '条件样式目标', '数据方式'),
      blocks: extractSystemPromptSection(prompt, '组件积木', '图片资源'),
    }
  })

  const estimatedGenerationUsage = computed(() => {
    const request = initialPromptPreview.value.request
    if (!request) return undefined
    const currentTemplate = context.current.value
      ? context.templateWithPlaceholders(context.current.value.artifact)
      : ''
    const inputTokens = estimateMainApiTokens([
      { role: 'system', content: request.systemPrompt },
      { role: 'user', content: request.userContent },
    ])
    const referenceOutput = currentTemplate || `${context.source.value}\n${context.style.value}`
    const baselineOutput = Math.max(
      900,
      Math.round(
        estimateMainApiTokens([{ role: 'assistant', content: referenceOutput }]) * 1.35 +
          context.blocks.value.length * 180,
      ),
    )
    const configuredLimit = (context.resolveWorkshopApi() ?? mainApiService.getConfig()).maxTokens
    const outputHigh =
      configuredLimit > 0 ? Math.min(configuredLimit, baselineOutput) : baselineOutput
    const outputLow = Math.max(500, Math.round(outputHigh * 0.65))
    return {
      inputTokens,
      outputLow,
      outputHigh,
      totalLow: inputTokens + outputLow,
      totalHigh: inputTokens + outputHigh,
    }
  })
  return {
    initialPromptPreview,
    refinementPromptPreview,
    extractSystemPromptSection,
    modulePromptPreviews,
    estimatedGenerationUsage,
  }
}
