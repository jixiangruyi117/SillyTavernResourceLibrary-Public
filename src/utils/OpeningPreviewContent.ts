const TAVERN_STATUS_BLOCK_PATTERN = /<tavern_status\b[^>]*>[\s\S]*?<\/tavern_status\s*>/gi
const DISPLAY_NONE_BLOCK_PATTERN =
  /<([a-z][\w:-]*)\b(?=[^>]*\bstyle\s*=\s*(?:"[^"]*display\s*:\s*none[^"]*"|'[^']*display\s*:\s*none[^']*'|[^\s>]*display\s*:\s*none[^\s>]*))[^>]*>[\s\S]*?<\/\1\s*>/gi
const EJS_BLOCK_PATTERN = /<%[\s\S]*?%>/g

export type TavernPreviewSourceKind = 'chatMessage' | 'openingArchive'

/**
 * 仅供开场白列表摘要使用：摘要不展示隐藏状态和模板实现细节。
 * 真实效果预览不得调用该清理函数，否则会先于 SillyTavern/酒馆助手擅自改变消息。
 */
export function stripOpeningPreviewHiddenBlocks(value: string): string {
  return value
    .replace(TAVERN_STATUS_BLOCK_PATTERN, '')
    .replace(DISPLAY_NONE_BLOCK_PATTERN, '')
    .replace(EJS_BLOCK_PATTERN, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function prepareTavernPreviewSource(
  value: string,
  _kind: TavernPreviewSourceKind = 'chatMessage',
): string {
  // SillyTavern 对开场白和普通 AI 消息使用同一条 messageFormatting 流水线。
  // 档案 UI 只改变外壳，不改变送入显示正则、Showdown 和 TavernHelper 的原文。
  return value
}
