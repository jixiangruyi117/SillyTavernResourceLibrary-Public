import { describe, expect, it } from 'vitest'
import type { CharacterCardContentEdit } from '../types/CharacterCardContentEdit'
import {
  applyCharacterCardContentEdit,
  applyCharacterCardContentEdits,
  migrateCharacterCardContentEdits,
  normalizeImportedCharacterBookEntry,
} from './CharacterCardContentEdits'

function edit(
  partial: Pick<
    CharacterCardContentEdit,
    'section' | 'operation' | 'targetKey' | 'before' | 'after'
  >,
): CharacterCardContentEdit {
  return {
    id: `${partial.section}-edit`,
    label: '测试修改',
    migrateToVersions: true,
    updatedAt: 1,
    ...partial,
  }
}

interface TestBookEntry extends Record<string, unknown> {
  uid: number
  comment?: string
  keys?: string[]
  content: string
  enabled: boolean
}
interface TestHelperNode {
  type: string
  name?: string
  scripts?: TestHelperNode[]
  value?: { id: string; name: string; content: string; enabled: boolean }
}

const source = {
  spec: 'chara_card_v3',
  data: {
    first_mes: '原开场白',
    alternate_greetings: ['备用一'],
    character_book: {
      name: '角色世界书',
      entries: [
        { uid: 7, comment: '城镇', keys: ['城镇'], content: '旧设定', enabled: true },
      ] as TestBookEntry[],
    },
    extensions: {
      regex_scripts: [
        { id: 'regex-1', scriptName: '旧规则', findRegex: 'foo', replaceString: 'bar' },
      ],
      tavern_helper: {
        scripts: [
          {
            type: 'folder',
            name: '工具',
            scripts: [
              {
                type: 'script',
                value: { id: 'script-1', name: '旧脚本', content: 'return 1', enabled: true },
              },
            ],
          },
        ] as TestHelperNode[],
      },
    },
  },
}

function cardData(card: unknown): typeof source.data {
  return (card as { data: unknown }).data as typeof source.data
}

