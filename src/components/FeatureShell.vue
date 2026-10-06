<script setup lang="ts">
import FeatureAppHeader from './FeatureAppHeader.vue'
import FeatureStateView from './FeatureStateView.vue'

withDefaults(
  defineProps<{
    title: string
    titleId?: string
    backLabel?: string
    state?: 'ready' | 'loading' | 'error' | 'offline' | 'permission' | 'empty'
    stateTitle?: string
    stateDescription?: string
  }>(),
  {
    titleId: undefined,
    backLabel: '返回功能桌面',
    state: 'ready',
    stateTitle: '',
    stateDescription: undefined,
  },
)

defineEmits<{ back: [] }>()
</script>

<template>
  <FeatureAppHeader
    :title="title"
    :title-id="titleId"
    :back-label="backLabel"
    @back="$emit('back')"
  >
    <template v-if="$slots.status" #status><slot name="status" /></template>
    <template v-if="$slots.actions" #actions><slot name="actions" /></template>
  </FeatureAppHeader>
  <FeatureStateView
    v-if="state !== 'ready'"
    :state="state"
    :title="stateTitle"
    :description="stateDescription"
  >
    <template v-if="$slots['state-actions']" #actions><slot name="state-actions" /></template>
  </FeatureStateView>
  <slot v-else />
</template>
