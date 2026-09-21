export const FRONTEND_WORKSHOP_MVU_MAX_PATH_LENGTH = 180
export const FRONTEND_WORKSHOP_MVU_MAX_DEPTH = 5
export const FRONTEND_WORKSHOP_MVU_MAX_OBJECT_ENTRIES = 30
export const FRONTEND_WORKSHOP_MVU_MAX_ARRAY_ENTRIES = 20
export const FRONTEND_WORKSHOP_MVU_MAX_SEARCH_RESULTS = 50
export const FRONTEND_WORKSHOP_MVU_WAIT_TIMEOUT_MS = 2_500

const UNSAFE_PATH_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype'])

export interface FrontendWorkshopMvuStateEntry {
  name: string
  path: string
  value: string
  depth: number
  expandable: boolean
}

export interface FrontendWorkshopMvuHost {
  waitGlobalInitialized?: (name: string) => Promise<unknown> | unknown
  getCurrentMessageId?: () => unknown
  Mvu?: {
    getMvuData?: (input: { type: 'message'; message_id: unknown }) => Promise<unknown> | unknown
  }
}

export interface FrontendWorkshopMvuStateSnapshot {
  available: boolean
  statData?: Record<string, unknown> | unknown[]
}

function isObject(value: unknown): value is Record<string, unknown> | unknown[] {
  return Boolean(value && typeof value === 'object')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return isObject(value) && !Array.isArray(value)
}

function joinPath(parentPath: string, name: string): string {
  return parentPath ? `${parentPath}.${name}` : name
}

function hasDisallowedPathCharacter(segment: string): boolean {
  return [...segment].some(
    (character) => character <= '\u001f' || character === '[' || character === ']',
  )
}

/** 只接受相对于 MVU stat_data 的普通点分路径。 */
export function normalizeFrontendWorkshopMvuPath(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const path = value.trim()
  if (!path || path.length > FRONTEND_WORKSHOP_MVU_MAX_PATH_LENGTH) return undefined
  const segments = path.split('.')
  if (segments.length > FRONTEND_WORKSHOP_MVU_MAX_DEPTH * 3) return undefined
  if (segments[0] === 'stat_data') return undefined
  if (
    segments.some(
      (segment) =>
        !segment ||
        segment.length > 80 ||
        UNSAFE_PATH_SEGMENTS.has(segment) ||
        hasDisallowedPathCharacter(segment),
    )
  )
    return undefined
  return path
}

export function readFrontendWorkshopMvuPath(value: unknown, path: string): unknown {
  const normalized = normalizeFrontendWorkshopMvuPath(path)
  if (!normalized) return undefined
  let current: unknown = value
  for (const segment of normalized.split('.')) {
    if (!isObject(current) || !Object.prototype.hasOwnProperty.call(current, segment))
      return undefined
    try {
      current = (current as Record<string, unknown>)[segment]
    } catch {
      return undefined
    }
  }
  return current
}

export function formatFrontendWorkshopMvuValue(value: unknown): string {
  if (value === null) return 'null'
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
    return String(value).slice(0, 240)
  if (Array.isArray(value)) return `[数组 ${value.length} 项]`
  if (isObject(value)) {
    try {
      return `{对象 ${Object.keys(value).length} 项}`
    } catch {
      return '{对象}'
    }
  }
  return String(value ?? '').slice(0, 240)
}

function ownKeys(value: Record<string, unknown> | unknown[]): string[] {
  try {
    return Object.keys(value)
  } catch {
    return []
  }
}

