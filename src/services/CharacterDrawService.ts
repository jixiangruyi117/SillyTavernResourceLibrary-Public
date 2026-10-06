import type { AppDatabase } from '../database/AppDatabase'
import {
  getResourceCategoryIds,
  RESOURCE_TYPE,
  type AppSetting,
  type ResourceSummary,
} from '../types/Resource'

const DRAW_SETTING_ID = 'feature.characterDraw'
const DRAW_HISTORY_LIMIT = 50
const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000

export type DrawFreshness = 'all' | 'notSevenDays' | 'never'

export interface CharacterDrawOptions {
  count: 1 | 10
  categoryId?: string
  tag?: string
  favoritesOnly?: boolean
  freshness?: DrawFreshness
}

export interface CharacterDrawRecord {
  resourceId: string
  count: number
  firstDrawnAt: number
  lastDrawnAt: number
}

export interface CharacterDrawHistoryItem {
  id: string
  drawnAt: number
  resourceIds: string[]
  filterLabel: string
}

export interface CharacterDrawState {
  totalDraws: number
  totalSessions: number
  records: Record<string, CharacterDrawRecord>
  history: CharacterDrawHistoryItem[]
}

export interface CharacterDrawResult {
  resourceIds: string[]
  state: CharacterDrawState
}

export function createEmptyCharacterDrawState(): CharacterDrawState {
  return { totalDraws: 0, totalSessions: 0, records: {}, history: [] }
}

function normalizeState(value: unknown): CharacterDrawState {
  if (!value || typeof value !== 'object') return createEmptyCharacterDrawState()
  const state = value as Partial<CharacterDrawState>
  return {
    totalDraws: Number.isFinite(state.totalDraws) ? Number(state.totalDraws) : 0,
    totalSessions: Number.isFinite(state.totalSessions) ? Number(state.totalSessions) : 0,
    records: state.records && typeof state.records === 'object' ? state.records : {},
    history: Array.isArray(state.history) ? state.history.slice(0, DRAW_HISTORY_LIMIT) : [],
  }
}

export function filterCharacterDrawPool(
  resources: ResourceSummary[],
  state: CharacterDrawState,
  options: CharacterDrawOptions,
  now = Date.now(),
): ResourceSummary[] {
  return resources.filter((resource) => {
    if (resource.type !== RESOURCE_TYPE.CHARACTER_CARD) return false
    if (options.categoryId && !getResourceCategoryIds(resource).includes(options.categoryId)) {
      return false
    }
    if (options.tag && !resource.tags.includes(options.tag)) return false
    if (options.favoritesOnly && !resource.favorite) return false
    const record = state.records[resource.id]
    if (options.freshness === 'never' && record) return false
    if (options.freshness === 'notSevenDays' && record && now - record.lastDrawnAt < SEVEN_DAYS) {
      return false
    }
    return true
  })
}

function shuffle<T>(items: T[], random: () => number): T[] {
  const next = [...items]
  for (let index = next.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1))
    ;[next[index], next[target]] = [next[target], next[index]]
  }
  return next
}

function buildFilterLabel(options: CharacterDrawOptions): string {
  const labels = [
    options.categoryId ? '指定文件夹' : '',
    options.tag ? `#${options.tag}` : '',
    options.favoritesOnly ? '仅收藏' : '',
    options.freshness === 'never'
      ? '从未抽到'
      : options.freshness === 'notSevenDays'
        ? '七日未见'
        : '',
  ].filter(Boolean)
  return labels.join(' · ') || '全部角色卡'
}

export class CharacterDrawService {
  private readonly database: AppDatabase
  private readonly random: () => number

  constructor(database: AppDatabase, random: () => number = Math.random) {
    this.database = database
    this.random = random
  }

  async load(): Promise<CharacterDrawState> {
    const setting = await this.database.settings.get(DRAW_SETTING_ID)
    return normalizeState(setting?.value)
  }

  async clear(): Promise<CharacterDrawState> {
    await this.database.settings.delete(DRAW_SETTING_ID)
    return createEmptyCharacterDrawState()
  }

  async importState(value: unknown): Promise<CharacterDrawState> {
    const state = normalizeState(value)
    const setting: AppSetting = { id: DRAW_SETTING_ID, value: state, updatedAt: Date.now() }
    await this.database.settings.put(setting)
    return state
  }

  async draw(
    resources: ResourceSummary[],
    options: CharacterDrawOptions,
    now = Date.now(),
  ): Promise<CharacterDrawResult> {
    const state = await this.load()
    const pool = filterCharacterDrawPool(resources, state, options, now)
    if (!pool.length) throw new Error('当前筛选下没有可抽取的角色卡')

    const selected: ResourceSummary[] = []
    let bag = shuffle(pool, this.random)
    while (selected.length < options.count) {
      if (!bag.length) bag = shuffle(pool, this.random)
      const resource = bag.pop()
      if (resource) selected.push(resource)
    }

    const records = { ...state.records }
    for (const resource of selected) {
      const previous = records[resource.id]
      records[resource.id] = {
        resourceId: resource.id,
        count: (previous?.count ?? 0) + 1,
        firstDrawnAt: previous?.firstDrawnAt ?? now,
        lastDrawnAt: now,
      }
    }
    const resourceIds = selected.map((resource) => resource.id)
    const nextState: CharacterDrawState = {
      totalDraws: state.totalDraws + resourceIds.length,
      totalSessions: state.totalSessions + 1,
      records,
      history: [
        {
          id: crypto.randomUUID(),
          drawnAt: now,
          resourceIds,
          filterLabel: buildFilterLabel(options),
        },
        ...state.history,
      ].slice(0, DRAW_HISTORY_LIMIT),
    }
    const setting: AppSetting = { id: DRAW_SETTING_ID, value: nextState, updatedAt: now }
    await this.database.settings.put(setting)
    return { resourceIds, state: nextState }
  }
}
