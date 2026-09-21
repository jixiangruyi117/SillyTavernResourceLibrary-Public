import type { ComputedRef, Ref, ShallowRef } from 'vue'
import { nextTick, toRaw } from 'vue'
import { confirmAction } from '../composables/UseConfirmDialog'
import {
  frontendWorkshopProjectService,
  frontendWorkshopSourceDocumentService,
} from '../core/FrontendWorkshopContainer'
import {
  frontendWorkshopGreetingTemplates,
  frontendWorkshopBlankSource,
} from '../utils/FrontendWorkshopGreetingTemplates'
import { readAppResumeState } from '../core/AppResumeState'
import type { FrontendWorkshopPage } from '../types/FrontendWorkshopProject'
import {
  createFrontendWorkshopProject,
  type FrontendWorkshopNode,
  type FrontendWorkshopNodeKind,
  type FrontendWorkshopPanel,
  type FrontendWorkshopProject,
} from '../types/FrontendWorkshopProject'
import type { EditorRoute, WorkspaceOwner } from '../types/FrontendWorkshopWorkbenchView'
import {
  applyFrontendWorkshopCommand,
  countExternalGreetingPageReferences,
  duplicateFrontendWorkshopGreetingPage,
  removeFrontendWorkshopGreetingPage,
} from '../utils/FrontendWorkshopCommandSystem'
import { cloneFrontendWorkshopProject as cloneProject } from '../utils/FrontendWorkshopProjectGeometry'

interface WorkshopProjectManagementContext {
  currentProject: ComputedRef<FrontendWorkshopProject | undefined>
  undoStack: Ref<FrontendWorkshopProject[]>
  redoStack: Ref<FrontendWorkshopProject[]>
  projects: Ref<FrontendWorkshopProject[]>
  status: Ref<string, string>
  latestProjectSaveToken: number
  saveStatus: Ref<string, string>
  projectSaveQueue: Promise<void>
  loading: Ref<boolean, boolean>
  currentProjectId: Ref<string, string>
  activePageId: Ref<string, string>
  selectedNodeId: Ref<string, string>
  activeLayerId: Ref<string, string>
  activePanel: Ref<FrontendWorkshopPanel | null>
  quickAddOpen: Ref<boolean, boolean>
  layersOpen: Ref<boolean, boolean>
  moreToolsOpen: Ref<boolean, boolean>
  editorRoute: Ref<EditorRoute>
  workspaceOwner: Readonly<ShallowRef<WorkspaceOwner | null>>
  closePreview: () => void
  makeNode: (kind: FrontendWorkshopNodeKind) => FrontendWorkshopNode
  currentPage: ComputedRef<FrontendWorkshopPage | undefined>
}

