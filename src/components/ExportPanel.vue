<script setup lang="ts">
import { confirmAction } from '../composables/UseConfirmDialog'
import { computed, ref } from 'vue'
import type { ArchivePortableSelection } from '../types/Backup'
import BackupScopeTree from './BackupScopeTree.vue'
import {
  createDefaultBackupSelection,
  toArchivePortableSelection,
  type BackupScopeId,
} from '../services/BackupScopeRegistry'

import { type Category, type ResourceSummary } from '../types/Resource'

const props = defineProps<{
  resources: ResourceSummary[]
  categories: Category[]
  busy: boolean
}>()
const emit = defineEmits<{
  close: []
  restore: []
  full: [
    details: {
      splitSizeBytes?: number
      resourceContent: 'original' | 'modified'
      portableSelection: ArchivePortableSelection
    },
  ]
  partial: [
    details: {
      resourceIds: string[]
      includeAllCategories: boolean
      splitSizeBytes?: number
      resourceContent: 'original' | 'modified'
      portableSelection: ArchivePortableSelection
    },
  ]
}>()

const initialSelection = createDefaultBackupSelection(props.resources, 'local')
const selectedIds = ref(new Set(initialSelection.resourceIds))
const selectedScopeIds = ref<BackupScopeId[]>([...initialSelection.scopes])
const partialReview = ref(false)
const includeAllCategories = ref(false)
const splitSizeMb = ref(0)
const resourceContent = ref<'original' | 'modified'>('original')
const scopeModel = computed({
  get: () => ({ resourceIds: [...selectedIds.value], scopeIds: [...selectedScopeIds.value] }),
  set: (next: { resourceIds: string[]; scopeIds: BackupScopeId[] }) => {
    selectedIds.value = new Set(next.resourceIds)
    selectedScopeIds.value = next.scopeIds
  },
})

const selectedResources = computed(() =>
  props.resources.filter((resource) => selectedIds.value.has(resource.id)),
)
const unselectedResources = computed(() =>
  props.resources.filter((resource) => !selectedIds.value.has(resource.id)),
)
const selectedSize = computed(() =>
  selectedResources.value.reduce((total, resource) => total + resource.fileSize, 0),
)
const fullSize = computed(() =>
  props.resources.reduce((total, resource) => total + resource.fileSize, 0),
)
const splitSizeBytes = computed(() =>
  splitSizeMb.value > 0 ? splitSizeMb.value * 1024 * 1024 : undefined,
)
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function portableSelection(): ArchivePortableSelection {
  return toArchivePortableSelection({
    resourceIds: new Set(scopeModel.value.resourceIds),
    scopes: new Set(scopeModel.value.scopeIds),
  })
}

async function confirmCredentialExport(): Promise<boolean> {
  if (!scopeModel.value.scopeIds.includes('extra.credentials')) return true
  return confirmAction({
    title: '导出敏感凭证',
    message:
      '主 API、生图、图床和云备份凭据会以明文写入这个 ZIP。任何拿到文件的人都可能使用这些凭据，确认继续吗？',
    confirmLabel: '仍要导出',
    danger: true,
  })
}

async function exportFull(): Promise<void> {
  if (!(await confirmCredentialExport())) return
  emit('full', {
    splitSizeBytes: splitSizeBytes.value,
    resourceContent: resourceContent.value,
    portableSelection: portableSelection(),
  })
}

async function exportPartial(): Promise<void> {
  if (!(await confirmCredentialExport())) return
  emit('partial', {
    resourceIds: Array.from(selectedIds.value),
    includeAllCategories: includeAllCategories.value,
    splitSizeBytes: splitSizeBytes.value,
    resourceContent: resourceContent.value,
    portableSelection: portableSelection(),
  })
}

function reviewPartialExport(): void {
  if (selectedResources.value.length) partialReview.value = true
}
</script>

