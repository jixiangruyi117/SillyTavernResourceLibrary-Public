<script setup lang="ts">
import '../styles/ConfirmDialog.css'
import { nextTick, onMounted, onUnmounted, ref, watch } from 'vue'

import { useConfirmDialogState } from '../composables/UseConfirmDialog'
import { triggerNativeHaptic } from '../core/NativeHaptics'

const { activeDialog, respond } = useConfirmDialogState()
const confirmButton = ref<HTMLButtonElement>()
const cancelButton = ref<HTMLButtonElement>()

// 危险操作默认聚焦取消，避免回车误确认；普通操作聚焦确认。
watch(activeDialog, async (dialog) => {
  if (!dialog) return
  await nextTick()
  ;(dialog.danger ? cancelButton.value : confirmButton.value)?.focus()
})

function handleKeydown(event: KeyboardEvent): void {
  if (!activeDialog.value) return
  if (event.key === 'Escape') {
    event.stopPropagation()
    respond('cancel')
  }
}

function respondWithHaptic(response: 'confirm' | 'cancel' | 'alternative'): void {
  if (response === 'confirm')
    triggerNativeHaptic(activeDialog.value?.danger ? 'warning' : 'confirm')
  respond(response)
}
onMounted(() => window.addEventListener('keydown', handleKeydown, true))
onUnmounted(() => window.removeEventListener('keydown', handleKeydown, true))
</script>

<template>
  <Teleport to="body">
    <div
      v-if="activeDialog"
      class="confirm-dialog__overlay"
      :class="{ 'is-centered': activeDialog.centered }"
      role="presentation"
      @click.self="respondWithHaptic('cancel')"
    >
      <section
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
    </div>
  </Teleport>
</template>
