import { describe, expect, it } from 'vitest'

import {
  copyPersonaForTavern,
  mapPersonaCharacterVariantsForTavern,
  personaContentMatches,
} from './TavernPersonaTransfer'

interface PersonaDescriptorForTransferTest {
  description?: string
  connections?: Array<{ type: string; id: string }>
  srl_persona_profile: {
    sections?: Array<{ id: string; name: string; text: string }>
    variants?: Record<string, unknown>
  }
  srl_persona_character_bindings?: Record<string, unknown>
}

function descriptorForTransferTest(
  backup: { persona_descriptions: Record<string, unknown> },
  avatarId: string,
): PersonaDescriptorForTransferTest {
  const descriptor = backup.persona_descriptions[avatarId]
  if (!descriptor || typeof descriptor !== 'object') throw new Error('Expected persona descriptor')
  return descriptor as PersonaDescriptorForTransferTest
}

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

  it('只保留已映射到酒馆角色卡的专属人设，保留全局描述和酒馆原生 connections', () => {
    const backup = {
      personas: { 'one.png': '人设' },
      persona_descriptions: {
        'one.png': {
          description: '全局内容',
          connections: [{ type: 'character', id: 'native-link.png' }],
          srl_persona_character_bindings: {
            'source-card.png': { avatar: 'source-card.png', name: '卡片', hash: 'a'.repeat(64) },
            'native-link.png': {
              avatar: 'native-link.png',
              name: '原生绑定卡',
              hash: 'b'.repeat(64),
            },
            'missing-card.png': {
              avatar: 'missing-card.png',
              name: '缺失卡',
              hash: 'c'.repeat(64),
            },
          },
          srl_persona_profile: {
            version: 1,
            sections: [{ id: 'base', name: '基础设定', text: '全局内容' }],
            variants: {
              'source-card.png': {
                defaultVersionId: 'v1',
                versions: { v1: { name: '版本', addition: '匹配卡' } },
              },
              'missing-card.png': {
                defaultVersionId: 'v1',
                versions: { v1: { name: '版本', addition: '缺失卡' } },
              },
            },
          },
        },
      },
    }
    const mapped = mapPersonaCharacterVariantsForTavern(
      backup,
      new Map([['one.png', new Map([['source-card.png', 'tavern-card.png']])]]),
    )
    const descriptor = descriptorForTransferTest(mapped, 'one.png')
    expect(descriptor.description).toBe('全局内容')
    expect(descriptor.connections).toEqual([{ type: 'character', id: 'native-link.png' }])
    expect(descriptor.srl_persona_profile.variants).toHaveProperty('tavern-card.png')
    expect(descriptor.srl_persona_profile.variants).not.toHaveProperty('missing-card.png')
    expect(descriptor.srl_persona_character_bindings).toHaveProperty('tavern-card.png')
    expect(descriptor.srl_persona_character_bindings).toHaveProperty('native-link.png')
    expect(descriptor.srl_persona_character_bindings).not.toHaveProperty('missing-card.png')
    expect(
      descriptorForTransferTest(backup, 'one.png').srl_persona_profile?.variants,
    ).toHaveProperty('source-card.png')
  })

  it('在酒馆没有匹配角色卡时清空角色专属部分但保留全局人设', () => {
    const backup = {
      personas: { 'one.png': '人设' },
      persona_descriptions: {
        'one.png': {
          description: '只保留全局',
          srl_persona_profile: {
            version: 1,
            sections: [{ id: 'base', name: '基础设定', text: '只保留全局' }],
            variants: {
              'missing-card.png': { defaultVersionId: 'v1', versions: { v1: { name: '版本' } } },
            },
          },
        },
      },
    }
    const mapped = mapPersonaCharacterVariantsForTavern(backup, new Map())
    const descriptor = descriptorForTransferTest(mapped, 'one.png')
    expect(descriptor.description).toBe('只保留全局')
    expect(descriptor.srl_persona_profile.sections).toEqual([
      { id: 'base', name: '基础设定', text: '只保留全局' },
    ])
    expect(descriptor.srl_persona_profile.variants).toEqual({})
  })
})
