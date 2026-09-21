<script setup lang="ts">
import FrontendWorkshopSourceAiShell from './FrontendWorkshopSourceAiShell.vue'

const emit = defineEmits<{
  back: []
  libraryChanged: []
}>()
</script>

<template>
  <FrontendWorkshopSourceAiShell @back="emit('back')" @library-changed="emit('libraryChanged')" />
</template>
