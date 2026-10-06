<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type {
  AssistantProjectSummary,
  ProductAssistantWorkspaceService,
} from '../services/ProductAssistantWorkspaceService'
const props = defineProps<{ workspace: ProductAssistantWorkspaceService }>()
const emit = defineEmits<{ continue: [id: string] }>()
const rows = ref<AssistantProjectSummary[]>([])
const page = ref(0)
const total = ref(0)
const error = ref('')
const loading = ref(false)
async function load(next = page.value) {
  loading.value = true
  error.value = ''
  try {
    const result = await props.workspace.projects(next * 20)
    rows.value = result.items
    total.value = result.total
    page.value = next
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '项目读取失败'
  } finally {
    loading.value = false
  }
}
onMounted(() => void load())
</script>
<template>
  <section aria-label="APP 项目" class="chat-workflow">
    <p v-if="!total && !loading" class="chat-empty">暂无 APP 项目</p>
    <div class="chat-workflow-list">
      <div v-for="row in rows" :key="row.id" class="chat-workflow-row chat-project-row">
        <span class="chat-workflow-icon" aria-hidden="true"
          ><svg viewBox="0 0 24 24">
            <rect x="4" y="4" width="16" height="16" rx="4" />
            <path d="M8 9h8m-8 4h5m-5 3h3" /></svg
        ></span>
        <div class="chat-workflow-copy">
          <strong>{{ row.name }}</strong
          ><small
            >{{ new Date(row.updatedAt).toLocaleDateString('zh-CN') }} · 第
            {{ row.version }} 版</small
          >
        </div>
        <button
          type="button"
          :disabled="loading"
          :aria-label="`在新聊天继续 ${row.name}`"
          @click="emit('continue', row.id)"
        >
          <span
            >继续<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg
          ></span>
        </button>
      </div>
    </div>
    <nav v-if="total > 20" class="chat-history-pages" aria-label="项目翻页">
      <button type="button" :disabled="loading || page === 0" @click="load(page - 1)">上一页</button
      ><span>{{ page + 1 }}</span
      ><button
        type="button"
        :disabled="loading || (page + 1) * 20 >= total"
        @click="load(page + 1)"
      >
        下一页
      </button>
    </nav>
    <p v-if="error" role="alert" class="chat-error">{{ error }}</p>
  </section>
</template>
