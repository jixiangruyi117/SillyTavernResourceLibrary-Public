import { computed, nextTick, ref, type Ref } from 'vue'
import {
  retainAssistantHistory,
  type AssistantImage,
  type AssistantDesignReference,
  type AssistantTurn,
} from '../services/ProductAssistantService'
export interface AssistantMessageAction {
  id: string
  label: string
  disabled?: boolean
  danger?: boolean
}
/** Owns message gestures and actions; conversation writes still use Workspace via persist. */
export function useProductAssistantMessageActions(options: {
  busy: Ref<boolean>
  history: Ref<AssistantTurn[]>
  input: Ref<string>
  images: Ref<AssistantImage[]>
  designReferences: Ref<AssistantDesignReference[]>
  inputElement: Ref<HTMLTextAreaElement | undefined>
  actionMenu: Readonly<Ref<HTMLDialogElement | null>>
  error: Ref<string>
  persist: () => Promise<void>
  scrollToLatest: () => Promise<void>
}) {
  const { busy, history, input, images, designReferences, inputElement, error } = options
  const selectedTurn = ref<AssistantTurn>()
  const actionsOpen = ref(false)
  const actionMenu = options.actionMenu
  const actionPosition = ref({ left: '12px', top: '12px' })
  const editingId = ref<string>()
  const messageLabels: Record<string, string> = {
    copy: '复制',
    edit: '编辑',
    resend: '重发',
    favorite: '收藏',
    delete: '删除',
  }
  const messageActions = computed<AssistantMessageAction[]>(() => [
    { id: 'copy', label: '复制', disabled: !selectedTurn.value?.text },
    ...(selectedTurn.value?.role === 'user'
      ? [
          { id: 'edit', label: '编辑问题' },
          { id: 'resend', label: '重新发送' },
        ]
      : []),
    { id: 'favorite', label: selectedTurn.value?.favorite ? '取消收藏' : '收藏消息' },
    { id: 'context', label: selectedTurn.value?.contextExcluded ? '取消隐藏' : '隐藏' },
    { id: 'delete', label: '删除消息', danger: true },
  ])
  let pressTimer: ReturnType<typeof setTimeout> | undefined
  let pressPoint: { x: number; y: number } | undefined
  let openingPressPointer: number | undefined
  function cancelPress() {
    clearTimeout(pressTimer)
    pressTimer = undefined
    pressPoint = undefined
  }
  async function openActions(turn: AssistantTurn, anchor?: Event | HTMLElement) {
    if (busy.value) return
    cancelPress()
    selectedTurn.value = turn
    actionsOpen.value = true
    const target =
      anchor instanceof HTMLElement ? anchor : (anchor?.currentTarget as HTMLElement | undefined)
    const bubble = target?.closest('.chat-message__body')?.querySelector('.chat-bubble') ?? target
    const rect = bubble?.getBoundingClientRect()
    await nextTick()
    const menu = actionMenu.value
    if (!menu) return
    if (!menu.open) menu.showModal()
    const { width, height } = menu.getBoundingClientRect()
    const x = rect ? rect.left + rect.width / 2 - width / 2 : 12
    const y = rect && rect.top > height + 20 ? rect.top - height - 10 : (rect?.bottom ?? 12) + 10
    actionPosition.value = {
      left: `${Math.max(12, Math.min(window.innerWidth - width - 12, x))}px`,
      top: `${Math.max(12, Math.min(window.innerHeight - height - 12, y))}px`,
    }
  }
  function closeActions() {
    openingPressPointer = undefined
    actionMenu.value?.close()
    actionsOpen.value = false
    selectedTurn.value = undefined
  }
  function dismissActions(event: MouseEvent) {
    if (
      openingPressPointer !== undefined &&
      (event as PointerEvent).pointerId === openingPressPointer
    ) {
      openingPressPointer = undefined
      return
    }
    closeActions()
  }
  function startMenuPointer() {
    openingPressPointer = undefined
  }
  function startPress(event: PointerEvent, turn: AssistantTurn) {
    if (event.button !== 0 || busy.value || (event.target as HTMLElement).closest('button, iframe'))
      return
    cancelPress()
    pressPoint = { x: event.clientX, y: event.clientY }
    const target = event.currentTarget as HTMLElement
    pressTimer = setTimeout(() => {
      openingPressPointer = event.pointerId
      void openActions(turn, target)
    }, 450)
  }
  function movePress(event: PointerEvent) {
    if (pressPoint && Math.hypot(event.clientX - pressPoint.x, event.clientY - pressPoint.y) > 8)
      cancelPress()
  }
  function cancelEditing() {
    editingId.value = undefined
    input.value = ''
    images.value = []
    designReferences.value = []
  }
  async function messageAction(action: AssistantMessageAction) {
    const turn = selectedTurn.value
    if (!turn || busy.value) return
    closeActions()
    try {
      if (action.id === 'copy') await navigator.clipboard.writeText(turn.text)
      else if (action.id === 'edit') {
        editingId.value = turn.id
        input.value = turn.text
        images.value = [...(turn.images ?? [])]
        designReferences.value = [...(turn.designReferences ?? [])]
        await nextTick()
        inputElement.value?.focus()
      } else if (action.id === 'resend') {
        history.value = retainAssistantHistory([
          ...history.value,
          {
            id: crypto.randomUUID(),
            role: 'user',
            text: turn.text,
            images: [...(turn.images ?? [])],
            designReferences: [...(turn.designReferences ?? [])],
          },
        ])
        await options.persist()
        await options.scrollToLatest()
      } else if (action.id === 'delete') {
        history.value = history.value.filter((item) => item.id !== turn.id)
        if (editingId.value === turn.id) cancelEditing()
        await options.persist()
      } else if (action.id === 'favorite' || action.id === 'context') {
        const key = action.id === 'context' ? 'contextExcluded' : 'favorite'
        const previous = turn[key]
        turn[key] = !previous
        try {
          await options.persist()
        } catch (cause) {
          turn[key] = previous
          throw cause
        }
      }
    } catch (cause) {
      error.value =
        action.id === 'copy'
          ? '复制失败，请检查剪贴板权限'
          : cause instanceof Error
            ? cause.message
            : '消息操作失败'
    }
  }
  return {
    selectedTurn,
    actionsOpen,
    actionPosition,
    editingId,
    messageLabels,
    messageActions,
    cancelPress,
    openActions,
    closeActions,
    dismissActions,
    startMenuPointer,
    startPress,
    movePress,
    cancelEditing,
    messageAction,
  }
}
