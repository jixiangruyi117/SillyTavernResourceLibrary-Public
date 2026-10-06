<script setup lang="ts">
import { ref } from 'vue'
import type {
  AssistantMemory,
  ProductAssistantWorkspaceService,
} from '../services/ProductAssistantWorkspaceService'
const props = defineProps<{ workspace: ProductAssistantWorkspaceService }>()
const emit = defineEmits<{ saved: [] }>()
const rows = ref(props.workspace.memories())
const busy = ref(false)
const error = ref('')
const status = ref('')
function add() {
  rows.value.push({ id: crypto.randomUUID(), scope: 'all', text: '' })
  status.value = ''
}
async function save(value: AssistantMemory[] = rows.value) {
  busy.value = true
  error.value = ''
  status.value = ''
  try {
    rows.value = await props.workspace.saveMemories(value)
    status.value = '已保存'
    emit('saved')
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '偏好保存失败'
  } finally {
    busy.value = false
  }
}
async function remove(id: string) {
  await save(rows.value.filter((item) => item.id !== id))
}
</script>
<template>
  <form class="chat-memory" @submit.prevent="save()">
    <section v-for="(row, index) in rows" :key="row.id" class="chat-memory-row">
      <div class="chat-memory-tools">
        <span class="chat-memory-scope">
          <select v-model="row.scope" :aria-label="`偏好 ${index + 1} 适用范围`" :disabled="busy">
            <option value="all">通用</option>
            <option value="appearance">外观</option>
            <option value="features">功能</option>
            <option value="creation">制作</option>
          </select>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 10 4 4 4-4" /></svg>
        </span>
        <button
          type="button"
          class="chat-history-action"
          :aria-label="`删除偏好 ${index + 1}`"
          :disabled="busy"
          @click="remove(row.id)"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />
          </svg>
        </button>
      </div>
      <div class="chat-memory-editor">
        <div class="chat-memory-measure" aria-hidden="true">{{ row.text + '\n' }}</div>
        <textarea
          v-model="row.text"
          :aria-label="`偏好 ${index + 1}`"
          maxlength="500"
          rows="1"
          placeholder="写下你希望她记住的偏好…"
          :disabled="busy"
        />
      </div>
    </section>
    <p v-if="!rows.length" class="chat-empty">暂无偏好</p>
    <div class="chat-memory-actions">
      <button type="button" :disabled="busy || rows.length >= 20" @click="add">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
        添加偏好
      </button>
      <button type="submit" :disabled="busy">保存偏好</button>
    </div>
    <p v-if="status" class="chat-memory-status" role="status">{{ status }}</p>
    <p v-if="error" class="chat-error" role="alert">{{ error }}</p>
  </form>
</template>
