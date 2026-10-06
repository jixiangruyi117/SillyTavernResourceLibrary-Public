<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type {
  AssistantTaskTemplate,
  ProductAssistantWorkspaceService,
} from '../services/ProductAssistantWorkspaceService'
import { chooseAction, confirmAction } from '../composables/UseConfirmDialog'
const props = defineProps<{ workspace: ProductAssistantWorkspaceService }>()
const emit = defineEmits<{ use: [value: AssistantTaskTemplate] }>()
const rows = ref<AssistantTaskTemplate[]>([])
const editing = ref(false)
const id = ref('')
const name = ref('')
const steps = ref('')
const baseline = ref('')
const current = computed(() => JSON.stringify([name.value, steps.value]))
const changed = computed(() => editing.value && current.value !== baseline.value)
const busy = ref(false)
const leaving = ref(false)
const error = ref('')
async function load() {
  rows.value = await props.workspace.templates()
}
onMounted(() => void load().catch(() => (error.value = '任务模板读取失败')))
async function save(): Promise<boolean> {
  if (busy.value) return false
  busy.value = true
  error.value = ''
  const snapshot = current.value
  try {
    await props.workspace.saveTemplate({
      id: id.value,
      name: name.value,
      steps: steps.value
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean),
    })
    baseline.value = snapshot
    await load()
    if (current.value === snapshot) editing.value = false
    return !changed.value
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '模板保存失败'
    return false
  } finally {
    busy.value = false
  }
}
async function requestLeave(): Promise<boolean> {
  if (busy.value || leaving.value) return false
  if (!changed.value) return true
  leaving.value = true
  try {
    const choice = await chooseAction({
      title: '有修改未保存',
      message: '任务模板有修改未保存，是否保存后退出？',
      confirmLabel: '保存并退出',
      alternativeLabel: '不保存退出',
      cancelLabel: '继续编辑',
    })
    if (choice === 'alternative') {
      editing.value = false
      return true
    }
    return choice === 'confirm' && (await save())
  } finally {
    leaving.value = false
  }
}
defineExpose({ requestLeave, newTemplate: () => edit() })
async function edit(value?: AssistantTaskTemplate) {
  if (!(await requestLeave())) return
  id.value = value?.id ?? crypto.randomUUID()
  name.value = value?.name ?? ''
  steps.value = value?.steps.join('\n') ?? ''
  baseline.value = current.value
  editing.value = true
  error.value = ''
}
async function cancel() {
  if (await requestLeave()) editing.value = false
}
async function remove(value: AssistantTaskTemplate) {
  if (
    !(await confirmAction({
      title: '删除任务模板',
      message: `删除“${value.name}”？已填入聊天的内容保留。`,
      confirmLabel: '删除模板',
    }))
  )
    return
  busy.value = true
  try {
    await props.workspace.removeTemplate(value.id)
    await load()
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '删除失败'
  } finally {
    busy.value = false
  }
}
</script>
<template>
  <section aria-label="常用任务模板" class="chat-workflow">
    <form v-if="editing" class="chat-template-editor" @submit.prevent="save">
      <label
        >名称<input v-model="name" aria-label="模板名称" maxlength="60" :disabled="busy"
      /></label>
      <label
        >操作步骤<textarea
          v-model="steps"
          aria-label="模板操作步骤"
          placeholder="每行一个步骤"
          maxlength="8000"
          rows="6"
          :disabled="busy"
        />
      </label>
      <div class="chat-workflow-actions">
        <button class="chat-workflow-primary" type="submit" :disabled="busy">
          <span>保存模板</span></button
        ><button type="button" :disabled="busy" @click="cancel"><span>取消</span></button
        ><small v-if="changed">有修改，待保存</small>
      </div>
    </form>
    <template v-else>
      <p v-if="!rows.length" class="chat-empty">暂无任务模板</p>
      <div class="chat-workflow-list">
        <div v-for="row in rows" :key="row.id" class="chat-template-row">
          <div class="chat-workflow-row">
            <span class="chat-workflow-icon" aria-hidden="true"
              ><svg viewBox="0 0 24 24">
                <path
                  d="M9 5h11M9 12h11M9 19h11M3 5l1 1 2-2m-3 8 1 1 2-2m-3 8 1 1 2-2"
                /></svg></span
            ><strong>{{ row.name }}</strong
            ><button
              type="button"
              :disabled="busy"
              :aria-label="`使用模板 ${row.name}`"
              @click="emit('use', row)"
            >
              <span
                >使用<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg
              ></span>
            </button>
          </div>
          <div class="chat-template-tools">
            <details class="chat-template-detail">
              <summary>
                {{ row.steps.length }} 个步骤<svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="m6 9 6 6 6-6" />
                </svg>
              </summary>
              <ol>
                <li v-for="(step, index) in row.steps" :key="index">{{ step }}</li>
              </ol>
            </details>
            <div class="chat-workflow-actions">
              <button
                class="chat-workflow-icon-button"
                type="button"
                :disabled="busy"
                :aria-label="`编辑模板 ${row.name}`"
                @click="edit(row)"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="m15 4 5 5M4 20l4-1L20 7l-3-3L5 16l-1 4z" />
                </svg></button
              ><button
                class="chat-workflow-icon-button"
                type="button"
                :disabled="busy"
                :aria-label="`删除模板 ${row.name}`"
                @click="remove(row)"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v5m4-5v5" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </div>
    </template>
    <p v-if="error" role="alert" class="chat-error">{{ error }}</p>
  </section>
</template>
