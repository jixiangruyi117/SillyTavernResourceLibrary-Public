import { afterEach, expect, it } from 'vitest'
import {
  applyAssistantPetExpression,
  assistantPetCue,
  publishAssistantPetCue,
  finishAssistantPetReply,
} from './ProductAssistantPetState'
afterEach(() => {
  assistantPetCue.value = undefined
})
it('rechecks active pet settings and validates plain short cues at the host boundary', () => {
  const cue = { expression: 'curious' as const, message: '我吗？' }
  expect(() =>
    applyAssistantPetExpression(cue, true, { desktopPet: true, aiPetExpressions: false }),
  ).toThrow('已关闭')
  expect(() =>
    applyAssistantPetExpression(cue, false, { desktopPet: true, aiPetExpressions: true }),
  ).toThrow('不可用')
  expect(assistantPetCue.value).toBeUndefined()
  applyAssistantPetExpression(cue, true, { desktopPet: true, aiPetExpressions: true })
  expect(assistantPetCue.value?.expression).toBe('curious')
  expect(() => publishAssistantPetCue('啊'.repeat(33))).toThrow('32字')
  expect(() => publishAssistantPetCue('换行\n')).toThrow('短句')
})
it('shows a compact completion status while keeping the full reply in chat', () => {
  const before = assistantPetCue.value?.id
  publishAssistantPetCue('我做好啦！', 'happy')
  finishAssistantPetReply(before, '预览好啦，还没有安装哦。', false)
  expect(assistantPetCue.value?.text).toBe('任务完成啦，点开看正文')
  expect(assistantPetCue.value?.text).not.toContain('预览好啦')
  expect(assistantPetCue.value?.expression).toBe('happy')
  finishAssistantPetReply(before, '这次没做好 TT', true)
  expect(assistantPetCue.value?.text).toBe('这次没完成，点开看原因')
  expect(assistantPetCue.value?.expression).toBeUndefined()
})
it('uses a short status for long replies, navigation, and stopped work', () => {
  finishAssistantPetReply(undefined, '原回复'.repeat(30), false)
  expect(assistantPetCue.value?.text).toBe('任务完成啦，点开看正文')
  finishAssistantPetReply(undefined, '功能在这里哦\n点这个按钮就好。', false)
  expect(assistantPetCue.value?.text).toBe('功能在这里哦，点开看详情')
  finishAssistantPetReply(undefined, '「资源设置」打开啦。', false)
  expect(assistantPetCue.value?.text).toBe('已打开「资源设置」，点开看详情')
  finishAssistantPetReply(undefined, '用户停止了请求', true)
  expect(assistantPetCue.value?.text).toBe('我先停一下，点开看进度')
  expect(Array.from(assistantPetCue.value!.text).length).toBeLessThanOrEqual(32)
})
it('uses the model-generated summary when it is short and plain text', () => {
  finishAssistantPetReply(undefined, '在设置里打开联网搜索后即可使用。', false, '联网搜索已开启')
  expect(assistantPetCue.value?.text).toBe('联网搜索已开启')
  finishAssistantPetReply(undefined, '正文', false, '超过十八字的简报会被丢弃并显示安全的短状态')
  expect(assistantPetCue.value?.text).toBe('任务完成啦，点开看正文')
})
