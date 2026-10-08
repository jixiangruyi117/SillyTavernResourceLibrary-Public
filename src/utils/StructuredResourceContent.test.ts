import { describe, expect, it } from 'vitest'
import { createStructuredContentDraft } from './StructuredResourceContent'
import { RESOURCE_TYPE } from '../types/Resource'
import type { CharacterCardContentEdit } from '../types/CharacterCardContentEdit'

function update(
  section: 'worldBook' | 'regex',
  before: Record<string, unknown>,
  patch: Record<string, unknown>,
): CharacterCardContentEdit {
  return {
    id: 'edit',
    section,
    operation: 'update',
    targetKey: String(section === 'worldBook' ? before.uid : before.id),
    label: '编辑',
    before,
    after: { ...before, ...patch },
    migrateToVersions: false,
    updatedAt: 1,
  }
}
function rows(draft: ReturnType<typeof createStructuredContentDraft>): Record<string, unknown>[] {
  const data = draft.card.data as Record<string, unknown>
  return (
    draft.section === 'worldBook'
      ? (data.character_book as Record<string, unknown>).entries
      : (data.extensions as Record<string, unknown>).regex_scripts
  ) as Record<string, unknown>[]
}
describe('standalone content adapter', () => {
  it('roundtrips untouched WI records and saves changes using native fields without editor identities', () => {
    const source = {
      name: '夜港',
      unknown: { keep: true },
      entries: {
        '42': {
          uid: 42,
          key: ['旧'],
          keysecondary: ['月光'],
          comment: '码头',
          content: '旧正文',
          disable: false,
          order: 101,
          position: 1,
          depth: 3,
          probability: 17,
          scanDepth: 5,
          unknown: '保留',
        },
        '99': { uid: 99, key: ['夜港'], content: '不动', vectorized: true },
      },
    }
    const draft = createStructuredContentDraft(source, RESOURCE_TYPE.WORLD_BOOK)
    expect(draft.build([])).toEqual(source)
    const before = rows(draft)[0]!
    const result = draft.build([
      update('worldBook', before, {
        content: '新正文',
        keys: ['新'],
        enabled: false,
        insertion_order: 33,
        constant: true,
        position: 'after_char',
        extensions: { ...(before.extensions as object), position: 4, depth: 2 },
      }),
    ])
    expect(result).toEqual({
      ...source,
      entries: {
        ...source.entries,
        '42': {
          ...source.entries['42'],
          key: ['新'],
          content: '新正文',
          disable: true,
          order: 33,
          constant: true,
          position: 4,
          depth: 2,
        },
      },
    })
  })
  it('preserves WI array shape and allocates an unused native uid for additions', () => {
    const source = {
      entries: [
        { uid: 0, key: ['x'], content: 'x' },
        { uid: 1, content: 'y' },
      ],
    }
    const draft = createStructuredContentDraft(source, RESOURCE_TYPE.WORLD_BOOK)
    const after = {
      uid: 2,
      id: 2,
      keys: ['新'],
      secondary_keys: [],
      content: '新增',
      enabled: true,
      insertion_order: 2,
      position: 'before_char',
      extensions: { position: 4, depth: 1 },
    }
    const added: CharacterCardContentEdit = {
      id: 'add',
      section: 'worldBook',
      operation: 'add',
      targetKey: '2',
      label: '新增',
      after,
      migrateToVersions: false,
      updatedAt: 1,
    }
    expect(draft.build([added])).toEqual({
      entries: [
        ...source.entries,
        {
          uid: 2,
          key: ['新'],
          keysecondary: [],
          content: '新增',
          disable: false,
          order: 2,
          position: 4,
          depth: 1,
        },
      ],
    })
  })
  it('keeps scope package membership, duplicate source ids, aliases and unknown settings', () => {
    const rule = {
      id: 'same',
      script_name: '旧',
      find_regex: '/旧/g',
      replace_string: '旧',
      enabled: true,
      markdown_only: true,
      custom: { preserve: 1 },
    }
    const source = {
      id: 'package',
      name: '方案',
      unknown: '保留',
      global: [rule],
      scoped: [{ ...rule, script_name: '角色' }],
      preset: [],
    }
    const draft = createStructuredContentDraft(source, RESOURCE_TYPE.REGEX)
    const before = rows(draft)[1]!
    const result = draft.build([
      update('regex', before, { scriptName: '新', replaceString: '新', disabled: true }),
    ])
    expect(result).toEqual({
      ...source,
      scoped: [
        {
          ...source.scoped[0],
          script_name: '新',
          replace_string: '新',
          enabled: false,
          disabled: true,
        },
      ],
    })
    expect(JSON.stringify(result)).not.toContain('structured:')
  })
  it('updates helper source/destination flags and keeps the rest of their objects', () => {
    const source = {
      script_name: '规则',
      find_regex: '/x/g',
      replace_string: 'y',
      source: { ai_output: true, custom: 7 },
      destination: { display: true, prompt: false, custom: 8 },
    }
    const draft = createStructuredContentDraft(source, RESOURCE_TYPE.REGEX)
    const before = rows(draft)[0]!
    expect(
      draft.build([
        update('regex', before, { placement: [1, 5], markdownOnly: false, promptOnly: true }),
      ]),
    ).toEqual({
      ...source,
      source: {
        custom: 7,
        user_input: true,
        ai_output: false,
        slash_command: false,
        world_info: true,
        reasoning: false,
      },
      destination: { display: false, prompt: true, custom: 8 },
    })
  })
  it('supports native single and collection regex edits and rejects removing every rule', () => {
    const source = {
      id: 'r',
      scriptName: '规则',
      findRegex: '/x/g',
      replaceString: 'y',
      placement: [2],
    }
    const draft = createStructuredContentDraft(source, RESOURCE_TYPE.REGEX)
    const before = rows(draft)[0]!
    expect(draft.build([update('regex', before, { replaceString: 'z' })])).toEqual({
      ...source,
      replaceString: 'z',
    })
    expect(createStructuredContentDraft([source], RESOURCE_TYPE.REGEX).build([])).toEqual([source])
    expect(() =>
      draft.build([{ ...update('regex', before, {}), operation: 'delete', after: undefined }]),
    ).toThrow('至少保留一条')
  })
})
