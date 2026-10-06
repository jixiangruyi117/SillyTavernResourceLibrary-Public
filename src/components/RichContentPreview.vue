<script setup lang="ts">
import {
  useRichContentPreview,
  type RichContentPreviewProps,
  type RichContentPreviewEvents,
} from '../composables/UseRichContentPreview'
const props = withDefaults(defineProps<RichContentPreviewProps>(), {
  active: true,
  emptyText: '没有内容。',
  swipePassthrough: false,
  immersive: false,
  bare: false,
  runtimeScripts: () => [],
  charAvatar: undefined,
  inspector: false,
  renderShell: 'message',
  messageAvatarMode: 'visible',
  sourceKind: 'chatMessage',
  macroCharName: undefined,
  macroUserName: undefined,
  greetingContents: () => [],
  greetingIndex: 0,
  characterData: undefined,
  displayRegexRules: () => [],
  frontendWorkshopBehaviorRuntime: false,
  preloadResources: false,
  preloadTrustedResources: false,
  viewportWidth: undefined,
  scale: 1,
})
const emit = defineEmits<RichContentPreviewEvents>()
const {
  hasPreviewInput,
  view,
  setView,
  detailsState,
  allDetailsOpen,
  togglePreviewDetails,
  isFrameInteractive,
  previewEnabled,
  preview,
  frameInteractive,
  frameContainerStyle,
  previewPolicy,
  previewRevision,
  isPreviewLoading,
  frameStyle,
  handleFrameLoad,
  previewSource,
} = useRichContentPreview(props, emit)
</script>

<template>
  <div
    v-if="hasPreviewInput"
    ref="previewHost"
    class="rich-content-preview"
    :class="{ 'rich-content-preview--immersive': immersive, 'rich-content-preview--bare': bare }"
  >
    <header v-if="!bare || sourceKind === 'openingArchive'" class="rich-content-preview__toolbar">
      <div role="group" aria-label="查看方式">
        <button
          type="button"
          :class="{ 'is-active': view === 'preview' }"
          @click="setView('preview')"
        >
          效果预览
        </button>
        <button
          type="button"
          :class="{ 'is-active': view === 'source' }"
          @click="setView('source')"
        >
          阅读原文
        </button>
        <button
          v-if="view === 'preview' && detailsState.total > 0"
          type="button"
          :class="{ 'is-active': allDetailsOpen }"
          :aria-pressed="allDetailsOpen"
          @click="togglePreviewDetails"
        >
          {{ allDetailsOpen ? '收起折叠' : '展开折叠' }}
        </button>
        <button
          v-if="view === 'preview' && swipePassthrough"
          type="button"
          :class="{ 'is-active': isFrameInteractive }"
          :aria-pressed="isFrameInteractive"
          @click="isFrameInteractive = !isFrameInteractive"
        >
          {{ isFrameInteractive ? '继续滑动' : '操作预览' }}
        </button>
      </div>
    </header>

    <div
      v-if="view === 'preview' && active && previewEnabled && preview?.document"
      class="rich-content-preview__frame"
      :class="{ 'is-interactive': frameInteractive }"
      :style="frameContainerStyle"
    >
      <iframe
        ref="frame"
        :key="`${previewPolicy.allowRemoteResources}-${previewPolicy.allowScripts}-${renderShell}-${sourceKind}-${previewRevision}`"
        :srcdoc="preview?.document"
        :class="{ 'is-loading': isPreviewLoading }"
        sandbox="allow-scripts allow-same-origin"
        :allow="previewPolicy.allowRemoteResources ? 'autoplay' : undefined"
        :style="frameStyle"
        loading="lazy"
        :title="`${title}预览`"
        @load="handleFrameLoad"
      ></iframe>
      <div v-if="isPreviewLoading" class="rich-content-preview__loading" role="status">
        <span class="rich-content-preview__loading-label">正在加载预览</span>
        <i class="rich-content-preview__loading-bar" role="progressbar" aria-label="预览加载中"></i>
      </div>
      <span v-if="swipePassthrough && !isFrameInteractive">左右滑动切换开场白</span>
    </div>
    <div v-else-if="view === 'preview'" class="rich-content-preview__standby">
      {{
        !active
          ? '滑到当前内容后加载预览'
          : previewEnabled
            ? '正在准备预览'
            : '预览资源已暂停，回到可见区域后恢复'
      }}
    </div>
    <pre v-else>{{ previewSource || emptyText }}</pre>
  </div>
  <pre v-else class="rich-content-preview__plain">{{ previewSource || emptyText }}</pre>
</template>

<style scoped src="../styles/RichContentPreview.css"></style>
