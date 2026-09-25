import type { ComputedRef, Ref, ShallowRef } from 'vue'
import { computed } from 'vue'
import { resourceQueryEngine, ResourceStatsIndex } from '../core/ResourceQueryEngine'
import type { FilterValue, SortValue } from '../types/AppView'
import {
  getRelatedResourceIds,
  getChatDisplayRegexIds,
  getResourceCategoryIds,
  isExtractedCharacterAsset,
  isUserPersonaAvatarAttachment,
  RESOURCE_TYPE,
  RESOURCE_TYPE_LABELS,
  type Category,
  type ResourceReference,
  type ResourceSummary,
  type ResourceType,
} from '../types/Resource'
import { getHiddenCategoryIds, isResourceHiddenByCategory } from '../utils/CategoryVisibility'
import { findContainerVariantGroups, findDuplicateGroups } from '../utils/DuplicateGroups'
import type { SearchScope } from './UseSearchIndex'
import { resourceAuthorSearchText } from '../utils/ResourceAuthors'

interface LibraryQueryViewContext {
  categories: Ref<Category[]>
  resources: Ref<ResourceSummary[]>
  hideCharacterAssets: Ref<boolean, boolean>
  hideChatDisplayRegex: Ref<boolean>
  showManuallyBoundResources: Ref<boolean>
  activeCategoryId: Ref<string | null | undefined>
  searchQuery: Ref<string, string>
  activeFilter: Ref<FilterValue>
  activeTag: Ref<string, string>
  sortValue: Ref<SortValue>
  resourceNameCollator: Intl.Collator
  searchScope: Ref<SearchScope, SearchScope>
  nameSearchIndexById: ComputedRef<Map<string, string>>
  searchIndexById: ComputedRef<Map<string, { name: string; content: string }>>
  contentSearchQuery: Ref<string, string>
  contentSearchMatchIds: ShallowRef<Set<string>, Set<string>>
  currentPage: Ref<number, number>
  pageSize: Ref<number, number>
  selectedSplitResourceId: Ref<string | undefined>
}

