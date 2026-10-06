<script setup lang="ts">
import { ref } from 'vue'
const props = defineProps<{
  destination: { target: string; title: string; guide?: string }
  navigate: (id: string, guide?: string) => Promise<void>
  persist: () => Promise<void>
  busy: boolean
}>()
const emit = defineEmits<{ failed: [message: string] }>()
const opening = ref(false)
async function open() {
  if (props.busy || opening.value) return
  opening.value = true
  try {
    await props.persist()
    await props.navigate(props.destination.target, props.destination.guide)
  } catch (cause) {
    emit('failed', cause instanceof Error ? cause.message : '跳转失败，当前聊天保留')
  } finally {
    opening.value = false
  }
}
</script>
<template>
  <button
    class="chat-navigation-link"
    type="button"
    :disabled="busy || opening"
    @pointerdown.stop
    @click.stop="open"
  >
    <span>前往{{ destination.title }}</span
    ><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14m-5-5 5 5-5 5" /></svg>
  </button>
</template>
<style scoped>
.chat-navigation-link {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 44px;
  margin-top: 8px;
  padding: 6px 12px;
  border: 1px solid var(--color-line);
  border-radius: 12px;
  background: var(--color-surface-raised);
  color: var(--color-accent);
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}
.chat-navigation-link svg {
  width: 16px;
  height: 16px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.7;
  stroke-linecap: round;
  stroke-linejoin: round;
}
</style>
