<script setup lang="ts">
import { ref, watch } from 'vue'
import type { ResourceSummary } from '../types/Resource'
import { galleryImageUrl } from '../types/ResourceGallery'
import { useResourceThumbnail } from '../composables/UseResourceThumbnail'
import { useLoadedObjectUrl } from '../composables/UseLoadedObjectUrl'
const props = defineProps<{
  image: ResourceSummary
  selected: boolean
  selecting: boolean
  disabled?: boolean
  cover: boolean
}>()
const emit = defineEmits<{ open: []; select: []; menu: [] }>()
const element = ref<HTMLElement | null>(null)
const blob = useResourceThumbnail(() => props.image, element)
const { previewUrl, replacePreview, confirmPreviewLoaded } = useLoadedObjectUrl()
const failed = ref(false)
watch(
  () => [blob.value, galleryImageUrl(props.image)] as const,
  ([value, url]) => {
    failed.value = false
    replacePreview(url || (value ? URL.createObjectURL(value) : ''))
  },
  { immediate: true },
)
</script>
<template>
  <article
    ref="element"
    class="resource-gallery__tile"
    :class="{ 'resource-gallery__tile--selected': selected }"
  >
    <button
      class="resource-gallery__picture"
      type="button"
      :disabled="disabled"
      :aria-label="`${selecting ? '选择' : '查看'} ${image.name}`"
      :aria-pressed="selecting ? selected : undefined"
      @click="selecting ? emit('select') : emit('open')"
    >
      <img
        v-if="previewUrl && !failed"
        :src="previewUrl"
        :alt="image.name"
        loading="lazy"
        referrerpolicy="no-referrer"
        @load="confirmPreviewLoaded"
        @error="failed = true"
      />
      <span v-else>{{ failed ? '图片不可用' : '图片' }}</span>
      <small v-if="cover || selecting" class="resource-gallery__badge">{{
        selecting ? (selected ? '已选' : '选择') : '封面'
      }}</small>
    </button>
    <div class="resource-gallery__caption">
      <span :title="image.name">{{ image.name }}</span
      ><button
        class="button button--quiet"
        type="button"
        :disabled="disabled"
        :aria-label="`管理 ${image.name}`"
        @click="emit('menu')"
      >
        ⋯
      </button>
    </div>
  </article>
</template>
