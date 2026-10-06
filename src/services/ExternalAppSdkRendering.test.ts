/** @vitest-environment jsdom */
import { Blob } from 'node:buffer'
import { describe, expect, it, vi } from 'vitest'
import { ExternalAppSdkService } from './ExternalAppSdkService'
import type { Resource } from '../types/Resource'
import { applyCharacterGreetingRegex } from '../utils/CharacterGreetingRegex'

vi.mock('./ChatReaderRendering', async (original) => {
  const actual = await original<typeof import('./ChatReaderRendering')>()
  return {
    ...actual,
    transformChatInputs: async (inputs: import('./ChatReaderRendering').ChatRenderInput[]) =>
      inputs.map((input) =>
        applyCharacterGreetingRegex([input.source], input.rules, input.context),
      ),
  }
})

function resource(id: string, type: Resource['type'], source: unknown, metadata = {}): Resource {
  return {
    id,
    type,
    name: id,
    metadata: { ...(type === 'chat' ? { messageCount: 1 } : {}), ...metadata },
    originalBlob: new Blob([typeof source === 'string' ? source : JSON.stringify(source)]),
    contentHash: id,
    relatedResourceIds: [],
  } as unknown as Resource
}
function sdkWith(items: Resource[]) {
  const resources = { get: vi.fn(async (id: string) => items.find((item) => item.id === id)) }
  return {
    sdk: new ExternalAppSdkService(
      { hasPermission: async () => true } as never,
      resources as never,
    ),
    resources,
  }
}
const rule = {
  id: 'display',
  scriptName: '面板',
  findRegex: 'STATUS',
  replaceString: '<div>正确状态栏</div>',
  placement: [2],
  markdownOnly: true,
}

describe('reader SDK rendering path', () => {
  it.each([
    resource('css', 'beautification', '.mes_text{color:red}', { format: 'css' }),
    resource(
      'theme',
      'beautification',
      { custom_css: '.mes_text{color:red}', main_text_color: '#123456' },
      { format: 'json' },
    ),
    resource(
      'colors-only',
      'beautification',
      { main_text_color: '#123456', chat_tint_color: '#fff' },
      { format: 'json' },
    ),
  ])('selects library style $id through the same SDK as the app', async (item) => {
    const { sdk } = sdkWith([item])
    const result = await sdk.readerStyle('reader', { id: item.id })
    expect(result.css).toMatch(/color:/)
  })
  it('replaces preset display rules without changing binding, originals or another group', async () => {
    const card = resource('card', 'characterCard', '', { card: { name: '角色' } })
    const chat = resource(
      'chat',
      'chat',
      JSON.stringify({ name: '角色', mes: 'STATUS', is_user: false }),
    )
    chat.relatedResourceIds = ['card']
    const preset = resource('old-preset', 'preset', { extensions: { regex_scripts: [rule] } })
    const { sdk, resources } = sdkWith([card, chat, preset])
    const result = await sdk.readChat('reader', {
      id: 'chat',
      regexSources: { preset: 'old-preset' },
      textOnly: true,
    })
    expect(result.regexSources).toEqual({ preset: { id: 'old-preset', name: 'old-preset' } })
    expect(result.messages[0]?.html).toBe('')
    expect(result.messages[0]?.displaySource).toBe('<div>正确状态栏</div>')
    expect(result.characterId).toBe('card')
    expect(chat.relatedResourceIds).toEqual(['card'])
    expect(await chat.originalBlob.text()).toContain('STATUS')
    expect(resources.get.mock.calls.map(([id]) => id)).not.toContain('unselected')
    await expect(
      sdk.readChat('reader', { id: 'chat', regexSources: { preset: 'card' } }),
    ).rejects.toThrow('类型不适用')
    await expect(
      sdk.readChat('reader', { id: 'chat', regexSources: { preset: 'missing' } }),
    ).rejects.toThrow('已不存在')
  })
  it('keeps disabled rules and rejects prompt-only replacements', async () => {
    const card = resource('card', 'characterCard', '', { card: { name: '角色' } })
    const chat = resource(
      'chat',
      'chat',
      JSON.stringify({ name: '角色', mes: 'STATUS', is_user: false }),
    )
    chat.relatedResourceIds = ['card']
    const rules = resource('rules', 'regex', [{ ...rule, disabled: true }])
    const { sdk } = sdkWith([card, chat, rules])
    const result = await sdk.readChat('reader', {
      id: 'chat',
      regexSources: { character: 'rules' },
    })
    expect(result.messages[0]?.html).toContain('STATUS')
    expect(result.regexRules[0]?.enabled).toBe(false)
    rules.originalBlob = new Blob([
      JSON.stringify([{ ...rule, markdownOnly: false, promptOnly: true }]),
    ]) as unknown as globalThis.Blob
    await expect(
      sdk.readChat('reader', { id: 'chat', regexSources: { character: 'rules' } }),
    ).rejects.toThrow('没有显示正则')
  })
})
