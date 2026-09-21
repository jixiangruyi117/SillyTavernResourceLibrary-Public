import type { ComputedRef, Ref, ShallowRef } from 'vue'
import { nextTick, toRaw } from 'vue'
import { type FrontendWorkshopViewportAction } from '../components/FrontendWorkshopProjectBar.vue'
import type { FrontendWorkshopPage } from '../types/FrontendWorkshopProject'
import {
  findFrontendWorkshopNode,
  type FrontendWorkshopAssetLink,
  type FrontendWorkshopLayer,
  type FrontendWorkshopLayoutViewport,
  type FrontendWorkshopNode,
  type FrontendWorkshopNodeKind,
  type FrontendWorkshopNodePlacement,
  type FrontendWorkshopPanel,
  type FrontendWorkshopProject,
} from '../types/FrontendWorkshopProject'
import type {
  FrontendWorkshopWorkbenchProps,
  WorkspaceOwner,
} from '../types/FrontendWorkshopWorkbenchView'
import {
  duplicateFrontendWorkshopNodeSubtree,
  removeFrontendWorkshopNodeSubtree,
} from '../utils/FrontendWorkshopCommandSystem'
import { isFrontendWorkshopCreatableNodeKind } from '../utils/FrontendWorkshopNodeDefinitionRegistry'
import {
  cloneFrontendWorkshopProject as cloneProject,
  defaultFrontendWorkshopNodePlacement as defaultNodePlacement,
  readFrontendWorkshopNodePlacement as readNodePlacement,
} from '../utils/FrontendWorkshopProjectGeometry'

interface WorkshopNodeEditingContext {
  NODE_LABELS: Record<FrontendWorkshopNodeKind, string>
  currentLayers: ComputedRef<FrontendWorkshopLayer[]>
  activeLayerId: Ref<string, string>
  canvasMode: Ref<FrontendWorkshopLayoutViewport>
  currentPage: ComputedRef<FrontendWorkshopPage | undefined>
  selectedNodeId: Ref<string, string>
  activePanel: Ref<FrontendWorkshopPanel | null>
  props: Readonly<
    FrontendWorkshopWorkbenchProps &
      Required<
        Pick<
          FrontendWorkshopWorkbenchProps,
          'sourceOwnerState' | 'sourceCanUndo' | 'sourceCanRedo' | 'sourceMarkup' | 'sourceSaving'
        >
      >
  >
  emit: ((event: 'back') => void) &
    ((event: 'libraryChanged') => void) &
    ((event: 'sourceRequested') => void) &
    ((
      event: 'sourceAddRequested',
      kind: FrontendWorkshopNodeKind | 'button',
      image?: FrontendWorkshopAssetLink | undefined,
    ) => void) &
    ((event: 'sourceComponentLibraryRequested') => void) &
    ((event: 'sourceUndoRequested') => void) &
    ((event: 'sourceRedoRequested') => void) &
    ((event: 'sourceAiRequested') => void) &
    ((event: 'sourceCompatibilityRequested') => void) &
    ((event: 'sourceViewportRequested', action: FrontendWorkshopViewportAction) => void) &
    ((
      event: 'previewRequested',
      request: { handled: boolean; openLegacyPreview: () => void },
    ) => void)
  status: Ref<string, string>
  updateProject: (mutator: (project: FrontendWorkshopProject) => void) => boolean
  workspaceOwner: Readonly<ShallowRef<WorkspaceOwner | null>>
  selectedNode: ComputedRef<FrontendWorkshopNode | undefined>
  currentProject: ComputedRef<FrontendWorkshopProject | undefined>
  replaceCurrentProject: (next: FrontendWorkshopProject) => void
  persistProject: (project: FrontendWorkshopProject) => Promise<void>
  undoStack: Ref<FrontendWorkshopProject[]>
  redoStack: Ref<FrontendWorkshopProject[]>
  quickAddOpen: Ref<boolean, boolean>
}

