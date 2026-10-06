import type { EmitFn } from 'vue'
import { computed, onMounted, onUnmounted, ref, toRaw, useTemplateRef, watch } from 'vue'
import { confirmAction } from '../composables/UseConfirmDialog'
import {
  frontendWorkshopSourceAiHostReferenceService,
  frontendWorkshopSourceComponentService,
} from '../core/FrontendWorkshopContainer'
import {
  createFrontendWorkshopSourceComponent,
  type FrontendWorkshopSourceComponent,
  type FrontendWorkshopSourceComponentDependency,
  type FrontendWorkshopSourceComponentSharePolicy,
} from '../types/FrontendWorkshopSourceComponent'
import type { FrontendWorkshopSourceDocument } from '../types/FrontendWorkshopSourceDocument'
import {
  createFrontendWorkshopSourceComponentAiProjection,
  createFrontendWorkshopSourceComponentPreviewDocument,
} from '../utils/FrontendWorkshopSourceComponent'
import type { FrontendWorkshopSourceRuntimeNetworkMode } from '../utils/FrontendWorkshopSourceRuntime'
import { downloadBlob } from '../utils/LibraryFormatting'

export type ComponentScope = 'current' | 'mine'

export interface ComponentPreviewProjection {
  document?: FrontendWorkshopSourceDocument
  error?: string
}

export type FrontendWorkshopSourceComponentLibraryProps = {
  sourceDocument: FrontendWorkshopSourceDocument
  networkMode?: FrontendWorkshopSourceRuntimeNetworkMode
}

export type FrontendWorkshopSourceComponentLibraryEvents = {
  close: []
  quickUse: [componentId: string]
  projectComponentsChanged: []
  revisionAccepted: [source: FrontendWorkshopSourceDocument, message: string]
  status: [message: string]
}

