import type { EmitFn } from 'vue'
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { chooseAction, confirmAction } from '../composables/UseConfirmDialog'
import { parseSillyTavernPersonaBackup } from '../parser/SillyTavernPersonaBackup'
import { browserStorageService, resourceService } from '../core/AppContainer'
import { tavernConnectionStore, type TavernConnectionSnapshot } from '../core/TavernConnectionStore'
import { canUseLocalTavernDirect } from '../services/LanDirectService'
import { prepareChatReturn, type ChatReturnPlan } from '../services/TavernChatReturn'
import type {
  TavernConflictPolicy,
  TavernResourceItem,
  TavernResourceKind,
} from '../services/TavernBridgeProtocol'
import { tavernBridgeService } from '../services/TavernBridgeService'
import {
  getResourceCategoryIds,
  getRelatedResourceIds,
  isUserPersonaAvatarAttachment,
  RESOURCE_TYPE,
  type Category,
  type ResourceSummary,
} from '../types/Resource'
import {
  BRIDGE_EXTENSION_VERSION,
  LOCAL_DIRECT_BRIDGE_EXTENSION_VERSION,
} from '../utils/BridgeInstall'
import {
  buildLocalNameIndex,
  buildTavernNameIndex,
  localResourceExistsInTavern,
  tavernItemExistsLocally,
} from '../utils/TavernBridgeDiff'
import { buildTavernSyncPlan, summarizeTavernSyncPlan } from '../utils/TavernSyncPlan'
import { copyPersonaForTavern, personaContentMatches } from '../utils/TavernPersonaTransfer'

export type TavernBridgeCenterProps = {
  resources: ResourceSummary[]
  categories?: Category[]
  initialLocalIds?: string[]
  initialKind?: 'userPersona'
}

export type TavernBridgeCenterEvents = {
  back: []
  'import-files': [files: File[]]
}

export type LocalSendFilter =
  | 'chat'
  | 'all'
  | 'character'
  | 'worldBook'
  | 'preset'
  | 'regex'
  | 'quickReply'
  | 'script'
  | 'theme'
  | 'userPersona'

export type TavernReceiveFilter = 'all' | TavernResourceKind

export interface TransferQueueItem {
  key: string
  name: string
  label: string
  status: 'pending' | 'active' | 'done' | 'failed'
  detail: string
  operationId?: string
}

type PersonaAvatarMode = 'none' | 'missing' | 'replace'
interface PersonaAvatarPlan {
  avatarId: string
  file: File
  exists: boolean
}
interface PersonaSendPlan {
  skip?: boolean
  file?: File
  avatarId?: string
}

