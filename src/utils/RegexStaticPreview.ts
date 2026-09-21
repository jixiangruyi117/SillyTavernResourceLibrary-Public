import type { PreviewPolicy } from '../services/BrowserStorageService'
import type { RegexEffectSummary } from './RegexEffectPreview'
import { buildRichContentPreview } from './RichContentPreview'

/**
 * 正则替换的“显示效果”与聊天消息使用同一条 SillyTavern → TavernHelper
 * 流水线，不再建立第二套 HTML/CSS/脚本解释器。
 */
export function buildRegexPreviewDocument(
  effect: RegexEffectSummary,
  title: string,
  source = '',
  policy: PreviewPolicy = { allowRemoteResources: false, allowScripts: false },
): string {
  if (!source && !effect.staticPreview.hasStaticContent) return ''
  return buildRichContentPreview(source, title, policy, [], {
    renderShell: 'content',
    sourceKind: 'chatMessage',
  }).document
}

export function hasBlockedRegexPreviewContent(effect: RegexEffectSummary): boolean {
  return effect.staticPreview.blockedScripts || effect.staticPreview.blockedExternalAssets
}
