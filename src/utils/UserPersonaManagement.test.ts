import { describe, expect, it } from 'vitest'
import { applyUserPersonaTemplate } from './UserPersonaManagement'
import { createUserPersonaProfile } from './UserPersonaProfile'

const draft = {
  avatarId: 'me.png',
  name: '我',
  title: '',
  description: '',
  position: 0,
  depth: 2,
  role: 0,
  lorebook: '',
  connections: [],
  characterBindings: {},
  profile: createUserPersonaProfile(),
}

describe('UserPersonaManagement', () => {
  it('applies a selectable template without changing identity or bindings', () => {
    const next = applyUserPersonaTemplate(
      { ...draft, connections: [{ type: 'group', id: 'g' }] },
      'roleplay',
    )
    expect(next.description).toContain('{{user}}')
    expect(next.avatarId).toBe('me.png')
    expect(next.connections).toEqual([{ type: 'group', id: 'g' }])
    expect(next.profile.sections[0]?.text).toBe(next.description)
  })
})
