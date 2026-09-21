<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { useResourceThumbnail } from '../composables/UseResourceThumbnail'
import type { ResourceSummary } from '../types/Resource'
const props = defineProps<{ resource: ResourceSummary; disabled?: boolean }>()
const emit = defineEmits<{ open: [] }>()
const thumbnail = useResourceThumbnail(() => props.resource)
const imageUrl = ref('')
const failed = ref(false)
function release() {
  if (imageUrl.value) URL.revokeObjectURL(imageUrl.value)
}
watch(
  thumbnail,
  (blob) => {
    release()
    imageUrl.value = blob ? URL.createObjectURL(blob) : ''
    failed.value = false
  },
  { immediate: true },
)
onBeforeUnmount(release)
</script>
<template>
  <button class="persona-app__list-item" type="button" :disabled="disabled" @click="emit('open')">
    <span class="persona-app__initial" aria-hidden="true"
      ><img v-if="imageUrl && !failed" :src="imageUrl" alt="" @error="failed = true" /><template
        v-else
        >{{ resource.name.slice(0, 1) }}</template
      ></span
    >
    <span class="persona-app__list-copy"
      ><strong>{{ resource.name }}</strong
      ><small v-if="Number(resource.metadata.itemCount) > 1"
        >{{ resource.metadata.itemCount }} 个人设 ·
        {{
          Array.isArray(resource.metadata.personaNames)
            ? resource.metadata.personaNames.join('、')
            : resource.fileName
        }}</small
      ></span
    >
    <span aria-hidden="true">›</span>
  </button>
</template>
