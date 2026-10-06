import { isRecord } from './UnknownValue'

/**
 * 版本对比。
 *
 * 全部在本地内存中完成：角色卡按卡内字段对比，世界书按条目对比，
 * 其他文本资源按行对比。只读取两份资源的元数据与原始文件文本，
 * 不修改任何资源、版本记录或导出内容。
 */

export interface LineDiffOp {
  type: 'same' | 'added' | 'removed'
  text: string
}

export interface FieldDiff {
  label: string
  status: 'added' | 'removed' | 'changed'
  oldText: string
  newText: string
  /** 多行文本字段附带行级 diff，短字段留空。 */
  lines?: LineDiffOp[]
}

export interface EntryDiff {
  key: string
  label: string
  status: 'added' | 'removed' | 'changed'
  lines?: LineDiffOp[]
  details?: FieldDiff[]
}

export const MAX_DIFF_LINES = 3000

export const INLINE_FIELD_LIMIT = 120

/**
 * 基于 LCS 的行级 diff。超过行数上限时退化为“整段替换”视图，
 * 避免在移动端对超长世界书做 O(n²) 计算。
 */
export function diffLines(oldText: string, newText: string): LineDiffOp[] {
  if (oldText === newText) {
    return oldText ? oldText.split('\n').map((text) => ({ type: 'same' as const, text })) : []
  }
  // 空字符串视为零行，避免出现一行“空删除”噪音。
  const oldLines = oldText ? oldText.split('\n') : []
  const newLines = newText ? newText.split('\n') : []
  if (oldLines.length > MAX_DIFF_LINES || newLines.length > MAX_DIFF_LINES) {
    return [
      ...oldLines.map((text) => ({ type: 'removed' as const, text })),
      ...newLines.map((text) => ({ type: 'added' as const, text })),
    ]
  }

  const rows = oldLines.length
  const columns = newLines.length
  // lengths[i][j] = oldLines[i:] 与 newLines[j:] 的最长公共子序列长度
  const lengths: Uint32Array[] = Array.from(
    { length: rows + 1 },
    () => new Uint32Array(columns + 1),
  )
  for (let i = rows - 1; i >= 0; i -= 1) {
    for (let j = columns - 1; j >= 0; j -= 1) {
      lengths[i][j] =
        oldLines[i] === newLines[j]
          ? lengths[i + 1][j + 1] + 1
          : Math.max(lengths[i + 1][j], lengths[i][j + 1])
    }
  }

  const ops: LineDiffOp[] = []
  let i = 0
  let j = 0
  while (i < rows && j < columns) {
    if (oldLines[i] === newLines[j]) {
      ops.push({ type: 'same', text: oldLines[i] })
      i += 1
      j += 1
    } else if (lengths[i + 1][j] >= lengths[i][j + 1]) {
      ops.push({ type: 'removed', text: oldLines[i] })
      i += 1
    } else {
      ops.push({ type: 'added', text: newLines[j] })
      j += 1
    }
  }
  while (i < rows) ops.push({ type: 'removed', text: oldLines[i++] })
  while (j < columns) ops.push({ type: 'added', text: newLines[j++] })
  return ops
}

export function asText(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value) && value.every((item) => typeof item === 'string')) {
    return value.join('、')
  }
  return ''
}

export function pushFieldDiff(
  fields: FieldDiff[],
  label: string,
  oldText: string,
  newText: string,
): void {
  if (oldText === newText) return
  const status: FieldDiff['status'] = !oldText ? 'added' : !newText ? 'removed' : 'changed'
  const multiline =
    oldText.length > INLINE_FIELD_LIMIT ||
    newText.length > INLINE_FIELD_LIMIT ||
    oldText.includes('\n') ||
    newText.includes('\n')
  fields.push({
    label,
    status,
    oldText,
    newText,
    lines: multiline ? diffLines(oldText, newText) : undefined,
  })
}

export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (!isRecord(value)) return JSON.stringify(value) ?? 'null'
  const fields = Object.keys(value)
    .filter((key) => value[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
  return `{${fields.join(',')}}`
}
