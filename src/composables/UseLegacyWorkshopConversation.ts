import type { WorkshopChatMessage } from '../types/FrontendWorkshopLegacyApp'
import { computed, ref } from 'vue'
import { confirmAction } from './UseConfirmDialog'
interface LegacyWorkshopConversationContext {
  conversation: import('vue').Ref<WorkshopChatMessage[]>
  excludedConversationVersionIds: import('vue').Ref<string[]>
  saveVersions: () => void
}
export function useLegacyWorkshopConversation(context: LegacyWorkshopConversationContext) {
  const { conversation, excludedConversationVersionIds, saveVersions } = context
  const conversationSelectionMode = ref(false)

  const selectedConversationTurnIds = ref<string[]>([])

  let conversationPressTimer: number | undefined

  let conversationPressStart: { x: number; y: number } | undefined

  let suppressedConversationClickId = ''

  const selectedConversationMessageCount = computed(() => {
    const selected = new Set(selectedConversationTurnIds.value)
    return conversation.value.filter((message) => selected.has(conversationTurnId(message))).length
  })

  function cancelConversationPress(): void {
    if (conversationPressTimer !== undefined) window.clearTimeout(conversationPressTimer)
    conversationPressTimer = undefined
    conversationPressStart = undefined
  }

  function conversationTurnId(message: WorkshopChatMessage): string {
    return message.versionId ? `version:${message.versionId}` : `message:${message.id}`
  }

  function toggleConversationTurn(message: WorkshopChatMessage): void {
    const turnId = conversationTurnId(message)
    const selected = new Set(selectedConversationTurnIds.value)
    if (selected.has(turnId)) selected.delete(turnId)
    else selected.add(turnId)
    selectedConversationTurnIds.value = Array.from(selected)
    conversationSelectionMode.value = selected.size > 0
  }

  function handleConversationClick(message: WorkshopChatMessage): void {
    const turnId = conversationTurnId(message)
    if (suppressedConversationClickId === turnId) {
      suppressedConversationClickId = ''
      return
    }
    suppressedConversationClickId = ''
    if (conversationSelectionMode.value) toggleConversationTurn(message)
  }

  function enterConversationSelection(message: WorkshopChatMessage): void {
    conversationSelectionMode.value = true
    if (!selectedConversationTurnIds.value.includes(conversationTurnId(message)))
      selectedConversationTurnIds.value = [
        ...selectedConversationTurnIds.value,
        conversationTurnId(message),
      ]
  }

  function cancelConversationSelection(): void {
    conversationSelectionMode.value = false
    selectedConversationTurnIds.value = []
  }

  function selectAllConversationTurns(): void {
    selectedConversationTurnIds.value = Array.from(
      new Set(conversation.value.map(conversationTurnId)),
    )
    conversationSelectionMode.value = selectedConversationTurnIds.value.length > 0
  }

  function startConversationPress(message: WorkshopChatMessage, event: PointerEvent): void {
    cancelConversationPress()
    conversationPressStart = { x: event.clientX, y: event.clientY }
    conversationPressTimer = window.setTimeout(() => {
      conversationPressTimer = undefined
      conversationPressStart = undefined
      suppressedConversationClickId = conversationTurnId(message)
      enterConversationSelection(message)
    }, 560)
  }

  function moveConversationPress(event: PointerEvent): void {
    if (!conversationPressStart) return
    if (
      Math.abs(event.clientX - conversationPressStart.x) > 10 ||
      Math.abs(event.clientY - conversationPressStart.y) > 10
    )
      cancelConversationPress()
  }

  async function deleteSelectedConversationTurns(): Promise<void> {
    cancelConversationPress()
    const selected = new Set(selectedConversationTurnIds.value)
    if (!selected.size) return
    const selectedVersionIds = Array.from(selected)
      .filter((id) => id.startsWith('version:'))
      .map((id) => id.slice('version:'.length))
    const selectedMessages = conversation.value.filter((message) =>
      selected.has(conversationTurnId(message)),
    )
    const confirmed = await confirmAction({
      title: `删除选中的 ${selected.size} 轮对话？`,
      message: `共 ${selectedMessages.length} 条聊天记录会移除。对应的用户修改要求将不再注入后续 AI；已生成的状态栏版本仍会保留。`,
      confirmLabel: '删除选中对话',
      cancelLabel: '保留',
    })
    if (!confirmed) return
    conversation.value = conversation.value.filter(
      (message) => !selected.has(conversationTurnId(message)),
    )
    excludedConversationVersionIds.value = Array.from(
      new Set([...excludedConversationVersionIds.value, ...selectedVersionIds]),
    ).slice(-20)
    cancelConversationSelection()
    saveVersions()
  }
  return {
    conversationSelectionMode,
    selectedConversationTurnIds,
    selectedConversationMessageCount,
    cancelConversationPress,
    conversationTurnId,
    toggleConversationTurn,
    handleConversationClick,
    enterConversationSelection,
    cancelConversationSelection,
    selectAllConversationTurns,
    startConversationPress,
    moveConversationPress,
    deleteSelectedConversationTurns,
  }
}