export function useWorkshopProjectManagement(getContext: () => WorkshopProjectManagementContext) {
  function rememberCurrentProject(): void {
    const context = getContext()

    const current = context.currentProject.value
    if (!current) return
    const snapshot = cloneProject(current)
    const previous = context.undoStack.value.at(-1)
    if (previous && JSON.stringify(previous) === JSON.stringify(snapshot)) return
    context.undoStack.value.push(snapshot)
    if (context.undoStack.value.length > 30) context.undoStack.value.shift()
    context.redoStack.value = []
  }

  function replaceCurrentProject(next: FrontendWorkshopProject): void {
    const context = getContext()

    const index = context.projects.value.findIndex((project) => project.id === next.id)
    if (index >= 0) context.projects.value.splice(index, 1, next)
  }

  function updateProject(mutator: (project: FrontendWorkshopProject) => void): boolean {
    const context = getContext()

    const current = context.currentProject.value
    if (!current) return false
    const result = applyFrontendWorkshopCommand(toRaw(current), mutator)
    if (!result.ok) {
      context.status.value = result.issues.map((item) => item.message).join('；')
      return false
    }
    rememberCurrentProject()
    replaceCurrentProject(result.project)
    void persistProject(result.project)
    return true
  }

  function commitWorkspaceGesture(payload: {
    previousProject: FrontendWorkshopProject
    project: FrontendWorkshopProject
  }): void {
    const context = getContext()

    replaceCurrentProject(payload.project)
    context.undoStack.value.push(payload.previousProject)
    if (context.undoStack.value.length > 30) context.undoStack.value.shift()
    context.redoStack.value = []
    void persistProject(payload.project)
  }

  function persistProject(project: FrontendWorkshopProject): Promise<void> {
    const context = getContext()

    const snapshot = cloneProject(project)
    const token = ++context.latestProjectSaveToken
    context.saveStatus.value = '保存中'
    context.projectSaveQueue = context.projectSaveQueue.then(async () => {
      try {
        const saved = await frontendWorkshopProjectService.save(snapshot)
        if (token !== context.latestProjectSaveToken) return
        const index = context.projects.value.findIndex((item) => item.id === saved.id)
        if (index >= 0) context.projects.value.splice(index, 1, saved)
        context.saveStatus.value = '已保存'
      } catch (error) {
        if (token !== context.latestProjectSaveToken) return
        context.saveStatus.value = '保存失败'
        context.status.value = error instanceof Error ? error.message : '项目保存失败'
      }
    })
    return context.projectSaveQueue
  }

  async function loadProjects(): Promise<void> {
    const context = getContext()

    context.loading.value = true
    try {
      context.projects.value = await frontendWorkshopProjectService.list()
      const resume = readAppResumeState()
      const restored = context.projects.value.find(
        (project) => project.id === resume?.projectId && project.kind === 'greeting',
      )
      if (resume?.feature === 'frontendWorkshop' && restored) openProject(restored.id)
    } catch (error) {
      context.status.value = error instanceof Error ? error.message : '项目目录暂时无法读取'
    } finally {
      context.loading.value = false
    }
  }

  function openProject(id: string): void {
    const context = getContext()

    const project = context.projects.value.find((item) => item.id === id)
    if (!project) return
    if (project.kind !== 'greeting') {
      context.status.value = '状态栏旧功能正在重置，本轮只保留开场白编辑。'
      return
    }
    context.currentProjectId.value = id
    context.activePageId.value = project.pages[0]?.id ?? ''
    context.selectedNodeId.value = ''
    context.activeLayerId.value = ''
    context.activePanel.value = null
    context.quickAddOpen.value = false
    context.layersOpen.value = false
    context.moreToolsOpen.value = false
    context.editorRoute.value = 'workspace'
    context.undoStack.value = []
    context.redoStack.value = []
    document.body.classList.add('has-frontend-workbench')
    void nextTick(() => context.workspaceOwner.value?.fitCanvas())
  }

  function returnToProjectHome(): void {
    const context = getContext()

    context.closePreview()
    context.currentProjectId.value = ''
    context.activePageId.value = ''
    context.selectedNodeId.value = ''
    context.activePanel.value = null
    document.body.classList.remove('has-frontend-workbench')
  }

  async function createSourceProject(name: string, authorSource: string): Promise<void> {
    const context = getContext()
    const project = createFrontendWorkshopProject('greeting')
    project.name = name
    project.document.name = name
    try {
      await frontendWorkshopProjectService.save(project)
      await frontendWorkshopSourceDocumentService.createAuthorSourceIfMissing(
        project.id,
        authorSource,
      )
      context.projects.value.unshift(project)
      openProject(project.id)
      context.saveStatus.value = '已保存'
    } catch (error) {
      context.status.value = error instanceof Error ? error.message : '创建失败'
      await loadProjects()
    }
  }

  async function createProject(): Promise<void> {
    await createSourceProject('新的开场白', frontendWorkshopBlankSource)
  }

  async function createTemplateProject(id: string): Promise<void> {
    const template = frontendWorkshopGreetingTemplates.find((item) => item.id === id)
    if (template) await createSourceProject(template.name, template.source)
  }

  async function duplicateProject(id: string): Promise<void> {
    const context = getContext()

    const source = context.projects.value.find((project) => project.id === id)
    if (!source) return
    const copy = cloneProject(source)
    copy.id = crypto.randomUUID()
    copy.document = { id: copy.id, name: `${source.name} · 副本`.slice(0, 120) }
    copy.name = copy.document.name
    copy.createdAt = Date.now()
    copy.updatedAt = copy.createdAt
    const document = await frontendWorkshopSourceDocumentService.get(id)
    await frontendWorkshopProjectService.save(copy)
    if (document)
      await frontendWorkshopSourceDocumentService.createAuthorSourceIfMissing(
        copy.id,
        document.authorSource,
        { origin: document.origin, hostProfile: document.hostProfile },
      )
    context.projects.value.unshift(copy)
  }

  async function deleteProject(id: string): Promise<void> {
    const context = getContext()

    const project = context.projects.value.find((item) => item.id === id)
    if (!project) return
    const confirmed = await confirmAction({
      title: '删除工作台项目',
      message: `删除“${project.name}”？`,
      confirmLabel: '删除',
      danger: true,
    })
    if (!confirmed) return
    await frontendWorkshopProjectService.delete(id)
    context.projects.value = context.projects.value.filter((item) => item.id !== id)
  }

  function selectGreetingPage(pageId: string): void {
    const context = getContext()

    if (!context.currentProject.value?.pages.some((page) => page.id === pageId)) return
    context.activePageId.value = pageId
    context.selectedNodeId.value = ''
    context.activeLayerId.value = ''
    context.activePanel.value = null
  }

  function addGreetingPage(): void {
    const context = getContext()

    const project = context.currentProject.value
    if (!project || project.pages.length >= 12) {
      context.status.value = '一个角色最多制作 12 条开场白。'
      return
    }
    const pageId = crypto.randomUUID()
    updateProject((draft) => {
      draft.pages.push({
        id: pageId,
        name: `备用开场白 ${draft.pages.length}`,
        layers: [{ id: `layer-${pageId}`, name: '默认图层', visible: true, locked: false }],
        nodes: [],
      })
    })
    selectGreetingPage(pageId)
  }

  function duplicateGreetingPage(): void {
    const context = getContext()

    const source = context.currentPage.value
    if (!source || !context.currentProject.value || context.currentProject.value.pages.length >= 12)
      return
    let nextPageId = ''
    if (
      !updateProject((draft) => {
        nextPageId = duplicateFrontendWorkshopGreetingPage(draft, source.id) ?? ''
        const copy = draft.pages.find((page) => page.id === nextPageId)
        if (copy) copy.name = `${source.name} · 变体`.slice(0, 80)
      })
    )
      return
    if (nextPageId) selectGreetingPage(nextPageId)
  }

  async function deleteGreetingPage(): Promise<void> {
    const context = getContext()

    const project = context.currentProject.value
    const page = context.currentPage.value
    if (!project || !page || project.pages[0]?.id === page.id) return
    const references = countExternalGreetingPageReferences(project, page.id)
    if (references) {
      context.status.value = `还有 ${references} 个入口指向该页面，请先修改入口。`
      return
    }
    const confirmed = await confirmAction({
      title: '删除备用开场白',
      message: `删除“${page.name}”？`,
      confirmLabel: '删除',
      danger: true,
    })
    if (!confirmed) return
    const fallback = project.pages[0]?.id ?? ''
    if (!updateProject((draft) => removeFrontendWorkshopGreetingPage(draft, page.id))) return
    selectGreetingPage(fallback)
  }

  function renameCurrentProject(event: Event): void {
    const target = event.target as HTMLInputElement
    const value = target.value.trim().slice(0, 120)
    if (!value) return
    updateProject((project) => {
      project.name = value
      project.document.name = value
    })
  }

  function renameGreetingPage(event: Event): void {
    const context = getContext()

    const pageId = context.currentPage.value?.id
    const value = (event.target as HTMLInputElement).value.trim().slice(0, 80)
    if (!pageId || !value) return
    updateProject((project) => {
      const page = project.pages.find((item) => item.id === pageId)
      if (page) page.name = value
    })
  }
  return {
    rememberCurrentProject,
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
  }
}
