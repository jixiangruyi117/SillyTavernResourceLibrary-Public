import type { EmitFn } from 'vue'
import { computed, nextTick, onBeforeUnmount, ref, useTemplateRef, watch } from 'vue'
import type { ActionSheetAction } from '../components/ActionSheet.vue'
import { chooseAction, confirmAction } from './UseConfirmDialog'
import { browserStorageService, userPersonaService, resourceService } from '../core/AppContainer'
import { dirtyStateRegistry } from '../core/DirtyStateRegistry'
import { SRL_BACK_REQUEST_EVENT, type SrlBackRequestDetail } from './UseBackStack'
import { parseSillyTavernPersonaBackup } from '../parser/SillyTavernPersonaBackup'
import { getResourceCategoryIds, RESOURCE_TYPE, type Resource } from '../types/Resource'
import {
  USER_PERSONA_POSITIONS,
  USER_PERSONA_ROLES,
  type SillyTavernPersonaBackup,
  type UserPersonaDraft,
  type UserPersonaEntry,
  type UserPersonaTemplate,
} from '../types/UserPersona'
import type { UserPersonaAppEvents, UserPersonaAppProps } from '../types/UserPersonaAppView'
import { applyUserPersonaTemplate, USER_PERSONA_TEMPLATES } from '../utils/UserPersonaManagement'
import { usePersonaAvatarEditing } from './UsePersonaAvatarEditing'
import { usePersonaResourceDelivery } from './UsePersonaResourceDelivery'
export type { UserPersonaAppEvents, UserPersonaAppProps } from '../types/UserPersonaAppView'

