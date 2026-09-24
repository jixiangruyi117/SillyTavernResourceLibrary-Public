import type { ComputedRef } from 'vue'
import { mainApiService } from '../core/AppContainer'
import type { MainApiConfig } from '../services/MainApiService'
import type {
  WorkshopDraft,
  WorkshopPromptSnapshot,
  WorkshopReviewCategory,
  WorkshopReviewSuggestion,
  WorkshopVersion,
} from '../types/FrontendWorkshopLegacyApp'
import { type FrontendWorkshopArtifact } from '../utils/FrontendWorkshop'
import {
  compactWorkshopDraft,
  compactWorkshopVersions,
} from '../utils/FrontendWorkshopLegacyReview'
import type { useWorkshopSessionState } from './UseWorkshopSessionState'

interface WorkshopPreviewReviewContext extends Pick<
  ReturnType<typeof useWorkshopSessionState>,
  | 'reviewingPreview'
  | 'reviewStatus'
  | 'error'
  | 'reviewSuggestions'
  | 'refinement'
  | 'versions'
  | 'drafts'
> {
  current: ComputedRef<WorkshopVersion | undefined>
  templateWithPlaceholders: (artifact: FrontendWorkshopArtifact) => string
  renderedSource: ComputedRef<string>
  saveApiPreference: () => Promise<void>
  resolveWorkshopApi: () => MainApiConfig | undefined
  workshopRequestOptions: { timeoutMs: number }
  saveVersions: () => void
  selectedReviewSuggestions: ComputedRef<
    {
      id: string
      category: WorkshopReviewCategory
      title: string
      detail: string
      selected: boolean
    }[]
  >
  buildSelectedReviewRequirement: () => string
  selectedReviewRequirementApplied: ComputedRef<boolean>
  DRAFT_STORAGE_KEY: string
  RECOVERY_STORAGE_KEY: string
}

