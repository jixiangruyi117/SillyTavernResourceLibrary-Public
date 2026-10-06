<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { createAsyncPanel } from '../core/AsyncPanel'
import {
  SRL_BACK_REQUEST_EVENT,
  useBackStack,
  type SrlBackRequestDetail,
} from '../composables/UseBackStack'
import { useConfirmDialogState } from '../composables/UseConfirmDialog'
import { assistantGuidance } from '../core/ProductAssistantGuidance'
import FeatureShell from './FeatureShell.vue'
import DiscordInboxPanel from './DiscordInboxPanel.vue'
import DiscordResourceDownloadPanel from './DiscordResourceDownloadPanel.vue'
import DiscordPendingSources from './DiscordPendingSources.vue'
import DiscordNativeInboxMode from './DiscordNativeInboxMode.vue'
import type { ResourceSummary } from '../types/Resource'

defineEmits<{ back: []; 'open-resource': [resource: ResourceSummary] }>()
const settingsOpen = ref(false)
const inboxPanel = ref<InstanceType<typeof DiscordInboxPanel> | null>(null)
watch(
  assistantGuidance,
  (guide) => {
    if (
      guide?.destination === 'inbox' &&
      [
        'discord-oneclick-tutorial',
        'discord-github-tutorial',
        'discord-manual-deploy-tutorial',
      ].includes(guide.id)
    ) {
      settingsOpen.value = true
    }
  },
  { immediate: true },
)
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
        data-assistant-focus="inbox-connection-settings"
        @click="settingsOpen = true"
      >
        连接设置
      </button>
      <button
        class="feature-header-action feature-header-action--icon"
        type="button"
        aria-label="清理云端"
        title="清理云端"
        data-assistant-focus="inbox-cloud-cleanup"
        @click="inboxPanel?.openCloudCleanup()"
      >
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M4 7h16M9 7V4h6v3m-9 0 1 13h10l1-13M10 11v5m4-5v5"
            stroke="currentColor"
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="1.7"
          />
        </svg>
      </button>
      <button
        class="feature-header-action feature-header-action--icon"
        type="button"
        aria-label="收件箱设置"
        title="收件箱设置"
        data-assistant-focus="inbox-automation-settings"
        @click="inboxPanel?.openAutomationSettings()"
      >
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M4 7h9m4 0h3M4 17h3m4 0h9M13 5v4M7 15v4"
            stroke="currentColor"
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="1.7"
          />
          <circle cx="15" cy="7" r="2" stroke="currentColor" stroke-width="1.7" />
          <circle cx="9" cy="17" r="2" stroke="currentColor" stroke-width="1.7" />
        </svg>
      </button>
    </template>
    <div class="discord-inbox-center__content">
      <DiscordNativeInboxMode />
      <DiscordInboxPanel ref="inboxPanel" @open-resource="$emit('open-resource', $event)" />
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
