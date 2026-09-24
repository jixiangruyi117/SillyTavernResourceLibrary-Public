import { describe, expect, it } from 'vitest'

import { copyPersonaForTavern, personaContentMatches } from './TavernPersonaTransfer'

const original = {
  personas: { 'one.png': '原名' },
  persona_descriptions: { 'one.png': { title: '标题', description: '原描述' } },
  default_persona: 'one.png',
}

describe('人设回传时的内容核对', () => {
  it('只比较同一头像标识的实际人设内容，不受 JSON 属性顺序影响', () => {
    expect(
      personaContentMatches(
        original,
        {
          persona_descriptions: { 'one.png': { description: '原描述', title: '标题' } },
          personas: { 'one.png': '原名' },
        },
        'one.png',
      ),
    ).toBe(true)
    expect(
      personaContentMatches(
        original,
        {
          personas: { 'one.png': '原名' },
          persona_descriptions: { 'one.png': { description: '旧描述' } },
        },
        'one.png',
      ),
    ).toBe(false)
    expect(
      personaContentMatches(
        original,
        {
          personas: { 'one.png': '旧名' },
          persona_descriptions: original.persona_descriptions,
        },
        'one.png',
      ),
    ).toBe(false)
  })

  it('另存一份生成新头像键，保留原备份且不切换酒馆默认人设', () => {
    const copy = copyPersonaForTavern(
      original,
      'one.png',
      'persona-12345678-1234-1234-1234-123456789abc.png',
    )
    expect(copy.personas).toEqual({
      'persona-12345678-1234-1234-1234-123456789abc.png': '原名',
    })
    expect(copy.persona_descriptions['persona-12345678-1234-1234-1234-123456789abc.png']).toEqual(
      original.persona_descriptions['one.png'],
    )
    expect(copy.default_persona).toBeUndefined()
    expect(original.personas['one.png']).toBe('原名')
  })
})
