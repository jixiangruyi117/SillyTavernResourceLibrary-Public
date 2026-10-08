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

type ResourceMatchOptions = Omit<ResourceQueryOptions, 'sort' | 'nameCollator' | 'offset' | 'limit'>
type ResourcePageOptions = Pick<ResourceQueryOptions, 'sort' | 'nameCollator' | 'offset' | 'limit'>

/** Keep only the requested ordered prefix; original positions settle equal-key ties. */
function orderedPage(
  resources: ResourceSummary[],
  compare: (left: ResourceSummary, right: ResourceSummary) => number,
  offset: number,
  limit: number,
): ResourceSummary[] {
  const capacity = offset + limit
  if (capacity * 2 >= resources.length)
    return resources.slice().sort(compare).slice(offset, capacity)
  type Entry = { resource: ResourceSummary; position: number }
  const heap: Entry[] = []
  const order = (left: Entry, right: Entry) =>
    compare(left.resource, right.resource) || left.position - right.position
  const siftDown = () => {
    let parent = 0
    while (parent * 2 + 1 < heap.length) {
      let child = parent * 2 + 1
      if (child + 1 < heap.length && order(heap[child + 1]!, heap[child]!) > 0) child++
      if (order(heap[parent]!, heap[child]!) >= 0) break
      ;[heap[parent], heap[child]] = [heap[child]!, heap[parent]!]
      parent = child
    }
  }
  resources.forEach((resource, position) => {
    if (heap.length < capacity) {
      heap.push({ resource, position })
      let child = heap.length - 1
      while (child > 0) {
        const parent = (child - 1) >> 1
        if (order(heap[parent]!, heap[child]!) >= 0) break
        ;[heap[parent], heap[child]] = [heap[child]!, heap[parent]!]
        child = parent
      }
    } else if ((compare(resource, heap[0]!.resource) || position - heap[0]!.position) < 0) {
      heap[0] = { resource, position }
      siftDown()
    }
  })
  return heap
    .sort(order)
    .slice(offset)
    .map((entry) => entry.resource)
}

export class ResourceQueryEngine {
  query(resources: ResourceSummary[], options: ResourceQueryOptions): ResourceQueryResult {
    return this.page(this.match(resources, options), options)
  }

  match(resources: ResourceSummary[], options: ResourceMatchOptions): ResourceSummary[] {
    const keyword = options.keyword?.trim().toLocaleLowerCase() ?? ''
    const matchesCategory = (resource: ResourceSummary) => {
      if (options.categoryId === undefined) return true
      const categoryIds = getResourceCategoryIds(resource)
      return options.categoryId === null
        ? categoryIds.length === 0
        : categoryIds.includes(options.categoryId)
    }
    return resources.filter((resource) => {
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
  }

  page(items: ResourceSummary[], options: ResourcePageOptions): ResourceQueryResult {
    const total = items.length
    const offset = Math.max(0, Math.round(options.offset ?? 0))
    const limit = options.limit === undefined ? total : Math.max(0, Math.round(options.limit))
    if (offset >= total || limit === 0) return { items: [], total }
    let compare: (left: ResourceSummary, right: ResourceSummary) => number
    let alreadyOrdered = false
    if (options.sort === 'name') {
      const collator = options.nameCollator ?? new Intl.Collator('zh-CN')
      compare = (left, right) => collator.compare(left.name, right.name)
    } else if (options.sort === 'size') {
      compare = (left, right) => right.fileSize - left.fileSize
    } else {
      alreadyOrdered = items.every(
        (resource, index) => index === 0 || items[index - 1]!.updatedAt >= resource.updatedAt,
      )
      compare = (left, right) => right.updatedAt - left.updatedAt
    }
    // Preserve the original public query's slicing semantics for non-finite persisted inputs.
    if (!Number.isFinite(offset) || !Number.isFinite(limit)) {
      const sorted = alreadyOrdered ? items.slice() : items.slice().sort(compare)
      return {
        items: offset || limit < total ? sorted.slice(offset, offset + limit) : sorted,
        total,
      }
    }
    if (alreadyOrdered) return { items: items.slice(offset, offset + limit), total }
    return { items: orderedPage(items, compare, offset, limit), total }
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
