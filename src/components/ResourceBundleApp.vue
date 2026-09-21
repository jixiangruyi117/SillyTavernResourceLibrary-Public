<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import { confirmAction } from '../composables/UseConfirmDialog'
import { browserStorageService } from '../core/AppContainer'
import type { ChatLoadout } from '../services/BrowserStorageService'
import {
  getRelatedResourceIds,
  RESOURCE_TYPE,
  RESOURCE_TYPE_LABELS,
  type Category,
  type ResourceSummary,
  type ResourceType,
} from '../types/Resource'
import FeatureAppHeader from './FeatureAppHeader.vue'

const props = defineProps<{
  resources: ResourceSummary[]
  categories: Category[]
}>()
const emit = defineEmits<{
  back: []
  libraryChanged: []
  sendToTavern: [resourceIds: string[]]
}>()

const templates = ref(browserStorageService.getChatLoadouts())
const editingTemplateId = ref('')
const bundleName = ref('')
const primaryResourceId = ref('')
const selectedResourceIds = ref(new Set<string>())
const query = ref('')
const typeFilter = ref<'all' | ResourceType>('all')
const categoryFilter = ref('')
const hideBoundElsewhere = ref(false)
const saving = ref(false)
const notice = ref('')

const resourceById = computed(
  () => new Map(props.resources.map((resource) => [resource.id, resource])),
)
const primaryResource = computed(() => resourceById.value.get(primaryResourceId.value))
const selectedResources = computed(() =>
  Array.from(selectedResourceIds.value).flatMap((id) => {
    const resource = resourceById.value.get(id)
    return resource ? [resource] : []
  }),
)
const bundleResourceIds = computed(() =>
  primaryResourceId.value
    ? [primaryResourceId.value, ...selectedResources.value.map((resource) => resource.id)]
    : [],
)
const primaryOptions = computed(() =>
  [...props.resources].sort((left, right) => {
    const preferred: ResourceType[] = [
      RESOURCE_TYPE.CHARACTER_CARD,
      RESOURCE_TYPE.PRESET,
      RESOURCE_TYPE.USER_PERSONA,
    ]
    const leftRank = preferred.indexOf(left.type)
    const rightRank = preferred.indexOf(right.type)
    const normalizedLeftRank = leftRank < 0 ? preferred.length : leftRank
    const normalizedRightRank = rightRank < 0 ? preferred.length : rightRank
    return normalizedLeftRank - normalizedRightRank || left.name.localeCompare(right.name, 'zh-CN')
  }),
)
const candidateResources = computed(() => {
  const keyword = query.value.trim().toLocaleLowerCase()
  return props.resources
    .filter((resource) => resource.id !== primaryResourceId.value)
    .filter(
      (resource) =>
        !hideBoundElsewhere.value ||
        selectedResourceIds.value.has(resource.id) ||
        getRelatedResourceIds(resource).length === 0,
    )
    .filter((resource) => typeFilter.value === 'all' || resource.type === typeFilter.value)
    .filter(
      (resource) =>
        !categoryFilter.value ||
        resource.categoryId === categoryFilter.value ||
        resource.categoryIds?.includes(categoryFilter.value),
    )
    .filter(
      (resource) =>
        !keyword ||
        `${resource.name}\n${resource.fileName}\n${RESOURCE_TYPE_LABELS[resource.type]}\n${resource.tags.join(' ')}`
          .toLocaleLowerCase()
          .includes(keyword),
    )
    .sort((left, right) => {
      const leftSelected = selectedResourceIds.value.has(left.id) ? 1 : 0
      const rightSelected = selectedResourceIds.value.has(right.id) ? 1 : 0
      return rightSelected - leftSelected || left.name.localeCompare(right.name, 'zh-CN')
    })
})
const executableCount = computed(
  () =>
    bundleResourceIds.value.filter((id) => {
      const type = resourceById.value.get(id)?.type
      return type === RESOURCE_TYPE.SCRIPT || type === RESOURCE_TYPE.PLUGIN
    }).length,
)
const movingSourceCount = computed(
  () =>
    bundleResourceIds.value.filter((id) =>
      resourceById.value.get(id)?.sourceLinks?.some((link) => link.versionRef?.kind === 'branch'),
    ).length,
)
const existingTemplate = computed(() =>
  templates.value.find((template) => template.id === editingTemplateId.value),
)

watch(primaryResourceId, (id) => {
  if (!id || !selectedResourceIds.value.has(id)) return
  const next = new Set(selectedResourceIds.value)
  next.delete(id)
  selectedResourceIds.value = next
})

