<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { SRL_BACK_REQUEST_EVENT, type SrlBackRequestDetail } from '../composables/UseBackStack'

export interface ActionSheetAction {
  id: string
  label: string
  description?: string
  danger?: boolean
  disabled?: boolean
}

const props = withDefaults(
  defineProps<{
    open: boolean
    title: string
    description?: string
    actions: readonly ActionSheetAction[]
  }>(),
  { description: undefined },
)

const emit = defineEmits<{
  'update:open': [value: boolean]
  select: [action: ActionSheetAction]
}>()

const panel = ref<HTMLElement>()

function close(): void {
  emit('update:open', false)
}

function select(action: ActionSheetAction): void {
  if (action.disabled) return
  emit('select', action)
  close()
}

function onKeydown(event: KeyboardEvent): void {
  if (props.open && event.key === 'Escape') close()
}

function onBackRequest(event: Event): void {
  if (!props.open) return
  const detail = (event as CustomEvent<SrlBackRequestDetail>).detail
  if (detail.handled) return
  detail.handled = true
  close()
}

watch(
  () => props.open,
  (open) => {
    document.documentElement.classList.toggle('srl-action-sheet-open', open)
    if (open) void nextTick(() => panel.value?.focus({ preventScroll: true }))
  },
  { immediate: true },
)

window.addEventListener('keydown', onKeydown)
window.addEventListener(SRL_BACK_REQUEST_EVENT, onBackRequest)
onBeforeUnmount(() => {
  document.documentElement.classList.remove('srl-action-sheet-open')
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener(SRL_BACK_REQUEST_EVENT, onBackRequest)
})
</script>

<template>
  <Teleport to="body">
    <Transition name="action-sheet">
      <div v-if="open" class="action-sheet" role="presentation" @click.self="close">
        <section
          ref="panel"
          class="action-sheet__panel"
          role="dialog"
          aria-modal="true"
          :aria-label="title"
          tabindex="-1"
        >
          <header>
            <div>
              <h2>{{ title }}</h2>
              <p v-if="description">{{ description }}</p>
            </div>
            <button type="button" aria-label="关闭操作面板" @click="close">×</button>
          </header>
          <div class="action-sheet__actions">
            <button
              v-for="action in actions"
              :key="action.id"
              type="button"
              :class="{ 'action-sheet__action--danger': action.danger }"
              :disabled="action.disabled"
              @click="select(action)"
            >
              <strong>{{ action.label }}</strong>
              <small v-if="action.description">{{ action.description }}</small>
            </button>
          </div>
          <slot />
        </section>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.action-sheet {
  position: fixed;
  z-index: 1200;
  inset: 0;
  display: grid;
  align-items: end;
  padding: max(1rem, var(--safe-top)) max(1rem, var(--safe-right)) 0 max(1rem, var(--safe-left));
  background: rgb(10 15 25 / 48%);
  backdrop-filter: blur(4px);
}

.action-sheet__panel {
  width: min(100%, 34rem);
  max-height: min(78dvh, 42rem);
  margin: 0 auto;
  overflow: auto;
  border: 1px solid var(--color-line-strong);
  padding-bottom: var(--safe-bottom);
  border-radius: 1.25rem 1.25rem 0 0;
  background: var(--color-surface, #fff);
  box-shadow: 0 1.2rem 3rem rgb(5 10 20 / 24%);
}

.action-sheet header {
  display: flex;
  gap: 1rem;
  align-items: start;
  justify-content: space-between;
  padding: 1rem 1rem 0.75rem;
}

.action-sheet h2,
.action-sheet p {
  margin: 0;
}

.action-sheet p {
  margin-top: 0.25rem;
  color: var(--color-ink-soft);
}

.action-sheet header > button {
  min-width: 2.75rem;
  min-height: 2.75rem;
  border: 0;
  background: transparent;
  font-size: 1.5rem;
}

.action-sheet__actions {
  display: grid;
  gap: 0.5rem;
  padding: 0 0.75rem 0.75rem;
}

.action-sheet__actions > button {
  display: grid;
  min-height: 3.25rem;
  padding: 0.7rem 0.85rem;
  border: 1px solid var(--color-line);
  border-radius: 0.85rem;
  background: transparent;
  color: inherit;
  text-align: left;
}

.action-sheet__actions small {
  margin-top: 0.15rem;
  color: var(--color-ink-soft);
}

.action-sheet__action--danger {
  color: var(--color-danger, #b42318) !important;
}

.action-sheet-enter-active,
.action-sheet-leave-active {
  transition: opacity 160ms ease;
}

.action-sheet-enter-from,
.action-sheet-leave-to {
  opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
  .action-sheet-enter-active,
  .action-sheet-leave-active {
    transition-duration: 0.01ms;
  }
}

@media (min-width: 768px) {
  .action-sheet {
    align-items: center;
    padding-bottom: max(1rem, var(--safe-bottom));
  }

  .action-sheet__panel {
    padding-bottom: 0;
    border-radius: 1.25rem;
  }
}
</style>
