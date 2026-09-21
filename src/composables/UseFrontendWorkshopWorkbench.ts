import type { EmitFn } from 'vue'
import { computed, nextTick, onMounted, onUnmounted, ref, toRaw, useTemplateRef, watch } from 'vue'
import FrontendWorkshopAssetLibrary from '../components/FrontendWorkshopAssetLibrary.vue'
import { type FrontendWorkshopViewportAction } from '../components/FrontendWorkshopProjectBar.vue'
import { type FrontendWorkshopToolRailTool } from '../components/FrontendWorkshopToolRail.vue'
import FrontendWorkshopTutorial from '../components/FrontendWorkshopTutorial.vue'
import { SRL_BACK_REQUEST_EVENT, type SrlBackRequestDetail } from '../composables/UseBackStack'
import { writeAppResumeState } from '../core/AppResumeState'
import type { FrontendWorkshopPage } from '../types/FrontendWorkshopProject'
import {
  findFrontendWorkshopNode,
  type FrontendWorkshopAssetLink,
  type FrontendWorkshopLayoutViewport,
  type FrontendWorkshopNode,
  type FrontendWorkshopNodeKind,
  type FrontendWorkshopPanel,
  type FrontendWorkshopProject,
} from '../types/FrontendWorkshopProject'
import type {
  EditorRoute,
  FrontendWorkshopWorkbenchEvents,
  FrontendWorkshopWorkbenchProps,
  WorkspaceOwner,
} from '../types/FrontendWorkshopWorkbenchView'
import { type FrontendWorkshopInspectorTab } from '../utils/FrontendWorkshopInspectorRegistry'
import {
  getFrontendWorkshopProjectCompatibilityIssues,
  renderFrontendWorkshopGreetingBundle,
  renderFrontendWorkshopProject,
} from '../utils/FrontendWorkshopProjectRenderer'
import { useWorkshopNodeEditing } from './UseWorkshopNodeEditing'
import { useWorkshopProjectManagement } from './UseWorkshopProjectManagement'
import { createFrontendWorkshopGreetingFile } from '../utils/FrontendWorkshopSourceDelivery'
import { confirmAction } from './UseConfirmDialog'
export type {
  EditorRoute,
  FrontendWorkshopSourceOwnerState,
  FrontendWorkshopWorkbenchEvents,
  FrontendWorkshopWorkbenchProps,
  WorkspaceOwner,
} from '../types/FrontendWorkshopWorkbenchView'

