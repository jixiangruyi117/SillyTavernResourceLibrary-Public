<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { createAsyncPanel } from '../core/AsyncPanel'
import {
  SRL_BACK_REQUEST_EVENT,
  useBackStack,
  type SrlBackRequestDetail,
} from '../composables/UseBackStack'
import { useConfirmDialogState } from '../composables/UseConfirmDialog'
import FeatureShell from './FeatureShell.vue'
import DiscordInboxPanel from './DiscordInboxPanel.vue'
import DiscordResourceDownloadPanel from './DiscordResourceDownloadPanel.vue'
import DiscordPendingSources from './DiscordPendingSources.vue'
import DiscordNativeInboxMode from './DiscordNativeInboxMode.vue'

defineEmits<{ back: [] }>()
const settingsOpen = ref(false)
const { activeDialog } = useConfirmDialogState()
const backStack = useBackStack([
  {
    id: 'inbox-connection',
    isActive: () => settingsOpen.value,
    back: () => {
      settingsOpen.value = false
    },
  },
])
function closeSettingsOnEscape(event: KeyboardEvent): void {
  if (event.key !== 'Escape' || activeDialog.value || backStack.back() === 'none') return
  event.preventDefault()
  event.stopImmediatePropagation()
}
function closeSettingsOnBack(event: Event): void {
  const detail = (event as CustomEvent<SrlBackRequestDetail>).detail
  if (!detail || detail.handled || activeDialog.value || backStack.back() === 'none') return
  detail.handled = true
  event.stopImmediatePropagation()
}
onMounted(() => {
  window.addEventListener('keydown', closeSettingsOnEscape, true)
  window.addEventListener(SRL_BACK_REQUEST_EVENT, closeSettingsOnBack, true)
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', closeSettingsOnEscape, true)
  window.removeEventListener(SRL_BACK_REQUEST_EVENT, closeSettingsOnBack, true)
})
const ConnectionSettings = createAsyncPanel(
  'Discord 连接设置',
  () => import('./ResourceLinkAdvancedSettings.vue'),
)
</script>

<template>
  <FeatureShell title="收件箱" @back="$emit('back')">
    <template #actions>
      <button
        class="feature-header-action feature-header-action--ghost"
        type="button"
        @click="settingsOpen = true"
      >
        连接设置
      </button>
    </template>
    <div class="discord-inbox-center__content">
      <DiscordNativeInboxMode />
      <DiscordInboxPanel />
      <DiscordResourceDownloadPanel />
      <DiscordPendingSources hide-when-empty />
    </div>
  </FeatureShell>
  <ConnectionSettings
    v-if="settingsOpen"
    title="Discord 连接设置"
    back-label="返回收件箱"
    @close="settingsOpen = false"
  />
</template>

<style scoped>
.discord-inbox-center__content {
  box-sizing: border-box;
  width: 100%;
  max-width: 52rem;
  margin: 16px auto 0;
  padding: 0 16px;
  border: 1px solid var(--color-line);
  border-radius: 12px;
  background: var(--color-surface-raised);
}
</style>
