<script setup lang="ts">
import { ref } from 'vue'

import type {
  FrontendWorkshopAssetLink,
  FrontendWorkshopProject,
} from '../types/FrontendWorkshopProject'
import FrontendWorkshopImagePicker from './FrontendWorkshopImagePicker.vue'

defineProps<{ project: FrontendWorkshopProject }>()

const emit = defineEmits<{
  close: []
  insertAsset: [asset: FrontendWorkshopAssetLink]
  commitProject: [
    payload: { previousProject: FrontendWorkshopProject; project: FrontendWorkshopProject },
  ]
  status: [message: string]
}>()

const openState = ref(false)
const picker = ref<InstanceType<typeof FrontendWorkshopImagePicker>>()

function open(_mode: 'library' | 'hosting', _route?: 'workspace'): void {
  openState.value = true
}

function close(): void {
  if (!openState.value) return
  openState.value = false
  emit('close')
}

function back(): void {
  picker.value?.back()
}

function insertAsset(asset: FrontendWorkshopAssetLink): void {
  emit('insertAsset', asset)
  emit('status', `已导入“${asset.name}”。`)
  close()
}

defineExpose({ open, back })
</script>

<template>
  <Teleport to="body">
    <FrontendWorkshopImagePicker
      v-if="openState"
      ref="picker"
      @close="close"
      @insert-asset="insertAsset"
    />
  </Teleport>
</template>
