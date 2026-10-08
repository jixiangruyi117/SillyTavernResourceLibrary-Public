import { isRecord } from './UnknownValue'

export const WORLD_BOOK_POSITIONS: Record<string, string> = {
  '0': '角色设定前',
  '1': '角色设定后',
  '2': '作者注顶部',
  '3': '作者注底部',
  '4': '指定深度',
  '5': '示例对话前',
  '6': '示例对话后',
  '7': '出口',
  before_char: '角色设定前',
  after_char: '角色设定后',
  before_example: '示例对话前',
  after_example: '示例对话后',
  at_depth: '指定深度',
  '@depth': '指定深度',
}

export type WorldBookMode = 'constant' | 'keyword' | 'vector'
export interface WorldBookEntry {
  key: string
  id: string
  title: string
  content: string
  enabled: boolean
  mode: WorldBookMode
  modeLabel: string
  primaryKeys: string[]
  secondaryKeys: string[]
  position: string
  placement: string
  order: string
  probability: string
  facts: { label: string; value: string }[]
  conditions: { label: string; value: string }[]
}

const text = (value: unknown) => (value == null ? '' : String(value))
const strings = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && Boolean(item.trim()))
    : typeof value === 'string' && value.trim()
      ? [value]
      : []

/** Read-only presentation of ST entries and card exports; never evaluates activation. */
export function readWorldBookEntries(
  entries: unknown,
  source: 'character' | 'world' = 'world',
): WorldBookEntry[] {
  const values = Array.isArray(entries)
    ? entries.map((value, index) => [String(index), value] as const)
    : isRecord(entries)
      ? Object.entries(entries)
      : []
  return values.flatMap(([recordKey, entry], index) => {
    if (!isRecord(entry)) return []
    const extensions = isRecord(entry.extensions) ? entry.extensions : {}
    const cardEntry =
      source === 'character' || entry.position === 'before_char' || entry.position === 'after_char'
    // Card exports keep their exact ST position in extensions, while the outer
    // position is only before_char/after_char. Native WI files use root fields.
    const field = (...names: string[]): unknown => {
      const records = cardEntry ? [extensions, entry] : [entry, extensions]
      for (const record of records)
        for (const name of names) if (record[name] != null) return record[name]
      return undefined
    }
    const id = text(entry.uid ?? entry.id ?? recordKey)
    const primaryKeys = strings(entry.keys ?? entry.key)
    const secondaryKeys = strings(entry.secondary_keys ?? entry.keysecondary)
    const mode =
      entry.constant === true ? 'constant' : field('vectorized') === true ? 'vector' : 'keyword'
    const modeLabel = { constant: '常驻', keyword: '关键词', vector: '向量' }[mode]
    const rawPosition = text(field('position'))
    const position =
      WORLD_BOOK_POSITIONS[rawPosition] ??
      (rawPosition ? `未知位置（${rawPosition}）` : '未设置位置')
    const atDepth = position === '指定深度'
    const roleValue = field('role')
    const role =
      (
        {
          '0': '系统消息',
          '1': '用户消息',
          '2': '助手消息',
          system: '系统消息',
          user: '用户消息',
          assistant: '助手消息',
        } as Record<string, string>
      )[text(roleValue)] ??
      (roleValue == null ? '系统消息（默认）' : `未知角色（${text(roleValue)}）`)
    const depth = field('depth')
    const placement = atDepth
      ? `${position} ${depth == null ? '4（默认）' : text(depth)} · ${role}`
      : position === '出口'
        ? `${position} · ${text(field('outletName', 'outlet_name')) || '未命名'}`
        : position
    const orderValue = field('order', 'insertion_order')
    const order = orderValue == null ? '100（默认）' : text(orderValue)
    const probabilityValue = field('probability')
    // ST probabilities are percentages: 1 means 1%, not 100%.
    const probability =
      field('useProbability') === false
        ? '不使用概率'
        : probabilityValue == null
          ? '100%（默认）'
          : `${text(probabilityValue)}%`
    const facts = [
      { label: '注入位置', value: placement },
      { label: '插入顺序', value: order },
      { label: '触发概率', value: probability },
    ]
    const conditions: WorldBookEntry['conditions'] = []
    const add = (label: string, value: unknown) => {
      if (value != null)
        conditions.push({
          label,
          value: typeof value === 'boolean' ? (value ? '是' : '否') : text(value),
        })
    }
    if (entry.selective === true && secondaryKeys.length) {
      const logic = text(field('selectiveLogic')) || '0'
      add(
        '辅助词条件',
        (
          { '0': '至少匹配一个', '1': '未全部匹配', '2': '全部不匹配', '3': '全部匹配' } as Record<
            string,
            string
          >
        )[logic] ?? `未知条件（${logic}）`,
      )
    } else if (secondaryKeys.length) add('辅助词条件', '未启用辅助词过滤')
    add('扫描深度', field('scanDepth', 'scan_depth'))
    add('区分大小写', field('caseSensitive', 'case_sensitive'))
    add('整词匹配', field('matchWholeWords', 'match_whole_words'))
    add('不被递归激活', field('excludeRecursion', 'exclude_recursion'))
    add('阻止后续递归', field('preventRecursion', 'prevent_recursion'))
    add('延后递归激活', field('delayUntilRecursion', 'delay_until_recursion'))
    add('包含组', field('group'))
    add('组权重', field('groupWeight', 'group_weight'))
    add('黏性持续', field('sticky'))
    add('冷却消息数', field('cooldown'))
    add('延迟消息数', field('delay'))
    return [
      {
        key: `${index}:${id}`,
        id,
        title:
          text(entry.comment ?? entry.name).trim() || primaryKeys.join('、') || `条目 ${index + 1}`,
        content: typeof entry.content === 'string' ? entry.content : '',
        enabled: entry.enabled !== false && entry.disable !== true,
        mode,
        modeLabel,
        primaryKeys,
        secondaryKeys,
        position,
        placement,
        order,
        probability,
        facts,
        conditions,
      },
    ]
  })
}
