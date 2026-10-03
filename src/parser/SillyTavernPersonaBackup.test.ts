import { describe, expect, it } from 'vitest'
import { reactive } from 'vue'
import { createUserPersonaProfile } from '../utils/UserPersonaProfile'

import {
  addPersonaToBackup,
  duplicatePersonaInBackup,
  parseSillyTavernPersonaBackup,
  removePersonaFromBackup,
  serializeSillyTavernPersonaBackup,
  setDefaultPersonaInBackup,
  updatePersonaInBackup,
} from './SillyTavernPersonaBackup'

const officialBackup = {
  personas: { 'alice.png': 'Alice', 'bob.png': 'Bob' },
  persona_descriptions: {
    'alice.png': {
      description: '[{{user}} is Alice.]',
      position: 4,
      depth: 3,
      role: 1,
      lorebook: 'Alice Lore',
      connections: [
        { type: 'character', id: 'Detective.png' },
        { type: 'group', id: 'group-7' },
      ],
      title: 'The Archivist',
      future_field: { keep: true },
    },
    'bob.png': { description: 'Bob', position: 0 },
  },
  default_persona: 'alice.png',
  future_top_level: 'preserve me',
}

describe('SillyTavernPersonaBackup', () => {
  it('parses the SillyTavern 1.18 persona backup fields without inventing defaults in raw data', () => {
    const result = parseSillyTavernPersonaBackup(officialBackup)

    expect(result.entries).toHaveLength(2)
    expect(result.entries[0]).toMatchObject({
      avatarId: 'alice.png',
      name: 'Alice',
      title: 'The Archivist',
      position: 4,
      depth: 3,
      role: 1,
      lorebook: 'Alice Lore',
      connections: [
        { type: 'character', id: 'Detective.png' },
        { type: 'group', id: 'group-7' },
      ],
    })
    expect(result.raw).toBe(officialBackup)
  })

  it('preserves unknown descriptor and top-level fields when editing known fields', () => {
    const updated = updatePersonaInBackup(officialBackup, 'alice.png', {
      avatarId: 'alice-renamed.png',
      name: 'Alice Renamed',
      title: 'Owner',
      description: 'Updated',
      position: 2,
      depth: 2,
      role: 0,
      lorebook: 'New Lore',
      connections: [{ type: 'character', id: 'Writer.png' }],
      characterBindings: {},
      profile: createUserPersonaProfile('Updated'),
    })

    expect(updated.future_top_level).toBe('preserve me')
    expect(updated.default_persona).toBe('alice-renamed.png')
    expect(updated.persona_descriptions['alice-renamed.png']).toMatchObject({
      future_field: { keep: true },
      description: 'Updated',
      position: 2,
    })
    expect(updated.personas['alice.png']).toBeUndefined()
  })

  it('migrates a legacy description into one global section and stores character variants separately', () => {
    const parsed = parseSillyTavernPersonaBackup(officialBackup)
    const profile = parsed.entries[0]!.profile
    expect(profile.sections).toEqual([
      { id: 'base', name: '基础设定', text: '[{{user}} is Alice.]' },
    ])

    const updated = updatePersonaInBackup(officialBackup, 'alice.png', {
      avatarId: 'alice.png',
      name: 'Alice',
      title: '',
      description: '[{{user}} is Alice.]',
      position: 0,
      depth: 2,
      role: 0,
      lorebook: '',
      connections: [],
      characterBindings: {},
      profile: {
        version: 1,
        sections: [{ id: 'base', name: '基础设定', text: '全局描述' }],
        variants: {
          'detective.png': {
            defaultVersionId: 'detective-1',
            versions: {
              'detective-1': {
                name: '侦探时期',
                overrides: { base: { mode: 'replace', text: '侦探世界中的版本' } },
                addition: '与侦探是搭档。',
              },
              'detective-2': {
                name: '潜伏时期',
                overrides: {},
                addition: '正在执行潜伏任务。',
              },
            },
          },
        },
      },
    })
    expect(updated.persona_descriptions['alice.png']).toMatchObject({
      description: '全局描述',
      srl_persona_profile: {
        variants: {
          'detective.png': {
            defaultVersionId: 'detective-1',
            versions: {
              'detective-1': {
                name: '侦探时期',
                overrides: { base: { mode: 'replace', text: '侦探世界中的版本' } },
                addition: '与侦探是搭档。',
              },
              'detective-2': {
                name: '潜伏时期',
                overrides: {},
                addition: '正在执行潜伏任务。',
              },
            },
          },
        },
      },
    })
  })

  it('adds, selects and removes personas while keeping a valid default', () => {
    const added = addPersonaToBackup(officialBackup, {
      avatarId: 'cara.png',
      name: 'Cara',
      title: '',
      description: '',
      position: 0,
      depth: 2,
      role: 0,
      lorebook: '',
      connections: [],
      characterBindings: {},
      profile: createUserPersonaProfile(''),
    })
    const selected = setDefaultPersonaInBackup(added, 'cara.png')
    const removed = removePersonaFromBackup(selected, 'cara.png')

    expect(added.personas['cara.png']).toBe('Cara')
    expect(selected.default_persona).toBe('cara.png')
    expect(removed.default_persona).toBe('alice.png')
  })

  it('duplicates a persona without changing the default or sharing descriptor objects', () => {
    const duplicated = duplicatePersonaInBackup(officialBackup, 'alice.png', 'alice-copy.png')
    expect(duplicated.personas['alice-copy.png']).toBe('Alice 副本')
    expect(duplicated.default_persona).toBe('alice.png')
    expect(duplicated.persona_descriptions['alice-copy.png']).toEqual(
      officialBackup.persona_descriptions['alice.png'],
    )
    expect(duplicated.persona_descriptions['alice-copy.png']).not.toBe(
      officialBackup.persona_descriptions['alice.png'],
    )
  })

  it('duplicates a Vue-reactive backup without passing a Proxy to structuredClone', () => {
    const duplicated = duplicatePersonaInBackup(reactive(officialBackup), 'alice.png', 'copy.png')

    expect(duplicated.persona_descriptions['copy.png']).toEqual(
      officialBackup.persona_descriptions['alice.png'],
    )
  })

  it('serializes as plain JSON without SRL-private fields', () => {
    const text = serializeSillyTavernPersonaBackup(officialBackup)
    expect(JSON.parse(text)).toEqual(officialBackup)
    expect(text).not.toContain('relatedResourceIds')
  })

  it('keeps the official restore entry permissive object check, including arrays', () => {
    expect(
      parseSillyTavernPersonaBackup({ personas: [], persona_descriptions: [] }).entries,
    ).toEqual([])
  })

  it('rejects lookalike JSON that the official restore entry would reject', () => {
    expect(() => parseSillyTavernPersonaBackup({ personas: {}, descriptions: {} })).toThrow(
      '不是 SillyTavern 用户人设备份',
    )
  })
})
