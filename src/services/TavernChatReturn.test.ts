import { describe, expect, it, vi } from 'vitest'
import { prepareChatReturn } from './TavernChatReturn'
import type { Resource } from '../types/Resource'

const card = {
  id: 'card',
  type: 'characterCard',
  fileName: 'b.png',
  metadata: {
    card: { data: { extensions: { regex_scripts: [{ scriptName: 'card', disabled: false }] } } },
  },
} as unknown as Resource
const chat = {
  id: 'chat',
  name: '雨夜',
  type: 'chat',
  relatedResourceIds: ['card'],
  metadata: { chatDisplayRegexId: 'regex' },
} as unknown as Resource
const regex = {
  id: 'regex',
  type: 'regex',
  originalBlob: new Blob([
    JSON.stringify({ global: [{ scriptName: 'global' }], preset: [{ scriptName: 'preset' }] }),
  ]),
} as Resource
const inventory = [
  {
    id: 'character:b.png',
    kind: 'character' as const,
    name: '同名',
    fileName: 'b.png',
    detail: '',
  },
]
describe('chat return plans', () => {
  it('does not read or return companion rules for chat-only transfer', async () => {
    const get = vi.fn(async (id: string) => (id === 'card' ? card : regex))
    expect(await prepareChatReturn(chat, { get }, inventory, false)).toEqual({
      avatar: 'b.png',
      targetLabel: '同名（b.png）',
    })
    expect(get).toHaveBeenCalledTimes(1)
  })
  it('collects all three scopes as disabled character copies without editing their source', async () => {
    const plan = await prepareChatReturn(
      chat,
      { get: async (id) => (id === 'card' ? card : regex) },
      inventory,
      true,
    )
    const result = JSON.parse(await plan.regexFile!.text())
    expect(result.sourceAvatar).toBe('b.png')
    expect(result.scoped.map((rule: { scriptName: string }) => rule.scriptName)).toEqual([
      'global',
      'preset',
      'card',
    ])
    expect(result.scoped.every((rule: { disabled: boolean }) => rule.disabled)).toBe(true)
    expect(JSON.stringify(card)).toContain('"disabled":false')
  })
  it('rejects missing target rather than using another same-named character', async () => {
    await expect(
      prepareChatReturn(
        chat,
        { get: async () => card },
        [{ ...inventory[0]!, id: 'character:a.png' }],
        false,
      ),
    ).rejects.toThrow('未自动改绑')
  })
})
