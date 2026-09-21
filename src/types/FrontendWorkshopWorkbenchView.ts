import { type FrontendWorkshopViewportAction } from '../components/FrontendWorkshopProjectBar.vue'
import {
  type FrontendWorkshopAssetLink,
  type FrontendWorkshopLayoutViewport,
  type FrontendWorkshopNodeKind,
} from '../types/FrontendWorkshopProject'

export type FrontendWorkshopSourceOwnerState = 'visual' | 'pending' | 'source'

export type EditorRoute = 'workspace' | 'assets'

export type FrontendWorkshopWorkbenchProps = {
  sourceOwnerState?: FrontendWorkshopSourceOwnerState
  sourceCanUndo?: boolean
  sourceCanRedo?: boolean
  sourceMarkup?: string
  sourceSaving?: boolean
  sourceViewport?: {
    mode: FrontendWorkshopLayoutViewport
    zoomPercent: number
    hasSelection: boolean
  }
}

export type FrontendWorkshopWorkbenchEvents = {
  back: []
  libraryChanged: []
  sourceRequested: []
  sourceAddRequested: [kind: FrontendWorkshopNodeKind | 'button', image?: FrontendWorkshopAssetLink]
  sourceComponentLibraryRequested: []
  sourceUndoRequested: []
  sourceRedoRequested: []
  sourceAiRequested: [instruction?: string]
  sourceCompatibilityRequested: []
  sourceViewportRequested: [action: FrontendWorkshopViewportAction]
  previewRequested: [request: { handled: boolean; openLegacyPreview: () => void }]
}

export interface WorkspaceOwner {
  closeOverlapPicker(): void
  fitCanvas(): void
  revealNode(nodeId: string): void
  zoomPercent: number
  setCanvasMode(mode: FrontendWorkshopLayoutViewport): void
  adjustZoom(delta: number): void
  resetZoom(): void
  fitSelection(): void
}