<template>
  <Teleport to="body">
    <div class="editor-overlay" role="presentation" @click.self="emit('close')">
      <section
        class="editor-sheet export-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="export-panel-title"
      >
        <header class="editor-sheet__header">
          <div>
            <h2 id="export-panel-title">导出资源</h2>
          </div>
          <button
            class="editor-sheet__close"
            type="button"
            aria-label="关闭"
            @click="emit('close')"
          >
            ×
          </button>
        </header>
        <section class="export-full">
          <div>
            <strong>完整资源导出</strong>
            <span>资源库内全部资源、历史版本、文件夹结构和原始文件</span>
            <small>额外设置、凭据和敏感数据仍按下方“备份范围”选择。</small>
          </div>
          <button class="button button--primary" type="button" :disabled="busy" @click="exportFull">
            {{ busy ? '正在装箱' : '导出全部资源' }}
          </button>
        </section>

        <fieldset class="export-content-mode">
          <legend>角色卡导出内容</legend>
          <label :class="{ 'is-selected': resourceContent === 'original' }">
            <input v-model="resourceContent" type="radio" value="original" />
            <span>
              <strong>原版导出</strong>
              <em>保留刚导入时的角色卡文件，不写入资源库内的正则开关与内容替换。</em>
            </span>
          </label>
          <label :class="{ 'is-selected': resourceContent === 'modified' }">
            <input v-model="resourceContent" type="radio" value="modified" />
            <span>
              <strong>修改版导出</strong>
              <em>把正则启停、替换世界书和替换开场白写入导出的角色卡副本。</em>
            </span>
          </label>
        </fieldset>

        <div class="export-divider"><span>或创建分包</span></div>

        <BackupScopeTree
          v-if="!partialReview"
          v-model="scopeModel"
          :resources="resources"
          :categories="categories"
          mode="local"
        />
        <section v-else class="export-partial-review" aria-label="确认分包内容">
          <header>
            <strong>确认分包内容</strong>
            <span>导出 {{ selectedResources.length }} 项 · {{ formatSize(selectedSize) }}</span>
          </header>
          <div>
            <strong>将导出</strong>
            <ul>
              <li v-for="resource in selectedResources" :key="resource.id">
                {{ resource.name }} · {{ formatSize(resource.fileSize) }}
              </li>
            </ul>
          </div>
          <div v-if="unselectedResources.length">
            <strong>不会导出</strong>
            <ul>
              <li v-for="resource in unselectedResources" :key="resource.id">
                {{ resource.name }} · {{ formatSize(resource.fileSize) }}
              </li>
            </ul>
          </div>
        </section>

        <label class="export-option">
          <input v-model="includeAllCategories" type="checkbox" />
          <span>
            <strong>分包保留全部文件夹结构</strong>
            <small>仅影响分包；关闭时只保存所选资源正在使用的文件夹</small>
          </span>
        </label>

        <label class="export-option export-option--split">
          <span class="export-option__marker">ZIP</span>
          <span>
            <strong>分卷导出</strong>
            <small>仅改变打包方式；按容量生成多个可独立恢复的 ZIP，不会拆分单个资源。</small>
          </span>
          <select v-model="splitSizeMb" aria-label="分卷容量">
            <option :value="0">不分卷</option>
            <option :value="256">每卷约 256 MB</option>
            <option :value="512">每卷约 512 MB</option>
            <option :value="1024">每卷约 1 GB</option>
          </select>
        </label>

        <p v-if="fullSize >= 256 * 1024 * 1024" class="export-size-warning">
          当前完整资源约 {{ formatSize(fullSize) }}，建议选择分卷；浏览器仍需为单个 ZIP
          保留输出空间。
        </p>
        <p v-else-if="selectedSize >= 256 * 1024 * 1024" class="export-size-warning">
          当前所选资源约 {{ formatSize(selectedSize) }}，建议选择分卷后再导出。
        </p>

        <footer class="export-footer">
          <span>{{
            partialReview ? '已按当前资源库逐项核对。' : 'ZIP 仅在本机生成，不会上传。'
          }}</span>
          <button
            v-if="!partialReview"
            class="button button--primary"
            type="button"
            :disabled="busy || selectedResources.length === 0"
            @click="reviewPartialExport"
          >
            检查分包内容（{{ selectedResources.length }} 项）
          </button>
          <template v-else>
            <button
              class="button button--secondary"
              type="button"
              :disabled="busy"
              @click="partialReview = false"
            >
              返回修改
            </button>
            <button
              class="button button--primary"
              type="button"
              :disabled="busy || selectedResources.length === 0"
              @click="exportPartial"
            >
              {{ busy ? '正在装箱' : `确认导出 ${selectedResources.length} 项` }}
            </button>
          </template>
        </footer>

        <button
          class="export-restore-entry"
          type="button"
          :disabled="busy"
          @click="emit('restore')"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 7h6l2 2h8v10H4V7Zm8 9V11m0 0-3 3m3-3 3 3" />
          </svg>
          <span>
            <strong>从 ZIP 恢复备份</strong>
            <small>先预检内容和冲突，再决定是否写入</small>
          </span>
        </button>
      </section>
    </div>
  </Teleport>
</template>
