import { describe, expect, it } from 'vitest'
import { compareUserPersonaVersions, resolveUserPersonaProfile } from './UserPersonaProfile'
import type { UserPersonaProfile } from '../types/UserPersona'

describe('resolveUserPersonaProfile', () => {
  it('joins the effective global and character-specific content with single newlines', () => {
    const profile: UserPersonaProfile = {
      version: 1,
      sections: [
        { id: 'base', name: '基础设定', text: '我是一个人' },
        { id: 'voice', name: '说话方式', text: '轻声说话' },
      ],
      variants: {
        alice: {
          versions: {
            default: {
              name: '默认版本',
              overrides: { voice: { mode: 'replace', text: '大声说话' } },
              addition: '一个普通人',
            },
          },
          defaultVersionId: 'default',
        },
      },
    }

    expect(resolveUserPersonaProfile(profile, 'alice')).toBe('我是一个人\n大声说话\n一个普通人')
  })

  it('reflects global edits unless the character version replaces that section', () => {
    const profile: UserPersonaProfile = {
      version: 1,
      sections: [{ id: 'base', name: '基础设定', text: '我不是人' }],
      variants: {
        alice: {
          versions: {
            default: {
              name: '默认版本',
              overrides: {},
              addition: '一个普通人',
            },
          },
          defaultVersionId: 'default',
        },
      },
    }

    expect(resolveUserPersonaProfile(profile, 'alice')).toBe('我不是人\n一个普通人')
    profile.variants.alice!.versions.default!.overrides.base = {
      mode: 'replace',
      text: '我是机器人',
    }
    expect(resolveUserPersonaProfile(profile, 'alice')).toBe('我是机器人\n一个普通人')
  })
  it('compares effective version content including disabled global text and additions', () => {
    const profile: UserPersonaProfile = {
      version: 1,
      sections: [{ id: 'base', name: '全局人设', text: '全局内容' }],
      variants: {
        alice: {
          defaultVersionId: 'first',
          versions: {
            first: { name: '初识', overrides: {}, addition: '最初的补充' },
            second: {
              name: '搭档',
              overrides: { base: { mode: 'disable' } },
              addition: '后来的补充',
            },
          },
        },
      },
    }
    expect(compareUserPersonaVersions(profile, 'alice', 'first', 'second')).toEqual([
      { name: '全局人设', before: '全局内容', after: '' },
      { name: '角色专属追加', before: '最初的补充', after: '后来的补充' },
    ])
    expect(compareUserPersonaVersions(profile, 'alice', 'first', 'first')).toEqual([])
    expect(compareUserPersonaVersions(profile, 'alice', 'missing', 'first')).toEqual([])
  })
})