export function useWorkshopNodeEditing(getContext: () => WorkshopNodeEditingContext) {
  function makeNode(kind: FrontendWorkshopNodeKind): FrontendWorkshopNode {
    const context = getContext()

    return {
      id: crypto.randomUUID(),
      kind,
      label: context.NODE_LABELS[kind],
      text: kind === 'text' ? '点击编辑这段文字' : undefined,
      contentSource: { kind: 'manual' },
      control:
        kind === 'control'
          ? { type: 'text', placeholder: '请输入内容', required: false, options: [] }
          : undefined,
      style: {
        align: 'start',
        tone: 'plain',
        columns: 1,
        emphasis: 'normal',
        opacity: 100,
        surfaceColor: kind === 'block' ? '#ffffff' : undefined,
        textColor: '#263238',
        borderWidth: kind === 'block' ? 1 : 0,
        borderColor: '#d7dfe2',
        borderStyle: 'solid',
        cornerRadius: kind === 'block' ? 4 : 0,
      },
      children: [],
    }
  }

  function makeButtonPreset(): FrontendWorkshopNode {
    const node = makeNode('text')
    node.label = '按钮'
    node.text = '按钮文字'
    node.semanticRole = 'action'
    node.action = { kind: 'none' }
    node.style = {
      ...node.style,
      surfaceColor: '#263238',
      textColor: '#ffffff',
      fontWeight: 600,
      align: 'center',
      padding: { top: 9, right: 14, bottom: 9, left: 14 },
      cornerRadius: 3,
    }
    return node
  }

  function nodeLayer(node: FrontendWorkshopNode): FrontendWorkshopLayer | undefined {
    const context = getContext()

    return context.currentLayers.value.find((layer) => layer.id === node.layerId)
  }

  function nodeCanEdit(node: FrontendWorkshopNode, index: number): boolean {
    const context = getContext()

    const layer = nodeLayer(node)
    if (layer && (!layer.visible || layer.locked)) return false
    if (context.activeLayerId.value && node.layerId !== context.activeLayerId.value) return false
    return !readNodePlacement(node, context.canvasMode.value, index).locked
  }

  function selectNode(id: string): void {
    const context = getContext()

    const page = context.currentPage.value
    const node = page ? findFrontendWorkshopNode(page.nodes, id) : undefined
    if (!node || nodeLayer(node)?.visible === false) return
    context.selectedNodeId.value = id
    context.activePanel.value = null
  }

  function editableLayerId(): string | undefined {
    const context = getContext()

    const active = context.currentLayers.value.find(
      (layer) => layer.id === context.activeLayerId.value,
    )
    if (active?.visible && !active.locked) return active.id
    return context.currentLayers.value.find((layer) => layer.visible && !layer.locked)?.id
  }

  function appendedPlacement(
    nodes: FrontendWorkshopNode[],
    node: FrontendWorkshopNode,
    viewport: FrontendWorkshopLayoutViewport,
  ): FrontendWorkshopNodePlacement {
    const base = defaultNodePlacement(node.kind, viewport, 0)
    let bottom = 0
    let zIndex = base.zIndex
    nodes.forEach((existing, index) => {
      const placement = readNodePlacement(existing, viewport, index)
      bottom = Math.max(bottom, placement.y + placement.height)
      zIndex = Math.max(zIndex, placement.zIndex + 1)
    })
    return { ...base, y: nodes.length ? bottom + 24 : base.y, zIndex: Math.min(999, zIndex) }
  }

  function addNode(kind: FrontendWorkshopNodeKind): string | undefined {
    const context = getContext()

    if (context.props.sourceOwnerState !== 'visual') {
      if (context.props.sourceOwnerState === 'source') context.emit('sourceAddRequested', kind)
      return
    }
    const page = context.currentPage.value
    if (!page || !isFrontendWorkshopCreatableNodeKind(kind)) return undefined
    const layerId = editableLayerId()
    if (!layerId) {
      context.status.value = '没有可编辑图层。'
      return undefined
    }
    const node = makeNode(kind)
    if (
      !context.updateProject((project) => {
        const target = project.pages.find((item) => item.id === page.id)
        if (!target) return
        node.layerId = layerId
        node.layout = {
          phone: appendedPlacement(target.nodes, node, 'phone'),
          wide: appendedPlacement(target.nodes, node, 'wide'),
        }
        target.nodes.push(node)
      })
    )
      return undefined
    context.selectedNodeId.value = node.id
    context.activePanel.value = null
    void nextTick(() => context.workspaceOwner.value?.revealNode(node.id))
    return node.id
  }

  function addButtonPreset(): void {
    const context = getContext()

    if (context.props.sourceOwnerState !== 'visual') {
      if (context.props.sourceOwnerState === 'source') context.emit('sourceAddRequested', 'button')
      return
    }
    const page = context.currentPage.value
    const layerId = editableLayerId()
    if (!page || !layerId) return
    const node = makeButtonPreset()
    if (
      !context.updateProject((project) => {
        const target = project.pages.find((item) => item.id === page.id)
        if (!target) return
        node.layerId = layerId
        node.layout = {
          phone: appendedPlacement(target.nodes, node, 'phone'),
          wide: appendedPlacement(target.nodes, node, 'wide'),
        }
        target.nodes.push(node)
      })
    )
      return
    context.selectedNodeId.value = node.id
  }

  function removeNodeById(id = getContext().selectedNodeId.value): void {
    const context = getContext()

    const page = context.currentPage.value
    if (!page || !id) return
    const node = findFrontendWorkshopNode(page.nodes, id)
    const index = page.nodes.findIndex((item) => item.id === id)
    if (!node || !nodeCanEdit(node, Math.max(0, index))) return
    if (
      !context.updateProject((project) => removeFrontendWorkshopNodeSubtree(project, page.id, id))
    )
      return
    context.selectedNodeId.value = ''
    context.activePanel.value = null
    context.workspaceOwner.value?.closeOverlapPicker()
  }

  function toggleSelectedNodeVisibility(): void {
    const context = getContext()

    const pageId = context.currentPage.value?.id
    const nodeId = context.selectedNodeId.value
    if (!pageId || !nodeId) return
    context.updateProject((project) => {
      const page = project.pages.find((item) => item.id === pageId)
      const node = page ? findFrontendWorkshopNode(page.nodes, nodeId) : undefined
      if (node) node.hidden = !node.hidden
    })
    context.selectedNodeId.value = ''
  }

  function toggleSelectedLock(): void {
    const context = getContext()

    const pageId = context.currentPage.value?.id
    const nodeId = context.selectedNodeId.value
    if (!pageId || !nodeId) return
    context.updateProject((project) => {
      const page = project.pages.find((item) => item.id === pageId)
      const node = page ? findFrontendWorkshopNode(page.nodes, nodeId) : undefined
      if (!node) return
      const index = page!.nodes.findIndex((item) => item.id === nodeId)
      const placement = readNodePlacement(node, context.canvasMode.value, Math.max(index, 0))
      node.layout ??= {}
      node.layout[context.canvasMode.value] = { ...placement, locked: !placement.locked }
    })
  }

  function duplicateSelectedNode(): void {
    const context = getContext()

    const page = context.currentPage.value
    const source = context.selectedNode.value
    const project = context.currentProject.value
    if (!page || !source || !project) return
    const ids = new Set<string>()
    const collect = (node: FrontendWorkshopNode): void => {
      ids.add(node.id)
      node.children.forEach(collect)
    }
    project.pages.forEach((item) => item.nodes.forEach(collect))
    const { node: copy } = duplicateFrontendWorkshopNodeSubtree(toRaw(source), ids)
    copy.label = `${source.label} 副本`
    copy.hidden = false
    for (const viewport of ['phone', 'wide'] as const) {
      const placement = readNodePlacement(
        source,
        viewport,
        Math.max(
          0,
          page.nodes.findIndex((item) => item.id === source.id),
        ),
      )
      copy.layout ??= {}
      copy.layout[viewport] = {
        ...placement,
        x: placement.x + 12,
        y: placement.y + 12,
        zIndex: Math.min(999, placement.zIndex + 1),
        locked: false,
      }
    }
    if (
      !context.updateProject((draft) =>
        draft.pages.find((item) => item.id === page.id)?.nodes.push(copy),
      )
    )
      return
    context.selectedNodeId.value = copy.id
  }

  function restoreProjectSnapshot(snapshot: FrontendWorkshopProject): void {
    const context = getContext()

    const current = context.currentProject.value
    if (!current) return
    const next = cloneProject(snapshot)
    context.replaceCurrentProject(next)
    if (
      context.selectedNodeId.value &&
      !next.pages.some((page) => findFrontendWorkshopNode(page.nodes, context.selectedNodeId.value))
    )
      context.selectedNodeId.value = ''
    void context.persistProject(next)
  }

  function undo(): void {
    const context = getContext()

    const current = context.currentProject.value
    const previous = context.undoStack.value.pop()
    if (!current || !previous) return
    context.redoStack.value.push(cloneProject(current))
    restoreProjectSnapshot(previous)
  }

  function redo(): void {
    const context = getContext()

    const current = context.currentProject.value
    const next = context.redoStack.value.pop()
    if (!current || !next) return
    context.undoStack.value.push(cloneProject(current))
    restoreProjectSnapshot(next)
  }

  function requestUndo(): void {
    const context = getContext()

    if (context.props.sourceOwnerState === 'source') context.emit('sourceUndoRequested')
    else undo()
  }

  function requestRedo(): void {
    const context = getContext()

    if (context.props.sourceOwnerState === 'source') context.emit('sourceRedoRequested')
    else redo()
  }

  function addFromQuickMenu(kind: FrontendWorkshopNodeKind | 'button'): void {
    const context = getContext()

    if (kind === 'button') addButtonPreset()
    else addNode(kind)
    context.quickAddOpen.value = false
  }

  function clearSelection(): void {
    const context = getContext()

    context.selectedNodeId.value = ''
    context.activePanel.value = null
  }

  function hideNode(nodeId: string): void {
    const context = getContext()

    context.selectedNodeId.value = nodeId
    toggleSelectedNodeVisibility()
  }

  function toggleNodeLock(nodeId: string): void {
    const context = getContext()

    context.selectedNodeId.value = nodeId
    toggleSelectedLock()
  }

  function duplicateNode(nodeId: string): void {
    const context = getContext()

    context.selectedNodeId.value = nodeId
    duplicateSelectedNode()
  }
  return {
    makeNode,
    makeButtonPreset,
    nodeLayer,
    nodeCanEdit,
    selectNode,
    editableLayerId,
    appendedPlacement,
    addNode,
    addButtonPreset,
    removeNodeById,
    toggleSelectedNodeVisibility,
    toggleSelectedLock,
    duplicateSelectedNode,
    restoreProjectSnapshot,
    undo,
    redo,
    requestUndo,
    requestRedo,
    addFromQuickMenu,
    clearSelection,
    hideNode,
    toggleNodeLock,
    duplicateNode,
  }
}
