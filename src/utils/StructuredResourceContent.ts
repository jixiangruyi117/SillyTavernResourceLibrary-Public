import { RESOURCE_TYPE, type ResourceType } from '../types/Resource'
import type { CharacterCardContentEdit } from '../types/CharacterCardContentEdit'
import {
  applyCharacterCardContentEdits,
  normalizeImportedCharacterBookEntry,
  stableCharacterContentJson,
} from './CharacterCardContentEdits'
import { clone } from './CharacterCardContentRows'
import { isRecord } from './UnknownValue'

type Entry = {
  key: string
  group: string
  source: Record<string, unknown>
  normalized: Record<string, unknown>
}
const groups = ['global', 'scoped', 'preset'] as const
const equal = (a: unknown, b: unknown) =>
  stableCharacterContentJson(a) === stableCharacterContentJson(b)

/** In-memory adapter for the existing entry editor. Never persists synthetic card identities. */
export function createStructuredContentDraft(raw: unknown, type: ResourceType) {
  const section = type === RESOURCE_TYPE.WORLD_BOOK ? 'worldBook' : 'regex'
  if (type !== RESOURCE_TYPE.WORLD_BOOK && type !== RESOURCE_TYPE.REGEX)
    throw new Error('此资源类型没有条目编辑入口。')
  const entries: Entry[] = []
  let shape: 'world-array' | 'world-record' | 'regex-array' | 'regex-single' | 'regex-groups'
  const append = (source: unknown, key: string, group = '') => {
    if (!isRecord(source)) throw new Error('文件含有无法编辑的条目，请下载原文件检查。')
    const normalized =
      section === 'worldBook'
        ? normalizeImportedCharacterBookEntry(source, entries.length)
        : normalizeRegex(source)
    // Source ids may be missing or duplicate across scopes; editor identities are local only.
    if (section === 'worldBook') normalized.uid = normalized.id = entries.length
    else normalized.id = `structured:${entries.length}`
    if (group)
      normalized.scope = (
        { global: '全局', scoped: '角色', preset: '预设' } as Record<string, string>
      )[group]
    entries.push({ key, group, source: clone(source), normalized })
  }
  if (section === 'worldBook') {
    if (!isRecord(raw)) throw new Error('世界书必须是 JSON 对象。')
    if (Array.isArray(raw.entries)) {
      shape = 'world-array'
      raw.entries.forEach((value, index) => append(value, String(index)))
    } else if (isRecord(raw.entries)) {
      shape = 'world-record'
      Object.entries(raw.entries).forEach(([key, value]) => append(value, key))
    } else throw new Error('文件没有可编辑的世界书条目。')
  } else if (Array.isArray(raw)) {
    shape = 'regex-array'
    raw.forEach((value, index) => append(value, String(index)))
  } else if (
    isRecord(raw) &&
    (typeof raw.findRegex === 'string' || typeof raw.find_regex === 'string')
  ) {
    shape = 'regex-single'
    append(raw, '0')
  } else if (isRecord(raw) && groups.every((group) => Array.isArray(raw[group]))) {
    shape = 'regex-groups'
    groups.forEach((group) =>
      (raw[group] as unknown[]).forEach((value, index) => append(value, String(index), group)),
    )
  } else throw new Error('文件没有可编辑的正则规则。')

  const values = entries.map((entry) => entry.normalized)
  const byIdentity = new Map(
    entries.map((entry) => [
      String(section === 'worldBook' ? entry.normalized.uid : entry.normalized.id),
      entry,
    ]),
  )
  const card: Record<string, unknown> =
    section === 'worldBook'
      ? { data: { character_book: { entries: values } } }
      : { data: { extensions: { regex_scripts: values } } }
  return {
    card,
    section: section as 'worldBook' | 'regex',
    grouped: shape === 'regex-groups',
    build(edits: CharacterCardContentEdit[], newRegexGroup = 'global'): unknown {
      if (edits.some((edit) => edit.section !== section))
        throw new Error('修改内容与资源类型不一致。')
      const applied = applyCharacterCardContentEdits(card, edits)
      if (applied.conflicts.length) throw new Error('条目修改有冲突，请返回编辑检查。')
      const data = applied.card.data as Record<string, unknown>
      const changed =
        section === 'worldBook'
          ? ((data.character_book as Record<string, unknown>).entries as Record<string, unknown>[])
          : ((data.extensions as Record<string, unknown>).regex_scripts as Record<
              string,
              unknown
            >[])
      const usedUids = new Set(
        entries.map((entry) => String(entry.source.uid ?? entry.source.id ?? entry.key)),
      )
      const usedKeys = new Set(entries.map((entry) => entry.key))
      const result = changed.map((value) => {
        const old = byIdentity.get(String(section === 'worldBook' ? value.uid : value.id))
        if (old) return { key: old.key, group: old.group, value: patchEntry(old, value, section) }
        if (section === 'regex') return { key: '', group: newRegexGroup, value: clone(value) }
        let uid = 0
        while (usedUids.has(String(uid)) || usedKeys.has(String(uid))) uid++
        usedUids.add(String(uid))
        usedKeys.add(String(uid))
        return { key: String(uid), group: '', value: toNativeWorldEntry(value, uid) }
      })
      if (shape === 'world-array' || shape === 'world-record')
        return {
          ...(raw as Record<string, unknown>),
          entries:
            shape === 'world-array'
              ? result.map((entry) => entry.value)
              : Object.fromEntries(result.map((entry) => [entry.key, entry.value])),
        }
      if (!result.length) throw new Error('请至少保留一条正则规则；移除整个资源请使用资源删除。')
      if (shape === 'regex-array') return result.map((entry) => entry.value)
      if (shape === 'regex-single')
        return result.length === 1 ? result[0]!.value : result.map((entry) => entry.value)
      if (!groups.includes(newRegexGroup as (typeof groups)[number]))
        throw new Error('请选择有效的正则作用域。')
      return {
        ...(raw as Record<string, unknown>),
        ...Object.fromEntries(
          groups.map((group) => [
            group,
            result.filter((entry) => entry.group === group).map((entry) => entry.value),
          ]),
        ),
      }
    },
  }
}

