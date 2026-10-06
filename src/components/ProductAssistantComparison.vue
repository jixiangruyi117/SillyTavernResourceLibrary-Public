<script setup lang="ts">
import { computed, ref } from 'vue'
import type { AssistantAppearanceComparison } from '../services/ProductAssistantAppearanceComparison'
import type { AssistantImage } from '../services/ProductAssistantService'
const props = defineProps<{
  comparison: AssistantAppearanceComparison
  currentId?: string
  busy: boolean
}>()
const emit = defineEmits<{
  action: [operation: 'keep-comparison' | 'undo-comparison', id: string]
  view: [image: AssistantImage]
}>()
const side = ref<'before' | 'after'>('after')
const image = computed(() => props.comparison[side.value])
</script>
<template>
  <section class="chat-comparison" :aria-label="`${comparison.title}美化对比`">
    <header>
      <strong>{{ comparison.title }}</strong
      ><span>{{
        comparison.state === 'undone'
          ? '已撤销'
          : comparison.state === 'kept'
            ? '已保留'
            : '美化对比'
      }}</span>
    </header>
    <div class="chat-comparison-switch" role="group" aria-label="切换对比截图">
      <button type="button" :aria-pressed="side === 'before'" @click="side = 'before'">
        修改前
      </button>
      <button type="button" :aria-pressed="side === 'after'" @click="side = 'after'">修改后</button>
    </div>
    <button
      v-if="image"
      type="button"
      class="chat-comparison-image"
      :aria-label="`放大${side === 'before' ? '修改前' : '修改后'}截图`"
      @click="emit('view', image)"
    >
      <img :src="image.dataUrl" :alt="side === 'before' ? '修改前实际界面' : '修改后实际界面'" />
    </button>
    <p v-else class="chat-empty">{{ comparison.captureError || '较早对比图已释放' }}</p>
    <footer v-if="comparison.state !== 'undone'">
      <button
        type="button"
        :disabled="busy || currentId !== comparison.id"
        @click="emit('action', 'undo-comparison', comparison.id)"
      >
        撤销
      </button>
      <button
        type="button"
        :disabled="busy || currentId !== comparison.id || comparison.state === 'kept'"
        @click="emit('action', 'keep-comparison', comparison.id)"
      >
        保留
      </button>
    </footer>
  </section>
</template>
