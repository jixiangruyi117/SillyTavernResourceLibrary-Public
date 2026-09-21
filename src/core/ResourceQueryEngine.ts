import { getResourceCategoryIds, type ResourceSummary, type ResourceType } from '../types/Resource'

export type ResourceQueryFilter = 'all' | 'favorites' | ResourceType
export type ResourceQuerySort = 'newest' | 'name' | 'size'

export interface ResourceQueryOptions {
  filter: ResourceQueryFilter
  categoryId: string | null | undefined
  tag?: string
  keyword?: string
  sort: ResourceQuerySort
  matchesSearch?: (resource: ResourceSummary, keyword: string) => boolean
  nameCollator?: Intl.Collator
  offset?: number
  limit?: number
}

export interface ResourceQueryResult {
  items: ResourceSummary[]
  total: number
}

export class ResourceQueryEngine {
  query(resources: ResourceSummary[], options: ResourceQueryOptions): ResourceQueryResult {
    const keyword = options.keyword?.trim().toLocaleLowerCase() ?? ''
    const matchesCategory = (resource: ResourceSummary) => {
      if (options.categoryId === undefined) return true
      const categoryIds = getResourceCategoryIds(resource)
      return options.categoryId === null
        ? categoryIds.length === 0
        : categoryIds.includes(options.categoryId)
    }
    const items = resources.filter((resource) => {
      if (
        options.filter !== 'all' &&
        !(options.filter === 'favorites' ? resource.favorite : resource.type === options.filter)
      ) {
        return false
      }
      if (!matchesCategory(resource)) return false
      if (options.tag && !resource.tags.includes(options.tag)) return false
      return !keyword || !options.matchesSearch || options.matchesSearch(resource, keyword)
    })

    if (options.sort === 'name') {
      const collator = options.nameCollator ?? new Intl.Collator('zh-CN')
      items.sort((left, right) => collator.compare(left.name, right.name))
    } else if (options.sort === 'size') {
      items.sort((left, right) => right.fileSize - left.fileSize)
    } else if (
      !items.every(
        (resource, index) => index === 0 || items[index - 1]!.updatedAt >= resource.updatedAt,
      )
    ) {
      items.sort((left, right) => right.updatedAt - left.updatedAt)
    }

    const total = items.length
    const offset = Math.max(0, Math.round(options.offset ?? 0))
    const limit = options.limit === undefined ? total : Math.max(0, Math.round(options.limit))
    return { items: offset || limit < total ? items.slice(offset, offset + limit) : items, total }
  }
}

export interface ResourceStatsSnapshot {
  total: number
  favorites: number
  types: Set<ResourceType>
  typeCounts: Map<ResourceType, number>
  tagCounts: Map<string, number>
}

export class ResourceStatsIndex {
  private readonly resources = new Map<string, ResourceSummary>()
  private snapshotValue: ResourceStatsSnapshot = {
    total: 0,
    favorites: 0,
    types: new Set(),
    typeCounts: new Map(),
    tagCounts: new Map(),
  }

  replace(resources: ResourceSummary[]): void {
    this.resources.clear()
    for (const resource of resources) this.resources.set(resource.id, resource)
    this.rebuild()
  }

  upsert(resource: ResourceSummary): void {
    this.resources.set(resource.id, resource)
    this.rebuild()
  }

  remove(id: string): void {
    if (this.resources.delete(id)) this.rebuild()
  }

  snapshot(): ResourceStatsSnapshot {
    return {
      total: this.snapshotValue.total,
      favorites: this.snapshotValue.favorites,
      types: new Set(this.snapshotValue.types),
      typeCounts: new Map(this.snapshotValue.typeCounts),
      tagCounts: new Map(this.snapshotValue.tagCounts),
    }
  }

  private rebuild(): void {
    const types = new Set<ResourceType>()
    const typeCounts = new Map<ResourceType, number>()
    const tagCounts = new Map<string, number>()
    let favorites = 0
    for (const resource of this.resources.values()) {
      types.add(resource.type)
      typeCounts.set(resource.type, (typeCounts.get(resource.type) ?? 0) + 1)
      if (resource.favorite) favorites += 1
      for (const tag of resource.tags) tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1)
    }
    this.snapshotValue = { total: this.resources.size, favorites, types, typeCounts, tagCounts }
  }
}

export const resourceQueryEngine = new ResourceQueryEngine()
