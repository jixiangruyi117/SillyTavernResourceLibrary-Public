import { type Category, type ResourceSummary } from '../types/Resource'
import {
  type AssemblyEntry,
  type PresetFavoriteSnapshot,
  type RegexGroupPick,
} from '../utils/PresetStitcher'

export type PresetStitcherAppProps = { resources: ResourceSummary[]; categories: Category[] }

export type PresetStitcherAppEvents = { back: []; 'library-changed': [] }

export type Step = 'base' | 'workbench' | 'review' | 'done'

export type SourceMode = 'preset' | 'favorites'

export type EditScope = 'source' | 'target' | 'favorite'

export interface WorkbenchSnapshot {
  assembly: AssemblyEntry[]
  regexPicks: RegexGroupPick[]
  candidates: PresetFavoriteSnapshot[]
  sourceOverrides: Array<[string, { name: string; role: string; content: string }]>
}
