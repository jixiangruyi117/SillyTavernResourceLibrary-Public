<script setup lang="ts">
import FeatureBackButton from './FeatureBackButton.vue'

defineOptions({ inheritAttrs: false })

withDefaults(
  defineProps<{
    title: string
    titleId?: string
    backLabel?: string
    layout?: 'page' | 'panel'
    backDisabled?: boolean
  }>(),
  {
    titleId: undefined,
    backLabel: '返回功能桌面',
    layout: 'page',
    backDisabled: false,
  },
)

const emit = defineEmits<{ back: [] }>()
</script>

<template>
  <header
    class="feature-app-header"
    :class="{ 'feature-app-header--panel': layout === 'panel' }"
    data-srl-feature-header="true"
    data-srl-hook="feature-header"
  >
    <FeatureBackButton
      class="feature-app-header__back"
      :label="backLabel"
      :disabled="backDisabled"
      @click="emit('back')"
    >
      <slot name="back-icon">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14.5 6-6 6 6 6" /></svg>
      </slot>
    </FeatureBackButton>
    <div class="feature-app-header__copy">
      <h1 :id="titleId">{{ title }}</h1>
    </div>
    <div class="feature-app-header__trailing">
      <slot name="status" />
      <slot name="actions" />
    </div>
  </header>
</template>

<style src="../styles/FeatureAppHeader.css"></style>
