import { getResourceCategoryIds, type Category, type ResourceReference } from '../types/Resource'

export function getHiddenCategoryIds(categories: readonly Category[]): Set<string> {
  return new Set(
    categories.filter((category) => category.hidden === true).map((category) => category.id),
  )
}

export function isResourceHiddenByCategory(
  resource: ResourceReference,
  hiddenCategoryIds: ReadonlySet<string>,
): boolean {
  return getResourceCategoryIds(resource).some((categoryId) => hiddenCategoryIds.has(categoryId))
}
