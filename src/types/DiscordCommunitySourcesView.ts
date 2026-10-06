import {
  type DiscordSourceRefreshDiff,
  type DiscordSourceRefreshSyncState,
} from '../services/DiscordSourceRefreshService'
import {
  type DiscordCapture,
  type ResourceCommunitySourceSummary,
  type ResourceCommunitySourceView,
} from '../types/CommunitySource'

export type DiscordCommunitySourcesProps = { resourceId: string }

export type DiscordCommunitySourcesEvents = { count: [value: number] }

export type RefreshMode = 'keep' | 'replace'

export type RevisionViewMode = 'view' | 'compare'

export type SourcePresentation = ResourceCommunitySourceSummary | ResourceCommunitySourceView

export type RefreshCandidate = {
  sourceId: string
  captures: DiscordCapture[]
  missingMessageIds: string[]
  diff: DiscordSourceRefreshDiff
  syncState: DiscordSourceRefreshSyncState
}

export type RevisionComparisonItem = {
  key: string
  label: string
  authorName: string
  summary: string
}
