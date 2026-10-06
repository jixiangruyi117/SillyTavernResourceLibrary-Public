/** @vitest-environment jsdom */
import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import CharacterCardMigrationReview from './CharacterCardMigrationReview.vue'
import {
  migrateCharacterCardContentWithReview,
  presentMigrationFieldConflicts,
  reviewCharacterCardMigrationConflicts,
  selectCharacterCardMigrationEdits,
} from '../services/CharacterCardMigrationReview'

describe('CharacterCardMigrationReview', () => {
  it('selects many migration records in one searchable paged checklist', async () => {
    const wrapper = mount(CharacterCardMigrationReview, { global: { stubs: { Teleport: true } } })
    const edits = Array.from({ length: 45 }, (_, i) => ({
      id: String(i),
      section: 'worldBook' as const,
      operation: 'delete' as const,
      targetKey: String(i),
      label: `世界书${i}`,
      before: { uid: i, content: '旧正文' },
      migrateToVersions: true,
      updatedAt: 1,
    }))
    try {
      const pending = selectCharacterCardMigrationEdits(edits, '新版本')
      await flushPromises()
      expect(wrapper.findAll('.migration-review__selection-row')).toHaveLength(20)
      await wrapper.get('input[type=search]').setValue('世界书44')
      expect(wrapper.findAll('.migration-review__selection-row')).toHaveLength(1)
      await wrapper.get('.migration-review__selection-row input').setValue(false)
      await wrapper.get('.migration-review__apply').trigger('click')
      await expect(pending).resolves.toEqual(edits.slice(0, 44))
      expect(wrapper.find('[aria-label="选择迁移修改"]').exists()).toBe(false)
    } finally {
      wrapper.unmount()
    }
  })

  it('shows the three versions and returns a manual text merge', async () => {
    const wrapper = mount(CharacterCardMigrationReview, {
      attachTo: document.body,
      global: { stubs: { Teleport: true } },
    })
    const edit = {
      id: 'edit-1',
      section: 'worldBook' as const,
      operation: 'update' as const,
      targetKey: '7',
      label: '世界书 · 城镇',
      before: {
        uid: 7,
        comment: '城镇',
        content: '旧正文',
        enabled: true,
      },
      after: {
        uid: 7,
        comment: '城镇',
        content: '我的正文',
        enabled: false,
      },
      migrateToVersions: true,
      updatedAt: 1,
    }
    const targetCard = {
      data: {
        character_book: {
          entries: [{ uid: 7, comment: '城镇', content: '作者的新正文', enabled: true }],
        },
      },
    }
    const pending = migrateCharacterCardContentWithReview(targetCard, [], [edit])
    await flushPromises()

    expect(wrapper.text()).toContain('旧正文')
    expect(wrapper.text()).toContain('作者的新正文')
    expect(wrapper.text()).toContain('我的正文')

    await wrapper.get('select').setValue('manual')
    await wrapper.get('textarea').setValue('作者补充，并保留我的修改')
    await wrapper.get('.migration-review__apply').trigger('click')

    await expect(pending).resolves.toMatchObject({
      card: {
        data: {
          character_book: {
            entries: [
              {
                content: '作者补充，并保留我的修改',
                enabled: false,
              },
            ],
          },
        },
      },
      edits: [
        {
          before: { content: '作者的新正文', enabled: true, comment: '城镇', uid: 7 },
          after: { content: '作者补充，并保留我的修改', enabled: false, comment: '城镇', uid: 7 },
        },
      ],
    })
    wrapper.unmount()
  })

  it('offers a delete decision, but no manual text field, for a changed entry deletion', async () => {
    const wrapper = mount(CharacterCardMigrationReview, {
      attachTo: document.body,
      global: { stubs: { Teleport: true } },
    })
    const pending = reviewCharacterCardMigrationConflicts(
      presentMigrationFieldConflicts([
        {
          key: 'delete-1::__entry__',
          edit: {
            id: 'delete-1',
            section: 'worldBook',
            operation: 'delete',
            targetKey: '7',
            label: '世界书 · 城镇',
            before: { uid: 7, content: '原内容' },
            migrateToVersions: true,
            updatedAt: 1,
          },
          field: '__entry__',
          baseValue: { uid: 7, content: '原内容' },
          currentValue: { uid: 7, content: '作者的新内容' },
          incomingValue: undefined,
        },
      ]),
    )
    await flushPromises()

    expect(wrapper.text()).toContain('删除整个条目')
    expect(wrapper.find('option[value="use-incoming"]').text()).toBe('删除此条目')
    expect(wrapper.find('option[value="manual"]').exists()).toBe(false)

    await wrapper.get('select').setValue('use-incoming')
    await wrapper.get('.migration-review__apply').trigger('click')
    await expect(pending).resolves.toEqual({ 'delete-1::__entry__': { choice: 'use-incoming' } })
    wrapper.unmount()
  })
})
