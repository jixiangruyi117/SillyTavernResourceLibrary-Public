<script setup lang="ts">
import FeatureBackButton from './FeatureBackButton.vue'

export type FrontendWorkshopViewportAction =
  'phone' | 'wide' | 'zoom-out' | 'zoom-in' | 'reset' | 'fit-canvas' | 'fit-selection'

defineProps<{
  name: string
  saveStatus: string
  mode: 'phone' | 'wide'
  zoomPercent: number
  hasSelection: boolean
  deliveryDisabled: boolean
  deliveryLabel?: string
  deliveryText?: string
}>()
const emit = defineEmits<{
  back: []
  rename: [event: Event]
  preview: []
  delivery: []
  compatibility: []
  viewport: [action: FrontendWorkshopViewportAction]
}>()
</script>

<template>
  <header class="frontend-workbench__projectbar">
    <FeatureBackButton label="返回项目首页" @click="emit('back')" />
    <label class="project-title">
      <input :value="name" maxlength="120" aria-label="项目名称" @change="emit('rename', $event)" />
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="m4 20 4.2-1 10.4-10.4-3.2-3.2L5 15.8 4 20Z" />
        <path d="m13.8 7 3.2 3.2" />
      </svg>
    </label>
    <div class="frontend-workbench__viewport-row">
      <span class="project-device">
        <button
          type="button"
          :class="{ 'is-active': mode === 'phone' }"
          @click="emit('viewport', 'phone')"
        >
          手机
        </button>
        <button
          type="button"
          :class="{ 'is-active': mode === 'wide' }"
          @click="emit('viewport', 'wide')"
        >
          宽屏
        </button>
      </span>
      <nav class="viewport-tools" aria-label="画布视口">
        <button type="button" aria-label="缩小画布" @click="emit('viewport', 'zoom-out')">−</button>
        <output aria-label="当前画布缩放">{{ zoomPercent }}%</output>
        <button type="button" aria-label="放大画布" @click="emit('viewport', 'zoom-in')">＋</button>
        <button type="button" aria-label="重置画布视角" @click="emit('viewport', 'reset')">
          重置
        </button>
        <button type="button" @click="emit('viewport', 'fit-canvas')">适合画布</button>
        <button type="button" :disabled="!hasSelection" @click="emit('viewport', 'fit-selection')">
          适合选区
        </button>
      </nav>
      <span class="project-saved" role="status">{{ saveStatus || '已保存' }}</span>
    </div>
    <button
      class="project-preview"
      type="button"
      aria-label="打开最终预览"
      @click="emit('preview')"
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M2.8 12s3.2-5.5 9.2-5.5S21.2 12 21.2 12 18 17.5 12 17.5 2.8 12 2.8 12Z" />
        <circle cx="12" cy="12" r="2.6" /></svg
      ><span>预览</span>
    </button>
    <button
      class="project-delivery"
      type="button"
      :aria-label="deliveryLabel ?? '复制酒馆开场白'"
      :disabled="deliveryDisabled"
      @click="emit('delivery')"
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="m3 10 18-7-7 18-3-8-8-3Z M11 13 21 3" /></svg
      ><span>{{ deliveryText ?? '交付' }}</span>
    </button>
    <button
      class="project-compatibility"
      type="button"
      aria-label="兼容检查"
      @click="emit('compatibility')"
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="m12 3 7 3v6c0 4-7 9-7 9s-7-5-7-9V6l7-3Z m-3 9 2 2 4-4" /></svg
      ><span>兼容检查</span>
    </button>
  </header>
</template>

<style scoped src="../styles/FrontendWorkshopProjectBar.css"></style>