function toggleResource(resourceId: string): void {
  const next = new Set(selectedResourceIds.value)
  if (next.has(resourceId)) next.delete(resourceId)
  else next.add(resourceId)
  selectedResourceIds.value = next
}

function removeSelected(resourceId: string): void {
  if (!selectedResourceIds.value.has(resourceId)) return
  const next = new Set(selectedResourceIds.value)
  next.delete(resourceId)
  selectedResourceIds.value = next
}

function resetDraft(): void {
  editingTemplateId.value = ''
  bundleName.value = ''
  primaryResourceId.value = ''
  selectedResourceIds.value = new Set()
  query.value = ''
  notice.value = ''
}

function openTemplate(template: ChatLoadout): void {
  editingTemplateId.value = template.id
  bundleName.value = template.name
  primaryResourceId.value = resourceById.value.has(template.primaryResourceId)
    ? template.primaryResourceId
    : ''
  selectedResourceIds.value = new Set(
    template.resourceIds.filter((resourceId) => resourceById.value.has(resourceId)),
  )
  const missingCount =
    Number(!resourceById.value.has(template.primaryResourceId)) +
    template.resourceIds.filter((resourceId) => !resourceById.value.has(resourceId)).length
  notice.value = missingCount
    ? `已恢复套装；其中 ${missingCount} 项资源已经不存在，请重新选择后保存。`
    : '已恢复套装，可继续调整或发送到酒馆。'
}

async function saveBundle(): Promise<void> {
  const name = bundleName.value.trim()
  if (!name || !primaryResourceId.value || !selectedResourceIds.value.size || saving.value) return
  saving.value = true
  notice.value = ''
  try {
    const now = Date.now()
    const id = existingTemplate.value?.id ?? crypto.randomUUID()
    const template: ChatLoadout = {
      id,
      name,
      primaryResourceId: primaryResourceId.value,
      resourceIds: Array.from(selectedResourceIds.value),
      createdAt: existingTemplate.value?.createdAt ?? now,
      updatedAt: now,
    }
    templates.value = browserStorageService.setChatLoadouts([
      template,
      ...templates.value.filter((item) => item.id !== id),
    ])
    editingTemplateId.value = id
    notice.value = `已保存“${template.name}”装载方案；不会改写资源之间的永久关联。`
  } catch (error) {
    notice.value = error instanceof Error ? error.message : '套装保存失败'
  } finally {
    saving.value = false
  }
}

async function deleteTemplate(template: ChatLoadout): Promise<void> {
  const confirmed = await confirmAction({
    title: '删除资源套装',
    message: `删除“${template.name}”吗？资源文件和永久资源关联不会被删除。`,
    confirmLabel: '删除套装',
    danger: true,
  })
  if (!confirmed) return
  templates.value = browserStorageService.setChatLoadouts(
    templates.value.filter((item) => item.id !== template.id),
  )
  if (editingTemplateId.value === template.id) resetDraft()
}

function sendBundle(): void {
  if (bundleResourceIds.value.length < 2) return
  emit('sendToTavern', bundleResourceIds.value)
}

function templateAvailability(template: ChatLoadout): string {
  const ids = [template.primaryResourceId, ...template.resourceIds]
  const available = ids.filter((id) => resourceById.value.has(id)).length
  return `${available}/${ids.length} 项可用`
}
</script>

