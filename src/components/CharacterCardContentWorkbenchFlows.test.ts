/** @vitest-environment jsdom */
import { mount, flushPromises } from '@vue/test-utils'
import { describe, it, expect, vi } from 'vitest'
import Workbench from './CharacterCardContentWorkbench.vue'
import { chooseAction, confirmAction } from '../composables/UseConfirmDialog'
import {
  applyCharacterCardContentEdits,
  migrateCharacterCardContentEdits,
} from '../utils/CharacterCardContentEdits'
import type { CharacterCardContentEdit } from '../types/CharacterCardContentEdit'
import { extractCharacterGreetingRegexRules } from '../utils/CharacterGreetingRegex'
vi.mock('../composables/UseConfirmDialog', () => ({
  chooseAction: vi.fn(),
  confirmAction: vi.fn(),
}))
function bookEntries(card: Record<string, unknown>) {
  return (card.data as { character_book: { entries: Record<string, unknown>[] } }).character_book
    .entries
}
function setup(card: Record<string, unknown> = { data: { character_book: { entries: [] } } }) {
  vi.clearAllMocks()
  vi.mocked(chooseAction).mockResolvedValue('confirm')
  vi.mocked(confirmAction).mockResolvedValue(true)
  return mount(Workbench, { props: { card, edits: [] } })
}
async function tab(w: ReturnType<typeof setup>, name: string) {
  await w
    .findAll('nav button')
    .find((b) => b.text().includes(name))!
    .trigger('click')
}
async function accept(w: ReturnType<typeof setup>) {
  await flushPromises()
  const edits = w.emitted('update:edits')!.at(-1)![0] as CharacterCardContentEdit[]
  await w.setProps({ edits })
  return edits
}
async function file(w: ReturnType<typeof setup>, data: unknown) {
  const input = w.get('input[type=file]')
  Object.defineProperty(input.element, 'files', {
    configurable: true,
    value: [{ name: 'test.json', text: async () => JSON.stringify(data) }],
  })
  await input.trigger('change')
  await flushPromises()
}
async function importAll(w: ReturnType<typeof setup>) {
  await w.get('.card-content-workbench__import-preview footer .is-primary').trigger('click')
  return accept(w)
}
async function editRow(w: ReturnType<typeof setup>, content: string) {
  await w.get('.card-content-workbench__list button').trigger('click')
  await w.get('textarea:not(.is-keys)').setValue(content)
  await w.get('.card-content-workbench__editor footer .is-primary').trigger('click')
  return accept(w)
}
describe('targeted card content audit', () => {
  it('allows cancelling exit or preserving pending input in the resource draft', async () => {
    const w = setup({ data: { character_book: { entries: [{ uid: 1, content: 'old' }] } } })
    try {
      await tab(w, '世界书')
      await w.get('.card-content-workbench__list button').trigger('click')
      await w.get('textarea:not(.is-keys)').setValue('未应用输入')
      vi.mocked(chooseAction).mockResolvedValueOnce('cancel')
      await w.get('[aria-label="退出编辑"]').trigger('click')
      await flushPromises()
      expect(w.emitted('back')).toBeUndefined()
      await w.get('[aria-label="退出编辑"]').trigger('click')
      const edits = await accept(w)
      expect(w.emitted('back')).toHaveLength(1)
      expect(
        bookEntries(applyCharacterCardContentEdits(w.props('card'), edits).card)[0]?.content,
      ).toBe('未应用输入')
    } finally {
      w.unmount()
    }
  })
  it('reports skipped duplicate greetings without retaining redundant edits', async () => {
    const w = setup({ data: { first_mes: '主开场', alternate_greetings: ['已有开场'] } })
    try {
      await file(w, { first_mes: '已有开场', alternate_greetings: ['新的开场'] })
      const edits = await importAll(w)
      expect(edits).toHaveLength(1)
      expect(w.get('[role=status]').text()).toContain('跳过 1 项已有内容')
      expect(
        (
          applyCharacterCardContentEdits(w.props('card'), edits).card.data as Record<
            string,
            unknown
          >
        ).alternate_greetings,
      ).toEqual(['已有开场', '新的开场'])
    } finally {
      w.unmount()
    }
  })
  it('refreshes an untouched editor after the underlying draft changes', async () => {
    const w = setup({ data: { character_book: { entries: [{ uid: 1, content: 'old' }] } } })
    try {
      await tab(w, '世界书')
      await w.get('.card-content-workbench__list button').trigger('click')
      await w.get('.card-content-workbench__actions .is-text').trigger('click')
      await w.setProps({
        edits: [
          {
            id: 'external',
            section: 'worldBook',
            operation: 'update',
            targetKey: '1',
            label: '条目',
            before: { uid: 1, content: 'old' },
            after: { uid: 1, content: 'new' },
            migrateToVersions: true,
            updatedAt: 1,
          },
        ],
      })
      await w.get('.card-content-workbench__list button').trigger('click')
      expect(w.get<HTMLTextAreaElement>('textarea:not(.is-keys)').element.value).toBe('new')
    } finally {
      w.unmount()
    }
  })
  it('includes pending editor text when the outer save prepares the draft', async () => {
    const w = setup()
    try {
      await tab(w, '世界书')
      await w.get('.card-content-workbench__actions .is-primary').trigger('click')
      await w.get('textarea:not(.is-keys)').setValue('未点应用的正文')
      expect(w.emitted('draft-change')!.at(-1)).toEqual([true])
      const ready = await (w.vm as unknown as { prepareSave: () => Promise<boolean> }).prepareSave()
      expect(ready).toBe(true)
      const edits = await accept(w)
      expect(
        bookEntries(applyCharacterCardContentEdits(w.props('card'), edits).card)[0],
      ).toMatchObject({ content: '未点应用的正文' })
      expect(chooseAction).not.toHaveBeenCalled()
    } finally {
      w.unmount()
    }
  })

  it('keeps an invalid pending entry open when the outer save is attempted', async () => {
    const w = setup()
    try {
      await tab(w, '世界书')
      await w.get('.card-content-workbench__actions .is-primary').trigger('click')
      await w.get('input[maxlength="120"]').setValue('还没写正文')
      await w.get('.card-content-workbench__actions .is-text').trigger('click')
      expect(await (w.vm as unknown as { prepareSave: () => Promise<boolean> }).prepareSave()).toBe(
        false,
      )
      expect(w.find('.card-content-workbench__editor').exists()).toBe(true)
      expect(w.text()).toContain('正文不能为空')
      expect(w.emitted('update:edits')).toBeUndefined()
    } finally {
      w.unmount()
    }
  })

  it('searches and pages large lists, and undoes one batch deletion', async () => {
    const card = {
      data: {
        character_book: {
          entries: Array.from({ length: 65 }, (_, uid) => ({
            uid,
            comment: `条目${uid}`,
            content: uid === 60 ? '搜索用正文' : '正文',
          })),
        },
      },
    }
    const w = setup(card)
    try {
      await tab(w, '世界书')
      expect(w.findAll('.card-content-workbench__list li')).toHaveLength(20)
      await w.get('input[aria-label="搜索卡内条目"]').setValue('搜索用正文')
      expect(w.findAll('.card-content-workbench__list li')).toHaveLength(1)
      expect(w.get('.card-content-workbench__list').text()).toContain('条目60')
      await w.get('.card-content-workbench__list input[type=checkbox]').setValue(true)
      await w.get('.card-content-workbench__selection .is-danger').trigger('click')
      const edits = await accept(w)
      expect(bookEntries(applyCharacterCardContentEdits(card, edits).card)).toHaveLength(64)
      await w.get('.card-content-workbench__notice button').trigger('click')
      const undone = await accept(w)
      expect(bookEntries(applyCharacterCardContentEdits(card, undone).card)).toHaveLength(65)
    } finally {
      w.unmount()
    }
  })

  it('preserves standalone world book depth, position and probability in embedded extensions', async () => {
    const w = setup()
    try {
      await tab(w, '世界书')
      await file(w, {
        entries: [
          { uid: 7, key: ['a,b'], content: '正文', position: 4, depth: 6, probability: 30 },
        ],
      })
      const edits = await importAll(w)
      expect(edits[0]?.after).toMatchObject({
        id: 7,
        uid: 7,
        keys: ['a,b'],
        position: 'after_char',
        extensions: { position: 4, depth: 6, probability: 30 },
      })
    } finally {
      w.unmount()
    }
  })
  it('preserves comma-bearing trigger words when only the entry body is edited', async () => {
    const card = {
      data: {
        character_book: {
          entries: [{ uid: 1, content: 'old', keys: ['New York, NY'], secondary_keys: ['/a,b/'] }],
        },
      },
    }
    const w = setup(card)
    try {
      await tab(w, '世界书')
      const edits = await editRow(w, 'new body')
      const result = applyCharacterCardContentEdits(card, edits)
      expect(bookEntries(result.card)[0]!.keys).toEqual(['New York, NY'])
      expect(bookEntries(result.card)[0]!.secondary_keys).toEqual(['/a,b/'])
    } finally {
      w.unmount()
    }
  })
  it('keeps existing V2 id entries editable after importing a book reusing those ids', async () => {
    const card = { data: { character_book: { entries: [{ id: 0, content: 'old', keys: [] }] } } }
    const w = setup(card)
    try {
      await tab(w, '世界书')
      await file(w, { entries: [{ id: 0, content: 'imported', keys: [] }] })
      await importAll(w)
      const edits = await editRow(w, 'updated old')
      const result = applyCharacterCardContentEdits(card, edits)
      expect(result.conflicts).toHaveLength(0)
      expect(bookEntries(result.card)[0]!.content).toBe('updated old')
    } finally {
      w.unmount()
    }
  })
  it('new enabled regex has a configured scope usable by the existing preview', async () => {
    const card = { data: { first_mes: 'hello' } }
    const w = setup(card)
    try {
      await tab(w, '正则')
      await w.get('.card-content-workbench__actions .is-primary').trigger('click')
      await w.get('.card-content-workbench__editor input[placeholder]').setValue('hello')
      await w.get('textarea:not(.is-keys)').setValue('world')
      await w.get('.card-content-workbench__editor footer .is-primary').trigger('click')
      const edits = await accept(w)
      const result = applyCharacterCardContentEdits(card, edits)
      expect(
        extractCharacterGreetingRegexRules(
          (result.card.data as { extensions: { regex_scripts: unknown[] } }).extensions
            .regex_scripts,
        ),
      ).toHaveLength(1)
    } finally {
      w.unmount()
    }
  })
  it('new entry edited twice retains the latest content', async () => {
    const card = { data: { character_book: { entries: [] } } }
    const w = setup(card)
    try {
      await tab(w, '世界书')
      await w.get('.card-content-workbench__actions .is-primary').trigger('click')
      await w.get('textarea:not(.is-keys)').setValue('first')
      await w.get('.card-content-workbench__editor footer .is-primary').trigger('click')
      await accept(w)
      await editRow(w, 'second')
      const edits = await editRow(w, 'third')
      const result = applyCharacterCardContentEdits(card, edits)
      expect(result.conflicts).toHaveLength(0)
      expect(bookEntries(result.card)[0]!.content).toBe('third')
      const migrated = migrateCharacterCardContentEdits(card, [], edits)
      expect(bookEntries(migrated.card)[0]!.content).toBe('third')
    } finally {
      w.unmount()
    }
  })
  it('allocates unique ids across imported entries and current entries', async () => {
    const card = { data: { character_book: { entries: [{ uid: 0, content: 'old' }] } } }
    const w = setup(card)
    try {
      await tab(w, '世界书')
      await file(w, {
        entries: [
          { uid: 3, content: 'a' },
          { uid: 0, content: 'b' },
        ],
      })
      const edits = await importAll(w)
      const result = applyCharacterCardContentEdits(card, edits)
      expect(result.conflicts).toHaveLength(0)
      expect(bookEntries(result.card)).toHaveLength(3)
    } finally {
      w.unmount()
    }
  })
  it('imports a standalone regex object', async () => {
    const w = setup()
    try {
      await tab(w, '正则')
      await file(w, {
        id: 'r1',
        scriptName: 'rule',
        findRegex: 'a',
        replaceString: 'b',
        placement: [2],
      })
      expect(w.find('.card-content-workbench__import-preview').exists()).toBe(true)
    } finally {
      w.unmount()
    }
  })
  it('keeps unfinished editor input when returning to the list and reopening', async () => {
    const w = setup({ data: { character_book: { entries: [{ uid: 1, content: 'old' }] } } })
    try {
      await tab(w, '世界书')
      await w.get('.card-content-workbench__list button').trigger('click')
      await w.get('textarea:not(.is-keys)').setValue('unfinished')
      await w.get('.card-content-workbench__actions .is-text').trigger('click')
      await w.get('.card-content-workbench__list button').trigger('click')
      expect(w.get<HTMLTextAreaElement>('textarea:not(.is-keys)').element.value).toBe('unfinished')
    } finally {
      w.unmount()
    }
  })
  it('does not turn pending world book imports into regex imports when switching tabs', async () => {
    const w = setup()
    try {
      await tab(w, '世界书')
      let resolve!: (value: string) => void
      const text = new Promise<string>((r) => {
        resolve = r
      })
      const input = w.get('input[type=file]')
      Object.defineProperty(input.element, 'files', {
        value: [{ name: 'book.json', text: () => text }],
      })
      await input.trigger('change')
      await tab(w, '正则')
      resolve(JSON.stringify({ entries: [{ uid: 1, content: 'world book' }] }))
      await flushPromises()
      expect(w.find('.card-content-workbench__error').exists()).toBe(false)
      expect(w.find('.card-content-workbench__import-preview').exists()).toBe(false)
    } finally {
      w.unmount()
    }
  })
})
