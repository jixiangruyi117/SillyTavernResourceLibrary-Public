<script setup lang="ts">
import { ref, watch, onBeforeUnmount } from 'vue'
import { Capacitor, registerPlugin } from '@capacitor/core'

const props = defineProps<{
  source: string
  geometry: {
    viewportWidth: number
    viewportHeight: number
    width: number
    height: number
    x: number
    y: number
  }
}>()
const emit = defineEmits<{
  dimensions: [width: number, height: number]
  loaded: []
  unavailable: []
}>()
const plugin = registerPlugin<{
  inspectImage(options: {
    uri: string
  }): Promise<{ width: number; height: number; supported: boolean }>
  readImageRegion(options: {
    uri: string
    left: number
    top: number
    right: number
    bottom: number
    edge: number
  }): Promise<{ uri: string }>
  releaseThumbnail(options: { uri: string }): Promise<void>
}>('NativeImages')
const canvas = ref<HTMLCanvasElement>()
let revision = 0,
  pending = false,
  dirty = false
let dimensions: { width: number; height: number } | undefined

async function paint() {
  dirty = true
  if (pending) return
  pending = true
  let activeRevision = revision
  try {
    while (dirty) {
      dirty = false
      const info = dimensions,
        element = canvas.value,
        frame = { ...props.geometry },
        token = revision
      activeRevision = token
      if (!info || !element || !frame.width || !frame.height) continue
      const left = (frame.viewportWidth - frame.width) / 2 + frame.x
      const top = (frame.viewportHeight - frame.height) / 2 + frame.y
      const region = {
        left: Math.max(0, Math.floor((-left / frame.width) * info.width)),
        top: Math.max(0, Math.floor((-top / frame.height) * info.height)),
        right: Math.min(
          info.width,
          Math.ceil(((frame.viewportWidth - left) / frame.width) * info.width),
        ),
        bottom: Math.min(
          info.height,
          Math.ceil(((frame.viewportHeight - top) / frame.height) * info.height),
        ),
      }
      if (region.right <= region.left || region.bottom <= region.top) continue
      const ratio = Math.min(
        window.devicePixelRatio || 1,
        2048 / Math.max(frame.viewportWidth, frame.viewportHeight),
      )
      const tile = await plugin.readImageRegion({
        uri: props.source,
        ...region,
        edge: Math.min(
          2048,
          Math.ceil(Math.max(frame.viewportWidth, frame.viewportHeight) * ratio),
        ),
      })
      try {
        if (token !== revision) continue
        const image = new Image()
        await new Promise<void>((resolve, reject) => {
          image.onload = () => resolve()
          image.onerror = () => reject(new Error('分块读取失败'))
          image.src = Capacitor.convertFileSrc(tile.uri)
        })
        if (token !== revision) continue
        element.width = Math.max(1, Math.ceil(frame.viewportWidth * ratio))
        element.height = Math.max(1, Math.ceil(frame.viewportHeight * ratio))
        const context = element.getContext('2d')!
        context.scale(ratio, ratio)
        context.drawImage(
          image,
          left + (region.left / info.width) * frame.width,
          top + (region.top / info.height) * frame.height,
          ((region.right - region.left) / info.width) * frame.width,
          ((region.bottom - region.top) / info.height) * frame.height,
        )
        emit('loaded')
      } finally {
        await plugin.releaseThumbnail({ uri: tile.uri })
      }
    }
  } catch {
    if (activeRevision === revision && canvas.value) emit('unavailable')
  } finally {
    pending = false
    if (dirty && dimensions) void paint()
  }
}

watch(
  () => props.source,
  async (source) => {
    const token = ++revision
    dimensions = undefined
    try {
      const info = await plugin.inspectImage({ uri: source })
      if (token !== revision) return
      if (!info.supported || info.width <= 0 || info.height <= 0) {
        emit('unavailable')
        return
      }
      dimensions = info
      emit('dimensions', info.width, info.height)
      await paint()
    } catch {
      if (token === revision) emit('unavailable')
    }
  },
  { immediate: true },
)
watch(
  () => props.geometry,
  () => void paint(),
  { flush: 'post' },
)
onBeforeUnmount(() => {
  revision++
  dirty = false
  dimensions = undefined
})
</script>

<template>
  <canvas ref="canvas" class="native-image-tiles" aria-hidden="true" />
</template>

<style scoped>
.native-image-tiles {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}
</style>
