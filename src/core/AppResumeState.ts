const KEY = 'srl.appResume.v1'

export const APP_RESUME_STATE_CHANGE_EVENT = 'srl:app-resume-state-change'

export interface AppResumeState {
  feature?: string
  resourceId?: string
  subpage?: string
  filter?: string
  search?: string
  scrollAnchor?: string
  projectId?: string
  savedAt: number
}

function safeText(value: unknown, max = 160): string | undefined {
  return typeof value === 'string' && value.length <= max ? value : undefined
}

export function readAppResumeState(): AppResumeState | null {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Record<string, unknown> | null
    if (!value || !Number.isFinite(value.savedAt)) return null
    return {
      feature: safeText(value.feature),
      resourceId: safeText(value.resourceId),
      subpage: safeText(value.subpage),
      filter: safeText(value.filter),
      search: safeText(value.search, 240),
      scrollAnchor: safeText(value.scrollAnchor),
      projectId: safeText(value.projectId),
      savedAt: Number(value.savedAt),
    }
  } catch {
    return null
  }
}

export function writeAppResumeState(changes: Partial<Omit<AppResumeState, 'savedAt'>>): void {
  const previous = readAppResumeState()
  const next: AppResumeState = { ...(previous ?? { savedAt: 0 }), ...changes, savedAt: Date.now() }
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    // 恢复位置不是业务数据，写入失败不阻断当前操作。
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent<AppResumeState>(APP_RESUME_STATE_CHANGE_EVENT, { detail: next }),
    )
  }
}
