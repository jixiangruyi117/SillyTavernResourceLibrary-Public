<script setup lang="ts">
import { toRef, type ShallowUnwrapRef } from 'vue'
import type { useApp } from '../composables/UseApp'
import { createAsyncPanel } from '../core/AsyncPanel'
const DuplicateCleaner = createAsyncPanel('重复清理', () => import('./DuplicateCleaner.vue'))
const SimilarNameGroups = createAsyncPanel('名称相似资源', () => import('./SimilarNameGroups.vue'))
const ExtractedAssetCleaner = createAsyncPanel(
  '清理拆分副本',
  () => import('./ExtractedAssetCleaner.vue'),
)
const ParsedCharacterTagCleaner = createAsyncPanel(
  '清理自动解析标签',
  () => import('./ParsedCharacterTagCleaner.vue'),
)
const VersionRecognitionPanel = createAsyncPanel(
  '历史版本重识别',
  () => import('./VersionRecognitionPanel.vue'),
)
type PanelModel = Pick<
  ShallowUnwrapRef<ReturnType<typeof useApp>>,
  | 'isDuplicateCleanerOpen'
  | 'duplicateResources'
  | 'openResourceDetail'
  | 'handleLibraryChanged'
  | 'isSimilarNameGroupsOpen'
  | 'visibleLibraryResources'
  | 'showSimilarResources'
  | 'isExtractedCleanerOpen'
  | 'managedResources'
  | 'isParsedTagCleanerOpen'
  | 'isVersionRecognitionOpen'
  | 'sameNameVersionCandidates'
  | 'categories'
  | 'refreshLibraryAndOpenVersions'
>
const input = defineProps<{ model: PanelModel }>()
const isDuplicateCleanerOpen = toRef(input.model, 'isDuplicateCleanerOpen')
const duplicateResources = toRef(input.model, 'duplicateResources')
const openResourceDetail = toRef(input.model, 'openResourceDetail')
const handleLibraryChanged = toRef(input.model, 'handleLibraryChanged')
const isSimilarNameGroupsOpen = toRef(input.model, 'isSimilarNameGroupsOpen')
const visibleLibraryResources = toRef(input.model, 'visibleLibraryResources')
const showSimilarResources = toRef(input.model, 'showSimilarResources')
const isExtractedCleanerOpen = toRef(input.model, 'isExtractedCleanerOpen')
const managedResources = toRef(input.model, 'managedResources')
const isParsedTagCleanerOpen = toRef(input.model, 'isParsedTagCleanerOpen')
const isVersionRecognitionOpen = toRef(input.model, 'isVersionRecognitionOpen')
const sameNameVersionCandidates = toRef(input.model, 'sameNameVersionCandidates')
const categories = toRef(input.model, 'categories')
const refreshLibraryAndOpenVersions = toRef(input.model, 'refreshLibraryAndOpenVersions')
</script>
<template>
  <div
    v-if="isDuplicateCleanerOpen"
    class="editor-overlay duplicate-cleaner-overlay"
    role="presentation"
    @click.self="isDuplicateCleanerOpen = false"
  >
    <div class="duplicate-cleaner-sheet" role="dialog" aria-modal="true" aria-label="重复清理">
      <DuplicateCleaner
        :resources="duplicateResources"
        @back="isDuplicateCleanerOpen = false"
        @open-resource="
          (resource) => {
            void openResourceDetail(resource)
          }
        "
        @library-changed="handleLibraryChanged"
      />
    </div>
  </div>

  <div
    v-if="isSimilarNameGroupsOpen"
    class="editor-overlay duplicate-cleaner-overlay"
    role="presentation"
    @click.self="isSimilarNameGroupsOpen = false"
  >
    <div class="duplicate-cleaner-sheet" role="dialog" aria-modal="true" aria-label="名称相似资源">
      <SimilarNameGroups
        :resources="visibleLibraryResources"
        @filter-resources="showSimilarResources"
        @back="isSimilarNameGroupsOpen = false"
        @open-resource="
          (resource) => {
            void openResourceDetail(resource)
          }
        "
      />
    </div>
  </div>

  <div
    v-if="isExtractedCleanerOpen"
    class="editor-overlay duplicate-cleaner-overlay"
    role="presentation"
    @click.self="isExtractedCleanerOpen = false"
  >
    <div class="duplicate-cleaner-sheet" role="dialog" aria-modal="true" aria-label="清理拆分副本">
      <ExtractedAssetCleaner
        :resources="managedResources"
        @back="isExtractedCleanerOpen = false"
        @open-resource="
          (resource) => {
            void openResourceDetail(resource)
          }
        "
        @library-changed="handleLibraryChanged"
      />
    </div>
  </div>

  <div
    v-if="isParsedTagCleanerOpen"
    class="editor-overlay duplicate-cleaner-overlay"
    role="presentation"
    @click.self="isParsedTagCleanerOpen = false"
  >
    <div
      class="duplicate-cleaner-sheet"
      role="dialog"
      aria-modal="true"
      aria-label="清理自动解析标签"
    >
      <ParsedCharacterTagCleaner
        @back="isParsedTagCleanerOpen = false"
        @open-resource="
          (resource) => {
            void openResourceDetail(resource)
          }
        "
        @library-changed="handleLibraryChanged"
      />
    </div>
  </div>

  <div
    v-if="isVersionRecognitionOpen"
    class="editor-overlay duplicate-cleaner-overlay"
    role="presentation"
    @click.self="isVersionRecognitionOpen = false"
  >
    <div class="duplicate-cleaner-sheet" role="dialog" aria-modal="true" aria-label="历史版本管理">
      <VersionRecognitionPanel
        :same-name-version-candidates="sameNameVersionCandidates"
        :categories="categories"
        :resources="managedResources"
        @close="isVersionRecognitionOpen = false"
        @library-changed="refreshLibraryAndOpenVersions"
      />
    </div>
  </div>
</template>
