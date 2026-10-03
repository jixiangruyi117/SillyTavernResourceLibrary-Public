<script setup lang="ts">
import '../styles/ConfirmDialog.css'
import { nextTick, onMounted, onUnmounted, ref, watch } from 'vue'

import { useConfirmDialogState } from '../composables/UseConfirmDialog'
import { SRL_BACK_REQUEST_EVENT, type SrlBackRequestDetail } from '../composables/UseBackStack'
import { triggerNativeHaptic } from '../core/NativeHaptics'

const { activeDialog, respond } = useConfirmDialogState()
const modal = ref<HTMLDialogElement>()
const confirmButton = ref<HTMLButtonElement>()
const cancelButton = ref<HTMLButtonElement>()
const dialogPanel = ref<HTMLElement>()
let returnFocus: HTMLElement | undefined

// 危险操作默认聚焦取消，避免回车误确认；普通操作聚焦确认。
watch(
  activeDialog,
  async (dialog, previous) => {
    if (!dialog) {
      await nextTick()
      if (!activeDialog.value && returnFocus?.isConnected)
        returnFocus.focus({ preventScroll: true })
      returnFocus = undefined
      return
    }
    if (!previous)
      returnFocus =
        document.activeElement instanceof HTMLElement ? document.activeElement : undefined
    await nextTick()
    if (!modal.value?.open) modal.value?.showModal()
    ;(dialog.danger ? cancelButton.value : confirmButton.value)?.focus({ preventScroll: true })
  },
  { immediate: true },
)

function handleKeydown(event: KeyboardEvent): void {
  if (!activeDialog.value) return
  if (event.key === 'Tab') {
    const buttons = Array.from(
      dialogPanel.value?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [],
    )
    const first = buttons[0]
    const last = buttons.at(-1)
    if (
      first &&
      last &&
      (!dialogPanel.value?.contains(document.activeElement) ||
        (event.shiftKey && document.activeElement === first) ||
        (!event.shiftKey && document.activeElement === last))
    ) {
      event.preventDefault()
      ;(event.shiftKey ? last : first).focus()
    }
    event.stopImmediatePropagation()
  }
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopImmediatePropagation()
    respond('cancel')
  }
}

function respondWithHaptic(response: 'confirm' | 'cancel' | 'alternative'): void {
  if (response === 'confirm')
    triggerNativeHaptic(activeDialog.value?.danger ? 'warning' : 'confirm')
  respond(response)
}
function handleBack(event: Event): void {
  if (!activeDialog.value || !(event instanceof CustomEvent)) return
  const detail = event.detail as SrlBackRequestDetail
  detail.handled = true
  event.stopImmediatePropagation()
  respond('cancel')
}
onMounted(() => {
  window.addEventListener('keydown', handleKeydown, true)
  window.addEventListener(SRL_BACK_REQUEST_EVENT, handleBack, true)
})
onUnmounted(() => {
  window.removeEventListener('keydown', handleKeydown, true)
  window.removeEventListener(SRL_BACK_REQUEST_EVENT, handleBack, true)
  modal.value?.close()
})
</script>

<template>
  <Teleport to="body">
    <dialog
      v-if="activeDialog"
      ref="modal"
      class="confirm-dialog__overlay"
      :class="{ 'is-centered': activeDialog.centered }"
      @cancel.prevent="respondWithHaptic('cancel')"
      @click.self="respondWithHaptic('cancel')"
    >
      <section
        ref="dialogPanel"
        class="confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        :aria-label="activeDialog.title"
      >
        <h3>{{ activeDialog.title }}</h3>
        <p>{{ activeDialog.message }}</p>
        <footer>
          <button ref="cancelButton" type="button" @click="respondWithHaptic('cancel')">
            {{ activeDialog.cancelLabel }}
          </button>
          <button
            v-if="activeDialog.alternativeLabel"
            type="button"
            @click="respondWithHaptic('alternative')"
          >
            {{ activeDialog.alternativeLabel }}
          </button>
          <button
            ref="confirmButton"
            type="button"
            class="confirm-dialog__confirm"
            :class="{ 'confirm-dialog__confirm--danger': activeDialog.danger }"
            @click="respondWithHaptic('confirm')"
          >
            {{ activeDialog.confirmLabel }}
          </button>
        </footer>
      </section>
    </dialog>
  </Teleport>
</template>
