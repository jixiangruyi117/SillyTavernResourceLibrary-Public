<script setup lang="ts">
import { computed, ref } from 'vue'

import {
  BACKUP_SCOPE_GROUPS,
  BACKUP_SCOPE_REGISTRY,
  type BackupScopeGroupId,
  type BackupScopeId,
} from '../services/BackupScopeRegistry'
import { getResourceCategoryIds, type Category, type ResourceSummary } from '../types/Resource'

const props = withDefaults(
  defineProps<{
    resources: readonly ResourceSummary[]
    categories?: Category[]
    modelValue: { resourceIds: string[]; scopeIds: BackupScopeId[] }
    mode: 'local' | 'cloud' | 'restore'
    disabledScopeIds?: BackupScopeId[]
    disabledScopeReasons?: Partial<Record<BackupScopeId, string>>
  }>(),
  { categories: () => [], disabledScopeIds: () => [], disabledScopeReasons: () => ({}) },
)
const emit = defineEmits<{
  'update:modelValue': [value: { resourceIds: string[]; scopeIds: BackupScopeId[] }]
}>()

const expanded = ref(
  new Set<BackupScopeId | BackupScopeGroupId>(['tavernResources', 'manualResources']),
)
const activeCategoryId = ref<string | null | 'all'>('all')
const disabled = computed(() => new Set(props.disabledScopeIds))
const scopeById = (id: BackupScopeId) => BACKUP_SCOPE_REGISTRY.find((scope) => scope.id === id)
const scopesForGroup = (group: BackupScopeGroupId) =>
  BACKUP_SCOPE_REGISTRY.filter((scope) => scope.group === group)
const resourcesForScope = (id: BackupScopeId) => {
  const type = scopeById(id)?.resourceType
  return type ? props.resources.filter((resource) => resource.type === type) : []
}
const visibleResourcesForScope = (id: BackupScopeId) => {
  const resources = resourcesForScope(id)
  if (activeCategoryId.value === 'all' || scopeById(id)?.group !== 'tavernResources')
    return resources
  return resources.filter((resource) => {
    const categoryIds = getResourceCategoryIds(resource)
    return activeCategoryId.value === null
      ? categoryIds.length === 0
      : categoryIds.includes(activeCategoryId.value)
  })
}
const categoryCount = (categoryId: string | null) =>
  props.resources.filter((resource) => {
    const categoryIds = getResourceCategoryIds(resource)
    return categoryId === null ? categoryIds.length === 0 : categoryIds.includes(categoryId)
  }).length
const selectedIds = computed(() => new Set(props.modelValue.resourceIds))
const selectedScopes = computed(() => new Set(props.modelValue.scopeIds))

function emitSelection(resourceIds: Set<string>, scopeIds: Set<BackupScopeId>): void {
  emit('update:modelValue', { resourceIds: [...resourceIds], scopeIds: [...scopeIds] })
}

