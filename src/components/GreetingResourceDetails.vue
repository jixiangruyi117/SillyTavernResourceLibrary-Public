<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue'
import GreetingPreviewDialog from './GreetingPreviewDialog.vue'
import { greetingResourceService, resourceService } from '../core/AppContainer'
import { parseGreetingResource, type GreetingResourceDocument } from '../types/GreetingResource'
import { RESOURCE_TYPE, type Resource, type ResourceSummary } from '../types/Resource'
import {
  inspectGreetingScripts,
  type GreetingScriptItem,
  type GreetingScriptChoice,
} from '../utils/GreetingScriptMerge'
import { isRecord } from '../utils/UnknownValue'

const props = defineProps<{ resource: Resource }>()
const greeting = shallowRef<GreetingResourceDocument>()
const cards = shallowRef<ResourceSummary[]>([])
const selected = ref('')
const query = ref('')
const mode = ref<'version' | 'new'>('new')
const error = ref('')
const message = ref('')
const busy = ref(false)
const choosing = ref(false)
const scriptItems = ref<GreetingScriptItem[]>([])
const scriptLoading = ref(false)
const scriptReady = ref(false)
const missingScripts = ref(0)
const scriptMode = ref<GreetingScriptChoice['mode']>()
const removeKeys = ref<string[]>([])
const previewIndex = ref<number | null>(null)
let generation = 0
watch(
  () => props.resource,
  async (resource) => {
    const current = ++generation
    greeting.value = undefined
    choosing.value = false
    error.value = ''
    message.value = ''
    selected.value = ''
    previewIndex.value = null
    try {
      const parsed = parseGreetingResource(JSON.parse(await resource.originalBlob.text()))
      if (current === generation) greeting.value = parsed
    } catch (reason) {
      if (current === generation)
        error.value = reason instanceof Error ? reason.message : '无法读取开场白'
    }
  },
  { immediate: true },
)
const items = computed(() =>
  greeting.value
    ? [greeting.value.first_mes, ...greeting.value.alternate_greetings].map((content, index) => ({
        key: String(index),
        label: index ? `备用 ${index}` : '主开场白',
        content,
      }))
    : [],
)
const filtered = computed(() =>
  cards.value.filter((card) =>
    card.name.toLocaleLowerCase().includes(query.value.trim().toLocaleLowerCase()),
  ),
)
const target = computed(() => cards.value.find((card) => card.id === selected.value))
const needsScriptChoice = computed(() => missingScripts.value > 0 && scriptItems.value.length > 0)
const canApply = computed(
  () =>
    target.value &&
    scriptReady.value &&
    !scriptLoading.value &&
    (!needsScriptChoice.value ||
      (scriptMode.value && (scriptMode.value !== 'replace-selected' || removeKeys.value.length))),
)
watch(selected, async (id) => {
  const current = generation
  scriptItems.value = []
  scriptMode.value = undefined
  removeKeys.value = []
  scriptReady.value = false
  scriptLoading.value = false
  missingScripts.value = 0
  if (!id) return
  const incoming = greeting.value?.companion_scripts ?? []
  if (!incoming.length) {
    scriptReady.value = true
    return
  }
  scriptLoading.value = true
  try {
    const card = await resourceService.get(id)
    if (id !== selected.value || current !== generation) return
    if (!card || card.contentHash !== target.value?.contentHash || !isRecord(card.metadata.card))
      throw new Error('角色卡已变化，请重新打开选择列表')
    scriptItems.value = inspectGreetingScripts(card.metadata.card, incoming)
    missingScripts.value = incoming.filter(
      (script) =>
        !inspectGreetingScripts(card.metadata.card as Record<string, unknown>, [script]).some(
          (item) => item.identical,
        ),
    ).length
    scriptReady.value = true
  } catch (reason) {
    if (id === selected.value && current === generation)
      error.value = reason instanceof Error ? reason.message : '无法读取原脚本'
  } finally {
    if (id === selected.value && current === generation) scriptLoading.value = false
  }
})
watch(query, () => {
  if (!filtered.value.some((card) => card.id === selected.value)) selected.value = ''
})
async function chooseCard() {
  const current = generation
  error.value = ''
  try {
    const available = (await resourceService.listSummaries()).filter(
      (card) => card.type === RESOURCE_TYPE.CHARACTER_CARD,
    )
    if (current !== generation) return
    cards.value = available
    choosing.value = true
  } catch (reason) {
    if (current !== generation) return
    error.value = reason instanceof Error ? reason.message : '无法读取角色卡'
  }
}
async function apply() {
  if (!target.value || busy.value || !canApply.value) return
  const current = generation
  const saveMode = mode.value
  busy.value = true
  error.value = ''
  message.value = ''
  try {
    const result = await greetingResourceService.apply(
      props.resource.id,
      target.value.id,
      saveMode,
      target.value.contentHash,
      needsScriptChoice.value
        ? { mode: scriptMode.value!, removeKeys: [...removeKeys.value] }
        : undefined,
    )
    if (current !== generation) return
    message.value =
      saveMode === 'version'
        ? `已保存“${result.name}”的新版本，原版可在历史版本中恢复。`
        : `已另存“${result.name}”，原角色卡保留。`
    choosing.value = false
    selected.value = ''
  } catch (reason) {
    if (current !== generation) return
    error.value = reason instanceof Error ? reason.message : '应用失败'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <section class="greeting-resource" aria-label="开场白资源">
    <p v-if="error" role="alert">{{ error }}</p>
    <template v-if="greeting">
      <div class="greeting-resource__actions">
        <button class="button button--secondary" type="button" @click="previewIndex = 0">
          预览开场白
        </button>
        <button class="button button--secondary" type="button" :disabled="busy" @click="chooseCard">
          应用到角色卡
        </button>
      </div>
      <p>
        {{ items.length }} 个开场白<span v-if="greeting.companion_scripts.length">
          · {{ greeting.companion_scripts.length }} 个配套脚本（导入后需在酒馆助手中启用）</span
        >
      </p>
      <details v-for="item in items" :key="item.key">
        <summary>{{ item.label }}</summary>
        <pre>{{ item.content }}</pre>
      </details>
      <div v-if="choosing" class="greeting-resource__apply" role="group" aria-label="应用到角色卡">
        <label
          >搜索角色卡<input
            v-model="query"
            type="search"
            :disabled="busy"
            placeholder="输入角色卡名称"
        /></label>
        <label
          >目标角色卡<select v-model="selected" required :disabled="busy">
            <option value="" disabled>请选择角色卡</option>
            <option v-for="card in filtered" :key="card.id" :value="card.id">
              {{ card.name }}
            </option>
          </select></label
        >
        <p v-if="!cards.length">资源库里还没有角色卡，请先导入。</p>
        <p>
          替换主开场白和全部备用开场白；角色设定和世界书保留。页面里写死的姓名、图片请先在前端了么调整。
        </p>
        <p v-if="scriptLoading">正在比对配套脚本…</p>
        <template v-if="selected && scriptReady && greeting.companion_scripts.length">
          <p>
            {{ greeting.companion_scripts.length - missingScripts }} 个相同脚本自动跳过，{{
              missingScripts
            }}
            个待加入。相同脚本保留原配置和启用状态。
          </p>
          <fieldset v-if="needsScriptChoice" :disabled="busy">
            <legend>配套脚本处理</legend>
            <label
              ><input v-model="scriptMode" type="radio" value="add" />仅增加：保留全部旧脚本</label
            >
            <label
              ><input
                v-model="scriptMode"
                type="radio"
                value="replace-selected"
              />替换部分：选择要移除的旧脚本</label
            >
            <label
              ><input
                v-model="scriptMode"
                type="radio"
                value="replace-all"
              />替换全部：移除其他旧脚本</label
            >
          </fieldset>
          <p v-if="scriptMode === 'replace-all'" role="alert">
            原卡其他功能的脚本也会被移除；相同脚本保留。请核对下方列表。
          </p>
          <details v-for="script in scriptItems" :key="script.key">
            <summary>{{ script.name }}{{ script.identical ? ' · 相同，保留' : '' }}</summary>
            <label v-if="scriptMode === 'replace-selected' && !script.identical"
              ><input
                v-model="removeKeys"
                type="checkbox"
                :value="script.key"
                :disabled="busy"
              />替换此旧脚本</label
            >
            <pre>{{ script.content }}</pre>
          </details>
          <details v-for="(script, index) in greeting.companion_scripts" :key="`incoming-${index}`">
            <summary>配套脚本：{{ script.name }}</summary>
            <pre>{{ script.content }}</pre>
          </details>
        </template>
        <fieldset :disabled="busy">
          <legend>保存方式</legend>
          <label><input v-model="mode" type="radio" value="new" />另存新卡</label
          ><label><input v-model="mode" type="radio" value="version" />作为当前卡的新版本</label>
        </fieldset>
        <div class="greeting-resource__actions">
          <button
            class="button button--primary"
            type="button"
            :disabled="!canApply || busy"
            @click="apply"
          >
            {{ busy ? '保存中…' : '确认应用' }}</button
          ><button
            class="button button--secondary"
            type="button"
            :disabled="busy"
            @click="choosing = false"
          >
            取消
          </button>
        </div>
      </div>
      <p v-if="message" role="status">{{ message }}</p>
      <GreetingPreviewDialog v-model="previewIndex" :items="items" :context-title="greeting.name" />
    </template>
  </section>
</template>

<style scoped>
.greeting-resource {
  min-width: 0;
  font-size: 14px;
}
.greeting-resource__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.greeting-resource .button {
  min-height: 32px;
  padding: 4px 10px;
  font-size: 13px;
}
summary {
  cursor: pointer;
  padding: 8px 0;
}
pre {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  max-height: 280px;
  overflow: auto;
}
.greeting-resource__apply {
  display: grid;
  gap: 10px;
  margin-top: 12px;
  border-top: 1px solid var(--color-line);
  padding-top: 12px;
}
.greeting-resource__apply > label {
  display: grid;
  gap: 4px;
}
input[type='search'],
select {
  width: 100%;
  min-width: 0;
  font-size: 16px;
}
fieldset {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  border: 0;
  padding: 0;
}
fieldset label {
  display: flex;
  align-items: center;
  gap: 4px;
}
p {
  overflow-wrap: anywhere;
}
</style>