export function useFrontendWorkshopSourceComponentLibrary(
  props: Readonly<
    FrontendWorkshopSourceComponentLibraryProps &
      Required<Pick<FrontendWorkshopSourceComponentLibraryProps, 'networkMode'>>
  >,
  emit: EmitFn<FrontendWorkshopSourceComponentLibraryEvents>,
) {
  const activeScope = ref<ComponentScope>('current')

  const components = ref<FrontendWorkshopSourceComponent[]>([])

  const detailComponentId = ref('')

  const aiCreateOpen = ref(false)

  const addMenuOpen = ref(false)

  const busyAction = ref('')

  const error = ref('')

  const importFileInput = useTemplateRef<HTMLInputElement>('importFileInput')

  const assetUrlDraft = ref('')

  const shareLicenseDraft = ref<FrontendWorkshopSourceComponentSharePolicy['license']>('private')

  const shareAllowedDraft = ref(false)

  const derivativesAllowedDraft = ref(true)

  const shareNoticeDraft = ref('')

  const dependencyDrafts = ref<FrontendWorkshopSourceComponentDependency[]>([])

  const requiresJavaScriptDraft = ref(false)

  const requiresNetworkDraft = ref(false)

  const hostApisDraft = ref('')

  const previewRuntimeErrors = ref<Record<string, string>>({})

  const aiNameDraft = ref('')

  const aiInstructionDraft = ref('')

  const aiEditInstruction = ref('')

  let aiAbortController: AbortController | undefined

  const licenseOptions: Array<{
    value: FrontendWorkshopSourceComponentSharePolicy['license']
    label: string
  }> = [
    { value: 'private', label: '仅自己使用' },
    { value: 'unspecified', label: '未指定授权' },
    { value: 'cc0', label: 'CC0' },
    { value: 'cc-by-4.0', label: 'CC BY 4.0' },
    { value: 'mit', label: 'MIT' },
    { value: 'custom', label: '自定义授权' },
  ]

  const currentComponents = computed(() =>
    components.value.filter((component) =>
      component.projectIds.includes(props.sourceDocument.projectId),
    ),
  )

  const visibleComponents = computed(() =>
    activeScope.value === 'current' ? currentComponents.value : components.value,
  )

  const detailComponent = computed(() =>
    components.value.find((component) => component.id === detailComponentId.value),
  )

  const detailAssetUrls = computed(
    () =>
      detailComponent.value?.dependencies.filter(
        (dependency) => dependency.kind === 'external-resource',
      ) ?? [],
  )

  const componentPreviews = computed<Map<string, ComponentPreviewProjection>>(
    () =>
      new Map<string, ComponentPreviewProjection>(
        components.value.map((component) => {
          try {
            return [
              component.id,
              { document: createFrontendWorkshopSourceComponentPreviewDocument(component) },
            ] as const
          } catch (reason) {
            return [
              component.id,
              { error: reason instanceof Error ? reason.message : '组件预览无法生成' },
            ] as const
          }
        }),
      ),
  )

  function componentPreview(componentId: string) {
    return componentPreviews.value.get(componentId)
  }

  function handlePreviewRuntimeError(componentId: string, payload: { message: string }): void {
    previewRuntimeErrors.value = { ...previewRuntimeErrors.value, [componentId]: payload.message }
  }

  async function reload(): Promise<void> {
    components.value = await frontendWorkshopSourceComponentService.list()
    previewRuntimeErrors.value = {}
  }

  function acceptUpdatedComponent(updated: FrontendWorkshopSourceComponent): void {
    components.value = components.value.map((component) =>
      component.id === updated.id ? updated : component,
    )
    const { [updated.id]: _removed, ...remainingErrors } = previewRuntimeErrors.value
    previewRuntimeErrors.value = remainingErrors
  }

  async function run(action: string, task: () => Promise<void>): Promise<void> {
    if (busyAction.value) return
    busyAction.value = action
    error.value = ''
    try {
      await task()
    } catch (reason) {
      error.value = reason instanceof Error ? reason.message : '组件操作失败'
    } finally {
      busyAction.value = ''
    }
  }

  function closeNestedView(): boolean {
    if (addMenuOpen.value) {
      addMenuOpen.value = false
      return true
    }
    if (detailComponentId.value) {
      detailComponentId.value = ''
      return true
    }
    if (aiCreateOpen.value) {
      aiAbortController?.abort()
      aiCreateOpen.value = false
      error.value = ''
      return true
    }
    return false
  }

  function stopAiRequest(): void {
    aiAbortController?.abort()
  }

  function componentAiInstruction(
    action: 'generate' | 'edit',
    instruction: string,
    component: FrontendWorkshopSourceComponent,
  ): string {
    const assetUrls = component.dependencies
      .filter((dependency) => dependency.kind === 'external-resource')
      .map((dependency) => dependency.specifier)
    return [
      action === 'generate'
        ? '请生成一个可独立复用的 Source Component。'
        : '请只修改当前 Source Component。',
      '当前 Author Source 是组件 HTML、CSS、JavaScript 的范围投影。只编辑 Write Scope 允许的字段内容，不要修改字段标记。',
      'HTML 必须保留一个可识别的根元素；不要返回完整 html/head/body 文档。',
      '不要格式化或重写用户没有要求的字段。需要未提供的 Host API 证据时必须请求 Host Reference，不得猜测。',
      assetUrls.length
        ? `可用素材直链：${assetUrls.join('、')}。只有用户要求使用时，才把对应 URL 写入 HTML src/srcset 或 CSS url()。`
        : '当前组件没有可用素材直链。',
      `用户要求：${instruction}`,
    ].join('\n')
  }

  async function requestComponentAiProposal(
    component: FrontendWorkshopSourceComponent,
    action: 'generate' | 'edit',
    instruction: string,
  ) {
    const projection = createFrontendWorkshopSourceComponentAiProjection(component)
    aiAbortController?.abort()
    const controller = new AbortController()
    aiAbortController = controller
    try {
      const orchestration = await frontendWorkshopSourceAiHostReferenceService.request(
        {
          source: projection.document,
          mode: 'edit',
          instruction: componentAiInstruction(action, instruction, component),
          writeScope: { kind: 'ranges', ranges: Object.values(projection.ranges) },
        },
        undefined,
        { signal: controller.signal },
      )
      if (orchestration.status === 'needs-host-reference') {
        throw new Error(
          `缺少可验证的 Host Reference：${orchestration.unresolvedRequests.join('、')}`,
        )
      }
      const attempt = orchestration.attempts.at(-1)
      if (!attempt) throw new Error('组件 AI 没有返回有效 proposal')
      if (attempt.result.proposal.edits.length === 0) {
        throw new Error(`AI 只返回了说明：${attempt.result.proposal.summary}`)
      }
      return { bundle: attempt.bundle, proposal: attempt.result.proposal }
    } finally {
      if (aiAbortController === controller) aiAbortController = undefined
    }
  }

  async function generateComponentWithAi(): Promise<void> {
    const name = aiNameDraft.value.trim()
    const instruction = aiInstructionDraft.value.trim()
    if (!name || !instruction) return
    await run('ai-generate', async () => {
      const base = createFrontendWorkshopSourceComponent({
        name,
        description: instruction,
        source: {
          html: '<div data-srl-ai-component-root></div>',
          css: '',
          javascript: '',
        },
        root: { tagName: 'div' },
        provenance: { origin: 'ai' },
      })
      const result = await requestComponentAiProposal(base, 'generate', instruction)
      const created = await frontendWorkshopSourceComponentService.createFromAiProposal(
        base,
        result.bundle,
        result.proposal,
      )
      components.value = [created, ...components.value.filter((item) => item.id !== created.id)]
      activeScope.value = 'mine'
      aiCreateOpen.value = false
      detailComponentId.value = created.id
      aiNameDraft.value = ''
      aiInstructionDraft.value = ''
      emit('status', `已生成组件“${created.name}”，并保存到我的组件。`)
    })
  }

  async function editComponentWithAi(component: FrontendWorkshopSourceComponent): Promise<void> {
    const instruction = aiEditInstruction.value.trim()
    if (!instruction) return
    await run(`ai-edit:${component.id}`, async () => {
      const snapshot = structuredClone(toRaw(component))
      const result = await requestComponentAiProposal(snapshot, 'edit', instruction)
      const updated = await frontendWorkshopSourceComponentService.applyAiProposalAtRevision(
        snapshot.id,
        snapshot.revision,
        result.bundle,
        result.proposal,
      )
      acceptUpdatedComponent(updated)
      aiEditInstruction.value = ''
      emit('status', `已用 AI 更新组件“${updated.name}”到 v${updated.revision}。`)
    })
  }

  function handleBack(): boolean {
    return closeNestedView()
  }

  function backOrClose(): void {
    if (!closeNestedView()) emit('close')
  }

  function openAiCreate(): void {
    addMenuOpen.value = false
    error.value = ''
    aiCreateOpen.value = true
  }

  function openComponentDetail(componentId: string): void {
    error.value = ''
    detailComponentId.value = componentId
  }

  function choosePortablePackage(): void {
    if (busyAction.value) return
    addMenuOpen.value = false
    const input = importFileInput.value
    if (!input) return
    input.value = ''
    input.click()
  }

  async function handlePortablePackageChange(event: Event): Promise<void> {
    const target = event.target
    const file = target instanceof HTMLInputElement ? target.files?.[0] : undefined
    if (!file) return
    await run('import', async () => {
      const imported = await frontendWorkshopSourceComponentService.importPortablePackage(file)
      components.value = [imported, ...components.value.filter((item) => item.id !== imported.id)]
      activeScope.value = 'mine'
      detailComponentId.value = imported.id
      emit('status', `已导入组件“${imported.name}”。`)
    })
  }

  function normalizeAssetUrl(value: string): string {
    let url: URL
    try {
      url = new URL(value.trim())
    } catch {
      throw new Error('请输入完整的 HTTPS 素材直链')
    }
    if (url.protocol !== 'https:') throw new Error('素材直链必须使用 HTTPS')
    return url.href
  }

  async function saveAssetUrl(component: FrontendWorkshopSourceComponent): Promise<void> {
    await run(`asset-url:${component.id}`, async () => {
      const url = normalizeAssetUrl(assetUrlDraft.value)
      if (
        component.dependencies.some(
          (dependency) => dependency.kind === 'external-resource' && dependency.specifier === url,
        )
      ) {
        throw new Error('这个素材直链已经添加过了')
      }
      const componentSnapshot = structuredClone(toRaw(component))
      const updated = await frontendWorkshopSourceComponentService.updateAtRevision(
        {
          ...componentSnapshot,
          dependencies: [
            ...componentSnapshot.dependencies,
            { kind: 'external-resource', specifier: url, optional: false },
          ],
          runtimeRequirements: {
            ...componentSnapshot.runtimeRequirements,
            requiresNetwork: true,
          },
        },
        component.revision,
      )
      acceptUpdatedComponent(updated)
      assetUrlDraft.value = ''
      emit('projectComponentsChanged')
      emit('status', '已添加素材直链。')
    })
  }

  async function removeAssetUrl(
    component: FrontendWorkshopSourceComponent,
    url: string,
  ): Promise<void> {
    const confirmed = await confirmAction({
      title: '移除素材直链',
      message: '移除后，组件代码中已经使用这个 URL 的位置不会被自动改写。',
      confirmLabel: '移除直链',
      danger: true,
    })
    if (!confirmed) return
    await run(`asset-url:${component.id}`, async () => {
      const componentSnapshot = structuredClone(toRaw(component))
      const updated = await frontendWorkshopSourceComponentService.updateAtRevision(
        {
          ...componentSnapshot,
          dependencies: componentSnapshot.dependencies.filter(
            (dependency) => dependency.kind !== 'external-resource' || dependency.specifier !== url,
          ),
        },
        component.revision,
      )
      acceptUpdatedComponent(updated)
      emit('projectComponentsChanged')
      emit('status', '已移除素材直链。')
    })
  }

  async function insertComponent(component: FrontendWorkshopSourceComponent): Promise<void> {
    await run(`insert:${component.id}`, async () => {
      const result = await frontendWorkshopSourceComponentService.insertIntoProject(
        component.id,
        props.sourceDocument.projectId,
        props.sourceDocument.revision,
      )
      const message = result.projectAssociationUpdated
        ? `已插入组件“${component.name}”，并加入当前组件；可从历史记录撤销`
        : `已插入组件“${component.name}”，但未能关联到当前组件；Source 修改已保留`
      emit('revisionAccepted', result.document, message)
      if (result.projectAssociationUpdated) emit('projectComponentsChanged')
      emit('close')
    })
  }

  async function duplicateComponent(component: FrontendWorkshopSourceComponent): Promise<void> {
    await run(`duplicate:${component.id}`, async () => {
      const duplicate = await frontendWorkshopSourceComponentService.duplicate(component.id)
      await reload()
      detailComponentId.value = duplicate.id
      emit('status', `已创建“${duplicate.name}”。`)
    })
  }

  async function exportComponent(component: FrontendWorkshopSourceComponent): Promise<void> {
    await run(`export:${component.id}`, async () => {
      const portablePackage = await frontendWorkshopSourceComponentService.createPortablePackage(
        component.id,
      )
      await downloadBlob(portablePackage.blob, portablePackage.fileName)
      emit('status', `已导出组件“${component.name}”。`)
    })
  }

  function handleLicenseChange(): void {
    if (shareLicenseDraft.value === 'private') shareAllowedDraft.value = false
  }

  function addDependency(): void {
    dependencyDrafts.value.push({ kind: 'host-api', specifier: '', optional: false })
  }

  function removeDependency(index: number): void {
    dependencyDrafts.value.splice(index, 1)
  }

  function normalizedDependencyDrafts(): FrontendWorkshopSourceComponentDependency[] {
    const seen = new Set<string>()
    return dependencyDrafts.value.flatMap((dependency) => {
      const specifier = dependency.specifier.trim()
      const key = `${dependency.kind}\0${specifier}`
      if (!specifier || seen.has(key)) return []
      seen.add(key)
      return [
        {
          kind: dependency.kind,
          specifier,
          ...(dependency.optional ? { optional: true } : {}),
        },
      ]
    })
  }

  function normalizedHostApis(): string[] {
    return Array.from(
      new Set(
        hostApisDraft.value
          .split(/[\n,]/u)
          .map((api) => api.trim())
          .filter(Boolean),
      ),
    )
  }

  async function saveRuntimeMetadata(component: FrontendWorkshopSourceComponent): Promise<void> {
    await run(`runtime:${component.id}`, async () => {
      if (dependencyDrafts.value.some((dependency) => !dependency.specifier.trim())) {
        throw new Error('依赖标识不能为空')
      }
      const componentSnapshot = structuredClone(toRaw(component))
      const updated = await frontendWorkshopSourceComponentService.updateAtRevision(
        {
          ...componentSnapshot,
          dependencies: [
            ...componentSnapshot.dependencies.filter(
              (dependency) => dependency.kind === 'external-resource',
            ),
            ...normalizedDependencyDrafts(),
          ],
          runtimeRequirements: {
            hostProfile: component.runtimeRequirements.hostProfile,
            requiresJavaScript: requiresJavaScriptDraft.value,
            requiresNetwork: requiresNetworkDraft.value,
            hostApis: normalizedHostApis(),
          },
        },
        component.revision,
      )
      acceptUpdatedComponent(updated)
      emit('status', `已更新组件“${component.name}”的运行需求。`)
    })
  }

  async function saveSharePolicy(component: FrontendWorkshopSourceComponent): Promise<void> {
    await run(`policy:${component.id}`, async () => {
      const notice = shareNoticeDraft.value.trim()
      const allowShare = shareLicenseDraft.value === 'private' ? false : shareAllowedDraft.value
      const componentSnapshot = structuredClone(toRaw(component))
      const updated = await frontendWorkshopSourceComponentService.updateAtRevision(
        {
          ...componentSnapshot,
          sharePolicy: {
            license: shareLicenseDraft.value,
            allowShare,
            allowDerivatives: derivativesAllowedDraft.value,
            ...(notice ? { notice } : {}),
          },
        },
        component.revision,
      )
      acceptUpdatedComponent(updated)
      emit('status', `已更新组件“${component.name}”的授权设置。`)
    })
  }

  async function removeFromCurrentProject(
    component: FrontendWorkshopSourceComponent,
  ): Promise<void> {
    const confirmed = await confirmAction({
      title: '移出当前项目',
      message: `移出“${component.name}”后，它将不再出现在当前组件中。已经插入的画布内容不会改变。`,
      confirmLabel: '移出项目',
      danger: true,
    })
    if (!confirmed) return
    await run(`remove:${component.id}`, async () => {
      await frontendWorkshopSourceComponentService.removeFromProject(
        component.id,
        props.sourceDocument.projectId,
      )
      await reload()
      detailComponentId.value = ''
      emit('projectComponentsChanged')
      emit('status', `已将“${component.name}”移出当前项目。`)
    })
  }

  async function deleteComponent(component: FrontendWorkshopSourceComponent): Promise<void> {
    const confirmed = await confirmAction({
      title: '删除个人组件',
      message: `确定删除“${component.name}”吗？已经插入项目的 Source 不会被改动。`,
      confirmLabel: '删除组件',
      danger: true,
    })
    if (!confirmed) return
    await run(`delete:${component.id}`, async () => {
      await frontendWorkshopSourceComponentService.delete(component.id)
      await reload()
      detailComponentId.value = ''
      emit('projectComponentsChanged')
      emit('status', `已删除组件“${component.name}”。`)
    })
  }

  function provenanceLabel(component: FrontendWorkshopSourceComponent): string {
    if (component.provenance.origin === 'project-selection') return '选区保存'
    if (component.provenance.origin === 'derived') return '组件副本'
    if (component.provenance.origin === 'imported') return '导入组件'
    if (component.provenance.origin === 'ai') return 'AI 生成'
    return '手动创建'
  }

  watch(
    detailComponent,
    (component) => {
      if (!component) return
      aiEditInstruction.value = ''
      shareLicenseDraft.value = component.sharePolicy.license
      shareAllowedDraft.value = component.sharePolicy.allowShare
      derivativesAllowedDraft.value = component.sharePolicy.allowDerivatives
      shareNoticeDraft.value = component.sharePolicy.notice ?? ''
      dependencyDrafts.value = component.dependencies
        .filter((dependency) => dependency.kind !== 'external-resource')
        .map((dependency) => ({ ...dependency }))
      requiresJavaScriptDraft.value = component.runtimeRequirements.requiresJavaScript
      requiresNetworkDraft.value = component.runtimeRequirements.requiresNetwork
      hostApisDraft.value = component.runtimeRequirements.hostApis.join('\n')
    },
    { immediate: true },
  )

  onMounted(() => {
    void run('load', reload)
  })

  onUnmounted(() => {
    aiAbortController?.abort()
  })
  return {
    handlePortablePackageChange,
    backOrClose,
    detailComponent,
    aiCreateOpen,
    addMenuOpen,
    activeScope,
    currentComponents,
    components,
    error,
    visibleComponents,
    componentPreview,
    handlePreviewRuntimeError,
    previewRuntimeErrors,
    provenanceLabel,
    busyAction,
    insertComponent,
    openComponentDetail,
    removeFromCurrentProject,
    deleteComponent,
    detailAssetUrls,
    dependencyDrafts,
    exportComponent,
    duplicateComponent,
    editComponentWithAi,
    aiEditInstruction,
    stopAiRequest,
    saveRuntimeMetadata,
    addDependency,
    removeDependency,
    requiresJavaScriptDraft,
    requiresNetworkDraft,
    hostApisDraft,
    saveSharePolicy,
    shareLicenseDraft,
    handleLicenseChange,
    licenseOptions,
    shareAllowedDraft,
    derivativesAllowedDraft,
    shareNoticeDraft,
    saveAssetUrl,
    assetUrlDraft,
    removeAssetUrl,
    generateComponentWithAi,
    aiNameDraft,
    aiInstructionDraft,
    openAiCreate,
    choosePortablePackage,
    handleBack,
  }
}
