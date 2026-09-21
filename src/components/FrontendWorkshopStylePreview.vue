<script setup lang="ts">
import { ref } from 'vue'
import type { WorkshopStyle } from '../utils/FrontendWorkshopStyleCatalog'
defineProps<{ styleEntry: WorkshopStyle }>()
const sample = ref(0)
</script>

<template>
  <div class="fw-style-preview">
    <div
      class="fw-style-scene"
      :class="`fw-style-${styleEntry.id}`"
      :aria-label="`${styleEntry.name}原创风格示例`"
    >
      <article class="fw-style-card">
        <span class="fw-style-overline">人物档案 / 07</span>
        <h3>{{ sample ? '选择开场' : '沈砚潮' }}</h3>
        <p>
          {{ sample ? '暴雨码头 / 深潜事故 / 黎明返航' : '潮汐之外，一位观察者的未公开档案。' }}
        </p>
        <span class="fw-style-sample-link">{{
          sample ? '01 · 暴雨码头 →' : '阅读人物档案 →'
        }}</span>
      </article>
    </div>
    <div class="fw-style-select">
      <button type="button" :aria-pressed="sample === 0" @click="sample = 0">人物档案示例</button
      ><button type="button" :aria-pressed="sample === 1" @click="sample = 1">开场选择示例</button>
    </div>
    <div class="fw-style-palette">
      <i
        v-for="color in styleEntry.palette"
        :key="color"
        :style="{ background: color }"
        aria-hidden="true"
      /><small>示例配色，可以自由更换</small>
    </div>
  </div>
</template>

<style scoped src="../styles/FrontendWorkshopStylePreview.css"></style>
