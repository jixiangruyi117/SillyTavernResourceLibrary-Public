import type { AppearanceScope } from '../core/AppearanceScopes'
import type { AssistantImage } from './ProductAssistantService'
import { captureAssistantPage } from './ProductAssistantScreenshot'
export interface AssistantAppearanceComparison {
  id: string
  scope: string
  title: string
  before?: AssistantImage
  after?: AssistantImage
  captureError?: string
  state: 'applied' | 'kept' | 'undone'
}
/** Captures actual DOM around the existing CSS write; owns no CSS or undo stack. */
export async function captureAssistantComparison(
  scope: AppearanceScope,
  signal: AbortSignal,
  apply: () => Promise<void>,
): Promise<AssistantAppearanceComparison> {
  const comparison: AssistantAppearanceComparison = {
    id: crypto.randomUUID(),
    scope: scope.value,
    title: scope.title,
    state: 'applied',
  }
  const capture = async (side: 'before' | 'after') => {
    try {
      comparison[side] = await captureAssistantPage(scope, signal)
    } catch (cause) {
      if (signal.aborted && side === 'before') throw cause
      comparison.captureError = `${side === 'before' ? '修改前' : '修改后'}截图未完成：${cause instanceof Error ? cause.message : '渲染失败'}`
    }
  }
  await capture('before')
  if (signal.aborted) throw new DOMException('已停止', 'AbortError')
  await apply()
  await capture('after')
  return comparison
}
