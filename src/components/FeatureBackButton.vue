<script setup lang="ts">
import { ref } from 'vue'

withDefaults(
  defineProps<{
    label: string
    title?: string
  }>(),
  {
    title: undefined,
  },
)

const emit = defineEmits<{
  click: [event: MouseEvent]
}>()

const button = ref<HTMLButtonElement>()

defineExpose({
  focus: () => button.value?.focus(),
})
</script>

<template>
  <button
    ref="button"
    class="feature-back-button"
    type="button"
    :aria-label="label"
    :title="title ?? label"
    @click="emit('click', $event)"
  >
    <slot>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14.5 6-6 6 6 6" /></svg>
    </slot>
  </button>
</template>

<style src="../styles/FeatureBackButton.css"></style>
