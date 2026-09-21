import { type Category, type ResourceSummary, type ResourceType } from '../types/Resource'

export type FolderLibraryViewProps = {
  categories: Category[]
  resources: ResourceSummary[]
  busy: boolean
  cabinetResourceIds: string[]
}

export type FolderLibraryViewEvents = {
  back: []
  openResource: [resource: ResourceSummary]
  manage: []
  add: [details: { categoryId: string; resourceIds: string[]; removeFromCabinet?: boolean }]
  cover: [details: { category: Category; file?: File; coverUrl?: string }]
  rename: [
    details: {
      category: Category
      name: string
      coverChanged?: boolean
      coverImage?: string
      file?: File
    },
  ]
  reorder: [categoryIds: string[]]
  pin: [resourceIds: string[]]
  unpin: [resourceId: string]
}

export type ResourceTypeFilter = ResourceType | 'all'

export type OrganizerResourceFilter = ResourceTypeFilter | 'unclassified'

export interface TouchDragState {
  pointerId: number
  resourceIds: string[]
  x: number
  y: number
  label: string
  targetSlot?: number
}
