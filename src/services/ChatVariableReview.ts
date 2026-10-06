import { isRecord } from '../utils/UnknownValue'

export interface ChatVariableChange {
  path: string
  type: 'added' | 'removed' | 'changed'
  before: string
  after: string
  delta?: number
}

/** Compare saved JSON values only; no MVU execution, generated explanations or inferred states. */
export function compareChatVariables(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
) {
  const beforeMvu = isRecord(before.stat_data),
    afterMvu = isRecord(after.stat_data)
  const kind = afterMvu ? 'mvu' : 'variables'
  const changes: ChatVariableChange[] = []
  if (beforeMvu !== afterMvu) return { kind, changes, truncated: false, incompatible: true }
  const object = (v: unknown): v is Record<string, unknown> => isRecord(v) || Array.isArray(v)
  const display = (v: unknown, present: boolean) => {
    if (!present) return '未保存此项'
    if (Array.isArray(v)) return `[数组：${v.length} 项]`
    if (isRecord(v)) return `{对象：${Object.keys(v).length} 项}`
    const text = JSON.stringify(v) ?? String(v)
    return text.length > 500 ? text.slice(0, 500) + '…（已截断）' : text
  }
  type Pair = {
    old: unknown
    next: unknown
    oldPresent: boolean
    nextPresent: boolean
    path: string[]
  }
  const stack: Pair[] = [
    {
      old: beforeMvu ? before.stat_data : before,
      next: afterMvu ? after.stat_data : after,
      oldPresent: true,
      nextPresent: true,
      path: [],
    },
  ]
  let visited = 0,
    truncated = false
  while (stack.length) {
    if (++visited > 10000 || changes.length >= 200) {
      truncated = true
      break
    }
    const item = stack.pop()!
    if (item.oldPresent === item.nextPresent && Object.is(item.old, item.next)) continue
    const oldObject = object(item.old),
      nextObject = object(item.next)
    if (
      item.oldPresent &&
      item.nextPresent &&
      oldObject &&
      nextObject &&
      Array.isArray(item.old) === Array.isArray(item.next) &&
      item.path.length < 24
    ) {
      const old = item.old as Record<string, unknown>,
        next = item.next as Record<string, unknown>
      const keys = new Set([...Object.keys(old), ...Object.keys(next)])
      if (keys.size + stack.length + visited > 10000) {
        truncated = true
        break
      }
      for (const key of [...keys].reverse())
        stack.push({
          old: old[key],
          next: next[key],
          oldPresent: Object.hasOwn(old, key),
          nextPresent: Object.hasOwn(next, key),
          path: [...item.path, key],
        })
      continue
    }
    if (oldObject && nextObject && item.path.length >= 24) {
      truncated = true
      continue
    }
    const delta =
      typeof item.old === 'number' && typeof item.next === 'number'
        ? item.next - item.old
        : undefined
    changes.push({
      path: (item.path.join(' › ') || '全部变量').slice(0, 1000),
      type: !item.oldPresent ? 'added' : !item.nextPresent ? 'removed' : 'changed',
      before: display(item.old, item.oldPresent),
      after: display(item.next, item.nextPresent),
      ...(delta !== undefined && Number.isFinite(delta) ? { delta } : {}),
    })
  }
  return { kind, changes, truncated, incompatible: false }
}
