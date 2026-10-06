<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { ExternalAppTrialSession } from '../services/ExternalAppTrialSession'
import type { AssistantAppSummary } from '../services/ProductAssistantAppSession'
import type { ExternalAppPreview } from '../types/ExternalApp'
import ProductAssistantAppAcceptance from './ProductAssistantAppAcceptance.vue'
import type { AssistantAppTask } from '../services/ExternalAppAcceptance'

const props = defineProps<{
  summary: AssistantAppSummary
  preview?: ExternalAppPreview
  busy: boolean
}>()
const emit = defineEmits<{ action: [operation: 'preview' | 'install' | 'export' | 'test'] }>()
const acceptance = ref<InstanceType<typeof ProductAssistantAppAcceptance>>()
const testing = ref(false)
function taskState(task: AssistantAppTask) {
  if (!task.implemented) return '待制作'
  if (task.result?.revision !== props.summary.revision) return '待验收'
  if (task.result.state === 'passed') return '已通过'
  if (task.result.state === 'failed') return `未通过 · 第 ${task.result.failedAt} 步`
  return '未验证'
}
const frame = ref<HTMLIFrameElement>()
const expanded = ref(true)
const state = ref('loading')
const errors = ref<string[]>([])
const notice = ref('')
const html = computed(() => props.preview?.runtimeHtml ?? '')
const trial = new ExternalAppTrialSession({
  permissions: () => props.preview?.requestedPermissions ?? [],
  active: () => Boolean(props.preview && expanded.value),
  running: () => {
    state.value = 'running'
  },
  diagnostic: (level, message) => {
    if (level === 'error') {
      errors.value = [...errors.value.slice(-9), message]
      state.value = 'error'
    }
  },
  notify: (message) => {
    notice.value = message
  },
  loading: (label) => {
    notice.value = label
  },
})
watch([() => props.summary.revision, () => html.value, expanded], () => {
  trial.disconnect()
  errors.value = []
  notice.value = ''
  state.value = 'loading'
})
function connect() {
  if (frame.value?.contentWindow) trial.connect(frame.value.contentWindow)
}
onBeforeUnmount(() => trial.disconnect())
defineExpose({
  test: async (tasks: AssistantAppTask[], revision: number, signal: AbortSignal) => {
    if (!acceptance.value) throw new Error('验收预览尚未挂载')
    return acceptance.value.run(tasks, revision, signal)
  },
  open: () => {
    expanded.value = true
  },
  diagnostics: () => ({
    state: expanded.value && props.preview ? state.value : 'not-previewed',
    messages: [...errors.value],
    revision: props.preview ? props.summary.revision : undefined,
  }),
})
</script>
<template>
  <section class="chat-app-preview" :aria-label="`${summary.name} APP 草稿`">
    <header>
      <span class="chat-app-preview__icon" aria-hidden="true"
        ><img v-if="preview?.iconDataUrl" :src="preview.iconDataUrl" alt="" /><svg
          v-else
          viewBox="0 0 24 24"
        >
          <rect x="4" y="4" width="16" height="16" rx="5" />
          <path d="M8 9h8M8 13h5M8 16h3" /></svg
      ></span>
      <span class="chat-app-preview__title"
        ><strong>{{ summary.name }}</strong
        ><small>{{
          summary.installedRevision === summary.revision ? '已安装' : '草稿'
        }}</small></span
      >
      <button
        v-if="!preview"
        class="chat-app-preview__start"
        type="button"
        :disabled="busy"
        aria-label="预览 APP"
        @click="emit('action', 'preview')"
      >
        <span>预览</span>
      </button>
      <button
        v-if="preview"
        type="button"
        :aria-expanded="expanded"
        :aria-label="expanded ? '收起 APP 预览' : '展开 APP 预览'"
        @click="expanded = !expanded"
      >
        <span>{{ expanded ? '收起' : '展开' }}</span>
      </button>
    </header>
    <iframe
      v-if="preview && expanded"
      v-show="!testing"
      ref="frame"
      :key="summary.revision"
      :srcdoc="html"
      sandbox="allow-scripts"
      referrerpolicy="no-referrer"
      :title="`${summary.name} 隔离试运行`"
      @load="connect"
      @error="state = 'error'"
    />
    <ProductAssistantAppAcceptance
      v-if="preview"
      ref="acceptance"
      :preview="preview"
      :revision="summary.revision"
      @running="testing = $event"
    />
    <p v-if="state === 'error'" class="chat-app-preview__error" role="status">
      预览有运行错误，可以让 AI 检查并修改。
    </p>
    <p v-else-if="notice" class="chat-app-preview__notice" role="status">{{ notice }}</p>
    <details v-if="summary.tasks?.length" class="chat-app-progress">
      <summary>
        制作进度
        <small
          >{{ summary.tasks.filter((task) => task.implemented).length }}/{{
            summary.tasks.length
          }}</small
        >
      </summary>
      <ul>
        <li v-for="task in summary.tasks" :key="task.id">
          <span>{{ task.title }}</span
          ><small>{{ taskState(task) }}</small>
        </li>
      </ul>
      <p>隔离预览验收；安装后的实际能力未验证。</p>
    </details>
    <footer>
      <span
        ><button
          v-if="summary.tasks?.length"
          type="button"
          :disabled="busy"
          @click="emit('action', 'test')"
        >
          <span>验收</span></button
        ><button type="button" :disabled="busy" @click="emit('action', 'export')">
          <span>导出</span></button
        ><button
          class="chat-app-preview__install"
          type="button"
          :disabled="busy || summary.installedRevision === summary.revision"
          :aria-label="
            summary.installedRevision === summary.revision
              ? '已安装'
              : preview?.previousInstallation
                ? '更新安装'
                : '安装到扩展'
          "
          @click="emit('action', 'install')"
        >
          <span>{{
            summary.installedRevision === summary.revision
              ? '已安装'
              : preview?.previousInstallation
                ? '更新安装'
                : '安装'
          }}</span>
        </button></span
      >
    </footer>
  </section>
</template>