export function useLibraryQueryView(context: LibraryQueryViewContext) {
  const hiddenCategoryIds = computed(() => getHiddenCategoryIds(context.categories.value))

  const visibleCategories = computed(() =>
    context.categories.value.filter((category) => category.hidden !== true),
  )

  const managedResources = computed(() =>
    context.resources.value.filter((resource) => !isUserPersonaAvatarAttachment(resource)),
  )

  const duplicateGroupCounts = computed(() => ({
    content: findDuplicateGroups(context.resources.value).length,
    variants: findContainerVariantGroups(managedResources.value).length,
  }))

  const manuallyBoundIds = computed(() => {
    const ids = new Set<string>()
    for (const resource of managedResources.value) {
      const targets = resource.metadata.manuallyBoundResourceIds
      if (!Array.isArray(targets)) continue
      const related = new Set(getRelatedResourceIds(resource))
      for (const id of targets) if (typeof id === 'string' && related.has(id)) ids.add(id)
    }
    return ids
  })

  const chatDisplayRegexIds = computed(() => getChatDisplayRegexIds(managedResources.value))

  const visibleLibraryResources = computed(() =>
    managedResources.value.filter(
      (resource) =>
        !isResourceHiddenByCategory(resource, hiddenCategoryIds.value) &&
        (!context.hideChatDisplayRegex.value ||
          resource.type !== RESOURCE_TYPE.REGEX ||
          !chatDisplayRegexIds.value.has(resource.id)) &&
        (context.showManuallyBoundResources.value || !manuallyBoundIds.value.has(resource.id)) &&
        (!context.hideCharacterAssets.value || !isExtractedCharacterAsset(resource)),
    ),
  )

  const visibleResourceFacets = computed(() => {
    const stats = new ResourceStatsIndex()
    stats.replace(visibleLibraryResources.value)
    const snapshot = stats.snapshot()
    const filterCounts = new Map<FilterValue, number>([
      ['all', snapshot.total],
      ['favorites', snapshot.favorites],
    ])
    snapshot.typeCounts.forEach((count, type) => filterCounts.set(type, count))
    return { types: snapshot.types, tagCounts: snapshot.tagCounts, filterCounts }
  })

  const filters = computed<Array<{ label: string; value: FilterValue }>>(() => {
    const alwaysVisible = new Set<ResourceType>([
      RESOURCE_TYPE.CHARACTER_CARD,
      RESOURCE_TYPE.WORLD_BOOK,
    ])
    const typeFilters = Object.values(RESOURCE_TYPE)
      .filter((type) => alwaysVisible.has(type) || visibleResourceFacets.value.types.has(type))
      .map((type) => ({ label: RESOURCE_TYPE_LABELS[type], value: type }))

    return [
      { label: '全部资源', value: 'all' },
      { label: '我的收藏', value: 'favorites' },
      ...typeFilters,
    ]
  })

  function matchesCategory(
    resource: ResourceReference,
    categoryId: string | null | undefined,
  ): boolean {
    if (categoryId === undefined) return true
    const categoryIds = getResourceCategoryIds(resource)
    return categoryId === null ? categoryIds.length === 0 : categoryIds.includes(categoryId)
  }

  const resourceFilterCounts = computed(() => {
    if (context.activeCategoryId.value === undefined)
      return visibleResourceFacets.value.filterCounts
    const counts = new Map<FilterValue, number>([
      ['all', 0],
      ['favorites', 0],
    ])
    for (const resource of visibleLibraryResources.value) {
      if (!matchesCategory(resource, context.activeCategoryId.value)) continue
      counts.set('all', (counts.get('all') ?? 0) + 1)
      if (resource.favorite) counts.set('favorites', (counts.get('favorites') ?? 0) + 1)
      counts.set(resource.type, (counts.get(resource.type) ?? 0) + 1)
    }
    return counts
  })

  function categoriesForResource(resource: ResourceReference): Category[] {
    return getResourceCategoryIds(resource).flatMap((id) => {
      const category = categoryById.value.get(id)
      return category ? [category] : []
    })
  }

  const filteredResources = computed(() => {
    const keyword = context.searchQuery.value.trim().toLocaleLowerCase()
    return resourceQueryEngine.query(visibleLibraryResources.value, {
      filter: context.activeFilter.value,
      categoryId: context.activeCategoryId.value,
      tag: context.activeTag.value,
      keyword,
      sort: context.sortValue.value,
      nameCollator: context.resourceNameCollator,
      matchesSearch: (resource, search) =>
        context.searchScope.value === 'name'
          ? Boolean(context.nameSearchIndexById.value.get(resource.id)?.includes(search))
          : context.searchScope.value === 'author'
            ? resourceAuthorSearchText(resource).includes(search)
            : Boolean(
                context.searchIndexById.value.get(resource.id)?.content.includes(search) ||
                (context.contentSearchQuery.value === search &&
                  context.contentSearchMatchIds.value.has(resource.id)),
              ),
    }).items
  })

  const paginatedResources = computed(() => {
    const start = (context.currentPage.value - 1) * context.pageSize.value
    return filteredResources.value.slice(start, start + context.pageSize.value)
  })

  const totalPages = computed(() =>
    Math.max(1, Math.ceil(filteredResources.value.length / context.pageSize.value)),
  )

  const tagFilters = computed(() => {
    return Array.from(visibleResourceFacets.value.tagCounts, ([tag, count]) => ({
      tag,
      count,
    })).sort(
      (left, right) => right.count - left.count || left.tag.localeCompare(right.tag, 'zh-CN'),
    )
  })

  const categoryById = computed(
    () => new Map(context.categories.value.map((category) => [category.id, category])),
  )

  const selectedSplitResource = computed(() =>
    context.resources.value.find(
      (resource) => resource.id === context.selectedSplitResourceId.value,
    ),
  )

  const selectedSplitCategories = computed(() =>
    selectedSplitResource.value ? categoriesForResource(selectedSplitResource.value) : [],
  )

  const selectedSplitRelations = computed(() => {
    if (!selectedSplitResource.value) return []
    const relatedIds = new Set(getRelatedResourceIds(selectedSplitResource.value))
    return context.resources.value.filter((resource) => relatedIds.has(resource.id))
  })

  const activeFilterLabel = computed(() => {
    if (context.activeFilter.value === 'all') return ''
    if (context.activeFilter.value === 'favorites') return '我的收藏'
    return RESOURCE_TYPE_LABELS[context.activeFilter.value]
  })

  const activeCategoryLabel = computed(() => {
    if (context.activeCategoryId.value === undefined) return ''
    if (context.activeCategoryId.value === null) return '未放入文件夹'
    return categoryById.value.get(context.activeCategoryId.value)?.name ?? '未知文件夹'
  })

  const activeSecondaryFilterCount = computed(
    () =>
      Number(context.activeCategoryId.value !== undefined) +
      Number(Boolean(context.activeTag.value)),
  )

  const activeScopeLabel = computed(() => {
    const folderLabel =
      context.activeCategoryId.value === undefined
        ? '全部文件夹'
        : context.activeCategoryId.value === null
          ? '未放入文件夹'
          : categoryById.value.get(context.activeCategoryId.value)?.name || '未知文件夹'
    const typeLabel =
      context.activeFilter.value === 'all'
        ? '全部类型'
        : context.activeFilter.value === 'favorites'
          ? '我的收藏'
          : RESOURCE_TYPE_LABELS[context.activeFilter.value]
    return `${folderLabel} · ${typeLabel}${context.activeTag.value ? ` · #${context.activeTag.value}` : ''}`
  })
  const statistics = computed(() => ({
    total: visibleLibraryResources.value.length,
    characterCards: visibleLibraryResources.value.filter(
      (resource) => resource.type === RESOURCE_TYPE.CHARACTER_CARD,
    ).length,
    worldBooks: visibleLibraryResources.value.filter(
      (resource) => resource.type === RESOURCE_TYPE.WORLD_BOOK,
    ).length,
  }))

  function countFilter(filter: FilterValue): number {
    return resourceFilterCounts.value.get(filter) ?? 0
  }

  function countCategory(categoryId: string | null | undefined): number {
    return visibleLibraryResources.value.filter((resource) => {
      const matchesCurrentCategory = matchesCategory(resource, categoryId)
      const matchesFilter =
        context.activeFilter.value === 'all' ||
        (context.activeFilter.value === 'favorites' && resource.favorite) ||
        resource.type === context.activeFilter.value
      return matchesCurrentCategory && matchesFilter
    }).length
  }
  return {
    countFilter,
    countCategory,
    statistics,
    hiddenCategoryIds,
    visibleCategories,
    managedResources,
    duplicateGroupCounts,
    visibleLibraryResources,
    visibleResourceFacets,
    filters,
    matchesCategory,
    resourceFilterCounts,
    categoriesForResource,
    filteredResources,
    paginatedResources,
    totalPages,
    tagFilters,
    categoryById,
    selectedSplitResource,
    selectedSplitCategories,
    selectedSplitRelations,
    activeFilterLabel,
    activeCategoryLabel,
    activeSecondaryFilterCount,
    activeScopeLabel,
  }
}
