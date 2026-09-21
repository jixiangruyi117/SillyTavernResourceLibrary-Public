export interface BackStackEntry {
  id: string
  isActive: () => boolean
  back: () => void
  canBack?: () => boolean
}

export type BackStackResult = 'handled' | 'blocked' | 'none'

export interface BackStackManager {
  back(): BackStackResult
}

/** 注册顺序即返回优先级；第一个 active entry 独占本次返回。 */
export function useBackStack(entries: BackStackEntry[]): BackStackManager {
  return {
    back() {
      const entry = entries.find((candidate) => candidate.isActive())
      if (!entry) return 'none'
      if (entry.canBack && !entry.canBack()) return 'blocked'
      entry.back()
      return 'handled'
    },
  }
}

export interface SrlBackRequestDetail {
  handled: boolean
  blocked?: boolean
}

export const SRL_BACK_REQUEST_EVENT = 'srl:back-request'
