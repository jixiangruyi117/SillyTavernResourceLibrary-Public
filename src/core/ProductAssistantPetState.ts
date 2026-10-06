import { shallowRef } from 'vue'

/** Transient pet cues, never conversation memory or model instructions. */
export const ASSISTANT_PET_EXPRESSIONS = [
  'idle',
  'happy',
  'walk',
  'thinking',
  'chat',
  'sleep',
  'curious',
  'surprised',
  'drool',
  'love',
  'ponder',
] as const
export type AssistantPetExpression = (typeof ASSISTANT_PET_EXPRESSIONS)[number]
export const assistantPetCue = shallowRef<{
  id: number
  text: string
  expression?: AssistantPetExpression
  reply?: boolean
}>()
let sequence = 0
export function isAssistantPetExpression(value: string): value is AssistantPetExpression {
  return (ASSISTANT_PET_EXPRESSIONS as readonly string[]).includes(value)
}
export function publishAssistantPetCue(
  text: string,
  expression?: AssistantPetExpression,
  reply = false,
) {
  if (expression && !isAssistantPetExpression(expression)) throw new Error('未知桌宠表情')
  if (
    Array.from(text).length > 32 ||
    Array.from(text).some((character) => character.charCodeAt(0) < 32)
  )
    throw new Error('桌宠气泡请使用32字以内的短句')
  assistantPetCue.value = { id: ++sequence, text: text.trim(), expression, reply }
}
export function finishAssistantPetReply(
  previousId: number | undefined,
  text: string,
  failed: boolean,
  summary?: string,
) {
  // The pet bubble is a compact status cue, never a second copy of the reply.
  // The full text remains in chat and is available by opening the bubble.
  const normalized = text.trim().replace(/\s+/g, ' ')
  const openedTitle = normalized.match(/^「(.+?)」打开啦。?$/)?.[1]
  const shortText =
    !failed &&
    summary &&
    Array.from(summary.trim()).length <= 18 &&
    !/[<>]/u.test(summary) &&
    !Array.from(summary).some((character) => character.charCodeAt(0) < 32)
      ? summary.trim()
      : failed
        ? /停|取消/.test(normalized)
          ? '我先停一下，点开看进度'
          : '这次没完成，点开看原因'
        : /功能在这里/.test(normalized)
          ? '功能在这里哦，点开看详情'
          : openedTitle
            ? `已打开「${Array.from(openedTitle).slice(0, 8).join('')}」，点开看详情`
            : '任务完成啦，点开看正文'
  const expression =
    !failed && assistantPetCue.value?.id !== previousId
      ? assistantPetCue.value?.expression
      : undefined
  publishAssistantPetCue(shortText, expression, true)
}
export function applyAssistantPetExpression(
  cue: { expression: AssistantPetExpression; message: string },
  active: boolean,
  preferences: { desktopPet?: boolean; aiPetExpressions?: boolean },
) {
  if (!active || !preferences.desktopPet || !preferences.aiPetExpressions)
    throw new Error('AI 控制表情已关闭或桌宠不可用')
  publishAssistantPetCue(cue.message, cue.expression)
  return { text: '已切换桌宠表情。' }
}