export function useWorkshopPreviewReview(getContext: () => WorkshopPreviewReviewContext) {
  function createPreviewReviewPrompt(): WorkshopPromptSnapshot {
    const context = getContext()

    if (!context.current.value) throw new Error('请先生成一版状态栏')
    const systemPrompt = `你是 SillyTavern 状态栏的视觉与交互评审。你只诊断当前静态 HTML/CSS 校样，不直接改代码。
同时从交互、动效、排版、配色、内容结构、移动端可读性和其他有价值方面评审，但只保留 3 至 8 条最值得修改的建议。
不得建议 script、iframe、事件属性、写回变量或依赖 hover 的核心功能；必须先考虑 320px 酒馆消息位、对比度、44px 触控和 prefers-reduced-motion。
只返回 JSON 数组，不要 Markdown 或解释。每项格式：{"category":"interaction|motion|layout|color|content|accessibility|other","title":"简短标题","detail":"具体、可执行、不相互冲突的修改要求"}。`
    const userPrompt = `【当前状态栏模板】
${context.templateWithPlaceholders(context.current.value.artifact)}

【当前校样数据与渲染结果】
${context.renderedSource.value}

【原始风格要求】
${context.current.value.style}

【评审边界】
只根据上面的真实模板与数据提建议；不要假设未出现的宿主状态。用户会自由勾选并编辑建议，所以每条必须可独立执行。`
    return {
      createdAt: Date.now(),
      messages: [
        { role: 'system', label: '审美诊断 System 提示词', content: systemPrompt },
        { role: 'user', label: '当前校样注入内容', content: userPrompt },
      ],
    }
  }

  function parsePreviewReviewSuggestions(value: string): WorkshopReviewSuggestion[] {
    const start = value.indexOf('[')
    const end = value.lastIndexOf(']')
    if (start < 0 || end <= start) throw new Error('AI 没有返回可识别的建议数组')
    const parsed = JSON.parse(value.slice(start, end + 1)) as unknown
    if (!Array.isArray(parsed)) throw new Error('AI 建议格式不是数组')
    const categories = new Set<WorkshopReviewCategory>([
      'interaction',
      'motion',
      'layout',
      'color',
      'content',
      'accessibility',
      'other',
    ])
    const suggestions = parsed
      .map((item): WorkshopReviewSuggestion | undefined => {
        if (!item || typeof item !== 'object') return undefined
        const record = item as Record<string, unknown>
        const title = String(record.title ?? '')
          .trim()
          .slice(0, 80)
        const detail = String(record.detail ?? '')
          .trim()
          .slice(0, 1200)
        if (!title || !detail) return undefined
        const rawCategory = String(record.category ?? 'other') as WorkshopReviewCategory
        return {
          id: crypto.randomUUID(),
          category: categories.has(rawCategory) ? rawCategory : 'other',
          title,
          detail,
          selected: false,
        }
      })
      .filter((item): item is WorkshopReviewSuggestion => Boolean(item))
      .slice(0, 8)
    if (!suggestions.length) throw new Error('AI 没有返回可用的建议')
    return suggestions
  }

  async function reviewCurrentPreview(): Promise<void> {
    const context = getContext()

    if (!context.current.value || context.reviewingPreview.value) return
    context.reviewingPreview.value = true
    context.reviewStatus.value = ''
    context.error.value = ''
    try {
      const promptSnapshot = createPreviewReviewPrompt()
      await context.saveApiPreference()
      const completion = await mainApiService.completeWithUsage(
        promptSnapshot.messages.map((message) => ({
          role: message.role,
          content: message.content,
        })),
        context.resolveWorkshopApi(),
        context.workshopRequestOptions,
      )
      const suggestions = parsePreviewReviewSuggestions(completion.text)
      context.reviewSuggestions.value = suggestions
      context.current.value.reviewPromptSnapshot = promptSnapshot
      context.current.value.reviewSuggestions = suggestions.map((suggestion) => ({ ...suggestion }))
      context.saveVersions()
      context.reviewStatus.value = `AI 已给出 ${suggestions.length} 条可选建议；未勾选的不会进入下一轮要求。`
    } catch (cause) {
      context.error.value = cause instanceof Error ? cause.message : 'AI 审美诊断失败'
    } finally {
      context.reviewingPreview.value = false
    }
  }

  function applySelectedReviewSuggestions(): void {
    const context = getContext()

    const selected = context.selectedReviewSuggestions.value
    if (!selected.length) {
      context.reviewStatus.value = '当前没有勾选建议，下一轮要求保持不变。'
      return
    }
    const requirement = context.buildSelectedReviewRequirement()
    if (context.selectedReviewRequirementApplied.value) {
      context.reviewStatus.value = `这 ${selected.length} 条建议已经写入，不会重复追加。`
      return
    }
    const baseRequirement = context.refinement.value
      .replace(/\n*【已选审美建议】[\s\S]*?【已选审美建议结束】/g, '')
      .trim()
    context.refinement.value = baseRequirement
      ? `${baseRequirement}\n\n${requirement}`
      : requirement
    context.reviewStatus.value = `已将 ${selected.length} 条建议写入下一轮要求，你仍可继续修改。`
  }

  function clearRepeatedReviewRequirements(): void {
    const context = getContext()

    const currentResult = compactWorkshopVersions(context.versions.value)
    context.versions.value = currentResult.versions
    let removed = currentResult.removed
    let snapshotCleaned = currentResult.snapshotCleaned

    const draftResults = context.drafts.value.map(compactWorkshopDraft)
    context.drafts.value = draftResults.map((result) => result.draft)
    removed += draftResults.reduce((total, result) => total + result.removed, 0)
    snapshotCleaned ||= draftResults.some((result) => result.snapshotCleaned)
    localStorage.setItem(context.DRAFT_STORAGE_KEY, JSON.stringify(context.drafts.value))

    try {
      const recovery = JSON.parse(
        localStorage.getItem(context.RECOVERY_STORAGE_KEY) ?? 'null',
      ) as WorkshopDraft | null
      if (recovery) {
        const recoveryResult = compactWorkshopDraft(recovery)
        removed += recoveryResult.removed
        snapshotCleaned ||= recoveryResult.snapshotCleaned
        if (recoveryResult.removed || recoveryResult.snapshotCleaned) {
          localStorage.setItem(context.RECOVERY_STORAGE_KEY, JSON.stringify(recoveryResult.draft))
        }
      }
    } catch {
      // 恢复草稿损坏时保持原样，不能为了清理重复提示词删除用户草稿。
    }

    if (!removed && !snapshotCleaned) {
      context.reviewStatus.value = '本机版本、草稿和恢复内容中没有可安全识别的重复审美建议。'
      return
    }
    context.saveVersions()
    context.reviewStatus.value = removed
      ? `已从本机版本、草稿和恢复内容清理 ${removed} 段重复审美建议；每组仅保留首次写入。`
      : '已清理本轮用户提示词的重复展示；原始接口请求记录已折叠保留。'
  }
  return {
    createPreviewReviewPrompt,
    parsePreviewReviewSuggestions,
    reviewCurrentPreview,
    applySelectedReviewSuggestions,
    clearRepeatedReviewRequirements,
  }
}