function toggleExpanded(id: BackupScopeId | BackupScopeGroupId): void {
  const next = new Set(expanded.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  expanded.value = next
}

function toggleScope(id: BackupScopeId): void {
  if (disabled.value.has(id)) return
  const nextIds = new Set(selectedIds.value)
  const nextScopes = new Set(selectedScopes.value)
  const resources = resourcesForScope(id)
  const selected =
    selectedScopes.value.has(id) && resources.every((resource) => nextIds.has(resource.id))
  if (selected) {
    nextScopes.delete(id)
    resources.forEach((resource) => nextIds.delete(resource.id))
  } else {
    nextScopes.add(id)
    resources.forEach((resource) => nextIds.add(resource.id))
  }
  emitSelection(nextIds, nextScopes)
}

function toggleResource(id: string, scopeId: BackupScopeId): void {
  if (disabled.value.has(scopeId)) return
  const nextIds = new Set(selectedIds.value)
  const nextScopes = new Set(selectedScopes.value)
  if (nextIds.has(id)) nextIds.delete(id)
  else nextIds.add(id)
  const resources = resourcesForScope(scopeId)
  if (resources.length && resources.every((resource) => nextIds.has(resource.id)))
    nextScopes.add(scopeId)
  else nextScopes.delete(scopeId)
  emitSelection(nextIds, nextScopes)
}

function toggleGroup(group: BackupScopeGroupId): void {
  const scopes = scopesForGroup(group).filter((scope) => !disabled.value.has(scope.id))
  const allSelected = scopes.every((scope) => {
    const resources = resourcesForScope(scope.id)
    return (
      selectedScopes.value.has(scope.id) &&
      resources.every((resource) => selectedIds.value.has(resource.id))
    )
  })
  const nextIds = new Set(selectedIds.value)
  const nextScopes = new Set(selectedScopes.value)
  for (const scope of scopes) {
    const resources = resourcesForScope(scope.id)
    if (allSelected) {
      nextScopes.delete(scope.id)
      resources.forEach((resource) => nextIds.delete(resource.id))
    } else {
      nextScopes.add(scope.id)
      resources.forEach((resource) => nextIds.add(resource.id))
    }
  }
  emitSelection(nextIds, nextScopes)
}

function groupState(group: BackupScopeGroupId): 'all' | 'some' | 'none' {
  const scopes = scopesForGroup(group).filter((scope) => !disabled.value.has(scope.id))
  const selectedCount = scopes.filter((scope) => {
    const resources = resourcesForScope(scope.id)
    return (
      selectedScopes.value.has(scope.id) &&
      resources.every((resource) => selectedIds.value.has(resource.id))
    )
  }).length
  return selectedCount === 0 ? 'none' : selectedCount === scopes.length ? 'all' : 'some'
}

function scopeState(id: BackupScopeId): 'all' | 'some' | 'none' {
  const resources = resourcesForScope(id)
  if (!resources.length) return selectedScopes.value.has(id) ? 'all' : 'none'
  const count = resources.filter((resource) => selectedIds.value.has(resource.id)).length
  return count === 0 ? 'none' : count === resources.length ? 'all' : 'some'
}

function scopeBadge(id: BackupScopeId): string {
  const scope = scopeById(id)
  if (!scope) return ''
  if (scope.sensitive) return '需要确认'
  if (scope.privacyWarning) return '含隐私'
  return ''
}

const selectedResourceCount = computed(() => selectedIds.value.size)
const selectedResourceSize = computed(() =>
  props.resources.reduce(
    (total, resource) => (selectedIds.value.has(resource.id) ? total + resource.fileSize : total),
    0,
  ),
)
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
</script>

<template>
  <section class="backup-scope-tree" aria-label="备份范围选择">
    <header class="backup-scope-tree__summary">
      <div><strong>备份范围</strong><small>云备份与本地导入导出使用同一套选择逻辑</small></div>
      <span>{{ selectedResourceCount }} 项资源 · {{ formatBytes(selectedResourceSize) }}</span>
    </header>
    <section v-for="group in BACKUP_SCOPE_GROUPS" :key="group.id" class="backup-scope-tree__group">
      <header :class="{ 'is-complete': groupState(group.id) === 'all' }">
        <button
          type="button"
          class="backup-scope-tree__group-toggle"
          @click="toggleExpanded(group.id)"
        >
          <span :class="`is-${groupState(group.id)}`" aria-hidden="true"></span>
          <strong>{{ group.label }}</strong>
          <small>{{ group.description }}</small>
        </button>
        <button type="button" class="backup-scope-tree__select" @click="toggleGroup(group.id)">
          {{ groupState(group.id) === 'all' ? '取消全选' : '选择全部' }}
        </button>
      </header>
      <div v-if="expanded.has(group.id)" class="backup-scope-tree__children">
        <div
          v-if="group.id === 'tavernResources' && categories.length"
          class="backup-scope-tree__filters"
        >
          <span>按文件夹查看</span>
          <button
            type="button"
            :class="{ 'is-active': activeCategoryId === 'all' }"
            @click="activeCategoryId = 'all'"
          >
            全部 {{ props.resources.length }}
          </button>
          <button
            type="button"
            :class="{ 'is-active': activeCategoryId === null }"
            @click="activeCategoryId = null"
          >
            <i></i>未放入文件夹 {{ categoryCount(null) }}
          </button>
          <button
            v-for="category in categories"
            :key="category.id"
            type="button"
            :class="{ 'is-active': activeCategoryId === category.id }"
            @click="activeCategoryId = category.id"
          >
            <i :style="{ backgroundColor: category.color }"></i>{{ category.name }}
            {{ categoryCount(category.id) }}
          </button>
        </div>
        <article
          v-for="scope in scopesForGroup(group.id)"
          :key="scope.id"
          class="backup-scope-tree__scope"
          :class="{ 'is-disabled': disabled.has(scope.id) }"
        >
          <button
            type="button"
            class="backup-scope-tree__scope-row"
            :class="{ 'is-selected': scopeState(scope.id) === 'all' }"
            :disabled="disabled.has(scope.id)"
            @click="toggleScope(scope.id)"
          >
            <span :class="`is-${scopeState(scope.id)}`" aria-hidden="true"></span>
            <span
              ><strong>{{ scope.label }}</strong
              ><small
                >{{ scope.description
                }}<template v-if="disabled.has(scope.id)">
                  · {{ props.disabledScopeReasons[scope.id] ?? '当前方式暂不支持' }}</template
                ></small
              ></span
            >
          </button>
          <div
            v-if="scopeBadge(scope.id) || visibleResourcesForScope(scope.id).length"
            class="backup-scope-tree__scope-actions"
          >
            <em v-if="scopeBadge(scope.id)" :class="{ 'is-sensitive': scope.sensitive }">{{
              scopeBadge(scope.id)
            }}</em>
            <button
              v-if="visibleResourcesForScope(scope.id).length"
              type="button"
              class="backup-scope-tree__expand"
              :aria-label="expanded.has(scope.id) ? `收起${scope.label}` : `展开${scope.label}`"
              @click="toggleExpanded(scope.id)"
            >
              {{
                expanded.has(scope.id)
                  ? '收起'
                  : `查看 ${visibleResourcesForScope(scope.id).length} 项`
              }}
            </button>
          </div>
          <div
            v-if="expanded.has(scope.id) && visibleResourcesForScope(scope.id).length"
            class="backup-scope-tree__resources"
          >
            <label v-for="resource in visibleResourcesForScope(scope.id)" :key="resource.id">
              <input
                type="checkbox"
                :checked="selectedIds.has(resource.id)"
                :disabled="disabled.has(scope.id)"
                @change="toggleResource(resource.id, scope.id)"
              />
              <span
                ><strong>{{ resource.name }}</strong
                ><small>{{ resource.fileName }} · {{ formatBytes(resource.fileSize) }}</small></span
              >
            </label>
          </div>
        </article>
      </div>
    </section>
    <p v-if="mode === 'restore'" class="backup-scope-tree__hint">
      未选择的资源不会写入当前设备；关联头像和历史版本会随所属资源处理。
    </p>
  </section>
</template>

<style scoped>
.backup-scope-tree {
  display: grid;
  gap: 0.75rem;
}
.backup-scope-tree__summary,
.backup-scope-tree__group > header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.75rem;
}
.backup-scope-tree__summary {
  align-items: center;
  padding: 0.75rem 0.85rem;
  border: 1px solid var(--glass-border);
  border-radius: var(--glass-radius-control);
  background: var(--glass-panel-strong);
  box-shadow: var(--glass-shadow);
}
.backup-scope-tree__summary strong,
.backup-scope-tree__summary small {
  display: block;
}
.backup-scope-tree__summary strong {
  font-size: 0.78rem;
  letter-spacing: 0.01em;
}
.backup-scope-tree__summary small,
.backup-scope-tree__summary > span {
  color: var(--color-ink-soft);
  font-size: 0.65rem;
  line-height: 1.4;
}
.backup-scope-tree__summary > span {
  flex: 0 0 auto;
  padding: 0.28rem 0.45rem;
  border: 1px solid var(--glass-border);
  border-radius: var(--glass-radius-control);
  background: var(--glass-panel-muted);
  font-weight: 700;
}
.backup-scope-tree__group {
  overflow: hidden;
  border: 1px solid var(--glass-border);
  border-radius: var(--glass-radius-panel);
  background: var(--glass-panel);
  box-shadow: var(--glass-shadow);
}
.backup-scope-tree__group > header {
  padding: 0.75rem 0.85rem;
  border-bottom: 1px solid var(--glass-border);
  background: var(--glass-panel-strong);
}
.backup-scope-tree__group > header.is-complete {
  background: color-mix(in srgb, var(--color-accent-soft) 35%, var(--glass-panel-strong));
}
.backup-scope-tree__group-toggle {
  display: grid;
  grid-template-columns: 0.8rem minmax(0, auto);
  align-items: center;
  gap: 0.3rem;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--color-ink);
  text-align: left;
  cursor: pointer;
}
.backup-scope-tree__group-toggle small {
  grid-column: 2;
  color: var(--color-ink-soft);
  font-size: 0.62rem;
}
.backup-scope-tree__group-toggle strong {
  font-size: 0.76rem;
}
.backup-scope-tree__select,
.backup-scope-tree__expand {
  border: 0;
  background: transparent;
  color: var(--color-accent);
  font-size: 0.65rem;
  font-weight: 750;
}
.backup-scope-tree__children {
  display: grid;
}
.backup-scope-tree__scope {
  position: relative;
  border-bottom: 1px solid var(--color-line);
}
.backup-scope-tree__scope:last-child {
  border-bottom: 0;
}
.backup-scope-tree__scope-row {
  display: grid;
  grid-template-columns: 0.8rem minmax(0, 1fr);
  width: 100%;
  align-items: center;
  gap: 0.45rem;
  min-height: 3.15rem;
  padding: 0.6rem 0.85rem;
  border: 0;
  background: transparent;
  color: var(--color-ink);
  text-align: left;
  cursor: pointer;
  transition: background 140ms ease;
}
.backup-scope-tree__scope-row:hover,
.backup-scope-tree__scope-row.is-selected {
  background: color-mix(in srgb, var(--color-accent-soft) 26%, var(--glass-panel-muted));
}
.backup-scope-tree__scope-row > span:nth-child(2) {
  min-width: 0;
}
.backup-scope-tree__scope-row strong,
.backup-scope-tree__scope-row small {
  display: block;
}
.backup-scope-tree__scope-row strong {
  font-size: 0.72rem;
}
.backup-scope-tree__scope-row small {
  margin-top: 0.16rem;
  color: var(--color-ink-soft);
  font-size: 0.62rem;
  line-height: 1.4;
}
.backup-scope-tree__scope-actions {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 0.45rem;
  min-height: 1.25rem;
  padding: 0 0.85rem 0.5rem 2.1rem;
  background: color-mix(in srgb, var(--color-accent-soft) 12%, var(--glass-panel-muted));
}
.backup-scope-tree__scope-actions em {
  padding: 0.15rem 0.3rem;
  border: 1px solid var(--color-line-strong);
  border-radius: 0.2rem;
  color: var(--color-ink-soft);
  font-size: 0.58rem;
  font-style: normal;
}
.backup-scope-tree__scope-actions em.is-sensitive {
  border-color: color-mix(in srgb, var(--color-danger) 45%, var(--color-line));
  color: var(--color-danger);
}
.backup-scope-tree__scope-row:disabled {
  opacity: 0.55;
}
.backup-scope-tree__expand {
  padding: 0;
}
.backup-scope-tree__filters {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.35rem;
  padding: 0.55rem 0.7rem;
  border-bottom: 1px solid var(--glass-border);
  background: color-mix(in srgb, var(--color-accent-soft) 15%, var(--glass-panel-muted));
}
.backup-scope-tree__filters > span {
  margin-right: 0.15rem;
  color: var(--color-ink-soft);
  font-size: 0.62rem;
  font-weight: 700;
}
.backup-scope-tree__filters button {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.25rem 0.4rem;
  border: 1px solid var(--glass-border);
  border-radius: var(--glass-radius-control);
  background: var(--glass-panel-muted);
  color: var(--color-ink-soft);
  font-size: 0.6rem;
}
.backup-scope-tree__filters button.is-active {
  border-color: var(--color-accent);
  background: color-mix(in srgb, var(--color-accent-soft) 44%, var(--glass-panel-muted));
  color: var(--color-ink);
  font-weight: 750;
}
.backup-scope-tree__filters i {
  width: 0.42rem;
  height: 0.42rem;
  border: 1px solid var(--color-line-strong);
  border-radius: 50%;
  background: var(--color-ink-soft);
}
.backup-scope-tree__resources {
  display: grid;
  gap: 0.25rem;
  padding: 0.25rem 0.85rem 0.7rem 2.1rem;
  background: color-mix(in srgb, var(--color-accent-soft) 10%, var(--glass-panel-muted));
}
.backup-scope-tree__resources label {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  gap: 0.45rem;
  padding: 0.45rem 0.5rem;
  border: 1px solid color-mix(in srgb, var(--glass-border) 75%, transparent);
  border-radius: calc(var(--glass-radius-control) * 0.75);
  background: color-mix(in srgb, var(--color-accent-soft) 22%, var(--glass-panel));
}
.backup-scope-tree__resources strong,
.backup-scope-tree__resources small {
  display: block;
}
.backup-scope-tree__resources strong {
  overflow: hidden;
  font-size: 0.66rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.backup-scope-tree__resources small {
  color: var(--color-ink-soft);
  font-size: 0.58rem;
}
.backup-scope-tree__hint {
  margin: 0;
  color: var(--color-ink-soft);
  font-size: 0.65rem;
  line-height: 1.5;
}
.backup-scope-tree__group-toggle > span,
.backup-scope-tree__scope-row > span:first-child {
  width: 0.75rem;
  height: 0.75rem;
  border: 1px solid var(--color-line-strong);
  border-radius: 0.18rem;
  background: var(--color-surface);
}
.backup-scope-tree__group-toggle > span.is-all,
.backup-scope-tree__scope-row > span:first-child.is-all {
  border-color: var(--color-accent);
  background: var(--color-accent);
  box-shadow: inset 0 0 0 0.16rem var(--color-surface);
}
.backup-scope-tree__group-toggle > span.is-some,
.backup-scope-tree__scope-row > span:first-child.is-some {
  border-color: var(--color-accent);
  background: linear-gradient(var(--color-accent), var(--color-accent)) center / 0.42rem 0.14rem
    no-repeat;
}
@media (max-width: 520px) {
  .backup-scope-tree__summary {
    align-items: flex-start;
  }

  .backup-scope-tree__summary > span {
    font-size: 0.6rem;
  }
}
</style>