export function useFrontendWorkshopWorkbench(
  props: Readonly<
    FrontendWorkshopWorkbenchProps &
      Required<
        Pick<
          FrontendWorkshopWorkbenchProps,
          'sourceOwnerState' | 'sourceCanUndo' | 'sourceCanRedo' | 'sourceMarkup' | 'sourceSaving'
        >
      >
  >,
  emit: EmitFn<FrontendWorkshopWorkbenchEvents>,
) {
  const {
    makeNode,
    selectNode,
    addNode,
    removeNodeById,
    requestUndo,
    requestRedo,
    addFromQuickMenu,
    clearSelection,
    hideNode,
    toggleNodeLock,
    duplicateNode,
  } = useWorkshopNodeEditing(() => ({
    NODE_LABELS,
    currentLayers,
    activeLayerId,
    canvasMode,
    currentPage,
    selectedNodeId,
    activePanel,
    props,
    emit,
    status,
    updateProject,
    workspaceOwner,
    selectedNode,
    currentProject,
    replaceCurrentProject,
    persistProject,
    undoStack,
    redoStack,
    quickAddOpen,
  }))

  const {
    replaceCurrentProject,
    updateProject,
    commitWorkspaceGesture,
    persistProject,
    loadProjects,
    openProject,
    returnToProjectHome,
    createProject,
    createTemplateProject,
    duplicateProject,
    deleteProject,
    selectGreetingPage,
    addGreetingPage,
    duplicateGreetingPage,
    deleteGreetingPage,
    renameCurrentProject,
    renameGreetingPage,
  } = useWorkshopProjectManagement(() => ({
    currentProject,
    undoStack,
    redoStack,
    projects,
    status,
    get latestProjectSaveToken() {
      return latestProjectSaveToken
    },
    set latestProjectSaveToken(value: typeof latestProjectSaveToken) {
      latestProjectSaveToken = value
    },
    saveStatus,
    get projectSaveQueue() {
      return projectSaveQueue
    },
    set projectSaveQueue(value: typeof projectSaveQueue) {
      projectSaveQueue = value
    },
    loading,
    currentProjectId,
    activePageId,
    selectedNodeId,
    activeLayerId,
    activePanel,
    quickAddOpen,
    layersOpen,
    moreToolsOpen,
    editorRoute,
    workspaceOwner,
    closePreview,
    makeNode,
    currentPage,
  }))

  const NODE_LABELS: Record<FrontendWorkshopNodeKind, string> = {
    block: '区块',
    text: '文字',
    image: '图片',
    divider: '分隔线',
    control: '表单控件',
  }

  const PANEL_LABELS: Record<FrontendWorkshopPanel, string> = {
    structure: '布局',
    content: '内容',
    appearance: '外观',
    interaction: '交互',
    ai: 'AI',
  }

  const MANUAL_PANELS: FrontendWorkshopPanel[] = [
    'content',
    'appearance',
    'structure',
    'interaction',
  ]

  const projects = ref<FrontendWorkshopProject[]>([])

  const currentProjectId = ref('')

  const activePageId = ref('')

  const selectedNodeId = ref('')

  const activeLayerId = ref('')

  const activePanel = ref<FrontendWorkshopPanel | null>(null)

  const canvasMode = ref<FrontendWorkshopLayoutViewport>('phone')

  const loading = ref(true)

  const status = ref('')

  const saveStatus = ref('')

  const pageStripCollapsed = ref(true)

  const toolRailCollapsed = ref(false)

  const quickAddOpen = ref(false)

  const layersOpen = ref(false)

  const moreToolsOpen = ref(false)

  const copiedNodeStyle = ref<FrontendWorkshopNode['style']>()

  const editorRoute = ref<EditorRoute>('workspace')

  const workspaceOwner = useTemplateRef<WorkspaceOwner>('workspaceOwner')

  const assetLibraryOwner =
    useTemplateRef<InstanceType<typeof FrontendWorkshopAssetLibrary>>('assetLibraryOwner')

  const tutorialOwner =
    useTemplateRef<InstanceType<typeof FrontendWorkshopTutorial>>('tutorialOwner')

  const undoStack = ref<FrontendWorkshopProject[]>([])

  const redoStack = ref<FrontendWorkshopProject[]>([])

  const previewOpen = ref(false)

  const compatibilityOpen = ref(false)

  const previewGreetingIndex = ref(0)

  const previewWidth = ref<number | 'fit'>(390)

  const previewStage = useTemplateRef<HTMLElement>('previewStage')

  const previewStageWidth = ref(390)

  let previewResizeObserver: ResizeObserver | undefined

  let projectSaveQueue = Promise.resolve()

  let latestProjectSaveToken = 0

  let statusDismissTimer: ReturnType<typeof setTimeout> | undefined

  const currentProject = computed<FrontendWorkshopProject | undefined>(() =>
    projects.value.find((project) => project.id === currentProjectId.value),
  )

  const currentPage = computed<FrontendWorkshopPage | undefined>(
    () =>
      currentProject.value?.pages.find((page) => page.id === activePageId.value) ??
      currentProject.value?.pages[0],
  )

  const selectedNode = computed<FrontendWorkshopNode | undefined>(() =>
    currentPage.value
      ? findFrontendWorkshopNode(currentPage.value.nodes, selectedNodeId.value)
      : undefined,
  )

  const currentLayers = computed(() => currentPage.value?.layers ?? [])

  const projectCompatibilityIssues = computed(() =>
    currentProject.value ? getFrontendWorkshopProjectCompatibilityIssues(currentProject.value) : [],
  )

  const inspectorTab = computed<FrontendWorkshopInspectorTab>(() => {
    if (activePanel.value === 'structure') return 'layout'
    if (activePanel.value === 'interaction') return 'interaction'
    if (activePanel.value === 'appearance') return 'appearance'
    return 'content'
  })

  const activeToolRailTool = computed<FrontendWorkshopToolRailTool | undefined>(() => {
    if (quickAddOpen.value) return 'quick-add'
    if (layersOpen.value) return 'layers'
    if (moreToolsOpen.value) return 'more'
    return undefined
  })

  const canUndoCurrentProject = computed(() =>
    props.sourceOwnerState === 'source' ? props.sourceCanUndo : Boolean(undoStack.value.length),
  )

  const canRedoCurrentProject = computed(() =>
    props.sourceOwnerState === 'source' ? props.sourceCanRedo : Boolean(redoStack.value.length),
  )

  const renderedGreetingBundle = computed(() =>
    currentProject.value && !projectCompatibilityIssues.value.length
      ? renderFrontendWorkshopGreetingBundle(currentProject.value)
      : { firstMessage: '', alternateGreetings: [], greetings: [] },
  )

  const previewRenderedProject = computed(() => {
    const project = currentProject.value
    const page = project?.pages[previewGreetingIndex.value]
    return project && page && !projectCompatibilityIssues.value.length
      ? renderFrontendWorkshopProject(project, page.id)
      : ''
  })

  const previewCssWidth = computed(() =>
    previewWidth.value === 'fit' ? undefined : previewWidth.value,
  )

  const previewScale = computed(() =>
    previewCssWidth.value ? Math.min(1, previewStageWidth.value / previewCssWidth.value) : 1,
  )

  function openTutorial(): void {
    tutorialOwner.value?.open()
    moreToolsOpen.value = false
  }

  function toggleQuickAdd(): void {
    quickAddOpen.value = !quickAddOpen.value
    layersOpen.value = false
    moreToolsOpen.value = false
  }

  function toggleLayers(): void {
    layersOpen.value = !layersOpen.value
    quickAddOpen.value = false
    moreToolsOpen.value = false
  }

  function toggleMoreTools(): void {
    moreToolsOpen.value = !moreToolsOpen.value
    quickAddOpen.value = false
    layersOpen.value = false
  }

  function selectToolRailTool(tool: FrontendWorkshopToolRailTool): void {
    if (tool === 'quick-add') toggleQuickAdd()
    else if (tool === 'layers') toggleLayers()
    else if (tool === 'ai') openDetailedAi()
    else toggleMoreTools()
  }

  function openDetailedAi(): void {
    quickAddOpen.value = false
    layersOpen.value = false
    moreToolsOpen.value = false
    if (props.sourceOwnerState === 'source') emit('sourceAiRequested')
    else if (props.sourceOwnerState === 'pending')
      status.value = '正在确认当前 Source，请稍后再打开详细 AI。'
    else {
      status.value = '详细 AI 工作台使用 Source；正在切换到源码。'
      void openAdvancedSource()
    }
  }

  async function openAdvancedSource(): Promise<void> {
    await projectSaveQueue
    if (saveStatus.value === '保存失败') return
    moreToolsOpen.value = false
    emit('sourceRequested')
  }

  function openComponentLibrary(): void {
    moreToolsOpen.value = false
    if (props.sourceOwnerState === 'source') emit('sourceComponentLibraryRequested')
    else void openAdvancedSource()
  }

  function openAssetLibrary(mode: 'library' | 'hosting' = 'library'): void {
    editorRoute.value = 'assets'
    moreToolsOpen.value = false
    void nextTick(() => assetLibraryOwner.value?.open(mode, 'workspace'))
  }

  function closeAssetLibrary(): void {
    editorRoute.value = 'workspace'
  }

  function insertAssetFromLibrary(asset: FrontendWorkshopAssetLink): void {
    if (props.sourceOwnerState === 'source') {
      emit('sourceAddRequested', 'image', asset)
      editorRoute.value = 'workspace'
      return
    }
    const id = addNode('image')
    if (!id) return
    updateProject((project) => {
      const node = findFrontendWorkshopNode(
        project.pages.find((page) => page.id === activePageId.value)?.nodes ?? [],
        id,
      )
      if (node) {
        node.label = asset.name
        node.imageUrl = asset.url
      }
    })
    editorRoute.value = 'workspace'
    activePanel.value = 'content'
  }

  function copySelectedStyle(): void {
    if (!selectedNode.value) return
    copiedNodeStyle.value = structuredClone(toRaw(selectedNode.value.style))
  }

  function pasteSelectedStyle(): void {
    const pageId = currentPage.value?.id
    const nodeId = selectedNodeId.value
    if (!pageId || !nodeId || !copiedNodeStyle.value) return
    updateProject((project) => {
      const node = findFrontendWorkshopNode(
        project.pages.find((page) => page.id === pageId)?.nodes ?? [],
        nodeId,
      )
      if (node) node.style = structuredClone(copiedNodeStyle.value!)
    })
  }

  function toggleInspector(panel: FrontendWorkshopPanel): void {
    if (!selectedNode.value || !MANUAL_PANELS.includes(panel)) return
    activePanel.value = activePanel.value === panel ? null : panel
  }

  function requestPreview(): void {
    const request = { handled: false, openLegacyPreview: openPreview }
    emit('previewRequested', request)
    if (!request.handled) request.openLegacyPreview()
  }

  function requestCanvasViewport(action: FrontendWorkshopViewportAction): void {
    if (props.sourceOwnerState !== 'visual') {
      emit('sourceViewportRequested', action)
      return
    }
    const owner = workspaceOwner.value
    if (action === 'phone' || action === 'wide') owner?.setCanvasMode(action)
    else if (action === 'zoom-out') owner?.adjustZoom(-0.25)
    else if (action === 'zoom-in') owner?.adjustZoom(0.25)
    else if (action === 'reset') owner?.resetZoom()
    else if (action === 'fit-canvas') owner?.fitCanvas()
    else owner?.fitSelection()
  }

  function requestCompatibility(): void {
    if (props.sourceOwnerState !== 'visual') emit('sourceCompatibilityRequested')
    else compatibilityOpen.value = true
  }

  function openPreview(): void {
    if (projectCompatibilityIssues.value.length) {
      status.value = `当前项目不能交付：${projectCompatibilityIssues.value[0]}`
      return
    }
    previewGreetingIndex.value = Math.max(
      0,
      currentProject.value?.pages.findIndex((page) => page.id === activePageId.value) ?? 0,
    )
    previewOpen.value = true
    void nextTick(updatePreviewStageWidth)
  }

  function closePreview(): void {
    previewOpen.value = false
  }

  function updatePreviewStageWidth(): void {
    previewStageWidth.value = Math.max(320, Math.floor(previewStage.value?.clientWidth ?? 390))
  }

  function navigatePreviewGreeting(target: number): void {
    if (target >= 0 && target < renderedGreetingBundle.value.greetings.length)
      previewGreetingIndex.value = target
  }

  async function writeClipboard(value: string): Promise<void> {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value)
      return
    }
    const textarea = document.createElement('textarea')
    textarea.value = value
    textarea.style.cssText = 'position:fixed;opacity:0;pointer-events:none'
    document.body.append(textarea)
    textarea.select()
    document.execCommand('copy')
    textarea.remove()
  }

  async function copyCurrentGreetingMarkup(): Promise<void> {
    if (!previewRenderedProject.value) return
    await writeClipboard(previewRenderedProject.value)
    status.value = '已复制当前开场白 HTML/CSS。'
  }

  const deliverySaving = ref(false)
  async function copyDeliveryMarkup(): Promise<void> {
    if (props.sourceOwnerState !== 'visual') {
      if (!props.sourceMarkup || props.sourceSaving || deliverySaving.value) return
      deliverySaving.value = true
      try {
        if (
          !(await confirmAction({
            title: '存入开场白资源',
            centered: true,
            message:
              '将当前作品的主开场白、全部备用开场白及配套脚本存入资源库。相同内容不会重复保存。',
            confirmLabel: '确认存入',
          }))
        )
          return
        const file = createFrontendWorkshopGreetingFile(
          props.sourceMarkup,
          currentProject.value?.name ?? '我的开场白',
        )
        const { greetingResourceService } = await import('../core/AppContainer')
        await greetingResourceService.save(file)
        status.value = '已存入资源库 → 开场白；可在资源内容中应用到角色卡。'
      } catch (reason) {
        status.value = reason instanceof Error ? reason.message : '存入资源库失败'
      } finally {
        deliverySaving.value = false
      }
      return
    }
    const bundle = renderedGreetingBundle.value
    if (!bundle.firstMessage) return
    const value = bundle.alternateGreetings.length
      ? JSON.stringify(
          { first_mes: bundle.firstMessage, alternate_greetings: bundle.alternateGreetings },
          null,
          2,
        )
      : bundle.firstMessage
    await writeClipboard(value)
    status.value = '已复制开场白交付内容。'
  }

  function handleBack(event: KeyboardEvent): void {
    if (event.key !== 'Escape' || event.defaultPrevented) return
    let handled = true
    if (previewOpen.value) closePreview()
    else if (compatibilityOpen.value) compatibilityOpen.value = false
    else if (tutorialOwner.value?.back()) {
      /* Tutorial owner consumed Back. */
    } else if (editorRoute.value === 'assets') assetLibraryOwner.value?.back()
    else if (quickAddOpen.value) quickAddOpen.value = false
    else if (layersOpen.value) layersOpen.value = false
    else if (moreToolsOpen.value) moreToolsOpen.value = false
    else if (activePanel.value) activePanel.value = null
    else if (currentProject.value) returnToProjectHome()
    else handled = false
    if (handled) {
      event.preventDefault()
      event.stopImmediatePropagation()
    }
  }

  function handleBackRequest(event: Event): void {
    if (!(event instanceof CustomEvent) || (!previewOpen.value && !compatibilityOpen.value)) return
    const detail = event.detail as SrlBackRequestDetail | undefined
    if (!detail || detail.handled) return
    if (compatibilityOpen.value) compatibilityOpen.value = false
    else closePreview()
    detail.handled = true
  }

  watch(currentProjectId, (id) => {
    writeAppResumeState({
      feature: id ? 'frontendWorkshop' : 'featureHub',
      projectId: id || undefined,
      subpage: id ? activePageId.value : 'frontendWorkshop',
    })
    document.body.classList.toggle('has-frontend-workbench', Boolean(id))
  })

  watch(activePageId, (pageId) => {
    if (currentProjectId.value)
      writeAppResumeState({
        feature: 'frontendWorkshop',
        projectId: currentProjectId.value,
        subpage: pageId,
      })
  })

  watch(status, (message) => {
    if (statusDismissTimer) clearTimeout(statusDismissTimer)
    if (message)
      statusDismissTimer = setTimeout(() => {
        if (status.value === message) status.value = ''
      }, 3200)
  })

  watch(previewOpen, async (open) => {
    previewResizeObserver?.disconnect()
    previewResizeObserver = undefined
    if (!open) return
    await nextTick()
    updatePreviewStageWidth()
    if (typeof ResizeObserver !== 'undefined' && previewStage.value) {
      previewResizeObserver = new ResizeObserver(updatePreviewStageWidth)
      previewResizeObserver.observe(previewStage.value)
    }
  })

  onMounted(() => {
    document.body.classList.add('has-frontend-workbench-route')
    void loadProjects()
    window.addEventListener('keydown', handleBack, true)
    document.addEventListener(SRL_BACK_REQUEST_EVENT, handleBackRequest)
  })

  onUnmounted(() => {
    if (statusDismissTimer) clearTimeout(statusDismissTimer)
    previewResizeObserver?.disconnect()
    document.body.classList.remove('has-frontend-workbench', 'has-frontend-workbench-route')
    window.removeEventListener('keydown', handleBack, true)
    document.removeEventListener(SRL_BACK_REQUEST_EVENT, handleBackRequest)
  })
  return {
    workspaceOwner,
    currentProject,
    returnToProjectHome,
    loading,
    createProject,
    createTemplateProject,
    projects,
    openProject,
    duplicateProject,
    deleteProject,
    saveStatus,
    canvasMode,
    selectedNode,
    projectCompatibilityIssues,
    renameCurrentProject,
    requestPreview,
    copyDeliveryMarkup,
    deliverySaving,
    requestCompatibility,
    requestCanvasViewport,
    pageStripCollapsed,
    currentPage,
    selectGreetingPage,
    addGreetingPage,
    renameGreetingPage,
    duplicateGreetingPage,
    deleteGreetingPage,
    activeToolRailTool,
    canUndoCurrentProject,
    canRedoCurrentProject,
    selectToolRailTool,
    requestUndo,
    requestRedo,
    toolRailCollapsed,
    quickAddOpen,
    addFromQuickMenu,
    NODE_LABELS,
    layersOpen,
    activeLayerId,
    selectedNodeId,
    commitWorkspaceGesture,
    status,
    moreToolsOpen,
    openComponentLibrary,
    copySelectedStyle,
    copiedNodeStyle,
    pasteSelectedStyle,
    openAssetLibrary,
    openTutorial,
    openAdvancedSource,
    selectNode,
    clearSelection,
    replaceCurrentProject,
    hideNode,
    toggleNodeLock,
    duplicateNode,
    removeNodeById,
    activePanel,
    MANUAL_PANELS,
    toggleInspector,
    PANEL_LABELS,
    inspectorTab,
    editorRoute,
    closeAssetLibrary,
    insertAssetFromLibrary,
    compatibilityOpen,
    previewOpen,
    closePreview,
    previewWidth,
    previewRenderedProject,
    previewCssWidth,
    previewScale,
    renderedGreetingBundle,
    previewGreetingIndex,
    navigatePreviewGreeting,
    copyCurrentGreetingMarkup,
  }
}
