import type { CharacterCardContentEdit } from '../types/CharacterCardContentEdit'
import { isRecord } from './UnknownValue'

export interface AppliedCharacterCardEdit {
  card: Record<string, unknown>
  status: 'applied' | 'already-present' | 'conflict'
  reason?: string
  rebasedEdit?: CharacterCardContentEdit
  fieldConflicts?: CharacterCardMigrationFieldConflict[]
}

export interface CharacterCardContentMigration {
  card: Record<string, unknown>
  edits: CharacterCardContentEdit[]
  conflicts: CharacterCardContentEdit[]
  alreadyPresent: CharacterCardContentEdit[]
  fieldConflicts: CharacterCardMigrationFieldConflict[]
}

export interface CharacterCardMigrationFieldConflict {
  key: string
  edit: CharacterCardContentEdit
  field: string
  baseValue: unknown
  currentValue: unknown
  incomingValue: unknown
}

export type CharacterCardMigrationFieldChoice =
  { choice: 'keep-current' } | { choice: 'use-incoming' } | { choice: 'manual'; value: string }

export type CharacterCardMigrationFieldChoices = Record<string, CharacterCardMigrationFieldChoice>

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

export function stableCharacterContentJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableCharacterContentJson).join(',')}]`
  if (isRecord(value)) {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableCharacterContentJson(item)}`)
      .join(',')}}`
  }
  return JSON.stringify(value) ?? 'undefined'
}

function keyList(value: unknown): string[] | undefined {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string')
  if (typeof value === 'string')
    return value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
  return undefined
}

export function characterBookPosition(entry: Record<string, unknown>): number {
  const extensions = isRecord(entry.extensions) ? entry.extensions : {}
  if (typeof extensions.position === 'number') return extensions.position
  if (typeof entry.position === 'number') return entry.position
  const positions: Record<string, number> = {
    before_char: 0,
    after_char: 1,
    at_depth: 4,
    before_example: 5,
    after_example: 6,
  }
  return positions[String(entry.position ?? 'before_char')] ?? 0
}

/** Map standalone SillyTavern World Info fields to the embedded Character Card V2 shape. */
export function normalizeImportedCharacterBookEntry(
  source: Record<string, unknown>,
  fallbackUid: number,
): Record<string, unknown> {
  const entry = clone(source)
  if (!Array.isArray(entry.keys)) entry.keys = keyList(entry.key) ?? []
  if (!Array.isArray(entry.secondary_keys)) entry.secondary_keys = keyList(entry.keysecondary) ?? []
  if (typeof entry.enabled !== 'boolean')
    entry.enabled = typeof entry.disable === 'boolean' ? !entry.disable : true
  const insertionOrder = Number(entry.insertion_order)
  if (Number.isFinite(insertionOrder)) {
    entry.insertion_order = insertionOrder
  } else {
    const order = Number(entry.order)
    entry.insertion_order = Number.isFinite(order) ? order : 0
  }
  if (!Number.isSafeInteger(entry.uid)) entry.uid = fallbackUid
  if (!isRecord(entry.extensions)) entry.extensions = {}
  const extensions = entry.extensions as Record<string, unknown>
  // SillyTavern reads advanced embedded settings from extensions, not WI root fields.
  const wiFields: Record<string, string> = {
    depth: 'depth',
    role: 'role',
    probability: 'probability',
    useProbability: 'useProbability',
    selectiveLogic: 'selectiveLogic',
    scanDepth: 'scan_depth',
    caseSensitive: 'case_sensitive',
    matchWholeWords: 'match_whole_words',
    excludeRecursion: 'exclude_recursion',
    preventRecursion: 'prevent_recursion',
    delayUntilRecursion: 'delay_until_recursion',
    group: 'group',
    groupOverride: 'group_override',
    groupWeight: 'group_weight',
    sticky: 'sticky',
    cooldown: 'cooldown',
    delay: 'delay',
    vectorized: 'vectorized',
    outletName: 'outlet_name',
  }
  for (const [sourceField, targetField] of Object.entries(wiFields)) {
    if (entry[sourceField] !== undefined && extensions[targetField] === undefined)
      extensions[targetField] = clone(entry[sourceField])
  }
  if (entry.position !== undefined || extensions.position !== undefined) {
    const position = characterBookPosition(entry)
    extensions.position = position
    entry.position = position === 0 ? 'before_char' : 'after_char'
  }
  if (typeof entry.comment !== 'string')
    entry.comment = typeof entry.name === 'string' ? entry.name : ''
  delete entry.key
  delete entry.keysecondary
  delete entry.disable
  delete entry.order
  return entry
}

/** Imported items are new entries: reserve both identity aliases before assigning one. */
export function allocateCharacterBookIdentity(
  entry: Record<string, unknown>,
  used: Set<string>,
): Record<string, unknown> {
  const candidate = entry.uid ?? entry.id
  let id =
    typeof candidate === 'number' && Number.isSafeInteger(candidate) && candidate >= 0
      ? candidate
      : 0
  while (used.has(String(id))) id++
  used.add(String(id))
  return { ...entry, uid: id, id }
}

export function readCharacterCardContentEdits(value: unknown): CharacterCardContentEdit[] {
  if (!Array.isArray(value)) return []
  const sections = new Set(['greeting', 'worldBook', 'regex', 'helperScript'])
  const operations = new Set(['add', 'update', 'delete'])
  return value.flatMap((item): CharacterCardContentEdit[] => {
    if (
      !isRecord(item) ||
      typeof item.id !== 'string' ||
      !sections.has(String(item.section)) ||
      !operations.has(String(item.operation)) ||
      typeof item.targetKey !== 'string' ||
      typeof item.label !== 'string' ||
      typeof item.migrateToVersions !== 'boolean' ||
      typeof item.updatedAt !== 'number'
    )
      return []
    return [item as unknown as CharacterCardContentEdit]
  })
}

function sameJson(left: unknown, right: unknown): boolean {
  return stableCharacterContentJson(left) === stableCharacterContentJson(right)
}

function cardData(card: Record<string, unknown>): Record<string, unknown> {
  return isRecord(card.data) ? card.data : card
}

function targetByIdOrBefore(
  values: unknown[],
  key: string,
  before: unknown,
  identityFields: string[],
): number {
  const idMatches = values.flatMap((value, index) =>
    isRecord(value) && identityFields.some((field) => String(value[field] ?? '') === key)
      ? [index]
      : [],
  )
  if (idMatches.length === 1) return idMatches[0]!
  if (idMatches.length > 1) return -1
  const exact = values.flatMap((value, index) => (sameJson(value, before) ? [index] : []))
  return exact.length === 1 ? exact[0]! : -1
}

function countIdentityMatches(values: unknown[], key: string, identityFields: string[]): number {
  return values.filter(
    (value) =>
      isRecord(value) && identityFields.some((field) => String(value[field] ?? '') === key),
  ).length
}

function mergeUpdatedObject(
  current: unknown,
  before: unknown,
  after: unknown,
  identityFields: string[],
  edit: CharacterCardContentEdit,
  choices: CharacterCardMigrationFieldChoices = {},
):
  | { merged: Record<string, unknown>; conflicts: CharacterCardMigrationFieldConflict[] }
  | undefined {
  if (!isRecord(current) || !isRecord(before) || !isRecord(after)) return undefined
  const merged = clone(current)
  const conflicts: CharacterCardMigrationFieldConflict[] = []
  const fields = new Set([...Object.keys(before), ...Object.keys(after)])
  for (const field of fields) {
    const wasPresent = Object.hasOwn(before, field)
    const isPresent = Object.hasOwn(after, field)
    const changed = wasPresent !== isPresent || !sameJson(before[field], after[field])
    if (!changed) continue
    if (identityFields.includes(field)) return undefined
    const currentHas = Object.hasOwn(current, field)
    const stillAtBase = currentHas === wasPresent && sameJson(current[field], before[field])
    const alreadyApplied = currentHas === isPresent && sameJson(current[field], after[field])
    if (!stillAtBase && !alreadyApplied) {
      const key = `${edit.id}::${field}`
      const choice = choices[key]
      if (!choice)
        conflicts.push({
          key,
          edit,
          field,
          baseValue: wasPresent ? before[field] : undefined,
          currentValue: currentHas ? current[field] : undefined,
          incomingValue: isPresent ? after[field] : undefined,
        })
      if (choice?.choice === 'use-incoming') {
        if (isPresent) merged[field] = clone(after[field])
        else delete merged[field]
      } else if (choice?.choice === 'manual') {
        merged[field] = choice.value
      }
      continue
    }
    if (isPresent) merged[field] = clone(after[field])
    else delete merged[field]
  }
  return { merged, conflicts }
}

function editGreeting(
  data: Record<string, unknown>,
  edit: CharacterCardContentEdit,
  rebase: boolean,
  choices: CharacterCardMigrationFieldChoices = {},
): AppliedCharacterCardEdit {
  const alternates = Array.isArray(data.alternate_greetings)
    ? data.alternate_greetings.filter((value): value is string => typeof value === 'string')
    : []
  const isPrimary = edit.targetKey === 'primary'
  if (isPrimary) {
    const current = typeof data.first_mes === 'string' ? data.first_mes : ''
    if (edit.operation === 'add')
      return { card: {}, status: 'conflict', reason: '主开场白不支持重复添加' }
    if (current !== edit.before) {
      if (
        (edit.operation !== 'delete' && current === edit.after) ||
        (edit.operation === 'delete' && current === '')
      )
        return { card: {}, status: 'already-present' }
      const key = `${edit.id}::first_mes`
      const choice = choices[key]
      if (rebase && choice) {
        if (choice.choice === 'keep-current') return { card: {}, status: 'already-present' }
        const next =
          choice.choice === 'manual'
            ? choice.value
            : edit.operation === 'delete'
              ? ''
              : String(edit.after ?? '')
        data.first_mes = next
        return {
          card: {},
          status: 'applied',
          rebasedEdit: {
            ...edit,
            before: current,
            ...(edit.operation === 'delete' ? { after: undefined } : { after: next }),
          },
        }
      }
      if (rebase)
        return {
          card: {},
          status: 'already-present',
          fieldConflicts: [
            {
              key,
              edit,
              field: 'first_mes',
              baseValue: edit.before,
              currentValue: current,
              incomingValue: edit.operation === 'delete' ? undefined : edit.after,
            },
          ],
        }
      return { card: {}, status: 'conflict', reason: '新版本的主开场白与记录基准不同' }
    }
    data.first_mes = edit.operation === 'delete' ? '' : String(edit.after ?? '')
    return {
      card: {},
      status: 'applied',
      ...(rebase
        ? {
            rebasedEdit: {
              ...edit,
              before: current,
              after: edit.operation === 'delete' ? undefined : String(edit.after ?? ''),
            },
          }
        : {}),
    }
  }

  if (edit.operation === 'add') {
    const text = typeof edit.after === 'string' ? edit.after : ''
    if (!text.trim()) return { card: {}, status: 'conflict', reason: '备用开场白不能为空' }
    if (alternates.includes(text)) return { card: {}, status: 'already-present' }
    alternates.push(text)
    data.alternate_greetings = alternates
    return { card: {}, status: 'applied' }
  }

  const requested = Number(edit.targetKey.replace(/^alternate:/u, ''))
  let index = Number.isInteger(requested) && alternates[requested] === edit.before ? requested : -1
  if (index < 0) {
    const candidates = alternates.flatMap((value, candidate) =>
      value === edit.before ? [candidate] : [],
    )
    if (candidates.length === 1) index = candidates[0]!
  }
  if (index < 0) {
    if (edit.operation === 'update' && alternates.includes(String(edit.after ?? '')))
      return { card: {}, status: 'already-present' }
    const requested = Number(edit.targetKey.replace(/^alternate:/u, ''))
    const requestedIsValid = Number.isInteger(requested) && requested >= 0
    if (edit.operation === 'delete' && !alternates.includes(String(edit.before ?? '')))
      return { card: {}, status: 'already-present' }
    if (
      rebase &&
      edit.operation === 'update' &&
      requestedIsValid &&
      requested < alternates.length &&
      !alternates.includes(String(edit.before ?? ''))
    ) {
      const key = `${edit.id}::alternate_greeting`
      const choice = choices[key]
      const current = alternates[requested]!
      if (choice?.choice === 'keep-current') return { card: {}, status: 'already-present' }
      if (choice) {
        const next = choice.choice === 'manual' ? choice.value : String(edit.after ?? '')
        alternates[requested] = next
        data.alternate_greetings = alternates
        return {
          card: {},
          status: 'applied',
          rebasedEdit: {
            ...edit,
            targetKey: `alternate:${requested}`,
            before: current,
            after: next,
          },
        }
      }
      return {
        card: {},
        status: 'already-present',
        fieldConflicts: [
          {
            key,
            edit,
            field: 'alternate_greeting',
            baseValue: edit.before,
            currentValue: current,
            incomingValue: edit.after,
          },
        ],
      }
    }
    return { card: {}, status: 'conflict', reason: '找不到唯一匹配的备用开场白' }
  }
  const before = alternates[index]
  if (edit.operation === 'delete') alternates.splice(index, 1)
  else alternates[index] = String(edit.after ?? '')
  data.alternate_greetings = alternates
  return {
    card: {},
    status: 'applied',
    ...(rebase
      ? {
          rebasedEdit: {
            ...edit,
            targetKey: `alternate:${index}`,
            before,
            ...(edit.operation === 'delete' ? { after: undefined } : {}),
          },
        }
      : {}),
  }
}

interface ListLocation {
  values: unknown[]
  write: (values: unknown[]) => void
}

function worldBookEntries(data: Record<string, unknown>): ListLocation {
  const book = isRecord(data.character_book) ? data.character_book : undefined
  if (!book) {
    const created: Record<string, unknown> = { name: '角色内嵌世界书', entries: [] }
    data.character_book = created
    return { values: [], write: (values) => (created.entries = values) }
  }
  if (Array.isArray(book.entries))
    return { values: book.entries, write: (values) => (book.entries = values) }
  if (isRecord(book.entries)) {
    const original = book.entries
    const values = Object.values(original)
    return {
      values,
      write: (next) => {
        const entries: Record<string, unknown> = {}
        next.forEach((item, index) => {
          const baseKey = isRecord(item) ? String(item.uid ?? item.id ?? index) : String(index)
          let key = baseKey
          let suffix = 1
          while (Object.hasOwn(entries, key)) key = `${baseKey}:${suffix++}`
          entries[key] = item
        })
        book.entries = entries
      },
    }
  }
  return { values: [], write: (values) => (book.entries = values) }
}

function regexScripts(data: Record<string, unknown>): ListLocation {
  const extensions = isRecord(data.extensions)
    ? data.extensions
    : ((data.extensions = {}) as Record<string, unknown>)
  const values = Array.isArray(extensions.regex_scripts) ? extensions.regex_scripts : []
  return { values, write: (next) => (extensions.regex_scripts = next) }
}

function helperScriptList(data: Record<string, unknown>): ListLocation {
  const extensions = isRecord(data.extensions)
    ? data.extensions
    : ((data.extensions = {}) as Record<string, unknown>)
  const rawHelper = extensions.tavern_helper
  const helper = isRecord(rawHelper)
    ? rawHelper
    : Array.isArray(rawHelper)
      ? (Object.fromEntries(
          rawHelper.filter(
            (item): item is [string, unknown] =>
              Array.isArray(item) && item.length >= 2 && typeof item[0] === 'string',
          ),
        ) as Record<string, unknown>)
      : {}
  if (helper !== rawHelper) extensions.tavern_helper = helper
  const values = Array.isArray(helper.scripts) ? helper.scripts : []
  return { values, write: (next) => (helper.scripts = next) }
}

function existingHelperScriptLists(data: Record<string, unknown>): ListLocation[] {
  const lists: ListLocation[] = []
  const extensions = isRecord(data.extensions) ? data.extensions : undefined
  const helper = isRecord(extensions?.tavern_helper) ? extensions.tavern_helper : undefined
  if (Array.isArray(helper?.scripts))
    lists.push({ values: helper.scripts, write: (next) => (helper.scripts = next) })
  if (Array.isArray(extensions?.TavernHelper_scripts))
    lists.push({
      values: extensions.TavernHelper_scripts,
      write: (next) => (extensions.TavernHelper_scripts = next),
    })
  if (Array.isArray(data.scripts))
    lists.push({ values: data.scripts, write: (next) => (data.scripts = next) })
  const legacyScript = data.script
  if (isRecord(legacyScript) && Array.isArray(legacyScript.scripts))
    lists.push({
      values: legacyScript.scripts,
      write: (next) => (legacyScript.scripts = next),
    })
  return lists
}

function findHelperScript(
  trees: unknown[],
  key: string,
  before: unknown,
): { path: number[]; raw: Record<string, unknown>; wrapped: boolean }[] {
  const found: { path: number[]; raw: Record<string, unknown>; wrapped: boolean }[] = []
  const visit = (nodes: unknown[], prefix: number[] = []): void => {
    nodes.forEach((node, index) => {
      if (!isRecord(node)) return
      const currentPath = [...prefix, index]
      if (node.type === 'folder') {
        const children = Array.isArray(node.scripts) ? node.scripts : node.value
        if (Array.isArray(children)) visit(children, currentPath)
        return
      }
      const wrapped = node.type === 'script' && isRecord(node.value)
      const raw: Record<string, unknown> = wrapped && isRecord(node.value) ? node.value : node
      if (typeof raw.content !== 'string' && typeof raw.script !== 'string') return
      const matchesId = Boolean(key) && String(raw.id ?? '') === key
      const matchesContent =
        isRecord(before) &&
        typeof before.content === 'string' &&
        (raw.content === before.content || raw.script === before.content)
      if (matchesId || (before !== undefined && sameJson(raw, before)) || matchesContent)
        found.push({ path: currentPath, raw, wrapped })
    })
  }
  visit(trees)
  return found
}

function updateHelperTree(
  trees: unknown[],
  targetPath: number[],
  operation: 'update' | 'delete',
  after?: unknown,
): unknown[] {
  const [index, ...nested] = targetPath
  return trees.flatMap((node, currentIndex) => {
    if (currentIndex !== index) return [node]
    if (!nested.length) {
      if (operation === 'delete') return []
      if (!isRecord(node) || !isRecord(after)) return [node]
      return [
        node.type === 'script' && isRecord(node.value)
          ? { ...node, value: clone(after) }
          : clone(after),
      ]
    }
    if (!isRecord(node)) return [node]
    const childKey = Array.isArray(node.scripts) ? 'scripts' : 'value'
    if (!Array.isArray(node[childKey])) return [node]
    return [
      {
        ...node,
        [childKey]: updateHelperTree(node[childKey] as unknown[], nested, operation, after),
      },
    ]
  })
}

function editObjectList(
  edit: CharacterCardContentEdit,
  location: ListLocation,
  identityFields: string[],
  rebase: boolean,
  choices: CharacterCardMigrationFieldChoices = {},
): AppliedCharacterCardEdit {
  const values = location.values
  if (edit.operation === 'add') {
    if (!isRecord(edit.after)) return { card: {}, status: 'conflict', reason: '导入条目格式不正确' }
    const existing = values.filter(
      (item) =>
        isRecord(item) &&
        identityFields.some((field) => String(item[field] ?? '') === edit.targetKey),
    )
    if (existing.length > 1)
      return { card: {}, status: 'conflict', reason: '新版存在重复标识，不能安全添加此条目' }
    if (existing.length === 1)
      return sameJson(existing[0], edit.after)
        ? { card: {}, status: 'already-present' }
        : { card: {}, status: 'conflict', reason: '目标已有相同标识的条目' }
    location.write([...values, clone(edit.after)])
    return { card: {}, status: 'applied' }
  }
  const index = targetByIdOrBefore(values, edit.targetKey, edit.before, identityFields)
  if (index < 0) {
    const identityMatches = countIdentityMatches(values, edit.targetKey, identityFields)
    const exactMatches = values.filter((item) => sameJson(item, edit.before)).length
    if (edit.operation === 'delete' && identityMatches === 0 && exactMatches === 0)
      return { card: {}, status: 'already-present' }
    if (edit.operation === 'update' && values.some((item) => sameJson(item, edit.after)))
      return { card: {}, status: 'already-present' }
    return { card: {}, status: 'conflict', reason: '找不到唯一匹配的条目' }
  }
  const before = values[index]
  const next = [...values]
  if (edit.operation === 'delete') {
    if (!sameJson(before, edit.before)) {
      if (!rebase) return { card: {}, status: 'conflict', reason: '新版条目已变化，未删除新版内容' }
      const key = `${edit.id}::__entry__`
      const choice = choices[key]
      if (!choice)
        return {
          card: {},
          status: 'already-present',
          fieldConflicts: [
            {
              key,
              edit,
              field: '__entry__',
              baseValue: edit.before,
              currentValue: before,
              incomingValue: undefined,
            },
          ],
        }
      if (choice.choice === 'keep-current') return { card: {}, status: 'already-present' }
      next.splice(index, 1)
      location.write(next)
      return {
        card: {},
        status: 'applied',
        rebasedEdit: { ...edit, before: clone(before), after: undefined },
      }
    }
    next.splice(index, 1)
  } else {
    const result = mergeUpdatedObject(
      before,
      edit.before,
      edit.after,
      identityFields,
      edit,
      choices,
    )
    if (!result)
      return { card: {}, status: 'conflict', reason: '新版本修改了同一字段，未覆盖新版内容' }
    if (result.conflicts.length && !rebase)
      return {
        card: {},
        status: 'conflict',
        reason: '新版本修改了同一字段，未覆盖新版内容',
        fieldConflicts: result.conflicts,
      }
    if (sameJson(before, result.merged))
      return { card: {}, status: 'already-present', fieldConflicts: result.conflicts }
    next[index] = result.merged
    location.write(next)
    const rebased = rebase
      ? {
          rebasedEdit: {
            ...edit,
            targetKey: isRecord(before)
              ? String(identityFields.map((field) => before[field]).find(Boolean) ?? edit.targetKey)
              : edit.targetKey,
            before: clone(before),
            after: clone(result.merged),
          },
        }
      : {}
    return {
      card: {},
      status: 'applied',
      fieldConflicts: result.conflicts,
      ...rebased,
    }
  }
  location.write(next)
  const rebased = rebase
    ? {
        rebasedEdit: {
          ...edit,
          targetKey: isRecord(before)
            ? String(identityFields.map((field) => before[field]).find(Boolean) ?? edit.targetKey)
            : edit.targetKey,
          before: clone(before),
          ...(edit.operation === 'delete' ? { after: undefined } : { after: clone(next[index]) }),
        },
      }
    : {}
  return { card: {}, status: 'applied', ...rebased }
}

function editHelperScripts(
  data: Record<string, unknown>,
  edit: CharacterCardContentEdit,
  rebase: boolean,
  choices: CharacterCardMigrationFieldChoices = {},
): AppliedCharacterCardEdit {
  const location = helperScriptList(data)
  if (edit.operation === 'add') {
    if (!isRecord(edit.after)) return { card: {}, status: 'conflict', reason: '脚本格式不正确' }
    const content = String(edit.after.content ?? '')
    if (
      existingHelperScriptLists(data).some(
        (list) => findHelperScript(list.values, '', { content }).length,
      )
    )
      return { card: {}, status: 'already-present' }
    location.write([...location.values, { type: 'script', value: clone(edit.after) }])
    return { card: {}, status: 'applied' }
  }
  const matches = existingHelperScriptLists(data).flatMap((list) =>
    findHelperScript(list.values, edit.targetKey, edit.before).map((match) => ({ ...match, list })),
  )
  if (matches.length !== 1) {
    if (
      edit.operation === 'update' &&
      findHelperScript(location.values, '', edit.after).length === 1
    )
      return { card: {}, status: 'already-present' }
    return { card: {}, status: 'conflict', reason: '找不到唯一匹配的酒馆助手脚本' }
  }
  const target = matches[0]!
  if (edit.operation === 'delete' && !sameJson(target.raw, edit.before)) {
    if (!rebase) return { card: {}, status: 'conflict', reason: '新版脚本已变化，未删除新版内容' }
    const key = `${edit.id}::__entry__`
    const choice = choices[key]
    if (!choice)
      return {
        card: {},
        status: 'already-present',
        fieldConflicts: [
          {
            key,
            edit,
            field: '__entry__',
            baseValue: edit.before,
            currentValue: target.raw,
            incomingValue: undefined,
          },
        ],
      }
    if (choice.choice === 'keep-current') return { card: {}, status: 'already-present' }
    target.list.write(updateHelperTree(target.list.values, target.path, 'delete'))
    return {
      card: {},
      status: 'applied',
      rebasedEdit: { ...edit, before: clone(target.raw), after: undefined },
    }
  }
  const after =
    edit.operation === 'update'
      ? mergeUpdatedObject(target.raw, edit.before, edit.after, ['id'], edit, choices)
      : undefined
  if (edit.operation === 'update') {
    if (!after)
      return { card: {}, status: 'conflict', reason: '新版本修改了同一字段，未覆盖新版内容' }
    if (after.conflicts.length && !rebase)
      return {
        card: {},
        status: 'conflict',
        reason: '新版本修改了同一字段，未覆盖新版内容',
        fieldConflicts: after.conflicts,
      }
    if (sameJson(target.raw, after.merged))
      return { card: {}, status: 'already-present', fieldConflicts: after.conflicts }
  }
  target.list.write(
    updateHelperTree(target.list.values, target.path, edit.operation, after?.merged ?? edit.after),
  )
  return {
    card: {},
    status: 'applied',
    ...(after ? { fieldConflicts: after.conflicts } : {}),
    ...(rebase
      ? {
          rebasedEdit: {
            ...edit,
            before: clone(target.raw),
            ...(edit.operation === 'delete'
              ? { after: undefined }
              : { after: clone(after?.merged) }),
          },
        }
      : {}),
  }
}

/** Apply one recorded item to a source card; conflicts never overwrite a changed version. */
export function applyCharacterCardContentEdit(
  source: Record<string, unknown>,
  edit: CharacterCardContentEdit,
  options: { rebase?: boolean; fieldChoices?: CharacterCardMigrationFieldChoices } = {},
): AppliedCharacterCardEdit {
  // Each writer replaces arrays/entries rather than mutating them. Copy only owned
  // containers so applying many edits does not repeatedly serialize the whole card.
  const card = { ...source }
  const originalData = cardData(source)
  const nextData = { ...originalData }
  if (isRecord(source.data)) card.data = nextData
  else Object.assign(card, nextData)
  const writable = isRecord(source.data) ? nextData : card
  if (isRecord(originalData.character_book))
    writable.character_book = { ...originalData.character_book }
  if (isRecord(originalData.extensions)) {
    const extensions = { ...originalData.extensions }
    if (isRecord(extensions.tavern_helper))
      extensions.tavern_helper = { ...extensions.tavern_helper }
    writable.extensions = extensions
  }
  if (isRecord(originalData.script)) writable.script = { ...originalData.script }
  const data = cardData(card)
  let result: AppliedCharacterCardEdit
  switch (edit.section) {
    case 'greeting':
      result = editGreeting(data, edit, Boolean(options.rebase), options.fieldChoices)
      break
    case 'worldBook':
      result = editObjectList(
        edit,
        worldBookEntries(data),
        ['uid', 'id'],
        Boolean(options.rebase),
        options.fieldChoices,
      )
      break
    case 'regex':
      result = editObjectList(
        edit,
        regexScripts(data),
        ['id'],
        Boolean(options.rebase),
        options.fieldChoices,
      )
      break
    case 'helperScript':
      result = editHelperScripts(data, edit, Boolean(options.rebase), options.fieldChoices)
      break
    default:
      result = { card: {}, status: 'conflict', reason: '未知的角色卡修改类型' }
  }
  return { ...result, card: result.status === 'applied' ? card : source }
}

export function applyCharacterCardContentEdits(
  source: Record<string, unknown>,
  edits: CharacterCardContentEdit[],
): { card: Record<string, unknown>; conflicts: CharacterCardContentEdit[] } {
  return edits.reduce(
    (state, edit) => {
      const result = applyCharacterCardContentEdit(state.card, edit)
      if (result.status === 'conflict') state.conflicts.push(edit)
      else if (result.status === 'applied') state.card = result.card
      return state
    },
    { card: source, conflicts: [] as CharacterCardContentEdit[] },
  )
}

/** Apply selected edits onto a new card, refusing changed targets and rebasing successful diffs. */
export function migrateCharacterCardContentEdits(
  targetCard: Record<string, unknown>,
  targetEdits: CharacterCardContentEdit[],
  incomingEdits: CharacterCardContentEdit[],
  fieldChoices: CharacterCardMigrationFieldChoices = {},
): CharacterCardContentMigration {
  const base = applyCharacterCardContentEdits(targetCard, targetEdits)
  let card = base.card
  const edits = [...targetEdits]
  const conflicts = [...base.conflicts]
  const alreadyPresent: CharacterCardContentEdit[] = []
  const fieldConflicts: CharacterCardMigrationFieldConflict[] = []
  for (const edit of incomingEdits) {
    const result = applyCharacterCardContentEdit(card, edit, {
      rebase: true,
      fieldChoices,
    })
    fieldConflicts.push(...(result.fieldConflicts ?? []))
    if (result.status === 'conflict') conflicts.push(edit)
    else if (result.status === 'already-present') alreadyPresent.push(edit)
    else {
      card = result.card
      edits.push({ ...(result.rebasedEdit ?? edit), migrateToVersions: true })
    }
  }
  return { card, edits, conflicts, alreadyPresent, fieldConflicts }
}