<template>
  <main class="resource-bundle-app">
    <FeatureAppHeader title="配了么" back-label="返回功能" @back="emit('back')" />

    <section class="resource-bundle-app__intro">
      <div>
        <strong>把角色卡与配套资源装成一组</strong>
        <p>装载方案只保存资源 ID，不复制原件，也不会改写资源之间的永久关联。</p>
      </div>
      <button type="button" @click="resetDraft">新建套装</button>
    </section>

    <section v-if="templates.length" class="resource-bundle-app__saved" aria-label="已保存套装">
      <header>
        <strong>我的套装</strong>
        <small>可重开、调整、发送或删除</small>
      </header>
      <div>
        <article
          v-for="template in templates"
          :key="template.id"
          :class="{ 'is-active': template.id === editingTemplateId }"
        >
          <button type="button" @click="openTemplate(template)">
            <strong>{{ template.name }}</strong>
            <small>{{ templateAvailability(template) }}</small>
          </button>
          <button type="button" aria-label="删除套装" @click="deleteTemplate(template)">
            删除
          </button>
        </article>
      </div>
    </section>

    <section class="resource-bundle-app__editor">
      <header>
        <strong>{{ editingTemplateId ? '编辑套装' : '新建套装' }}</strong>
        <small>保存与更新只改变装载方案，不建立或解除永久资源关联</small>
      </header>

      <div class="resource-bundle-app__fields">
        <label>
          <span>套装名称</span>
          <input v-model="bundleName" maxlength="80" placeholder="例如：北境角色完整套装" />
        </label>
        <label>
          <span>主资源</span>
          <select v-model="primaryResourceId">
            <option value="">选择角色卡、预设或其他主资源</option>
            <option v-for="resource in primaryOptions" :key="resource.id" :value="resource.id">
              {{ RESOURCE_TYPE_LABELS[resource.type] }} · {{ resource.name }}
            </option>
          </select>
        </label>
      </div>

      <div v-if="primaryResource" class="resource-bundle-app__primary">
        <span>主资源</span>
        <strong>{{ primaryResource.name }}</strong>
        <small
          >{{ RESOURCE_TYPE_LABELS[primaryResource.type] }} · {{ primaryResource.fileName }}</small
        >
      </div>

      <section class="resource-bundle-app__picker">
        <header>
          <strong>选择配套资源</strong>
          <small>已选 {{ selectedResourceIds.size }} 项</small>
        </header>
        <div class="resource-bundle-app__filters">
          <input v-model="query" type="search" placeholder="搜索名称、文件名或标签" />
          <select v-model="typeFilter" aria-label="按资源类型筛选">
            <option value="all">全部类型</option>
            <option v-for="type in Object.values(RESOURCE_TYPE)" :key="type" :value="type">
              {{ RESOURCE_TYPE_LABELS[type] }}
            </option>
          </select>
          <select v-model="categoryFilter" aria-label="按文件夹筛选">
            <option value="">全部文件夹</option>
            <option v-for="category in categories" :key="category.id" :value="category.id">
              {{ category.name }}
            </option>
          </select>
          <label class="resource-bundle-app__bound-filter">
            <input v-model="hideBoundElsewhere" type="checkbox" />
            <span>隐藏已经关联过的资源</span>
          </label>
        </div>

        <div v-if="candidateResources.length" class="resource-bundle-app__candidates">
          <button
            v-for="resource in candidateResources"
            :key="resource.id"
            type="button"
            :class="{ 'is-selected': selectedResourceIds.has(resource.id) }"
            @click="toggleResource(resource.id)"
          >
            <i aria-hidden="true"></i>
            <span>
              <strong>{{ resource.name }}</strong>
              <small>{{ RESOURCE_TYPE_LABELS[resource.type] }} · {{ resource.fileName }}</small>
            </span>
          </button>
        </div>
        <p v-else class="resource-bundle-app__empty">没有符合当前筛选条件的配套资源。</p>
      </section>

      <section v-if="selectedResources.length" class="resource-bundle-app__selected">
        <header>
          <strong>当前装配</strong><small>{{ bundleResourceIds.length }} 项</small>
        </header>
        <div>
          <span v-for="resource in selectedResources" :key="resource.id">
            {{ resource.name }}
            <button
              type="button"
              :aria-label="`移除 ${resource.name}`"
              @click="removeSelected(resource.id)"
            >
              ×
            </button>
          </span>
        </div>
      </section>

      <section class="resource-bundle-app__check" aria-label="套装体检">
        <div>
          <strong>{{ bundleResourceIds.length }}</strong
          ><span>资源总数</span>
        </div>
        <div :class="{ 'has-warning': executableCount }">
          <strong>{{ executableCount }}</strong
          ><span>可执行资源</span>
        </div>
        <div :class="{ 'has-warning': movingSourceCount }">
          <strong>{{ movingSourceCount }}</strong
          ><span>移动分支来源</span>
        </div>
      </section>

      <p v-if="notice" class="resource-bundle-app__notice" role="status">{{ notice }}</p>

      <footer class="resource-bundle-app__actions">
        <button
          type="button"
          :disabled="
            saving || !bundleName.trim() || !primaryResourceId || !selectedResourceIds.size
          "
          @click="saveBundle"
        >
          {{ saving ? '正在保存' : editingTemplateId ? '更新套装' : '保存套装' }}
        </button>
        <button type="button" :disabled="bundleResourceIds.length < 2" @click="sendBundle">
          去酒馆互传
        </button>
      </footer>
    </section>
  </main>
</template>

<style scoped src="../styles/ResourceBundleApp.css"></style>
