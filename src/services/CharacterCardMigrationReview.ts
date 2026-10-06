import { readonly, shallowRef } from 'vue'

import type {
  CharacterCardMigrationFieldChoice,
  CharacterCardMigrationFieldChoices,
  CharacterCardMigrationFieldConflict,
} from '../utils/CharacterCardContentEdits'
import { migrateCharacterCardContentEdits } from '../utils/CharacterCardContentEdits'
import type { CharacterCardContentEdit } from '../types/CharacterCardContentEdit'

export interface CharacterCardMigrationReviewItem extends CharacterCardMigrationFieldConflict {
  sectionLabel: string
  fieldLabel: string
  manualAllowed: boolean
}

export interface CharacterCardMigrationReviewSelection {
  key: string
  choice: CharacterCardMigrationFieldChoice
}

const SECTION_LABELS: Record<CharacterCardMigrationFieldConflict['edit']['section'], string> = {
  greeting: '开场白',
  worldBook: '世界书',
  regex: '正则',
  helperScript: '酒馆助手脚本',
}

const FIELD_LABELS: Record<string, string> = {
  __entry__: '整条目',
  first_mes: '主开场白',
  alternate_greeting: '备用开场白',
  alternate_greetings: '备用开场白',
  comment: '条目名称',
  content: '条目内容',
  keys: '触发词',
  secondary_keys: '次级触发词',
  enabled: '启用状态',
  insertion_order: '插入顺序',
  findRegex: '查找正则',
  replaceString: '替换内容',
  scriptName: '正则名称',
  name: '名称',
  description: '说明',
  script: '脚本代码',
}

export function presentMigrationFieldConflicts(
  items: CharacterCardMigrationFieldConflict[],
): CharacterCardMigrationReviewItem[] {
  return items.map((item) => ({
    ...item,
    sectionLabel: SECTION_LABELS[item.edit.section],
    fieldLabel: FIELD_LABELS[item.field] ?? item.field,
    manualAllowed:
      item.edit.operation !== 'delete' &&
      (typeof item.currentValue === 'string' || typeof item.incomingValue === 'string'),
  }))
}

export async function migrateCharacterCardContentWithReview(
  targetCard: Record<string, unknown>,
  targetEdits: CharacterCardContentEdit[],
  incomingEdits: CharacterCardContentEdit[],
) {
  const preview = migrateCharacterCardContentEdits(targetCard, targetEdits, incomingEdits)
  if (!preview.fieldConflicts.length) return preview
  const choices = await reviewCharacterCardMigrationConflicts(
    presentMigrationFieldConflicts(preview.fieldConflicts),
  )
  return choices
    ? migrateCharacterCardContentEdits(targetCard, targetEdits, incomingEdits, choices)
    : undefined
}

interface PendingReview {
  items: CharacterCardMigrationReviewItem[]
  resolve: (selections: CharacterCardMigrationReviewSelection[] | undefined) => void
}

const activeReview = shallowRef<PendingReview['items']>()
const activeSelection = shallowRef<{ edits: CharacterCardContentEdit[]; target: string }>()
let selectionResolve: ((value: CharacterCardContentEdit[] | undefined) => void) | undefined
const queue: PendingReview[] = []
let activeResolve: PendingReview['resolve'] | undefined

function present(next: PendingReview): void {
  activeReview.value = next.items
  activeResolve = next.resolve
}

export function reviewCharacterCardMigrationConflicts(
  items: CharacterCardMigrationReviewItem[],
): Promise<CharacterCardMigrationFieldChoices | undefined> {
  if (!items.length) return Promise.resolve({})
  return new Promise((resolve) => {
    const pending: PendingReview = {
      items,
      resolve: (selections) => {
        if (!selections) {
          resolve(undefined)
          return
        }
        resolve(Object.fromEntries(selections.map(({ key, choice }) => [key, choice])))
      },
    }
    if (activeReview.value || activeSelection.value) queue.push(pending)
    else present(pending)
  })
}

export function useCharacterCardMigrationReviewState() {
  return {
    activeReview: readonly(activeReview),
    activeSelection: readonly(activeSelection),
    select(ids: string[] | undefined): void {
      const resolve = selectionResolve
      const edits = activeSelection.value?.edits ?? []
      selectionResolve = undefined
      activeSelection.value = undefined
      resolve?.(ids ? edits.filter((edit) => ids.includes(edit.id)) : undefined)
      const next = queue.shift()
      if (next) present(next)
    },
    respond(selections: CharacterCardMigrationReviewSelection[] | undefined): void {
      const resolve = activeResolve
      activeResolve = undefined
      activeReview.value = undefined
      resolve?.(selections)
      const next = queue.shift()
      if (next) present(next)
    },
  }
}

/** One checklist replaces N sequential confirmation dialogs; conflicts follow separately. */
export function selectCharacterCardMigrationEdits(
  edits: CharacterCardContentEdit[],
  target: string,
): Promise<CharacterCardContentEdit[] | undefined> {
  if (!edits.length) return Promise.resolve([])
  if (activeSelection.value || activeReview.value) return Promise.resolve(undefined)
  return new Promise((resolve) => {
    selectionResolve = resolve
    activeSelection.value = { edits, target }
  })
}