/** 按需列出一层节点，调用方只在展开时继续读取子项。 */
export function listFrontendWorkshopMvuStateEntries(
  value: unknown,
  parentPath = '',
  depth = 0,
): FrontendWorkshopMvuStateEntry[] {
  if (!isObject(value) || depth > FRONTEND_WORKSHOP_MVU_MAX_DEPTH) return []
  const limit = Array.isArray(value)
    ? FRONTEND_WORKSHOP_MVU_MAX_ARRAY_ENTRIES
    : FRONTEND_WORKSHOP_MVU_MAX_OBJECT_ENTRIES
  return ownKeys(value)
    .slice(0, limit)
    .flatMap((name) => {
      let child: unknown
      try {
        child = (value as Record<string, unknown>)[name]
      } catch {
        return []
      }
      return [
        {
          name,
          path: joinPath(parentPath, name),
          value: formatFrontendWorkshopMvuValue(child),
          depth,
          expandable: isObject(child) && depth < FRONTEND_WORKSHOP_MVU_MAX_DEPTH,
        },
      ]
    })
}

/** 搜索同样受递归、每层条数和结果数限制，避免大状态树阻塞编辑器。 */
export function searchFrontendWorkshopMvuStateEntries(
  value: unknown,
  keyword: string,
): FrontendWorkshopMvuStateEntry[] {
  const query = keyword.trim().toLocaleLowerCase()
  if (!query || !isObject(value)) return []
  const results: FrontendWorkshopMvuStateEntry[] = []
  const seen = new WeakSet<object>()
  const visit = (current: unknown, parentPath: string, depth: number): void => {
    if (
      !isObject(current) ||
      depth > FRONTEND_WORKSHOP_MVU_MAX_DEPTH ||
      results.length >= FRONTEND_WORKSHOP_MVU_MAX_SEARCH_RESULTS
    )
      return
    if (seen.has(current)) return
    seen.add(current)
    for (const entry of listFrontendWorkshopMvuStateEntries(current, parentPath, depth)) {
      if (results.length >= FRONTEND_WORKSHOP_MVU_MAX_SEARCH_RESULTS) return
      const child = readFrontendWorkshopMvuPath(value, entry.path)
      if (`${entry.name} ${entry.path}`.toLocaleLowerCase().includes(query)) results.push(entry)
      if (entry.expandable) visit(child, entry.path, depth + 1)
    }
  }
  visit(value, '', 0)
  return results
}

/**
 * MVU 是可选宿主依赖。TavernHelper 的 waitGlobalInitialized() 在目标全局从未被共享时会一直等待，
 * 因此编辑器读取不能裸 await 它；超时仅代表“本次没有及时可用”，用户仍可稍后重新读取。
 */
async function waitForOptionalMvu(host: FrontendWorkshopMvuHost): Promise<boolean> {
  if (typeof host.waitGlobalInitialized !== 'function') return false
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  try {
    const initialized = Promise.resolve(host.waitGlobalInitialized('Mvu')).then(
      () => true,
      () => false,
    )
    const timedOut = new Promise<boolean>((resolve) => {
      timeoutId = setTimeout(() => resolve(false), FRONTEND_WORKSHOP_MVU_WAIT_TIMEOUT_MS)
    })
    return await Promise.race([initialized, timedOut])
  } catch {
    return false
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId)
  }
}

/** 只使用已确认的 TavernHelper / MVU 宿主接口；失败或超时由调用方使用 sample 降级。 */
export async function readCurrentFrontendWorkshopMvuState(
  host: FrontendWorkshopMvuHost = globalThis as FrontendWorkshopMvuHost,
): Promise<FrontendWorkshopMvuStateSnapshot> {
  if (!(await waitForOptionalMvu(host))) return { available: false }
  try {
    const messageId = host.getCurrentMessageId?.()
    if (messageId === undefined || messageId === null || !host.Mvu?.getMvuData)
      return { available: false }
    const mvuData = await host.Mvu.getMvuData({ type: 'message', message_id: messageId })
    const variables = isRecord(mvuData) ? mvuData.variables : undefined
    const statData = isRecord(mvuData)
      ? (mvuData.stat_data ?? (isRecord(variables) ? variables.stat_data : undefined))
      : undefined
    return isObject(statData) ? { available: true, statData } : { available: false }
  } catch {
    return { available: false }
  }
}
