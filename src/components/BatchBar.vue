<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'

import type { Category } from '../types/Resource'

defineProps<{
  count: number
  visibleCount: number
  allVisibleSelected: boolean
  scopeCount: number
  scopeLabel: string
  allScopeSelected: boolean
  selectedCharacterCount: number
  categories: Category[]
  busy: boolean
}>()
const emit = defineEmits<{
  resize: [height: number]
  close: []
  toggleVisible: []
  toggleScope: []
  extractCharacterAssets: []
  favorite: [favorite: boolean]
  move: [categoryId: string | null]
  manageFolders: []
  tag: [details: { tag: string; action: 'add' | 'remove' }]
  aiTag: []
  delete: []
}>()

const categoryId = ref('')
const tagName = ref('')
const bar = ref<HTMLElement>()
let resizeObserver: ResizeObserver | undefined

onMounted(() => {
  if (!bar.value) return
  const reportHeight = () => emit('resize', bar.value?.getBoundingClientRect().height ?? 0)
  reportHeight()
  if (typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(reportHeight)
    resizeObserver.observe(bar.value, { box: 'border-box' })
  }
})

onUnmounted(() => {
  resizeObserver?.disconnect()
  emit('resize', 0)
})
</script>

<template>
  <aside ref="bar" class="batch-bar" aria-label="批量操作">
    <div class="batch-bar__summary">
      <strong>{{ count }}</strong>
      <span>项已选择</span>
    </div>

    <div class="batch-bar__tags">
      <input
        v-model="tagName"
        type="text"
        maxlength="40"
        placeholder="批量标签"
        aria-label="批量标签名称"
        :disabled="busy || !count"
      />
      <button
        class="batch-bar__button"
        type="button"
        :disabled="busy || !count || !tagName.trim()"
        @click="emit('tag', { tag: tagName, action: 'add' })"
      >
        加标签
      </button>
      <button
        class="batch-bar__button"
        type="button"
        :disabled="busy || !count || !tagName.trim()"
        @click="emit('tag', { tag: tagName, action: 'remove' })"
      >
        删标签
      </button>
    </div>

    <button
      class="batch-bar__button"
      type="button"
      :disabled="busy || !visibleCount"
      @click="emit('toggleVisible')"
    >
      {{ allVisibleSelected ? '取消本页' : `选择本页 ${visibleCount}` }}
    </button>

    <button
      class="batch-bar__button batch-bar__button--scope"
      type="button"
      :disabled="busy || !scopeCount"
      :title="`${scopeLabel}共 ${scopeCount} 项`"
      @click="emit('toggleScope')"
    >
      {{ allScopeSelected ? `取消${scopeLabel}` : `全选${scopeLabel} ${scopeCount}` }}
    </button>

    <button
      class="batch-bar__button batch-bar__button--extract"
      type="button"
      :disabled="busy || !selectedCharacterCount"
      title="将所选角色卡或预设内嵌的世界书、整组正则保存为独立资源，并自动双向绑定"
      @click="emit('extractCharacterAssets')"
    >
      拆分配套 {{ selectedCharacterCount || '' }}
    </button>

    <button
      class="batch-bar__button batch-bar__button--ai"
      type="button"
      :disabled="busy"
      title="按分类、文件夹和标签状态筛选资源，小批交给 AI 识别并在审核后写入"
      @click="emit('aiTag')"
    >
      AI 识别标签
    </button>

    <div class="batch-bar__group">
      <button
        class="batch-bar__button"
        type="button"
        :disabled="busy || !count"
        @click="emit('favorite', true)"
      >
        收藏
      </button>
      <button
        class="batch-bar__button"
        type="button"
        :disabled="busy || !count"
        @click="emit('favorite', false)"
      >
        取消收藏
      </button>
    </div>

    <div class="batch-bar__move">
      <select v-model="categoryId" aria-label="批量加入文件夹" :disabled="busy || !count">
        <option value="">清除全部文件夹</option>
        <option v-for="category in categories" :key="category.id" :value="category.id">
          {{ category.name }}
        </option>
      </select>
      <button
        class="batch-bar__button"
        type="button"
        :disabled="busy || !count"
        @click="emit('move', categoryId || null)"
      >
        {{ categoryId ? '加入文件夹' : '清除文件夹' }}
      </button>
      <button
        class="batch-bar__button batch-bar__button--folder"
        type="button"
        :disabled="busy"
        @click="emit('manageFolders')"
      >
        新建文件夹
      </button>
    </div>

    <button
      class="batch-bar__button batch-bar__button--danger"
      type="button"
      :disabled="busy || !count"
      @click="emit('delete')"
    >
      删除
    </button>

    <button class="batch-bar__close" type="button" aria-label="退出批量模式" @click="emit('close')">
      ×
    </button>
  </aside>
</template>
