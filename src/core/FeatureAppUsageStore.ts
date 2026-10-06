const STORAGE_KEY = 'srl.featureApps.usage.v1'
const RECENT_LIMIT = 8

export interface FeatureAppUsageState {
  pinned: string[]
  recent: string[]
}

function normalizeIds(value: unknown, limit = Number.POSITIVE_INFINITY): string[] {
  if (!Array.isArray(value)) return []
  return [
    ...new Set(value.filter((item): item is string => typeof item === 'string' && item.length > 0)),
  ].slice(0, limit)
}

export class FeatureAppUsageStore {
  read(): FeatureAppUsageState {
    try {
      const value = JSON.parse(
        localStorage.getItem(STORAGE_KEY) ?? 'null',
      ) as Partial<FeatureAppUsageState> | null
      return {
        pinned: normalizeIds(value?.pinned),
        recent: normalizeIds(value?.recent, RECENT_LIMIT),
      }
    } catch {
      return { pinned: [], recent: [] }
    }
  }

  markOpened(id: string): FeatureAppUsageState {
    const state = this.read()
    return this.write({
      pinned: state.pinned,
      recent: [id, ...state.recent.filter((item) => item !== id)].slice(0, RECENT_LIMIT),
    })
  }

  togglePinned(id: string): FeatureAppUsageState {
    const state = this.read()
    return this.write({
      pinned: state.pinned.includes(id)
        ? state.pinned.filter((item) => item !== id)
        : [...state.pinned, id],
      recent: state.recent,
    })
  }

  private write(value: FeatureAppUsageState): FeatureAppUsageState {
    const state = {
      pinned: normalizeIds(value.pinned),
      recent: normalizeIds(value.recent, RECENT_LIMIT),
    }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    } catch {
      // 功能排序只是设备偏好，写入失败不阻断 APP 打开。
    }
    return state
  }
}

export const featureAppUsageStore = new FeatureAppUsageStore()
