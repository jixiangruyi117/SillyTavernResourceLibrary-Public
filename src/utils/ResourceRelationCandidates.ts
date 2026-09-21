import {
  getRelatedResourceIds,
  RESOURCE_TYPE_LABELS,
  type ResourceSummary,
} from '../types/Resource'

export interface ResourceRelationCandidateOptions {
  currentResourceId: string
  selectedResourceIds: ReadonlySet<string>
  query: string
  hideBoundElsewhere: boolean
}

export function isResourceBoundElsewhere(
  resource: ResourceSummary,
  currentResourceId: string,
): boolean {
  return getRelatedResourceIds(resource).some((id) => id !== currentResourceId)
}

export function filterResourceRelationCandidates(
  resources: ResourceSummary[],
  options: ResourceRelationCandidateOptions,
): ResourceSummary[] {
  const query = options.query.trim().toLocaleLowerCase()
  return resources
    .filter((resource) => resource.id !== options.currentResourceId)
    .filter(
      (resource) =>
        !options.hideBoundElsewhere ||
        options.selectedResourceIds.has(resource.id) ||
        !isResourceBoundElsewhere(resource, options.currentResourceId),
    )
    .filter(
      (resource) =>
        !query ||
        `${resource.name}\n${resource.fileName}\n${RESOURCE_TYPE_LABELS[resource.type]}`
          .toLocaleLowerCase()
          .includes(query),
    )
    .sort((left, right) => {
      const leftSelected = options.selectedResourceIds.has(left.id) ? 1 : 0
      const rightSelected = options.selectedResourceIds.has(right.id) ? 1 : 0
      return rightSelected - leftSelected || left.name.localeCompare(right.name, 'zh-CN')
    })
}