describe('character card content edit overlays', () => {
  it('maps standalone SillyTavern World Info fields to embedded card fields', () => {
    const normalized = normalizeImportedCharacterBookEntry(
      {
        name: '独立世界书条目',
        key: ['触发词'],
        keysecondary: '次要一, 次要二',
        disable: true,
        order: 27,
        content: '内容',
      },
      91,
    )

    expect(normalized).toMatchObject({
      uid: 91,
      comment: '独立世界书条目',
      keys: ['触发词'],
      secondary_keys: ['次要一', '次要二'],
      enabled: false,
      insertion_order: 27,
      content: '内容',
      extensions: {},
    })
    expect(normalized).not.toHaveProperty('key')
    expect(normalized).not.toHaveProperty('keysecondary')
    expect(normalized).not.toHaveProperty('disable')
    expect(normalized).not.toHaveProperty('order')
  })

  it('adds alternate greetings while keeping the primary greeting intact', () => {
    const added = applyCharacterCardContentEdit(
      source,
      edit({
        section: 'greeting',
        operation: 'add',
        targetKey: 'alternate:new-1',
        after: '新开场白',
      }),
    )

    expect(added.status).toBe('applied')
    expect(cardData(added.card).first_mes).toBe('原开场白')
    expect(cardData(added.card).alternate_greetings).toEqual(['备用一', '新开场白'])
    expect(source.data.alternate_greetings).toEqual(['备用一'])
  })

  it('applies world book and regex changes by stable entry ids', () => {
    const result = applyCharacterCardContentEdits(source, [
      edit({
        section: 'worldBook',
        operation: 'update',
        targetKey: '7',
        before: source.data.character_book.entries[0],
        after: { ...source.data.character_book.entries[0], content: '新设定' },
      }),
      edit({
        section: 'regex',
        operation: 'update',
        targetKey: 'regex-1',
        before: source.data.extensions.regex_scripts[0],
        after: { ...source.data.extensions.regex_scripts[0], replaceString: 'baz' },
      }),
    ])

    expect(result.conflicts).toEqual([])
    expect(cardData(result.card).character_book.entries[0]!.content).toBe('新设定')
    expect(cardData(result.card).extensions.regex_scripts[0]!.replaceString).toBe('baz')
  })

  it('updates nested TavernHelper scripts without flattening their folder tree', () => {
    const before = source.data.extensions.tavern_helper.scripts[0]!.scripts![0]!.value!
    const result = applyCharacterCardContentEdit(
      source,
      edit({
        section: 'helperScript',
        operation: 'update',
        targetKey: 'script-1',
        before,
        after: { ...before, content: 'return 2' },
      }),
    )

    expect(result.status).toBe('applied')
    expect(cardData(result.card).extensions.tavern_helper.scripts[0]!.name).toBe('工具')
    expect(
      cardData(result.card).extensions.tavern_helper.scripts[0]!.scripts![0]!.value!.content,
    ).toBe('return 2')
  })

  it('does not overwrite an entry changed in a newer card version', () => {
    const newer = structuredClone(source)
    newer.data.character_book.entries[0]!.content = '新版内容'
    const result = applyCharacterCardContentEdit(
      newer,
      edit({
        section: 'worldBook',
        operation: 'update',
        targetKey: '7',
        before: source.data.character_book.entries[0],
        after: { ...source.data.character_book.entries[0], content: '用户修改' },
      }),
    )

    expect(result.status).toBe('conflict')
    expect(cardData(result.card).character_book.entries[0]!.content).toBe('新版内容')
  })

  it('rebases a selected world book edit onto a matching entry in the new version', () => {
    const newSource = structuredClone(source)
    newSource.data.character_book.entries[0]!.comment = '新版城镇名称'
    const incoming = edit({
      section: 'worldBook',
      operation: 'update',
      targetKey: '7',
      before: source.data.character_book.entries[0],
      after: { ...source.data.character_book.entries[0], content: '用户设定' },
    })
    const migrated = migrateCharacterCardContentEdits(newSource, [], [incoming])

    expect(migrated.conflicts).toEqual([])
    expect(migrated.edits).toHaveLength(1)
    expect(migrated.edits[0]?.before).toEqual(newSource.data.character_book.entries[0])
    expect(cardData(migrated.card).character_book.entries[0]).toMatchObject({
      comment: '新版城镇名称',
      content: '用户设定',
    })
    expect(
      cardData(applyCharacterCardContentEdits(newSource, migrated.edits).card).character_book
        .entries[0],
    ).toEqual(cardData(migrated.card).character_book.entries[0])
  })

  it('auto-merges non-conflicting fields and reports same-field author edits for review', () => {
    const newSource = structuredClone(source)
    newSource.data.character_book.entries[0]!.content = '作者微调后的内容'
    const original = source.data.character_book.entries[0]
    const incoming = edit({
      section: 'worldBook',
      operation: 'update',
      targetKey: '7',
      before: original,
      after: { ...original, content: '用户正文', enabled: false },
    })

    const preview = migrateCharacterCardContentEdits(newSource, [], [incoming])
    const entry = cardData(preview.card).character_book.entries[0]

    expect(preview.fieldConflicts).toHaveLength(1)
    expect(preview.fieldConflicts[0]).toMatchObject({
      field: 'content',
      baseValue: '旧设定',
      currentValue: '作者微调后的内容',
      incomingValue: '用户正文',
    })
    expect(preview.conflicts).toEqual([])
    expect(entry).toMatchObject({ content: '作者微调后的内容', enabled: false })
  })

  it.each([
    ['保留新版', { choice: 'keep-current' as const }, '作者微调后的内容'],
    ['采用我的修改', { choice: 'use-incoming' as const }, '用户正文'],
    [
      '手动合并',
      { choice: 'manual' as const, value: '作者补充 + 用户补充' },
      '作者补充 + 用户补充',
    ],
  ])('%s 后只记录最终迁移结果', (_label, choice, expectedContent) => {
    const newSource = structuredClone(source)
    newSource.data.character_book.entries[0]!.content = '作者微调后的内容'
    const original = source.data.character_book.entries[0]
    const incoming = edit({
      section: 'worldBook',
      operation: 'update',
      targetKey: '7',
      before: original,
      after: { ...original, content: '用户正文', enabled: false },
    })

    const migrated = migrateCharacterCardContentEdits(newSource, [], [incoming], {
      [`${incoming.id}::content`]: choice,
    })
    const entry = cardData(migrated.card).character_book.entries[0]

    expect(migrated.fieldConflicts).toEqual([])
    expect(entry).toMatchObject({ content: expectedContent, enabled: false })
    expect(migrated.edits).toHaveLength(1)
    expect(migrated.edits[0]?.before).toEqual(newSource.data.character_book.entries[0])
    expect(
      cardData(applyCharacterCardContentEdits(newSource, migrated.edits).card).character_book
        .entries[0],
    ).toEqual(entry)
  })

  it('follows stable ids when the author reorders world book entries', () => {
    const newer = structuredClone(source)
    newer.data.character_book.entries.push({
      uid: 8,
      comment: '河谷',
      content: '河谷设定',
      enabled: true,
    })
    newer.data.character_book.entries.reverse()
    const original = source.data.character_book.entries[0]
    const incoming = edit({
      section: 'worldBook',
      operation: 'update',
      targetKey: '7',
      before: original,
      after: { ...original, content: '用户更新' },
    })

    const migrated = migrateCharacterCardContentEdits(newer, [], [incoming])

    expect(migrated.conflicts).toEqual([])
    expect(cardData(migrated.card).character_book.entries).toEqual([
      { uid: 8, comment: '河谷', content: '河谷设定', enabled: true },
      { ...original, content: '用户更新' },
    ])
  })

  it('refuses to guess when the new version contains duplicate stable ids', () => {
    const newer = structuredClone(source)
    newer.data.character_book.entries.push({
      uid: 7,
      comment: '重复 ID 的另一条',
      content: '不能误写到这里',
      enabled: true,
    })
    const original = source.data.character_book.entries[0]
    const incoming = edit({
      section: 'worldBook',
      operation: 'update',
      targetKey: '7',
      before: original,
      after: { ...original, content: '用户更新' },
    })

    const migrated = migrateCharacterCardContentEdits(newer, [], [incoming])

    expect(migrated.conflicts).toEqual([incoming])
    expect(cardData(migrated.card).character_book.entries).toEqual(
      newer.data.character_book.entries,
    )
  })

  it('keeps object-shaped World Book entries when rebuilt keys collide', () => {
    const card = {
      data: {
        character_book: {
          entries: {
            first: { comment: '无标识条目', content: '旧值' },
            second: { uid: 0, comment: '数字标识条目', content: '另一个值' },
          },
        },
      },
    }
    const incoming = edit({
      section: 'worldBook',
      operation: 'update',
      targetKey: 'missing-id',
      before: { comment: '无标识条目', content: '旧值' },
      after: { comment: '无标识条目', content: '新值' },
    })

    const migrated = migrateCharacterCardContentEdits(card, [], [incoming])
    const entries = cardData(migrated.card).character_book.entries

    expect(Object.values(entries)).toHaveLength(2)
    expect(Object.values(entries)).toContainEqual({ comment: '无标识条目', content: '新值' })
    expect(Object.values(entries)).toContainEqual({
      uid: 0,
      comment: '数字标识条目',
      content: '另一个值',
    })
  })

  it('does not resurrect an entry removed by the author', () => {
    const newer = structuredClone(source)
    newer.data.character_book.entries = []
    const incoming = edit({
      section: 'worldBook',
      operation: 'update',
      targetKey: '7',
      before: source.data.character_book.entries[0],
      after: { ...source.data.character_book.entries[0], content: '用户更新' },
    })

    const migrated = migrateCharacterCardContentEdits(newer, [], [incoming])

    expect(migrated.conflicts).toEqual([incoming])
    expect(cardData(migrated.card).character_book.entries).toEqual([])
  })

  it('lets the user keep or delete an author-updated entry when a recorded deletion conflicts', () => {
    const newer = structuredClone(source)
    newer.data.character_book.entries[0]!.content = '作者仍在维护的条目'
    const incoming = edit({
      section: 'worldBook',
      operation: 'delete',
      targetKey: '7',
      before: source.data.character_book.entries[0],
    })

    const preview = migrateCharacterCardContentEdits(newer, [], [incoming])
    const keepAuthor = migrateCharacterCardContentEdits(newer, [], [incoming], {
      [`${incoming.id}::__entry__`]: { choice: 'keep-current' },
    })
    const applyDeletion = migrateCharacterCardContentEdits(newer, [], [incoming], {
      [`${incoming.id}::__entry__`]: { choice: 'use-incoming' },
    })

    expect(preview.fieldConflicts[0]).toMatchObject({
      field: '__entry__',
      baseValue: source.data.character_book.entries[0],
      currentValue: newer.data.character_book.entries[0],
      incomingValue: undefined,
    })
    expect(cardData(keepAuthor.card).character_book.entries).toEqual(
      newer.data.character_book.entries,
    )
    expect(keepAuthor.edits).toEqual([])
    expect(cardData(applyDeletion.card).character_book.entries).toEqual([])
    expect(applyDeletion.edits[0]?.before).toEqual(newer.data.character_book.entries[0])
    expect(
      cardData(applyCharacterCardContentEdits(newer, applyDeletion.edits).card).character_book
        .entries,
    ).toEqual([])
  })

  it('treats a deletion already present in the new version as complete', () => {
    const newer = structuredClone(source)
    newer.data.character_book.entries = []
    const incoming = edit({
      section: 'worldBook',
      operation: 'delete',
      targetKey: '7',
      before: source.data.character_book.entries[0],
    })

    const migrated = migrateCharacterCardContentEdits(newer, [], [incoming])

    expect(migrated.conflicts).toEqual([])
    expect(migrated.alreadyPresent).toEqual([incoming])
    expect(migrated.edits).toEqual([])
  })

  it('does not duplicate a user update already included by the author', () => {
    const original = source.data.character_book.entries[0]
    const incoming = edit({
      section: 'worldBook',
      operation: 'update',
      targetKey: '7',
      before: original,
      after: { ...original, content: '用户更新' },
    })
    const newer = structuredClone(source)
    newer.data.character_book.entries[0] = {
      ...original,
      content: '用户更新',
      extensions: { authorNote: '作者同时补充' },
    }

    const migrated = migrateCharacterCardContentEdits(newer, [], [incoming])

    expect(migrated.conflicts).toEqual([])
    expect(migrated.alreadyPresent).toEqual([incoming])
    expect(migrated.edits).toEqual([])
    expect(cardData(migrated.card).character_book.entries[0]!.extensions).toEqual({
      authorNote: '作者同时补充',
    })
  })

  it('handles a user-removed field as a field-level conflict and applies the selected removal', () => {
    const before = { ...source.data.character_book.entries[0], comment: '旧名称' }
    const after = { ...before }
    delete (after as Partial<typeof before>).comment
    const incoming = edit({
      section: 'worldBook',
      operation: 'update',
      targetKey: '7',
      before,
      after,
    })
    const newer = structuredClone(source)
    newer.data.character_book.entries[0]!.comment = '作者的新名称'

    const preview = migrateCharacterCardContentEdits(newer, [], [incoming])
    const resolved = migrateCharacterCardContentEdits(newer, [], [incoming], {
      [`${incoming.id}::comment`]: { choice: 'use-incoming' },
    })

    expect(preview.fieldConflicts[0]).toMatchObject({
      field: 'comment',
      currentValue: '作者的新名称',
      incomingValue: undefined,
    })
    expect(cardData(resolved.card).character_book.entries[0]).not.toHaveProperty('comment')
    expect(resolved.edits[0]?.after).not.toHaveProperty('comment')
  })

  it('offers field conflict choices for a changed primary greeting', () => {
    const incoming = edit({
      section: 'greeting',
      operation: 'update',
      targetKey: 'primary',
      before: '原开场白',
      after: '用户改写的开场白',
    })
    const newer = structuredClone(source)
    newer.data.first_mes = '作者修订的开场白'

    const preview = migrateCharacterCardContentEdits(newer, [], [incoming])
    const resolved = migrateCharacterCardContentEdits(newer, [], [incoming], {
      [`${incoming.id}::first_mes`]: { choice: 'manual', value: '合并后的开场白' },
    })

    expect(preview.fieldConflicts[0]).toMatchObject({
      field: 'first_mes',
      baseValue: '原开场白',
      currentValue: '作者修订的开场白',
      incomingValue: '用户改写的开场白',
    })
    expect(cardData(resolved.card).first_mes).toBe('合并后的开场白')
    expect(resolved.edits[0]?.before).toBe('作者修订的开场白')
    expect(resolved.edits[0]?.after).toBe('合并后的开场白')
  })

  it('does not report a primary greeting deletion twice after the new version already removed it', () => {
    const incoming = edit({
      section: 'greeting',
      operation: 'delete',
      targetKey: 'primary',
      before: '原开场白',
    })
    const newer = structuredClone(source)
    newer.data.first_mes = ''

    const migrated = migrateCharacterCardContentEdits(newer, [], [incoming])

    expect(migrated.conflicts).toEqual([])
    expect(migrated.alreadyPresent).toEqual([incoming])
    expect(cardData(migrated.card).first_mes).toBe('')
  })

  it('does not treat an entry whose stable id changed as the same entry', () => {
    const newer = structuredClone(source)
    newer.data.character_book.entries[0]!.uid = 70
    const incoming = edit({
      section: 'worldBook',
      operation: 'update',
      targetKey: '7',
      before: source.data.character_book.entries[0],
      after: { ...source.data.character_book.entries[0], content: '用户更新' },
    })

    const migrated = migrateCharacterCardContentEdits(newer, [], [incoming])

    expect(migrated.conflicts).toEqual([incoming])
    expect(cardData(migrated.card).character_book.entries[0]).toEqual(
      newer.data.character_book.entries[0],
    )
  })

  it('accepts reordered JSON object keys without reporting a false conflict', () => {
    const newer = structuredClone(source)
    newer.data.character_book.entries[0] = {
      content: '旧设定',
      enabled: true,
      keys: ['城镇'],
      comment: '城镇',
      uid: 7,
    }
    const incoming = edit({
      section: 'worldBook',
      operation: 'update',
      targetKey: '7',
      before: source.data.character_book.entries[0],
      after: { ...source.data.character_book.entries[0], content: '用户更新' },
    })

    const migrated = migrateCharacterCardContentEdits(newer, [], [incoming])

    expect(migrated.fieldConflicts).toEqual([])
    expect(migrated.conflicts).toEqual([])
    expect(cardData(migrated.card).character_book.entries[0]!.content).toBe('用户更新')
  })

  it('treats trigger-key arrays as one conflict instead of silently unioning author and user lists', () => {
    const original = source.data.character_book.entries[0]
    const incoming = edit({
      section: 'worldBook',
      operation: 'update',
      targetKey: '7',
      before: original,
      after: { ...original, keys: ['城镇', '港口'] },
    })
    const newer = structuredClone(source)
    newer.data.character_book.entries[0]!.keys = ['城镇', '旅馆']

    const preview = migrateCharacterCardContentEdits(newer, [], [incoming])
    const keepAuthor = migrateCharacterCardContentEdits(newer, [], [incoming], {
      [`${incoming.id}::keys`]: { choice: 'keep-current' },
    })

    expect(preview.fieldConflicts[0]).toMatchObject({
      field: 'keys',
      currentValue: ['城镇', '旅馆'],
      incomingValue: ['城镇', '港口'],
    })
    expect(cardData(preview.card).character_book.entries[0]!.keys).toEqual(['城镇', '旅馆'])
    expect(cardData(keepAuthor.card).character_book.entries[0]!.keys).toEqual(['城镇', '旅馆'])
  })

  it('resolves multiple conflicting fields independently while merging safe fields', () => {
    const original = source.data.character_book.entries[0]
    const incoming = edit({
      section: 'worldBook',
      operation: 'update',
      targetKey: '7',
      before: original,
      after: {
        ...original,
        comment: '用户名称',
        content: '用户正文',
        enabled: false,
      },
    })
    const newer = structuredClone(source)
    newer.data.character_book.entries[0]!.comment = '作者名称'
    newer.data.character_book.entries[0]!.content = '作者正文'
    newer.data.character_book.entries[0]!.insertion_order = 42

    const preview = migrateCharacterCardContentEdits(newer, [], [incoming])
    const resolved = migrateCharacterCardContentEdits(newer, [], [incoming], {
      [`${incoming.id}::comment`]: { choice: 'keep-current' },
      [`${incoming.id}::content`]: { choice: 'manual', value: '手动合并正文' },
    })
    const entry = cardData(resolved.card).character_book.entries[0]

    expect(preview.fieldConflicts.map((item) => item.field).sort()).toEqual(['comment', 'content'])
    expect(entry).toMatchObject({
      comment: '作者名称',
      content: '手动合并正文',
      enabled: false,
      insertion_order: 42,
    })
  })

  it('provides the same field conflict choices for TavernHelper script content', () => {
    const original = source.data.extensions.tavern_helper.scripts[0]!.scripts![0]!.value!
    const newer = structuredClone(source)
    newer.data.extensions.tavern_helper.scripts[0]!.scripts![0]!.value!.content = 'return 3'
    const incoming = edit({
      section: 'helperScript',
      operation: 'update',
      targetKey: 'script-1',
      before: original,
      after: { ...original, content: 'return 2' },
    })

    const preview = migrateCharacterCardContentEdits(newer, [], [incoming])
    const resolved = migrateCharacterCardContentEdits(newer, [], [incoming], {
      [`${incoming.id}::content`]: { choice: 'use-incoming' },
    })

    expect(preview.fieldConflicts[0]).toMatchObject({
      field: 'content',
      currentValue: 'return 3',
      incomingValue: 'return 2',
    })
    expect(
      cardData(resolved.card).extensions.tavern_helper.scripts[0]!.scripts![0]!.value!.content,
    ).toBe('return 2')
  })

  it('allows an explicit user deletion when the author edited a TavernHelper script', () => {
    const original = source.data.extensions.tavern_helper.scripts[0]!.scripts![0]!.value!
    const newer = structuredClone(source)
    newer.data.extensions.tavern_helper.scripts[0]!.scripts![0]!.value!.content = 'return 3'
    const incoming = edit({
      section: 'helperScript',
      operation: 'delete',
      targetKey: 'script-1',
      before: original,
    })

    const preview = migrateCharacterCardContentEdits(newer, [], [incoming])
    const resolved = migrateCharacterCardContentEdits(newer, [], [incoming], {
      [`${incoming.id}::__entry__`]: { choice: 'use-incoming' },
    })

    expect(preview.fieldConflicts[0]).toMatchObject({
      field: '__entry__',
      currentValue: { ...original, content: 'return 3' },
      incomingValue: undefined,
    })
    expect(cardData(resolved.card).extensions.tavern_helper.scripts[0]!.scripts).toEqual([])
    expect(resolved.edits[0]?.before).toEqual({ ...original, content: 'return 3' })
  })

  it('uses the shared field-level resolver for regex rule conflicts', () => {
    const original = source.data.extensions.regex_scripts[0]
    const newer = structuredClone(source)
    newer.data.extensions.regex_scripts[0]!.replaceString = '作者新替换'
    const incoming = edit({
      section: 'regex',
      operation: 'update',
      targetKey: 'regex-1',
      before: original,
      after: { ...original, replaceString: '用户替换' },
    })

    const preview = migrateCharacterCardContentEdits(newer, [], [incoming])
    const resolved = migrateCharacterCardContentEdits(newer, [], [incoming], {
      [`${incoming.id}::replaceString`]: { choice: 'use-incoming' },
    })

    expect(preview.fieldConflicts[0]).toMatchObject({
      field: 'replaceString',
      currentValue: '作者新替换',
      incomingValue: '用户替换',
    })
    expect(cardData(resolved.card).extensions.regex_scripts[0]!.replaceString).toBe('用户替换')
  })

  it('refuses to migrate a TavernHelper script when duplicate ids make its location ambiguous', () => {
    const newer = structuredClone(source)
    newer.data.extensions.tavern_helper.scripts.push({
      type: 'script',
      value: { id: 'script-1', name: '重复脚本', content: 'return 9', enabled: true },
    })
    const original = source.data.extensions.tavern_helper.scripts[0]!.scripts![0]!.value!
    const incoming = edit({
      section: 'helperScript',
      operation: 'update',
      targetKey: 'script-1',
      before: original,
      after: { ...original, content: 'return 2' },
    })

    const migrated = migrateCharacterCardContentEdits(newer, [], [incoming])

    expect(migrated.conflicts).toEqual([incoming])
    expect(
      cardData(migrated.card).extensions.tavern_helper.scripts[0]!.scripts![0]!.value!,
    ).toEqual(original)
    expect(cardData(migrated.card).extensions.tavern_helper.scripts[1]!.value!.content).toBe(
      'return 9',
    )
  })

  it('shows an edited alternate greeting as a slot conflict and lets the user merge it', () => {
    const newer = structuredClone(source)
    newer.data.alternate_greetings = ['作者更新的备用开场白', '其他开场白']
    const incoming = edit({
      section: 'greeting',
      operation: 'update',
      targetKey: 'alternate:0',
      before: '备用一',
      after: '用户改写的备用开场白',
    })

    const preview = migrateCharacterCardContentEdits(newer, [], [incoming])
    const resolved = migrateCharacterCardContentEdits(newer, [], [incoming], {
      [`${incoming.id}::alternate_greeting`]: {
        choice: 'manual',
        value: '合并后的备用开场白',
      },
    })

    expect(preview.fieldConflicts[0]).toMatchObject({
      field: 'alternate_greeting',
      baseValue: '备用一',
      currentValue: '作者更新的备用开场白',
      incomingValue: '用户改写的备用开场白',
    })
    expect(cardData(preview.card).alternate_greetings[0]).toBe('作者更新的备用开场白')
    expect(cardData(resolved.card).alternate_greetings[0]).toBe('合并后的备用开场白')
    expect(resolved.edits[0]?.before).toBe('作者更新的备用开场白')
    expect(resolved.edits[0]?.after).toBe('合并后的备用开场白')
  })
})
