<script setup lang="ts">
defineProps<{ active: boolean }>()
</script>

<template>
  <Teleport v-if="active" defer to="#stitch-entry-editor-portal">
    <slot />
  </Teleport>
  <slot v-else />
</template>