export function useTavernBridgeCenter(
  props: Readonly<
    TavernBridgeCenterProps &
      Required<Pick<TavernBridgeCenterProps, 'categories' | 'initialLocalIds'>>
  >,
  emit: EmitFn<TavernBridgeCenterEvents>,
) {
  const state = ref<TavernConnectionSnapshot>(tavernConnectionStore.getSnapshot())
  let disposed = false

  const activeDirection = ref<'fromTavern' | 'toTavern'>('fromTavern')

  const tavernItems = ref<TavernResourceItem[]>([])

  const selectedTavernIds = ref(new Set<string>())

  const selectedLocalIds = ref(new Set<string>())

  const tavernReceiveFilter = ref<TavernReceiveFilter>(props.initialKind ?? 'all')

  const tavernSearch = ref('')

  const localSendFilter = ref<LocalSendFilter>(props.initialKind ?? 'all')

  const search = ref('')

  const conflictPolicy = ref<TavernConflictPolicy>(
    props.initialKind === 'userPersona' ? 'skip' : 'copy',
  )
  const personaAvatarMode = ref<PersonaAvatarMode>(
    state.value.status === 'connected' &&
      !state.value.capabilities?.includes('persona-avatar-check-v1')
      ? 'none'
      : 'missing',
  )

  const busy = ref(false)
  const canBindDirectory = tavernBridgeService.canBindDirectory()
  async function bindDirectory(reuse = true): Promise<void> {
    if (busy.value) return
    busy.value = true
    error.value = ''
    try {
      await tavernBridgeService.bindDirectory(reuse)
      await tavernConnectionStore.refreshInventory()
    } catch (reason) {
      if (!(reason instanceof DOMException && reason.name === 'AbortError')) {
        error.value = reason instanceof Error ? reason.message : '无法绑定酒馆目录'
      }
    } finally {
      busy.value = false
    }
  }

  const progress = ref('')

  const error = ref('')

  const reports = ref<string[]>(browserStorageService.getBridgeTransferLog())

  const localDirectEnabled = ref(false)

  const bridgeFolderFilter = ref('')

  const bridgeTagFilter = ref('')

  const bridgeFavoritesOnly = ref(false)

  const showOnlyMissingTavern = ref(false)

  const showOnlyMissingLocal = ref(false)

  const showOnlySelectedTavern = ref(false)

  const showOnlySelectedLocal = ref(false)

  const authorToolsDialog = ref<
    'list' | 'reloadGuard' | 'sceneSwitcher' | 'characterLorebooks' | null
  >(null)

  const installGuideOpen = ref(false)

  const copiedAuthorToolId = ref<string | null>(null)

  let authorToolsTrigger: HTMLElement | null = null

  const AUTHOR_TOOLS = [
    {
      id: 'reloadGuard',
      name: '聊天重载保护器',
      eyebrow: 'CHAT RELOAD GUARD',
      summary: '防止切换正则或预设时，聊天重载失败把原聊天覆盖为只剩开场白。',
      details: [
        '仅在单次当前聊天重载期间保留内存快照，并阻止已确认的危险覆盖保存。',
        '不改写正则、预设、角色卡或正常聊天内容；不支持的酒馆版本会停止接管。',
        '当前已审计支持 SillyTavern 1.18.0。',
      ],
      repository: 'https://github.com/jixiangruyi117/SillyTavern-ChatReloadGuard',
    },
    {
      id: 'sceneSwitcher',
      name: '场景切换器',
      eyebrow: 'SCENE SWITCHER',
      summary: '把常用的连接配置、角色、预设和主题保存成组合，之后一项快速切换。',
      details: [
        '只改动组合中明确勾选的项目，未勾选项保持当前状态。',
        '支持常用组合、角色与聊天记录搜索，以及可选的聊天页快速切换悬浮球。',
        '不会保存 API 密钥、代理密码或聊天记录，也不替代酒馆原生连接档案。',
      ],
      repository: 'https://github.com/jixiangruyi117/SillyTavern-SceneSwitcher',
    },
    {
      id: 'characterLorebooks',
      name: '角色世界书',
      eyebrow: 'CHARACTER LOREBOOKS',
      summary: '按角色归属整理世界书，当前角色聊天时不再被其他角色的世界书淹没。',
      details: [
        '只读取酒馆已有的主世界书、附加世界书与公共世界书绑定，不移动或改写世界书文件。',
        '可查看当前角色、公共和全部世界书，并标记共享、聊天、人设与全局启用状态。',
        '可在明确确认后关闭其他角色的全局启用世界书；当前角色书和公共书保持原样。',
      ],
      repository: 'https://github.com/jixiangruyi117/SillyTavern-CharacterLorebooks',
    },
  ] as const

  const selectedAuthorTool = computed(() =>
    authorToolsDialog.value && authorToolsDialog.value !== 'list'
      ? AUTHOR_TOOLS.find((tool) => tool.id === authorToolsDialog.value)
      : undefined,
  )

  const restoredDraft = browserStorageService.getBridgeTransferDraft()
  const transferQueue = ref<TransferQueueItem[]>(
    restoredDraft?.items.map((item) => ({
      ...item,
      ...(item.status === 'active' || item.status === 'pending'
        ? { status: 'failed' as const, detail: '上次传输中断，请连接原酒馆后重试' }
        : {}),
    })) ?? [],
  )

  const failedTransferKeys = computed(() =>
    transferQueue.value.filter((item) => item.status === 'failed').map((item) => item.key),
  )

  let lastTransferDirection: 'pull' | 'send' = restoredDraft?.direction ?? 'pull'
  let transferOrigin = restoredDraft?.origin ?? ''
  if (restoredDraft) conflictPolicy.value = restoredDraft.policy
  watch(
    transferQueue,
    (items) =>
      browserStorageService.setBridgeTransferDraft({
        direction: lastTransferDirection,
        origin: transferOrigin,
        policy: conflictPolicy.value,
        at: Date.now(),
        items: items.map((item) => ({ ...item })),
      }),
    { deep: true, flush: 'sync' },
  )

  const localNameIndex = computed(() => buildLocalNameIndex(props.resources))

  const tavernNameIndex = computed(() => buildTavernNameIndex(tavernItems.value))

  const itemExistsLocally = (item: TavernResourceItem) =>
    tavernItemExistsLocally(item, localNameIndex.value)

  const resourceExistsInTavern = (resource: ResourceSummary) =>
    localResourceExistsInTavern(resource, tavernNameIndex.value)

  const bridgeSyncPlan = computed(() =>
    buildTavernSyncPlan(supportedLocalResources.value, tavernItems.value),
  )

  const bridgeDiffSummary = computed(() => {
    if (!tavernItems.value.length) return undefined
    const summary = summarizeTavernSyncPlan(bridgeSyncPlan.value)
    return {
      tavernOnly: summary['tavern-only'],
      localOnly: summary['local-only'],
      localNewer: summary['local-newer'],
      tavernNewer: summary['tavern-newer'],
      consistent: summary.consistent,
      unverified: summary['unverified-match'],
    }
  })

  function selectSyncEntries(direction: 'fromTavern' | 'toTavern', statuses: string[]): void {
    const selected = bridgeSyncPlan.value.flatMap((entry) => {
      if (!statuses.includes(entry.status)) return []
      const id = direction === 'fromTavern' ? entry.tavernId : entry.localId
      return id ? [id] : []
    })
    activeDirection.value = direction
    if (direction === 'fromTavern') selectedTavernIds.value = new Set(selected)
    else selectedLocalIds.value = new Set(selected)
  }

  const sendConflictCount = computed(
    () =>
      supportedLocalResources.value.filter(
        (resource) => selectedLocalIds.value.has(resource.id) && resourceExistsInTavern(resource),
      ).length,
  )
  const selectedPersonaCount = computed(
    () =>
      supportedLocalResources.value.filter(
        (resource) =>
          resource.type === RESOURCE_TYPE.USER_PERSONA && selectedLocalIds.value.has(resource.id),
      ).length,
  )
  const canCheckPersonaAvatars = computed(() =>
    state.value.capabilities?.includes('persona-avatar-check-v1'),
  )
  const deviceCode = ref('')

  const canShowDeviceJoin = computed(
    () => !tavernBridgeService.hasInvitation() || state.value.status === 'error',
  )

  const canUseLocalTavernHost = computed(() => canUseLocalTavernDirect())

  const localDirectAvailable = computed(() => {
    void state.value.status
    return tavernBridgeService.isLocalTavernDirectAvailable()
  })

  const supportedLocalResources = computed(() =>
    props.resources.filter(
      (resource) =>
        (resource.type === RESOURCE_TYPE.CHAT && state.value.transport !== 'directory') ||
        resource.type === RESOURCE_TYPE.USER_PERSONA ||
        resource.type === RESOURCE_TYPE.CHARACTER_CARD ||
        resource.type === RESOURCE_TYPE.WORLD_BOOK ||
        resource.type === RESOURCE_TYPE.PRESET ||
        resource.type === RESOURCE_TYPE.REGEX ||
        resource.type === RESOURCE_TYPE.QUICK_REPLY ||
        resource.type === RESOURCE_TYPE.SCRIPT ||
        (resource.type === RESOURCE_TYPE.BEAUTIFICATION &&
          resource.metadata.detectedVariant === 'theme'),
    ),
  )
  const includeChatRegex = ref(false)
  const chatReturnPlans = new Map<string, ChatReturnPlan>()
  const selectedChatCount = computed(
    () =>
      supportedLocalResources.value.filter(
        (item) => item.type === RESOURCE_TYPE.CHAT && selectedLocalIds.value.has(item.id),
      ).length,
  )
  watch(selectedPersonaCount, (count) => {
    if (count && conflictPolicy.value === 'copy') conflictPolicy.value = 'skip'
    if (!count) personaAvatarMode.value = 'missing'
  })
  watch(
    () => state.value.status,
    (status) => {
      if (status === 'connected' && !canCheckPersonaAvatars.value) personaAvatarMode.value = 'none'
    },
  )

  const filteredLocalResources = computed(() => {
    const keyword = search.value.trim().toLocaleLowerCase()
    const typedResources = supportedLocalResources.value.filter(
      (resource) =>
        matchesLocalSendFilter(resource, localSendFilter.value) &&
        (!showOnlyMissingLocal.value || !resourceExistsInTavern(resource)) &&
        (!showOnlySelectedLocal.value || selectedLocalIds.value.has(resource.id)) &&
        (!bridgeFolderFilter.value ||
          getResourceCategoryIds(resource).includes(bridgeFolderFilter.value)) &&
        (!bridgeTagFilter.value || resource.tags.includes(bridgeTagFilter.value)) &&
        (!bridgeFavoritesOnly.value || resource.favorite),
    )
    if (!keyword) return typedResources
    return typedResources.filter(
      (resource) =>
        resource.name.toLocaleLowerCase().includes(keyword) ||
        resource.fileName.toLocaleLowerCase().includes(keyword),
    )
  })

  const localSendFilters = computed<Array<{ key: LocalSendFilter; label: string; count: number }>>(
    () => {
      const filters: Array<{ key: LocalSendFilter; label: string }> = [
        { key: 'all', label: '全部' },
        { key: 'userPersona', label: '用户人设' },
        { key: 'character', label: '角色卡' },
        { key: 'chat', label: '聊天记录' },
        { key: 'worldBook', label: '世界书' },
        { key: 'preset', label: '预设' },
        { key: 'regex', label: '正则' },
        { key: 'quickReply', label: '快速回复' },
        { key: 'script', label: '助手脚本' },
        { key: 'theme', label: '美化主题' },
      ]
      return filters.map((filter) => ({
        ...filter,
        count: supportedLocalResources.value.filter((resource) =>
          matchesLocalSendFilter(resource, filter.key),
        ).length,
      }))
    },
  )

  const visibleTavernItems = computed(() => {
    const keyword = tavernSearch.value.trim().toLocaleLowerCase()
    return tavernItems.value.filter(
      (item) =>
        (tavernReceiveFilter.value === 'all' || item.kind === tavernReceiveFilter.value) &&
        (!showOnlyMissingTavern.value || !itemExistsLocally(item)) &&
        (!showOnlySelectedTavern.value || selectedTavernIds.value.has(item.id)) &&
        (!keyword ||
          item.name.toLocaleLowerCase().includes(keyword) ||
          item.fileName.toLocaleLowerCase().includes(keyword) ||
          (item.kind === 'chat' && item.detail.toLocaleLowerCase().includes(keyword))),
    )
  })

  const tavernReceiveFilters = computed<
    Array<{ key: TavernReceiveFilter; label: string; count: number }>
  >(() => {
    const filters: Array<{ key: TavernReceiveFilter; label: string }> = [
      { key: 'all', label: '全部' },
      { key: 'userPersona', label: '用户人设' },
      { key: 'character', label: '角色卡' },
      { key: 'chat', label: '聊天记录' },
      { key: 'worldBook', label: '世界书' },
      { key: 'preset', label: '预设' },
      { key: 'regexGlobal', label: '全局正则' },
      { key: 'regexCharacter', label: '角色正则' },
      { key: 'regexPreset', label: '预设正则' },
      { key: 'quickReply', label: '快速回复' },
      { key: 'scriptGlobal', label: '全局脚本' },
      { key: 'scriptCharacter', label: '角色脚本' },
      { key: 'scriptPreset', label: '预设脚本' },
      { key: 'theme', label: '主题' },
    ]
    return filters
      .map((filter) => ({
        ...filter,
        count:
          filter.key === 'all'
            ? tavernItems.value.length
            : tavernItems.value.filter((item) => item.kind === filter.key).length,
      }))
      .filter(
        (filter) =>
          filter.key === 'all' || filter.key === tavernReceiveFilter.value || filter.count > 0,
      )
  })

  const bridgeTagOptions = computed(() => {
    const counts = new Map<string, number>()
    for (const resource of supportedLocalResources.value) {
      for (const tag of resource.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1)
    }
    return Array.from(counts.keys()).sort((left, right) => left.localeCompare(right, 'zh-CN'))
  })

  function recordReport(entry: string): void {
    const stamp = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    reports.value = browserStorageService.appendBridgeTransferLog([`[${stamp}] ${entry}`])
  }

  function handleState(event: Event): void {
    state.value = (event as CustomEvent<TavernConnectionSnapshot>).detail
    tavernItems.value = state.value.inventory
    if (
      state.value.status === 'connected' &&
      !tavernItems.value.length &&
      !state.value.lastSyncAt
    ) {
      void refreshTavernResources()
    }
  }

  function setLocalDirectEnabled(): void {
    tavernBridgeService.setLocalTavernDirectEnabled(localDirectEnabled.value)
  }

  function acceptPairing(): void {
    error.value = ''
    try {
      tavernBridgeService.accept()
      progress.value = '已确认配对码，等待酒馆完成连接…'
    } catch (reason) {
      error.value = reason instanceof Error ? reason.message : '无法确认配对'
    }
  }

  async function joinDeviceRelay(): Promise<void> {
    error.value = ''
    if (busy.value) return
    const code = deviceCode.value.trim().toUpperCase()
    if (!/^[2-9A-HJ-NP-Z]{8}$/u.test(code)) {
      error.value = '请输入酒馆显示的 8 位设备码'
      return
    }
    busy.value = true
    try {
      progress.value = '正在通过 HTTPS 安全中继连接酒馆…'
      await tavernBridgeService.joinSecureRelay(code)
      progress.value = '已找到酒馆，请核对两端显示的六位确认码'
    } catch (reason) {
      progress.value = ''
      error.value =
        reason instanceof Error
          ? reason.message
          : '无法连接 HTTPS 酒馆中继，请确认云服务器和酒馆扩展均已更新。'
    } finally {
      busy.value = false
    }
  }

  async function connectLocalTavern(): Promise<void> {
    error.value = ''
    if (busy.value) return
    busy.value = true
    try {
      progress.value = '正在请求本机酒馆；请稍后在酒馆扩展确认…'
      await tavernBridgeService.connectLocalTavern()
      localDirectEnabled.value = true
    } catch (reason) {
      progress.value = ''
      error.value = reason instanceof Error ? reason.message : '无法连接本机酒馆'
    } finally {
      busy.value = false
    }
  }

  function disconnectTavern(): void {
    tavernBridgeService.disconnect('已手动断开酒馆连接')
    tavernItems.value = []
    selectedTavernIds.value = new Set()
    localDirectEnabled.value = false
    error.value = ''
    progress.value = '已断开；可用本机连接或设备码重新连接。'
  }

  async function refreshTavernResources(kind?: 'chat'): Promise<void> {
    if (busy.value || state.value.status !== 'connected') return
    busy.value = true
    error.value = ''
    progress.value = '正在读取酒馆资源目录…'
    try {
      tavernItems.value = await tavernConnectionStore.refreshInventory(kind)
      if (kind) tavernReceiveFilter.value = kind
      selectedTavernIds.value = new Set(
        Array.from(selectedTavernIds.value).filter((id) =>
          tavernItems.value.some((item) => item.id === id),
        ),
      )
      if (
        tavernItems.value.length > 24 &&
        tavernReceiveFilter.value === 'all' &&
        tavernReceiveFilters.value[1]
      ) {
        tavernReceiveFilter.value = tavernReceiveFilters.value[1].key
      }
      progress.value = kind
        ? `已读取 ${tavernItems.value.filter((item) => item.kind === kind).length} 条已保存聊天；接收时随附所属角色卡`
        : `已读取 ${tavernItems.value.length} 项酒馆资源`
    } catch (reason) {
      error.value = reason instanceof Error ? reason.message : '无法读取酒馆资源'
    } finally {
      busy.value = false
    }
  }

  function toggleSelection(target: 'tavern' | 'local', id: string): void {
    const source = target === 'tavern' ? selectedTavernIds : selectedLocalIds
    const next = new Set(source.value)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    source.value = next
  }

  function selectAllTavern(): void {
    const visibleIds = visibleTavernItems.value.map((item) => item.id)
    const allSelected = visibleIds.every((id) => selectedTavernIds.value.has(id))
    const next = new Set(selectedTavernIds.value)
    for (const id of visibleIds) {
      if (allSelected) next.delete(id)
      else next.add(id)
    }
    selectedTavernIds.value = next
  }

  function selectAllLocal(): void {
    const visibleIds = filteredLocalResources.value.map((resource) => resource.id)
    const allSelected = visibleIds.every((id) => selectedLocalIds.value.has(id))
    const next = new Set(selectedLocalIds.value)
    for (const id of visibleIds) {
      if (allSelected) next.delete(id)
      else next.add(id)
    }
    selectedLocalIds.value = next
  }

  function tavernResourceLabel(kind: TavernResourceKind): string {
    const labels: Record<TavernResourceKind, string> = {
      chat: '聊天记录',
      character: '角色卡',
      worldBook: '世界书',
      preset: '预设',
      regexGlobal: '全局正则',
      regexCharacter: '角色正则',
      regexPreset: '预设正则',
      quickReply: '快速回复',
      theme: '主题',
      scriptGlobal: '全局脚本',
      scriptCharacter: '角色脚本',
      scriptPreset: '预设脚本',
      userPersona: '用户人设',
      userAvatar: '用户头像',
    }
    return labels[kind]
  }

  async function runPullQueue(items: TavernResourceItem[]): Promise<void> {
    lastTransferDirection = 'pull'
    busy.value = true
    error.value = ''
    const files: File[] = []
    const receivedEntries: TransferQueueItem[] = []
    let done = 0
    try {
      for (const item of items) {
        if (disposed) break
        const entry = transferQueue.value.find((queued) => queued.key === item.id)
        if (!entry) continue
        entry.status = 'active'
        progress.value = `正在接收 ${done + 1} / ${items.length}：${item.name}`
        try {
          const [file] = await tavernBridgeService.pullResources([item])
          if (!file) throw new Error('酒馆没有返回文件，资源可能已被删除')
          files.push(file)
          receivedEntries.push(entry)
          entry.detail = '已接收，等待交给资源库导入'
        } catch (reason) {
          entry.status = 'failed'
          entry.detail = reason instanceof Error ? reason.message : '接收失败'
        }
        done += 1
      }
      if (files.length && !disposed) {
        emit('import-files', files)
        for (const entry of receivedEntries) {
          entry.status = 'done'
          entry.detail = '已交给资源库导入，请查看结果通知'
        }
        selectedTavernIds.value = new Set()
      }
      const failed = transferQueue.value.filter((item) => item.status === 'failed').length
      progress.value = failed
        ? `接收完成：成功 ${files.length} 项、失败 ${failed} 项；失败项可单独重试`
        : `已从酒馆取回 ${files.length} 个文件，正在导入资源库；导入结果会在底部通知中显示`
      recordReport(`从酒馆接收 ${files.length} 项${failed ? `（${failed} 项失败）` : ''}`)
      tavernConnectionStore.recordSync(tavernItems.value)
    } finally {
      busy.value = false
    }
  }

  async function pullFromTavern(): Promise<void> {
    const items = tavernItems.value.filter((item) => selectedTavernIds.value.has(item.id))
    if (!items.length || busy.value) return
    lastTransferDirection = 'pull'
    transferOrigin = state.value.tavernOrigin
    transferQueue.value = items.map((item) => ({
      key: item.id,
      name: item.name,
      label: '取回',
      status: 'pending',
      detail: '',
    }))
    await runPullQueue(items)
  }

  async function retryFailedTransfers(): Promise<void> {
    if (busy.value || !failedTransferKeys.value.length) return
    if (state.value.status !== 'connected') {
      error.value = '请先重新连接原来的酒馆'
      return
    }
    if (transferOrigin !== state.value.tavernOrigin) {
      error.value = '当前连接与上次任务的目标不同，请重新选择资源发起传输'
      return
    }
    const keys = new Set(failedTransferKeys.value)
    if (lastTransferDirection === 'pull') {
      const items = tavernItems.value.filter((item) => keys.has(item.id))
      if (!items.length) {
        error.value = '失败的条目已不在酒馆目录中，请刷新目录后重新选择'
        return
      }
      for (const entry of transferQueue.value) if (keys.has(entry.key)) entry.status = 'pending'
      await runPullQueue(items)
    } else {
      const summaries = supportedLocalResources.value.filter((resource) => keys.has(resource.id))
      if (!summaries.length) {
        error.value = '失败的条目已不在本地列表中'
        return
      }
      if (!(await confirmDirectoryWrite())) return
      let avatarPlans: Map<string, PersonaAvatarPlan>
      let personaPlans: Map<string, PersonaSendPlan>
      busy.value = true
      try {
        const prepared = await preparePersonaSendPlans(summaries)
        if (!prepared) return
        personaPlans = prepared
        const avatars = await preparePersonaAvatarPlans(summaries, personaPlans)
        if (!avatars) return
        avatarPlans = avatars
        if (state.value.status !== 'connected') throw new Error('酒馆连接已断开，请重新连接后重试')
        for (const entry of transferQueue.value) if (keys.has(entry.key)) entry.status = 'pending'
        await runSendQueue(summaries, avatarPlans, personaPlans)
      } catch (reason) {
        error.value = reason instanceof Error ? reason.message : '无法核对酒馆头像'
      } finally {
        busy.value = false
      }
    }
  }

  function bridgeKind(resource: ResourceSummary): TavernResourceKind {
    if (resource.type === RESOURCE_TYPE.CHAT) return 'chat'
    if (resource.type === RESOURCE_TYPE.USER_PERSONA) return 'userPersona'
    if (resource.type === RESOURCE_TYPE.CHARACTER_CARD) return 'character'
    if (resource.type === RESOURCE_TYPE.WORLD_BOOK) return 'worldBook'
    if (resource.type === RESOURCE_TYPE.PRESET) return 'preset'
    if (resource.type === RESOURCE_TYPE.REGEX) {
      if (typeof resource.metadata.extractedFromCharacterId === 'string') return 'regexCharacter'
      if (typeof resource.metadata.extractedFromPresetId === 'string') return 'regexPreset'
      if (resource.metadata.regexScope === 'character') return 'regexCharacter'
      if (resource.metadata.regexScope === 'preset') return 'regexPreset'
      return 'regexGlobal'
    }
    if (resource.type === RESOURCE_TYPE.QUICK_REPLY) return 'quickReply'
    if (resource.type === RESOURCE_TYPE.SCRIPT) return 'scriptGlobal'
    return 'theme'
  }

  function matchesLocalSendFilter(resource: ResourceSummary, filter: LocalSendFilter): boolean {
    if (filter === 'chat') return resource.type === RESOURCE_TYPE.CHAT
    if (filter === 'userPersona') return resource.type === RESOURCE_TYPE.USER_PERSONA
    if (filter === 'all') return true
    if (filter === 'character') return resource.type === RESOURCE_TYPE.CHARACTER_CARD
    if (filter === 'worldBook') return resource.type === RESOURCE_TYPE.WORLD_BOOK
    if (filter === 'preset') return resource.type === RESOURCE_TYPE.PRESET
    if (filter === 'regex') return resource.type === RESOURCE_TYPE.REGEX
    if (filter === 'quickReply') return resource.type === RESOURCE_TYPE.QUICK_REPLY
    if (filter === 'script') return resource.type === RESOURCE_TYPE.SCRIPT
    return (
      resource.type === RESOURCE_TYPE.BEAUTIFICATION &&
      resource.metadata.detectedVariant === 'theme'
    )
  }

  async function confirmDirectoryWrite(): Promise<boolean> {
    if (state.value.transport !== 'directory') return true
    return confirmAction({
      title: '写入本地酒馆目录',
      message: `目标：${state.value.tavernOrigin}。请先关闭酒馆页面和程序，避免它保存旧设置覆盖本次修改。覆盖前会保存原文件到 .srl-backups，写入后下次启动生效。`,
      confirmLabel: '酒馆已关闭，继续',
    })
  }

  async function sendToTavern(): Promise<void> {
    const summaries = supportedLocalResources.value.filter((resource) =>
      selectedLocalIds.value.has(resource.id),
    )
    if (!summaries.length || busy.value) return
    busy.value = true
    try {
      if (!(await confirmDirectoryWrite())) return
      if (summaries.some((resource) => resource.type === RESOURCE_TYPE.CHAT)) {
        if (!state.value.capabilities.includes('chat-import-v1'))
          throw new Error('请先更新酒馆互传扩展：当前版本不支持聊天回传')
        const inventory = await tavernBridgeService.listResources()
        chatReturnPlans.clear()
        for (const summary of summaries.filter((item) => item.type === RESOURCE_TYPE.CHAT)) {
          const chat = await resourceService.get(summary.id)
          if (!chat) throw new Error('聊天记录已不存在')
          chatReturnPlans.set(
            chat.id,
            await prepareChatReturn(chat, resourceService, inventory, includeChatRegex.value),
          )
        }
        if (
          !(await confirmAction({
            title: '确认导入聊天记录',
            message:
              [...chatReturnPlans]
                .map(
                  ([id, plan]) =>
                    `${summaries.find((item) => item.id === id)!.name} → ${plan.targetLabel}`,
                )
                .join('\n') +
              '\n\n聊天会作为新记录导入，不切换当前聊天，不覆盖原记录。' +
              (includeChatRegex.value
                ? '\n配套正则会添加为目标角色的停用正则；不修改全局或预设正则，需在酒馆选择启用。'
                : '\n只导入聊天记录，酒馆原有正则保持不变。'),
            confirmLabel: '确认目标并导入',
          }))
        )
          return
      }
      const scriptCount = summaries.filter(
        (resource) => resource.type === RESOURCE_TYPE.SCRIPT,
      ).length
      if (
        scriptCount &&
        !(await confirmAction({
          title: '发送助手脚本',
          message: `所选中包含 ${scriptCount} 个酒馆助手脚本。脚本会以“全部停用”状态进入酒馆的全局脚本库，需要你在酒馆助手中确认内容后手动启用；不会自动运行任何代码。
接收端页面扩展需为 ${BRIDGE_EXTENSION_VERSION} 或更高版本。`,
          confirmLabel: '以停用状态发送',
        }))
      ) {
        return
      }
      if (
        conflictPolicy.value === 'overwrite' &&
        !(await confirmAction({
          title: '覆盖同名资源',
          message: '覆盖模式会替换酒馆中的同名资源。SRL 内的原文件不会改变，确定继续吗？',
          confirmLabel: '覆盖发送',
          danger: true,
        }))
      ) {
        return
      }
      let avatarPlans: Map<string, PersonaAvatarPlan>
      let personaPlans: Map<string, PersonaSendPlan>
      try {
        const prepared = await preparePersonaSendPlans(summaries)
        if (!prepared) return
        personaPlans = prepared
        const avatars = await preparePersonaAvatarPlans(summaries, personaPlans)
        if (!avatars) return
        avatarPlans = avatars
      } catch (reason) {
        error.value = reason instanceof Error ? reason.message : '无法核对酒馆头像'
        return
      }
      if (state.value.status !== 'connected') {
        error.value = '酒馆连接已断开，请重新连接后重试'
        return
      }
      lastTransferDirection = 'send'
      transferOrigin = state.value.tavernOrigin
      transferQueue.value = summaries.map((summary) => ({
        key: summary.id,
        name: summary.name,
        label: '发送',
        status: 'pending',
        detail: '',
        operationId: crypto.randomUUID(),
      }))
      await runSendQueue(summaries, avatarPlans, personaPlans)
    } catch (reason) {
      error.value = reason instanceof Error ? reason.message : '发送失败'
    } finally {
      busy.value = false
    }
  }

  async function preparePersonaSendPlans(
    summaries: ResourceSummary[],
  ): Promise<Map<string, PersonaSendPlan> | null> {
    const plans = new Map<string, PersonaSendPlan>()
    if (
      conflictPolicy.value !== 'skip' ||
      !summaries.some((item) => item.type === RESOURCE_TYPE.USER_PERSONA)
    )
      return plans
    // 目录用于展示，可能是旧快照；发送前单独核对酒馆当前的人设键和内容。
    const current = await tavernBridgeService.listResources()
    for (const summary of summaries) {
      if (summary.type !== RESOURCE_TYPE.USER_PERSONA) continue
      const resource = await resourceService.get(summary.id)
      if (!resource) throw new Error(`人设“${summary.name}”已不存在`)
      const local = parseSillyTavernPersonaBackup(JSON.parse(await resource.originalBlob.text()))
      if (local.entries.length !== 1) continue
      const avatarId = local.entries[0]!.avatarId
      const remote = current.find((item) => item.id === `userPersona:${avatarId}`)
      if (!remote) continue
      const [remoteFile] = await tavernBridgeService.pullResources([remote])
      if (!remoteFile) throw new Error(`无法核对酒馆人设“${summary.name}”`)
      if (personaContentMatches(local.raw, JSON.parse(await remoteFile.text()), avatarId)) {
        plans.set(summary.id, { skip: true })
        continue
      }
      const decision = await chooseAction({
        title: '酒馆人设已有不同内容',
        message: `“${summary.name}”仍使用酒馆原头像标识，但名称或描述已修改。跳过会保留酒馆原版；另存为新人设会生成新的头像标识，不覆盖原版，也不切换当前使用的人设。`,
        confirmLabel: '另存为新人设',
        alternativeLabel: '跳过这项',
        cancelLabel: '取消发送',
      })
      if (decision === 'cancel') return null
      if (decision === 'alternative') {
        plans.set(summary.id, { skip: true })
        continue
      }
      const nextAvatarId = `persona-${crypto.randomUUID()}.png`
      const copy = copyPersonaForTavern(local.raw, avatarId, nextAvatarId)
      plans.set(summary.id, {
        avatarId: nextAvatarId,
        file: new File([JSON.stringify(copy, null, 2)], `${nextAvatarId.slice(0, -4)}.json`, {
          type: 'application/json',
        }),
      })
    }
    return plans
  }

  async function preparePersonaAvatarPlans(
    summaries: ResourceSummary[],
    personaPlans = new Map<string, PersonaSendPlan>(),
  ): Promise<Map<string, PersonaAvatarPlan> | null> {
    const plans = new Map<string, PersonaAvatarPlan>()
    if (
      personaAvatarMode.value === 'none' ||
      !summaries.some((item) => item.type === RESOURCE_TYPE.USER_PERSONA)
    ) {
      return plans
    }
    if (!canCheckPersonaAvatars.value) {
      throw new Error('当前酒馆扩展不支持头像核对，请更新页面扩展后再传封面')
    }
    const unavailable: string[] = []
    for (const summary of summaries) {
      if (summary.type !== RESOURCE_TYPE.USER_PERSONA) continue
      if (personaPlans.get(summary.id)?.skip) continue
      const resource = await resourceService.get(summary.id)
      if (!resource) throw new Error(`人设“${summary.name}”已不存在`)
      const view = parseSillyTavernPersonaBackup(JSON.parse(await resource.originalBlob.text()))
      const avatarId =
        view.defaultPersona || (view.entries.length === 1 ? view.entries[0]!.avatarId : '')
      if (!avatarId) {
        unavailable.push(`${summary.name}（未设默认人设）`)
        continue
      }
      if (
        avatarId !== avatarId.trim() ||
        avatarId.length > 120 ||
        /[\\/:*?"<>|]/u.test(avatarId) ||
        Array.from(avatarId).some((character) => character.charCodeAt(0) < 32) ||
        !/\.png$/iu.test(avatarId)
      ) {
        unavailable.push(`${summary.name}（头像文件名不符合酒馆要求）`)
        continue
      }
      let avatar: Awaited<ReturnType<typeof resourceService.get>>
      for (const id of getRelatedResourceIds(resource)) {
        const candidate = await resourceService.get(id)
        if (
          candidate &&
          isUserPersonaAvatarAttachment(candidate) &&
          candidate.metadata.avatarId === avatarId
        ) {
          avatar = candidate
          break
        }
      }
      if (!avatar) {
        unavailable.push(`${summary.name}（没有已缓存的封面）`)
        continue
      }
      plans.set(summary.id, {
        avatarId: personaPlans.get(summary.id)?.avatarId ?? avatarId,
        file: new File([avatar.originalBlob], personaPlans.get(summary.id)?.avatarId ?? avatarId, {
          type: 'image/png',
        }),
        exists: false,
      })
    }
    if (!plans.size) return plans
    const existing = new Set<string>()
    const avatarIds = Array.from(plans.values(), (plan) => plan.avatarId)
    for (let index = 0; index < avatarIds.length; index += 100) {
      const batch = await tavernBridgeService.checkUserAvatarIds(
        avatarIds.slice(index, index + 100),
      )
      for (const id of batch) existing.add(id)
    }
    for (const plan of plans.values()) plan.exists = existing.has(plan.avatarId)
    const lines = summaries.flatMap((summary) => {
      const plan = plans.get(summary.id)
      if (!plan) return []
      const outcome = plan.exists
        ? personaAvatarMode.value === 'replace'
          ? '替换酒馆同名头像'
          : '酒馆已有，保留原图'
        : '酒馆缺少，将新增'
      return [`${summary.name} → ${plan.avatarId}：${outcome}`]
    })
    const confirmed = await confirmAction({
      title: '核对人设封面传送',
      message: `${lines.join('\n')}${unavailable.length ? `\n无法传封面：${unavailable.join('、')}` : ''}\n头像与人设分别传送；一项失败时会报告实际结果，便于重试。`,
      confirmLabel: '按此范围发送',
      danger:
        personaAvatarMode.value === 'replace' &&
        Array.from(plans.values()).some((plan) => plan.exists),
    })
    return confirmed ? plans : null
  }

  async function runSendQueue(
    summaries: ResourceSummary[],
    avatarPlans = new Map<string, PersonaAvatarPlan>(),
    personaPlans = new Map<string, PersonaSendPlan>(),
  ): Promise<void> {
    lastTransferDirection = 'send'
    busy.value = true
    error.value = ''
    let sentCount = 0
    try {
      for (let index = 0; index < summaries.length; index += 1) {
        const summary = summaries[index]!
        const entry = transferQueue.value.find((queued) => queued.key === summary.id)
        if (!entry) continue
        entry.status = 'active'
        progress.value = `正在发送 ${index + 1} / ${summaries.length}：${summary.name}`
        const personaPlan = personaPlans.get(summary.id)
        if (personaPlan?.skip) {
          entry.status = 'done'
          entry.detail = '酒馆已有相同人设，已跳过'
          continue
        }
        let avatarDetail = ''
        try {
          const resource = await resourceService.get(summary.id)
          if (!resource) throw new Error('资源已不存在')
          const chatPlan = chatReturnPlans.get(resource.id)
          if (resource.type === RESOURCE_TYPE.CHAT && !chatPlan)
            throw new Error('请重新选择聊天并确认接收角色')
          const avatarPlan = avatarPlans.get(summary.id)
          if (
            summary.type === RESOURCE_TYPE.USER_PERSONA &&
            personaAvatarMode.value !== 'none' &&
            !avatarPlan
          ) {
            avatarDetail = '没有已缓存封面；仅传人设'
          }
          if (avatarPlan) {
            if (avatarPlan.exists && personaAvatarMode.value === 'missing') {
              avatarDetail = '酒馆同名头像已保留'
            } else {
              const [avatarResult] = await tavernBridgeService.sendFiles(
                [
                  {
                    file: avatarPlan.file,
                    kind: 'userAvatar',
                    displayName: avatarPlan.avatarId,
                    targetName: avatarPlan.avatarId,
                  },
                ],
                personaAvatarMode.value === 'replace' ? 'overwrite' : 'skip',
              )
              avatarDetail =
                avatarResult?.status === 'skipped'
                  ? '酒馆同名头像已保留'
                  : `头像${avatarResult?.status === 'overwritten' ? '已替换' : '已上传'}`
            }
          }
          const [result] = await tavernBridgeService.sendFiles(
            [
              {
                file:
                  personaPlan?.file ??
                  new File([resource.originalBlob], resource.fileName, {
                    type: resource.mimeType,
                  }),
                kind: bridgeKind(summary),
                displayName: summary.name,
                operationId: entry.operationId,
                targetName: chatPlan
                  ? chatPlan.avatar
                  : typeof resource.metadata.extractedFromCharacterName === 'string'
                    ? resource.metadata.extractedFromCharacterName
                    : typeof resource.metadata.extractedFromPresetName === 'string'
                      ? resource.metadata.extractedFromPresetName
                      : typeof resource.metadata.sourceName === 'string'
                        ? resource.metadata.sourceName
                        : undefined,
              },
            ],
            chatPlan ? 'copy' : personaPlan?.file ? 'skip' : conflictPolicy.value,
            (_completed, _total, detail) => {
              if (detail) progress.value = detail
            },
          )
          if (chatPlan?.regexFile) {
            avatarDetail = '聊天已导入'
            await tavernBridgeService.sendFiles(
              [
                {
                  file: chatPlan.regexFile,
                  kind: 'regexCharacter',
                  displayName: '聊天配套正则（停用）',
                  targetName: chatPlan.avatar,
                  operationId: entry.operationId + ':regex',
                },
              ],
              'copy',
            )
            avatarDetail = '配套正则已添加，保持停用'
          }
          entry.status = 'done'
          entry.detail = [
            result?.status === 'skipped'
              ? '已跳过相同或同名资源'
              : state.value.transport === 'directory'
                ? '已写入并校验，下次启动酒馆生效'
                : '酒馆已确认导入',
            avatarDetail,
          ]
            .filter(Boolean)
            .join(' · ')
          if (result?.status !== 'skipped') sentCount += 1
        } catch (reason) {
          entry.status = 'failed'
          const message = reason instanceof Error ? reason.message : '发送失败'
          entry.detail = [
            avatarDetail,
            message.includes('暂不支持')
              ? `${message}；助手脚本互传需要页面扩展 ${BRIDGE_EXTENSION_VERSION}+，请在酒馆扩展管理中点击更新`
              : message,
          ]
            .filter(Boolean)
            .join(' · ')
        }
      }
      const failed = transferQueue.value.filter((item) => item.status === 'failed').length
      if (sentCount) selectedLocalIds.value = new Set()
      if (sentCount) {
        tavernItems.value = await tavernConnectionStore
          .refreshInventory()
          .catch(() => tavernItems.value)
      }
      recordReport(`发送 ${sentCount} 项到酒馆${failed ? `（${failed} 项失败）` : ''}`)
      progress.value = failed
        ? `发送完成：成功 ${sentCount} 项、失败 ${failed} 项；失败项可单独重试`
        : state.value.transport === 'directory'
          ? `已写入 ${sentCount} 项到酒馆目录；下次启动酒馆后生效`
          : `已发送 ${sentCount} 项到酒馆；如果酒馆界面未刷新，请在酒馆内刷新对应列表`
    } finally {
      busy.value = false
    }
  }

  function resourceLabel(resource: ResourceSummary): string {
    if (resource.type === RESOURCE_TYPE.CHAT) return '聊天记录'
    if (resource.type === RESOURCE_TYPE.USER_PERSONA) return '用户人设'
    if (resource.type === RESOURCE_TYPE.CHARACTER_CARD) return '角色卡'
    if (resource.type === RESOURCE_TYPE.WORLD_BOOK) return '世界书'
    if (resource.type === RESOURCE_TYPE.PRESET) return '预设'
    if (resource.type === RESOURCE_TYPE.REGEX) return '正则'
    if (resource.type === RESOURCE_TYPE.QUICK_REPLY) return '快速回复'
    if (resource.type === RESOURCE_TYPE.SCRIPT) return '助手脚本'
    return '主题'
  }

  function openAuthorTools(event: MouseEvent): void {
    authorToolsTrigger = event.currentTarget instanceof HTMLElement ? event.currentTarget : null
    copiedAuthorToolId.value = null
    authorToolsDialog.value = 'list'
  }

  function closeAuthorTools(): void {
    authorToolsDialog.value = null
    copiedAuthorToolId.value = null
    void nextTick(() => authorToolsTrigger?.focus({ preventScroll: true }))
  }

  function showAuthorToolDetails(toolId: (typeof AUTHOR_TOOLS)[number]['id']): void {
    copiedAuthorToolId.value = null
    authorToolsDialog.value = toolId
  }

  async function copyAuthorToolRepository(tool: (typeof AUTHOR_TOOLS)[number]): Promise<void> {
    try {
      await navigator.clipboard.writeText(tool.repository)
      copiedAuthorToolId.value = tool.id
    } catch {
      copiedAuthorToolId.value = null
      error.value = '无法复制仓库地址，请手动复制链接。'
    }
  }

  onMounted(() => {
    tavernConnectionStore.addEventListener('change', handleState)
    state.value = tavernConnectionStore.getSnapshot()
    tavernItems.value = state.value.inventory
    const supportedIds = new Set(supportedLocalResources.value.map((resource) => resource.id))
    selectedLocalIds.value = new Set(
      props.initialLocalIds.filter((resourceId) => supportedIds.has(resourceId)),
    )
    if (selectedLocalIds.value.size) activeDirection.value = 'toTavern'
    // 离开“功能 → 酒馆互传”只会卸载页面，不会关闭 Service 的中继端口。
    // 此时不会再收到新的 connected 事件，必须主动恢复目录，不能显示为空列表。
    if (state.value.status === 'connected' && !state.value.lastSyncAt) void refreshTavernResources()
  })

  onUnmounted(() => {
    disposed = true
    tavernConnectionStore.removeEventListener('change', handleState)
  })
  return {
    canBindDirectory,
    bindDirectory,
    state,
    busy,
    acceptPairing,
    canShowDeviceJoin,
    joinDeviceRelay,
    deviceCode,
    canUseLocalTavernHost,
    connectLocalTavern,
    installGuideOpen,
    error,
    progress,
    localDirectEnabled,
    setLocalDirectEnabled,
    localDirectAvailable,
    LOCAL_DIRECT_BRIDGE_EXTENSION_VERSION,
    refreshTavernResources,
    disconnectTavern,
    activeDirection,
    bridgeDiffSummary,
    selectSyncEntries,
    showOnlyMissingTavern,
    showOnlyMissingLocal,
    tavernReceiveFilters,
    tavernReceiveFilter,
    tavernSearch,
    visibleTavernItems,
    selectAllTavern,
    selectedTavernIds,
    showOnlySelectedTavern,
    toggleSelection,
    tavernResourceLabel,
    itemExistsLocally,
    pullFromTavern,
    localSendFilters,
    includeChatRegex,
    selectedChatCount,
    localSendFilter,
    search,
    bridgeFolderFilter,
    bridgeTagFilter,
    bridgeTagOptions,
    bridgeFavoritesOnly,
    selectAllLocal,
    selectedLocalIds,
    filteredLocalResources,
    tavernItems,
    showOnlySelectedLocal,
    resourceLabel,
    resourceExistsInTavern,
    conflictPolicy,
    personaAvatarMode,
    selectedPersonaCount,
    canCheckPersonaAvatars,
    sendConflictCount,
    sendToTavern,
    reports,
    transferQueue,
    failedTransferKeys,
    retryFailedTransfers,
    openAuthorTools,
    authorToolsDialog,
    closeAuthorTools,
    AUTHOR_TOOLS,
    showAuthorToolDetails,
    selectedAuthorTool,
    copyAuthorToolRepository,
    copiedAuthorToolId,
  }
}