export function useUserPersonaApp(
  props: Readonly<UserPersonaAppProps>,
  emit: EmitFn<UserPersonaAppEvents>,
) {
  const page = ref<'list' | 'editor'>('list')
  const transferOpen = ref(false)
  const selectedResourceId = ref('')
  const selectedAvatarId = ref('')
  const currentResource = ref<Resource | null>(null)
  const currentBackup = ref<SillyTavernPersonaBackup | null>(null)
  const currentWarnings = ref<string[]>([])
  const draft = ref<UserPersonaDraft>(createDraft())
  const originalDraftSignature = ref('')
  const avatarSourceUrl = ref('')
  const cachedAvatarResource = ref<Resource | null>(null)
  const pendingAvatarFile = ref<File | null>(null)
  const cachedAvatarPreview = ref('')
  const pendingAvatarPreview = ref('')
  const avatarPreviewFailed = ref(false)
  const avatarResourcesByAvatarId = ref<Map<string, Resource>>(new Map())
  const initialAvatarResourceIds = ref(new Set<string>())
  const selectedWorldBookId = ref('')
  const selectedCharacterIds = ref(new Set<string>())
  const characterCategoryFilter = ref('all')
  const characterSearchQuery = ref('')
  const searchQuery = ref('')
  const listLimit = ref(30)
  const selectedTemplateId = ref('blank')
  const customTemplates = ref<UserPersonaTemplate[]>(
    browserStorageService.getUserPersonaTemplates(),
  )
  const customTemplateName = ref('')
  const creatingTemplate = ref(false)
  const showTemplates = ref(false)
  const showAdvanced = ref(false)
  const loading = ref(false)
  const saving = ref(false)
  const creatingPack = ref(false)
  const statusMessage = ref('')
  const errorMessage = ref('')
  const headerMoreOpen = ref(false)
  const importInput = useTemplateRef<HTMLInputElement>('importInput')
  const avatarInput = useTemplateRef<HTMLInputElement>('avatarInput')
  const descriptionInput = useTemplateRef<HTMLTextAreaElement>('descriptionInput')
  const busy = computed(() => loading.value || saving.value)
  const {
    revokePreview,
    setCachedAvatar,
    setPendingAvatar,
    clearAvatarEditor,
    avatarSourceOf,
    loadAvatarResources,
    fileBaseName,
    characterAvatarId,
    ensureAvatarCached,
    onAvatarFileChange,
    onAvatarUrlInput,
    chooseAvatarImage,
    removeAvatarBinding,
    applyAvatarBindingForSave,
  } = usePersonaAvatarEditing(() => ({
    cachedAvatarPreview,
    cachedAvatarResource,
    avatarPreviewFailed,
    pendingAvatarPreview,
    pendingAvatarFile,
    avatarSourceUrl,
    avatarResourcesByAvatarId,
    initialAvatarResourceIds,
    emit,
    errorMessage,
    statusMessage,
    avatarInput,
    draft,
  }))
  const { connectionsForSave, saveDraft, deleteCurrent, importPersonaFiles } =
    usePersonaResourceDelivery(() => ({
      characters,
      characterAvatarId,
      draft,
      selectedCharacterIds,
      worldBooks,
      fileBaseName,
      currentBackup,
      initialAvatarResourceIds,
      currentResource,
      avatarResourcesByAvatarId,
      emit,
      loadResource,
      saving,
      errorMessage,
      statusMessage,
      ensureAvatarCached,
      creatingPack,
      selectedAvatarId,
      applyAvatarBindingForSave,
      selectedResourceId,
      activeEntry,
      entries,
      page,
      loading,
    }))
  const personaResources = computed(() =>
    props.resources
      .filter((r) => r.type === RESOURCE_TYPE.USER_PERSONA)
      .sort((a, b) => b.updatedAt - a.updatedAt),
  )
  const filteredResources = computed(() => {
    const query = searchQuery.value.trim().toLocaleLowerCase()
    return personaResources.value.filter(
      (r) =>
        !query ||
        `${r.name}\n${r.metadata.personaNames ?? ''}\n${r.tags.join(' ')}`
          .toLocaleLowerCase()
          .includes(query),
    )
  })
  const visibleResources = computed(() => filteredResources.value.slice(0, listLimit.value))
  watch(searchQuery, () => {
    listLimit.value = 30
  })
  const worldBooks = computed(() =>
    props.resources.filter((r) => r.type === RESOURCE_TYPE.WORLD_BOOK),
  )
  const characters = computed(() =>
    props.resources.filter((r) => r.type === RESOURCE_TYPE.CHARACTER_CARD),
  )
  const filteredCharacters = computed(() => {
    const query = characterSearchQuery.value.trim().toLocaleLowerCase()
    return characters.value.filter(
      (r) =>
        (characterCategoryFilter.value === 'all' ||
          getResourceCategoryIds(r).includes(characterCategoryFilter.value)) &&
        (!query || `${r.name}\n${r.fileName}`.toLocaleLowerCase().includes(query)),
    )
  })
  const entries = computed(() =>
    currentBackup.value ? parseSillyTavernPersonaBackup(currentBackup.value).entries : [],
  )
  const activeEntry = computed(() =>
    entries.value.find((e) => e.avatarId === selectedAvatarId.value),
  )
  const selectedCustomTemplate = computed(() =>
    customTemplates.value.find((t) => t.id === selectedTemplateId.value),
  )
  const unresolvedConnections = computed(() =>
    draft.value.connections.filter(
      (c) =>
        c.type === 'group' ||
        !characters.value.some((r) => [characterAvatarId(r), r.fileName, r.name].includes(c.id)),
    ),
  )
  const avatarPreviewUrl = computed(() => {
    if (pendingAvatarPreview.value) return pendingAvatarPreview.value
    const source = avatarSourceUrl.value.trim()
    if (
      source &&
      source !== cachedAvatarResource.value?.metadata.sourceUrl &&
      /^https:\/\//i.test(source)
    )
      return source
    return cachedAvatarPreview.value || (/^https:\/\//i.test(source) ? source : '')
  })
  const isDirty = computed(
    () =>
      page.value === 'editor' &&
      !!selectedAvatarId.value &&
      editorSignature() !== originalDraftSignature.value,
  )
  const headerMoreActions = computed<ActionSheetAction[]>(() =>
    page.value === 'list'
      ? [{ id: 'import', label: '导入人设 JSON' }]
      : currentResource.value
        ? [
            { id: 'history', label: '查看历史版本' },
            { id: 'transfer', label: '发送整份人设文件到酒馆' },
            { id: 'delete', label: '删除当前人设', danger: true },
          ]
        : [],
  )

  function createDraft(): UserPersonaDraft {
    return {
      avatarId: `persona-${crypto.randomUUID()}.png`,
      name: '',
      title: '',
      description: '',
      position: USER_PERSONA_POSITIONS.IN_PROMPT,
      depth: 2,
      role: USER_PERSONA_ROLES.SYSTEM,
      lorebook: '',
      connections: [],
    }
  }
  function editorSignature(): string {
    return JSON.stringify({
      draft: draft.value,
      url: avatarSourceUrl.value.trim(),
      avatar: cachedAvatarResource.value?.id ?? '',
      file: pendingAvatarFile.value
        ? `${pendingAvatarFile.value.name}:${pendingAvatarFile.value.size}:${pendingAvatarFile.value.lastModified}`
        : '',
    })
  }
  function resetPanels(): void {
    showAdvanced.value = false
    showTemplates.value = false
    creatingTemplate.value = false
    selectedTemplateId.value = 'blank'
    characterSearchQuery.value = ''
    characterCategoryFilter.value = 'all'
  }
  function selectEntry(entry: UserPersonaEntry): void {
    selectedAvatarId.value = entry.avatarId
    draft.value = {
      avatarId: entry.avatarId,
      name: entry.name,
      title: entry.title,
      description: entry.description,
      position: entry.position,
      depth: entry.depth,
      role: entry.role,
      lorebook: entry.lorebook,
      connections: entry.connections.map((c) => ({ ...c })),
    }
    selectedWorldBookId.value =
      worldBooks.value.find(
        (r) => r.name === entry.lorebook || fileBaseName(r.fileName) === entry.lorebook,
      )?.id ?? ''
    selectedCharacterIds.value = new Set(
      characters.value
        .filter((r) =>
          entry.connections.some(
            (c) =>
              c.type === 'character' && [characterAvatarId(r), r.fileName, r.name].includes(c.id),
          ),
        )
        .map((r) => r.id),
    )
    setPendingAvatar(null)
    const avatar = avatarResourcesByAvatarId.value.get(entry.avatarId) ?? null
    setCachedAvatar(avatar)
    avatarSourceUrl.value = avatar ? avatarSourceOf(avatar) : ''
    originalDraftSignature.value = editorSignature()
  }
  async function loadResource(
    resourceId: string,
    preferredAvatarId = selectedAvatarId.value,
  ): Promise<void> {
    const loaded = await userPersonaService.load(resourceId)
    await loadAvatarResources(loaded.resource.relatedResourceIds ?? [])
    currentResource.value = loaded.resource
    currentBackup.value = loaded.view.raw
    currentWarnings.value = loaded.view.warnings
    selectedResourceId.value = resourceId
    creatingPack.value = false
    const entry =
      loaded.view.entries.find((e) => e.avatarId === preferredAvatarId) ??
      loaded.view.entries.find((e) => e.avatarId === loaded.view.defaultPersona) ??
      loaded.view.entries[0]
    if (!entry) throw new Error('这份文件没有可编辑的人设')
    selectEntry(entry)
  }
  async function openResource(resourceId: string): Promise<void> {
    if (busy.value) return
    loading.value = true
    errorMessage.value = ''
    statusMessage.value = ''
    try {
      await loadResource(resourceId, '')
      resetPanels()
      page.value = 'editor'
    } catch (error) {
      errorMessage.value = error instanceof Error ? error.message : '读取失败'
    } finally {
      loading.value = false
    }
  }
  async function changeEntry(event: Event): Promise<void> {
    const input = event.target as HTMLSelectElement
    const id = input.value
    input.value = selectedAvatarId.value
    if (!(await confirmDiscardDraft())) return
    const entry = entries.value.find((e) => e.avatarId === id)
    if (entry) {
      selectEntry(entry)
      resetPanels()
    }
  }
  function startNewPack(): void {
    if (busy.value) return
    creatingPack.value = true
    currentResource.value = null
    currentBackup.value = null
    currentWarnings.value = []
    selectedResourceId.value = ''
    selectedAvatarId.value = '__new__'
    draft.value = createDraft()
    selectedWorldBookId.value = ''
    selectedCharacterIds.value = new Set()
    avatarResourcesByAvatarId.value = new Map()
    initialAvatarResourceIds.value = new Set()
    clearAvatarEditor()
    resetPanels()
    errorMessage.value = ''
    statusMessage.value = ''
    originalDraftSignature.value = editorSignature()
    page.value = 'editor'
  }
  function discardDraft(): void {
    if (activeEntry.value) selectEntry(activeEntry.value)
    else originalDraftSignature.value = editorSignature()
  }
  async function confirmDiscardDraft(): Promise<boolean> {
    if (!isDirty.value) return true
    const decision = await chooseAction({
      title: '人设有未保存修改',
      message: '保存到资源库后离开？',
      confirmLabel: '保存并离开',
      alternativeLabel: '放弃修改',
      cancelLabel: '继续编辑',
    })
    if (decision === 'confirm') {
      await saveDraft()
      return !errorMessage.value && !isDirty.value
    }
    if (decision === 'alternative') {
      discardDraft()
      return true
    }
    return false
  }
  async function goBack(): Promise<void> {
    if (busy.value) return
    if (transferOpen.value) {
      transferOpen.value = false
      return
    }
    if (page.value === 'editor') {
      if (!(await confirmDiscardDraft())) return
      page.value = 'list'
      return
    }
    emit('back')
  }
  async function openTransfer(): Promise<void> {
    if (busy.value || !(await confirmDiscardDraft())) return
    transferOpen.value = true
  }
  async function importTransferredFiles(files: File[]): Promise<void> {
    loading.value = true
    errorMessage.value = ''
    try {
      // The shared transfer page can also select other resource types; keep the common importer.
      const results = await resourceService.importFiles(files, { detectVersions: false })
      emit('library-changed')
      const failed = results.filter((r) => r.status === 'failed')
      errorMessage.value = failed.map((r) => (r.status === 'failed' ? r.message : '')).join('；')
      statusMessage.value = `已接收 ${results.filter((r) => r.status === 'imported').length} 项，跳过重复 ${results.filter((r) => r.status === 'duplicate').length} 项`
      transferOpen.value = false
      page.value = 'list'
    } catch (error) {
      errorMessage.value = error instanceof Error ? error.message : '接收失败'
      transferOpen.value = false
    } finally {
      loading.value = false
    }
  }
  async function selectHeaderMore(action: ActionSheetAction): Promise<void> {
    if (action.id === 'import') importInput.value?.click()
    if (action.id === 'history' && currentResource.value && (await confirmDiscardDraft())) {
      emit('open-history', currentResource.value)
    }
    if (action.id === 'transfer') await openTransfer()
    if (action.id === 'delete') await deleteCurrent()
  }
  async function applyTemplate(): Promise<void> {
    const template = [...USER_PERSONA_TEMPLATES, ...customTemplates.value].find(
      (t) => t.id === selectedTemplateId.value,
    )
    if (!template || template.description === draft.value.description) return
    if (
      draft.value.description.trim() &&
      !(await confirmAction({
        title: '使用模板',
        message: '替换当前人设描述？名称、备注、头像和绑定保持不变。',
        confirmLabel: '替换描述',
      }))
    )
      return
    draft.value = applyUserPersonaTemplate(draft.value, template.id, [template])
  }
  function saveCustomTemplate(): void {
    const name = customTemplateName.value.trim()
    if (!name || !draft.value.description.trim()) {
      errorMessage.value = !name ? '请填写模板名称' : '请先填写人设描述'
      return
    }
    const template = {
      id: `custom-${crypto.randomUUID()}`,
      name,
      description: draft.value.description,
    }
    customTemplates.value = browserStorageService.setUserPersonaTemplates([
      ...customTemplates.value,
      template,
    ])
    selectedTemplateId.value = template.id
    creatingTemplate.value = false
    customTemplateName.value = ''
    errorMessage.value = ''
    statusMessage.value = '模板已保存'
  }
  async function deleteSelectedCustomTemplate(): Promise<void> {
    const template = selectedCustomTemplate.value
    if (
      !template ||
      !(await confirmAction({
        title: '删除模板',
        message: `删除“${template.name}”？已填写的人设不受影响。`,
        confirmLabel: '删除',
        danger: true,
      }))
    )
      return
    customTemplates.value = browserStorageService.setUserPersonaTemplates(
      customTemplates.value.filter((t) => t.id !== template.id),
    )
    selectedTemplateId.value = 'blank'
  }
  async function insertPlaceholder(token: '{{user}}' | '{{char}}'): Promise<void> {
    const textarea = descriptionInput.value
    const start = textarea?.selectionStart ?? draft.value.description.length
    const end = textarea?.selectionEnd ?? start
    draft.value.description =
      draft.value.description.slice(0, start) + token + draft.value.description.slice(end)
    await nextTick()
    textarea?.focus({ preventScroll: true })
    textarea?.setSelectionRange(start + token.length, start + token.length)
  }
  function onWorldBookChange(): void {
    const selected = worldBooks.value.find((r) => r.id === selectedWorldBookId.value)
    draft.value.lorebook = selected?.name ?? ''
  }
  function toggleCharacter(id: string): void {
    const next = new Set(selectedCharacterIds.value)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    selectedCharacterIds.value = next
    draft.value.connections = connectionsForSave()
  }
  const unregister = dirtyStateRegistry.register({
    featureId: 'user-persona',
    label: 'user才是老大',
    isDirty: () => isDirty.value,
    save: saveDraft,
    discard: discardDraft,
  })
  watch(isDirty, (dirty) => {
    dirtyStateRegistry.changed()
    if (dirty) statusMessage.value = ''
  })
  watch(
    () => props.resources.find((resource) => resource.id === selectedResourceId.value)?.updatedAt,
    (updatedAt) => {
      if (
        page.value !== 'editor' ||
        !updatedAt ||
        !currentResource.value ||
        currentResource.value.updatedAt === updatedAt ||
        isDirty.value
      )
        return
      void loadResource(selectedResourceId.value).catch((reason: unknown) => {
        errorMessage.value = reason instanceof Error ? reason.message : '刷新人设版本失败'
      })
    },
  )
  function onBackRequest(event: Event): void {
    const detail = (event as CustomEvent<SrlBackRequestDetail>).detail
    if (
      detail.handled ||
      headerMoreOpen.value ||
      document.querySelector('[role="dialog"], [role="alertdialog"]')
    )
      return
    if (page.value === 'editor' || transferOpen.value) {
      detail.handled = true
      void goBack()
    }
  }
  window.addEventListener(SRL_BACK_REQUEST_EVENT, onBackRequest)
  onBeforeUnmount(() => {
    unregister()
    window.removeEventListener(SRL_BACK_REQUEST_EVENT, onBackRequest)
    revokePreview(cachedAvatarPreview.value)
    revokePreview(pendingAvatarPreview.value)
  })
  return {
    page,
    transferOpen,
    busy,
    loading,
    saving,
    goBack,
    openTransfer,
    importTransferredFiles,
    selectedResourceId,
    headerMoreOpen,
    headerMoreActions,
    selectHeaderMore,
    importInput,
    importPersonaFiles,
    startNewPack,
    statusMessage,
    errorMessage,
    searchQuery,
    listLimit,
    filteredResources,
    visibleResources,
    openResource,
    draft,
    entries,
    selectedAvatarId,
    changeEntry,
    currentResource,
    currentWarnings,
    creatingPack,
    isDirty,
    saveDraft,
    avatarPreviewUrl,
    avatarPreviewFailed,
    avatarSourceUrl,
    cachedAvatarResource,
    pendingAvatarFile,
    chooseAvatarImage,
    onAvatarFileChange,
    onAvatarUrlInput,
    removeAvatarBinding,
    showTemplates,
    selectedTemplateId,
    applyTemplate,
    USER_PERSONA_TEMPLATES,
    customTemplates,
    selectedCustomTemplate,
    deleteSelectedCustomTemplate,
    creatingTemplate,
    customTemplateName,
    saveCustomTemplate,
    insertPlaceholder,
    showAdvanced,
    USER_PERSONA_POSITIONS,
    USER_PERSONA_ROLES,
    selectedWorldBookId,
    onWorldBookChange,
    worldBooks,
    characters,
    characterSearchQuery,
    characterCategoryFilter,
    filteredCharacters,
    selectedCharacterIds,
    toggleCharacter,
    unresolvedConnections,
  }
}
