<script setup lang="ts">
import { computed, ref } from 'vue'
import { RESOURCE_TYPE_LABELS, type ResourceSummary, type ResourceType } from '../types/Resource'
import FeatureStateView from './FeatureStateView.vue'

const props = withDefaults(
  defineProps<{
    resources: readonly ResourceSummary[]
    modelValue: readonly string[]
    title?: string
    multiple?: boolean
    allowedTypes?: readonly ResourceType[]
  }>(),
  { title: '选择资源', multiple: true, allowedTypes: undefined },
)

const emit = defineEmits<{
  'update:modelValue': [ids: string[]]
  confirm: [ids: string[]]
  cancel: []
}>()

const query = ref('')
const typeFilter = ref<ResourceType | 'all'>('all')
const selected = computed(() => new Set(props.modelValue))
const typeOptions = computed(() => {
  const allowed = props.allowedTypes ? new Set(props.allowedTypes) : undefined
  return Array.from(new Set(props.resources.map((resource) => resource.type))).filter(
    (type) => !allowed || allowed.has(type),
  )
})
const filteredResources = computed(() => {
  const normalized = query.value.trim().toLocaleLowerCase()
  const allowed = props.allowedTypes ? new Set(props.allowedTypes) : undefined
  return props.resources.filter((resource) => {
    if (allowed && !allowed.has(resource.type)) return false
    if (typeFilter.value !== 'all' && resource.type !== typeFilter.value) return false
    if (!normalized) return true
    return `${resource.name}\n${resource.fileName}\n${resource.tags.join('\n')}`
      .toLocaleLowerCase()
      .includes(normalized)
  })
})

function toggle(id: string): void {
  if (!props.multiple) {
    emit('update:modelValue', [id])
    return
  }
  const next = new Set(selected.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  emit('update:modelValue', Array.from(next))
}
</script>

<template>
  <section class="resource-picker" :aria-label="title">
    <header>
      <div>
        <h2>{{ title }}</h2>
        <small>已选 {{ modelValue.length }} 项</small>
      </div>
      <div class="resource-picker__toolbar">
        <input v-model="query" type="search" placeholder="搜索名称、文件名或标签" />
        <select v-model="typeFilter" aria-label="资源类型">
          <option value="all">全部类型</option>
          <option v-for="type in typeOptions" :key="type" :value="type">
            {{ RESOURCE_TYPE_LABELS[type] }}
          </option>
        </select>
      </div>
    </header>

    <FeatureStateView
      v-if="!filteredResources.length"
      state="empty"
      title="没有匹配的资源"
      description="调整搜索词或资源类型后再试。"
    />
    <div v-else class="resource-picker__list" role="listbox" :aria-multiselectable="multiple">
      <button
        v-for="resource in filteredResources"
        :key="resource.id"
        type="button"
        role="option"
        :aria-selected="selected.has(resource.id)"
        @click="toggle(resource.id)"
      >
        <span class="resource-picker__check" aria-hidden="true">
          {{ selected.has(resource.id) ? '✓' : '' }}
        </span>
        <span>
          <strong>{{ resource.name }}</strong>
          <small>{{ RESOURCE_TYPE_LABELS[resource.type] }} · {{ resource.fileName }}</small>
        </span>
      </button>
    </div>

    <footer>
      <button type="button" @click="emit('cancel')">取消</button>
      <button
        type="button"
        class="resource-picker__primary"
        @click="emit('confirm', [...modelValue])"
      >
        确认选择
      </button>
    </footer>
  </section>
</template>

<style scoped>
.resource-picker {
  display: grid;
  min-height: 0;
  grid-template-rows: auto minmax(0, 1fr) auto;
  gap: 0.75rem;
}

.resource-picker header,
.resource-picker footer,
.resource-picker__toolbar {
  display: flex;
  gap: 0.6rem;
  align-items: center;
}

.resource-picker header,
.resource-picker footer {
  justify-content: space-between;
}

.resource-picker h2,
.resource-picker small {
  margin: 0;
}

.resource-picker__toolbar input {
  min-width: min(17rem, 50vw);
}

.resource-picker__toolbar input,
.resource-picker__toolbar select,
.resource-picker footer button {
  min-height: 2.75rem;
}

.resource-picker__list {
  display: grid;
  gap: 0.4rem;
  overflow: auto;
}

.resource-picker__list > button {
  display: grid;
  grid-template-columns: 1.5rem 1fr;
  gap: 0.7rem;
  align-items: center;
  min-height: 3.25rem;
  padding: 0.6rem 0.75rem;
  border: 1px solid var(--color-line);
  border-radius: 0.75rem;
  background: transparent;
  color: inherit;
  text-align: left;
}

.resource-picker__list > button[aria-selected='true'] {
  border-color: var(--color-accent);
  background: color-mix(in srgb, var(--color-accent) 10%, transparent);
}

.resource-picker__list span:last-child {
  display: grid;
}

.resource-picker__check {
  display: grid;
  width: 1.35rem;
  height: 1.35rem;
  place-items: center;
  border: 1px solid var(--color-line-strong);
  border-radius: 0.35rem;
}

.resource-picker footer {
  justify-content: flex-end;
}

.resource-picker__primary {
  background: var(--color-accent) !important;
  color: white;
}

@media (max-width: 640px) {
  .resource-picker header {
    align-items: stretch;
    flex-direction: column;
  }

  .resource-picker__toolbar > * {
    min-width: 0;
    flex: 1;
  }
}
</style>