function normalizeRegex(source: Record<string, unknown>): Record<string, unknown> {
  const value = clone(source)
  value.scriptName = source.scriptName ?? source.script_name ?? source.name ?? '未命名正则'
  value.findRegex = source.findRegex ?? source.find_regex ?? ''
  value.replaceString = source.replaceString ?? source.replace_string ?? ''
  value.disabled = source.disabled === true || source.enabled === false
  value.markdownOnly = source.markdownOnly ?? source.markdown_only ?? false
  value.promptOnly = source.promptOnly ?? source.prompt_only ?? false
  if (isRecord(source.source)) {
    value.placement = Object.entries({
      user_input: 1,
      ai_output: 2,
      slash_command: 3,
      world_info: 5,
      reasoning: 6,
    }).flatMap(([key, position]) =>
      (source.source as Record<string, unknown>)[key] === true ? [position] : [],
    )
    if (isRecord(source.destination)) {
      value.markdownOnly = source.destination.display === true && source.destination.prompt !== true
      value.promptOnly = source.destination.prompt === true && source.destination.display !== true
    }
  }
  return value
}

function patchEntry(
  old: Entry,
  value: Record<string, unknown>,
  section: string,
): Record<string, unknown> {
  if (equal(old.normalized, value)) return clone(old.source)
  const output = clone(old.source)
  const write = (field: string, native: string, convert: (v: unknown) => unknown = (v) => v) => {
    if (!equal(old.normalized[field], value[field])) output[native] = convert(value[field])
  }
  if (section === 'worldBook') {
    write('comment', typeof output.name === 'string' && !('comment' in output) ? 'name' : 'comment')
    write('content', 'content')
    write('constant', 'constant')
    write('selective', 'selective')
    write('keys', 'keys' in output ? 'keys' : 'key')
    write('secondary_keys', 'secondary_keys' in output ? 'secondary_keys' : 'keysecondary')
    write(
      'enabled',
      'enabled' in output ? 'enabled' : 'disable',
      'enabled' in output ? (v) => v : (v) => !v,
    )
    write('insertion_order', 'insertion_order' in output ? 'insertion_order' : 'order')
    const beforeExt = old.normalized.extensions as Record<string, unknown>
    const afterExt = value.extensions as Record<string, unknown>
    for (const key of ['position', 'depth']) {
      if (equal(beforeExt[key], afterExt[key])) continue
      if ('keys' in output) {
        output.extensions = {
          ...(isRecord(output.extensions) ? output.extensions : {}),
          [key]: afterExt[key],
        }
        if (key === 'position') output.position = value.position
      } else {
        output[key] = afterExt[key]
        if (isRecord(output.extensions) && key in output.extensions)
          output.extensions = { ...output.extensions, [key]: afterExt[key] }
      }
    }
  } else {
    for (const [field, alias] of [
      ['scriptName', 'script_name'],
      ['findRegex', 'find_regex'],
      ['replaceString', 'replace_string'],
      ['markdownOnly', 'markdown_only'],
      ['promptOnly', 'prompt_only'],
    ]) {
      const native = alias! in output && !(field! in output) ? alias! : field!
      write(field!, native)
      if (alias! in output && field! in output) write(field!, alias!)
    }
    write('disabled', 'disabled')
    if ('enabled' in output) write('disabled', 'enabled', (v) => !v)
    if (isRecord(output.source)) {
      if (!equal(old.normalized.placement, value.placement)) {
        output.source = {
          ...output.source,
          ...Object.fromEntries(
            Object.entries({
              user_input: 1,
              ai_output: 2,
              slash_command: 3,
              world_info: 5,
              reasoning: 6,
            }).map(([key, position]) => [key, (value.placement as number[]).includes(position)]),
          ),
        }
      }
      if (
        isRecord(output.destination) &&
        (!equal(old.normalized.markdownOnly, value.markdownOnly) ||
          !equal(old.normalized.promptOnly, value.promptOnly))
      ) {
        output.destination = {
          ...output.destination,
          display: value.markdownOnly === true || value.promptOnly !== true,
          prompt: value.promptOnly === true || value.markdownOnly !== true,
        }
      }
      for (const key of ['markdownOnly', 'promptOnly']) if (!(key in old.source)) delete output[key]
    } else write('placement', 'placement')
  }
  return output
}

function toNativeWorldEntry(value: Record<string, unknown>, uid: number): Record<string, unknown> {
  const { keys, secondary_keys, enabled, insertion_order, extensions, id: _id, ...rest } = value
  const ext = isRecord(extensions) ? extensions : {}
  return {
    ...rest,
    uid,
    key: keys,
    keysecondary: secondary_keys,
    disable: !enabled,
    order: insertion_order,
    position: ext.position ?? 0,
    depth: ext.depth ?? 4,
  }
}
